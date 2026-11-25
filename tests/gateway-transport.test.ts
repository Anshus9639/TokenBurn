import test from "node:test";
import assert from "node:assert/strict";
import {
  apiModelId,
  completeChat,
  GatewayTransportError,
  streamChat,
  type GatewayTransportInput,
} from "@/lib/gateway/transport";
import type { GatewayChatRequest } from "@/lib/gateway/types";

function request(overrides: Partial<GatewayChatRequest> = {}): GatewayChatRequest {
  return { messages: [{ role: "user", content: "Hello" }], ...overrides };
}

function input(overrides: Partial<GatewayTransportInput> = {}): GatewayTransportInput {
  return {
    provider: "openai",
    model: "gpt-4.1-mini",
    apiKey: "sk-test-secret-key-123",
    request: request(),
    maxOutputTokens: 256,
    maxAttempts: 1,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req-head" },
  });
}

function sseResponse(events: Array<Record<string, unknown> | string>): Response {
  const text = events
    .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

test("OpenAI-compatible non-stream completion normalizes usage and tool calls", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return jsonResponse({
      id: "chatcmpl-1",
      model: "gpt-4.1-mini-2025-04-14",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Calling a tool.",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    });
  };

  const completion = await completeChat(input({ fetchImpl }));
  assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("authorization"), "Bearer sk-test-secret-key-123");
  const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.equal(body.model, "gpt-4.1-mini");
  assert.equal(body.max_tokens, 256);
  assert.equal(body.stream, false);

  assert.equal(completion.content, "Calling a tool.");
  assert.equal(completion.finishReason, "tool_calls");
  assert.equal(completion.toolCalls[0]?.function?.name, "lookup");
  assert.equal(completion.usage?.inputTokens, 120);
  assert.equal(completion.usage?.cachedInputTokens, 20);
  assert.equal(completion.usage?.outputTokens, 30);
  assert.equal(completion.usage?.reasoningTokens, 5);
  assert.equal(completion.providerRequestId, "chatcmpl-1");
});

test("OpenAI structured output and parameters pass through", async () => {
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      id: "chatcmpl-2",
      choices: [{ message: { role: "assistant", content: '{"ok":true}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
    });
  };
  const format = {
    type: "json_schema" as const,
    json_schema: { name: "result", schema: { type: "object", properties: { ok: { type: "boolean" } } }, strict: true },
  };
  await completeChat(
    input({
      fetchImpl,
      request: request({
        response_format: format,
        temperature: 0.2,
        top_p: 0.9,
        seed: 7,
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
        tool_choice: "none",
      }),
    }),
  );
  assert.deepEqual(body.response_format, format);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.top_p, 0.9);
  assert.equal(body.seed, 7);
  assert.equal(body.tool_choice, "none");
  assert.ok(Array.isArray(body.tools));
});

test("Anthropic messages, tools and usage are translated", async () => {
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Looking that up." },
        { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 40, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 12 },
    });
  };
  const completion = await completeChat(
    input({
      provider: "anthropic",
      model: "claude-sonnet-4",
      fetchImpl,
      request: request({
        messages: [
          { role: "system", content: "You are terse." },
          { role: "user", content: "Look up x." },
          { role: "assistant", content: null, tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: '{"q":"x"}' } }] },
          { role: "tool", content: "result", tool_call_id: "call_1" },
        ],
        tools: [{ type: "function", function: { name: "lookup", description: "Look up", parameters: { type: "object" } } }],
        tool_choice: "auto",
      }),
    }),
  );

  assert.equal(body.model, "claude-sonnet-4-20250514");
  assert.equal(body.system, "You are terse.");
  assert.equal(body.max_tokens, 256);
  const messages = body.messages as Array<Record<string, unknown>>;
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[1]?.role, "assistant");
  const assistantBlocks = messages[1]?.content as Array<Record<string, unknown>>;
  assert.equal(assistantBlocks[0]?.type, "tool_use");
  const toolResult = (messages[2]?.content as Array<Record<string, unknown>>)[0];
  assert.equal(toolResult?.type, "tool_result");
  const tools = body.tools as Array<Record<string, unknown>>;
  assert.equal(tools[0]?.name, "lookup");
  assert.deepEqual(body.tool_choice, { type: "auto" });

  assert.equal(completion.content, "Looking that up.");
  assert.equal(completion.toolCalls[0]?.function?.arguments, '{"q":"x"}');
  assert.equal(completion.finishReason, "tool_calls");
  assert.equal(completion.usage?.inputTokens, 50);
  assert.equal(completion.usage?.cachedInputTokens, 10);
  assert.equal(completion.usage?.cacheWriteTokens, 5);
  assert.equal(completion.usage?.outputTokens, 12);
});

