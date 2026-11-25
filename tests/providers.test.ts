import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anthropicAdapter,
  extractStreamUsage,
  geminiAdapter,
  getAdapter,
  groqAdapter,
  mistralAdapter,
  normalizeProviderError,
  openaiAdapter,
  redactSecrets,
} from "@/lib/providers";
import { chatWithProvider, ProviderRuntimeError, verifyProviderCredential } from "@/lib/providers/runtime";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { impl, calls };
}

describe("provider adapters", () => {
  it("normalizes OpenAI usage with cached prompt tokens and reasoning", () => {
    const usage = openaiAdapter.normalize({
      id: "req_1",
      model: "gpt-4.1-2025-04-14",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 400 },
        completion_tokens_details: { reasoning_tokens: 50 },
      },
    });
    assert.equal(usage.model, "gpt-4.1");
    assert.equal(usage.inputTokens, 1000);
    assert.equal(usage.cachedInputTokens, 400);
    assert.equal(usage.outputTokens, 200);
    assert.equal(usage.reasoningTokens, 50);
    assert.equal(usage.requestId, "req_1");
    assert.equal(usage.provenance, "provider_reported");
  });

  it("recombines Anthropic cache reads and keeps cache writes separate", () => {
    const usage = anthropicAdapter.normalize({
      id: "msg_1",
      model: "claude-sonnet-4-20250514",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 50,
        output_tokens: 20,
      },
    });
    assert.equal(usage.model, "claude-sonnet-4");
    assert.equal(usage.inputTokens, 400);
    assert.equal(usage.cachedInputTokens, 300);
    assert.equal(usage.cacheWriteTokens, 50);
    assert.equal(usage.outputTokens, 20);
  });

  it("normalizes Gemini usageMetadata and strips the models/ prefix", () => {
    const usage = geminiAdapter.normalize({
      responseId: "gem_1",
      modelVersion: "models/gemini-2.5-flash-001",
      usageMetadata: {
        promptTokenCount: 500,
        cachedContentTokenCount: 100,
        candidatesTokenCount: 80,
        thoughtsTokenCount: 20,
      },
    });
    assert.equal(usage.model, "gemini-2.5-flash");
    assert.equal(usage.inputTokens, 500);
    assert.equal(usage.cachedInputTokens, 100);
    assert.equal(usage.outputTokens, 80);
    assert.equal(usage.reasoningTokens, 20);
    assert.equal(usage.requestId, "gem_1");
  });

  it("reads cached tokens for Groq only when reported", () => {
    const withCache = groqAdapter.normalize({
      model: "llama-3.3-70b-versatile",
      usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 30 } },
    });
    const withoutCache = groqAdapter.normalize({
      model: "llama-3.3-70b-versatile",
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });
    assert.equal(withCache.cachedInputTokens, 30);
    assert.equal(withoutCache.cachedInputTokens, 0);
  });

  it("normalizes Mistral's OpenAI-compatible payload", () => {
    const usage = mistralAdapter.normalize({
      id: "mistral_1",
      model: "mistral-small-latest",
      usage: { prompt_tokens: 700, completion_tokens: 65 },
    });
    assert.equal(usage.model, "mistral-small-latest");
    assert.equal(usage.inputTokens, 700);
    assert.equal(usage.outputTokens, 65);
    assert.equal(usage.cachedInputTokens, 0);
  });

  it("does not silently alias distinct models", () => {
    assert.equal(openaiAdapter.normalizeModel("o3-mini"), "o3-mini");
    assert.equal(openaiAdapter.normalizeModel("gpt-4-turbo"), "gpt-4-turbo");
    assert.equal(openaiAdapter.normalizeModel("gpt-4o-latest"), "gpt-4o");
    assert.equal(getAdapter("mistral")?.id, "mistral");
    assert.equal(getAdapter("unknown"), null);
  });
});

describe("provider error handling", () => {
  it("maps status codes to actionable error info", () => {
    assert.equal(normalizeProviderError("openai", 401, { error: { message: "bad key" } }).code, "invalid_credentials");
    assert.equal(normalizeProviderError("openai", 401, {}).retryable, false);
    assert.equal(normalizeProviderError("anthropic", 429, {}).code, "provider_rate_limited");
    assert.equal(normalizeProviderError("anthropic", 429, {}).retryable, true);
    assert.equal(normalizeProviderError("gemini", 503, {}).retryable, true);
    assert.equal(normalizeProviderError("groq", 404, {}).code, "model_not_found");
    assert.equal(normalizeProviderError("mistral", 422, {}).code, "provider_invalid_request");
  });

  it("redacts credential-shaped strings from provider messages", () => {
    const redacted = redactSecrets(
      "key sk-abcdefghijklmnop failed; also sk-ant-abcdefghijk and gsk_abcdefghijk and AIzaabcdefghijklmnop and Bearer abcdefghijk",
    );
    assert.equal(redacted.includes("sk-abcdefghijklmnop"), false);
    assert.equal(redacted.includes("sk-ant-abcdefghijk"), false);
    assert.equal(redacted.includes("gsk_abcdefghijk"), false);
    assert.equal(redacted.includes("AIzaabcdefghijklmnop"), false);
    assert.equal(redacted.includes("Bearer abcdefghijk"), false);
  });

  it("never echoes the API key in a runtime error", async () => {
    const { impl } = mockFetch(() => json({ error: { message: "Incorrect API key provided: sk-live-abcdefghijklmnop" } }, 401));
    await assert.rejects(
      chatWithProvider({
        provider: "openai",
        model: "gpt-4.1",
        apiKey: "sk-live-abcdefghijklmnop",
        messages: [{ role: "user", content: "hi" }],
        fetchImpl: impl,
        sleep: async () => {},
      }),
      (error: ProviderRuntimeError) => {
        assert.equal(error.info.code, "invalid_credentials");
        assert.equal(error.message.includes("sk-live-abcdefghijklmnop"), false);
        return true;
      },
    );
  });
});