test("Anthropic JSON schema uses a forced tool and returns content JSON", async () => {
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      id: "msg_2",
      content: [{ type: "tool_use", id: "toolu_2", name: "result", input: { ok: true } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 8 },
    });
  };
  const completion = await completeChat(
    input({
      provider: "anthropic",
      model: "claude-3-5-haiku",
      fetchImpl,
      request: request({
        response_format: {
          type: "json_schema",
          json_schema: { name: "result", schema: { type: "object", properties: { ok: { type: "boolean" } } } },
        },
      }),
    }),
  );
  assert.deepEqual(body.tool_choice, { type: "tool", name: "result" });
  assert.equal(completion.content, '{"ok":true}');
  assert.equal(completion.toolCalls.length, 0);
  assert.equal(completion.finishReason, "stop");
});

test("Gemini contents, tool responses and usage are translated", async () => {
  let url = "";
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (target, init) => {
    url = String(target);
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      responseId: "g-1",
      modelVersion: "gemini-2.5-flash",
      candidates: [
        {
          content: { role: "model", parts: [{ text: "It is 12." }, { functionCall: { name: "lookup", args: { q: "x" } } }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 30, cachedContentTokenCount: 5, candidatesTokenCount: 9, thoughtsTokenCount: 2 },
    });
  };
  const completion = await completeChat(
    input({
      provider: "gemini",
      model: "gemini-2.5-flash",
      fetchImpl,
      request: request({
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "What is x?" },
          { role: "assistant", content: null, tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: '{"q":"x"}' } }] },
          { role: "tool", content: "12", tool_call_id: "call_1" },
        ],
        response_format: { type: "json_object" },
      }),
    }),
  );
  assert.match(url, /models\/gemini-2\.5-flash:generateContent$/);
  const systemInstruction = body.systemInstruction as { parts: Array<{ text: string }> };
  assert.match(systemInstruction.parts[0]?.text ?? "", /Be brief\./);
  assert.match(systemInstruction.parts[0]?.text ?? "", /Return a single valid JSON value/);
  const contents = body.contents as Array<Record<string, unknown>>;
  assert.equal(contents[0]?.role, "user");
  assert.equal(contents[1]?.role, "model");
  assert.ok(JSON.stringify(contents[1]).includes("functionCall"));
  assert.equal(contents[2]?.role, "user");
  assert.ok(JSON.stringify(contents[2]).includes("functionResponse"));
  const config = body.generationConfig as Record<string, unknown>;
  assert.equal(config.responseMimeType, "application/json");

  assert.equal(completion.content, "It is 12.");
  assert.equal(completion.finishReason, "tool_calls");
  assert.equal(completion.toolCalls[0]?.function?.name, "lookup");
  assert.equal(completion.usage?.inputTokens, 30);
  assert.equal(completion.usage?.cachedInputTokens, 5);
  assert.equal(completion.usage?.outputTokens, 9);
  assert.equal(completion.usage?.reasoningTokens, 2);
});

test("OpenAI streaming is passed through and usage is captured", async () => {
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return sseResponse([
      { id: "chatcmpl-s1", choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
      { id: "chatcmpl-s1", choices: [{ index: 0, delta: { content: "Hi" } }] },
      { id: "chatcmpl-s1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { id: "chatcmpl-s1", choices: [], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } },
      "[DONE]",
    ]);
  };
  const { stream, done } = await streamChat(input({ fetchImpl, request: request({ stream: true }) }));
  const raw = await readAll(stream);
  const completion = await done;

  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.match(raw, /"content":"Hi"/);
  assert.match(raw, /data: \[DONE\]/);
  assert.equal(completion.content, "Hi");
  assert.equal(completion.finishReason, "stop");
  assert.equal(completion.usage?.inputTokens, 8);
  assert.equal(completion.usage?.outputTokens, 2);
});

test("Anthropic streaming is translated to OpenAI chunks with tool calls", async () => {
  const fetchImpl: typeof fetch = async () =>
    sseResponse([
      {
        type: "message_start",
        message: {
          id: "msg_s1",
          model: "claude-sonnet-4",
          usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_s1", name: "lookup" } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"q":' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"x"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
      { type: "message_stop" },
    ]);
  const { stream, done } = await streamChat(
    input({ provider: "anthropic", model: "claude-sonnet-4", fetchImpl, request: request({ stream: true }) }),
  );
  const raw = await readAll(stream);
  const completion = await done;

  assert.match(raw, /"content":"Hello"/);
  assert.match(raw, /"tool_calls"/);
  assert.match(raw, /data: \[DONE\]/);
  assert.equal(completion.content, "Hello world");
  assert.equal(completion.finishReason, "tool_calls");
  assert.equal(completion.toolCalls[0]?.id, "toolu_s1");
  assert.equal(completion.toolCalls[0]?.function?.arguments, '{"q":"x"}');
  assert.equal(completion.usage?.inputTokens, 10);
  assert.equal(completion.usage?.outputTokens, 7);
});

test("Gemini streaming is translated with usage metadata", async () => {
  const fetchImpl: typeof fetch = async () =>
    sseResponse([
      { responseId: "g-s1", candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }] },
      {
        responseId: "g-s1",
        candidates: [{ content: { role: "model", parts: [{ text: " there" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 12, cachedContentTokenCount: 2, candidatesTokenCount: 4 },
      },
    ]);
  const { stream, done } = await streamChat(
    input({ provider: "gemini", model: "gemini-2.5-flash", fetchImpl, request: request({ stream: true }) }),
  );
  const raw = await readAll(stream);
  const completion = await done;

  assert.match(raw, /"content":"Hi"/);
  assert.match(raw, /"content":" there"/);
  assert.match(raw, /data: \[DONE\]/);
  assert.equal(completion.content, "Hi there");
  assert.equal(completion.finishReason, "stop");
  assert.equal(completion.usage?.inputTokens, 12);
  assert.equal(completion.usage?.cachedInputTokens, 2);
  assert.equal(completion.usage?.outputTokens, 4);
});

test("retryable provider errors retry, non-retryable errors throw redacted messages", async () => {
  let calls = 0;
  const retrying: typeof fetch = async () => {
    calls++;
    if (calls === 1) return jsonResponse({ error: { message: "slow down" } }, 429);
    return jsonResponse({
      id: "chatcmpl-r",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    });
  };
  const completion = await completeChat(
    input({ fetchImpl: retrying, maxAttempts: 2, sleep: async () => {}, request: request() }),
  );
  assert.equal(completion.content, "ok");
  assert.equal(calls, 2);

  const denied: typeof fetch = async () =>
    jsonResponse({ error: { message: "Incorrect API key provided: sk-test-secret-key-123" } }, 401);
  await assert.rejects(
    () => completeChat(input({ fetchImpl: denied, maxAttempts: 1 })),
    (error: unknown) => {
      assert.ok(error instanceof GatewayTransportError);
      assert.equal(error.info.code, "invalid_credentials");
      assert.equal(error.info.retryable, false);
      assert.ok(!error.message.includes("sk-test-secret-key-123"));
      return true;
    },
  );
});

test("stream start errors are thrown before a stream is returned", async () => {
  const denied: typeof fetch = async () =>
    jsonResponse({ error: { message: "bad key" } }, 401);
  await assert.rejects(
    () =>
      streamChat(
        input({ provider: "groq", model: "llama-3.1-8b-instant", fetchImpl: denied, maxAttempts: 1, request: request({ stream: true }) }),
      ),
    (error: unknown) => error instanceof GatewayTransportError && error.info.code === "invalid_credentials",
  );
});

test("catalog model ids map to provider wire ids", () => {
  assert.equal(apiModelId("anthropic", "claude-sonnet-4"), "claude-sonnet-4-20250514");
  assert.equal(apiModelId("openai", "gpt-4.1-mini"), "gpt-4.1-mini");
  assert.equal(apiModelId("gemini", "gemini-2.5-pro"), "gemini-2.5-pro");
});