describe("provider runtime", () => {
  it("retries a rate limit and returns normalized provider-reported usage", async () => {
    let attempt = 0;
    const { impl, calls } = mockFetch(() => {
      attempt += 1;
      if (attempt === 1) return json({ error: { message: "slow down" } }, 429, { "retry-after": "0" });
      return json({
        id: "req_ok",
        model: "gpt-4.1",
        usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } },
      });
    });

    const result = await chatWithProvider({
      provider: "openai",
      model: "gpt-4.1",
      apiKey: "sk-test-key-123456",
      messages: [{ role: "user", content: "hello" }],
      fetchImpl: impl,
      sleep: async () => {},
    });

    assert.equal(attempt, 2);
    assert.equal(result.attempts, 2);
    assert.equal(result.usage.inputTokens, 120);
    assert.equal(result.usage.cachedInputTokens, 20);
    assert.equal(result.usage.outputTokens, 30);
    assert.equal(result.usage.requestId, "req_ok");
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/chat/completions");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer sk-test-key-123456");
  });

  it("builds Anthropic and Gemini requests with provider-specific shapes", async () => {
    const { impl, calls } = mockFetch(() =>
      json({
        id: "msg",
        model: "claude-sonnet-4",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    await chatWithProvider({
      provider: "anthropic",
      model: "claude-sonnet-4",
      apiKey: "sk-ant-test-123456",
      system: "be brief",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: impl,
      sleep: async () => {},
    });
    const anthropicHeaders = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(anthropicHeaders["x-api-key"], "sk-ant-test-123456");
    assert.equal(anthropicHeaders["anthropic-version"], "2023-06-01");
    const anthropicBody = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(anthropicBody.system, "be brief");
    assert.equal(anthropicBody.max_tokens, 1024);

    const geminiFetch = mockFetch(() =>
      json({
        responseId: "g1",
        modelVersion: "models/gemini-2.5-flash",
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
      }),
    );
    await chatWithProvider({
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "AIza-test-1234567890",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: geminiFetch.impl,
      sleep: async () => {},
    });
    assert.equal(
      geminiFetch.calls[0]?.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    const geminiHeaders = geminiFetch.calls[0]?.init?.headers as Record<string, string>;
    assert.equal(geminiHeaders["x-goog-api-key"], "AIza-test-1234567890");
  });

  it("surfaces network failures as retryable provider errors without leaking keys", async () => {
    let attempts = 0;
    const { impl } = mockFetch(() => {
      attempts += 1;
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      chatWithProvider({
        provider: "mistral",
        model: "mistral-small-latest",
        apiKey: "sk-mistral-secret-123456",
        messages: [{ role: "user", content: "hi" }],
        maxAttempts: 2,
        fetchImpl: impl,
        sleep: async () => {},
      }),
      (error: ProviderRuntimeError) => {
        assert.equal(error.info.code, "provider_network_error");
        assert.equal(error.info.retryable, true);
        assert.equal(error.message.includes("sk-mistral-secret"), false);
        return true;
      },
    );
    assert.equal(attempts, 2);
  });

  it("verifies credentials with a real read-only models request shape", async () => {
    const { impl, calls } = mockFetch(() =>
      json({ object: "list", data: [{ id: "gpt-4.1" }, { id: "gpt-4o" }] }),
    );
    const result = await verifyProviderCredential("openai", "sk-verify-123456", { fetchImpl: impl });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.sampleModels, ["gpt-4.1", "gpt-4o"]);
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/models");
    assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer sk-verify-123456");
  });

  it("reports a failed verification honestly instead of claiming success", async () => {
    const { impl } = mockFetch(() => json({ error: { message: "invalid x-api-key" } }, 401));
    const result = await verifyProviderCredential("anthropic", "sk-ant-bad-123456", { fetchImpl: impl });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.message, /Authentication failed/);
    assert.equal(result.sampleModels.length, 0);
  });
});

describe("stream usage extraction", () => {
  it("reads usage from OpenAI-compatible stream chunks", () => {
    const usage = extractStreamUsage("openai", [
      'data: {"model":"gpt-4.1","choices":[{"delta":{"content":"hi"}}]}',
      'data: {"model":"gpt-4.1","usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":4}}}',
    ]);
    assert.ok(usage);
    assert.equal(usage.inputTokens, 10);
    assert.equal(usage.cachedInputTokens, 4);
    assert.equal(usage.outputTokens, 5);
  });

  it("reads Anthropic message_start and message_delta usage", () => {
    const usage = extractStreamUsage("anthropic", [
      { type: "message_start", message: { id: "m1", model: "claude-sonnet-4", usage: { input_tokens: 8, cache_read_input_tokens: 2 } } },
      { type: "message_delta", usage: { output_tokens: 6 } },
    ]);
    assert.ok(usage);
    assert.equal(usage.inputTokens, 10);
    assert.equal(usage.cachedInputTokens, 2);
    assert.equal(usage.outputTokens, 6);
  });

  it("returns null when the stream reports no usage", () => {
    assert.equal(extractStreamUsage("openai", ['data: {"choices":[{"delta":{"content":"x"}}]}']), null);
  });
});
