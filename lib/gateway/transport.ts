import { getAdapter, normalizeProviderError, redactSecrets } from "@/lib/providers";
import {
  asNumber,
  asRecord,
  type NormalizedUsage,
  type ProviderErrorInfo,
  type ProviderId,
} from "@/lib/providers/types";
import {
  messageText,
  type GatewayChatRequest,
  type GatewayMessage,
  type GatewayToolCall,
} from "./types";

const DEFAULT_TIMEOUT_MS = 120_000;
const RETRY_BASE_MS = 300;

const sleepImpl = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const uuid = () => globalThis.crypto.randomUUID();

/** Catalog ids that differ from the id the provider expects on the wire. */
const API_MODEL_IDS: Record<string, string> = {
  "anthropic/claude-opus-4": "claude-opus-4-20250514",
  "anthropic/claude-sonnet-4": "claude-sonnet-4-20250514",
  "anthropic/claude-3-5-haiku": "claude-3-5-haiku-20241022",
};

export function apiModelId(provider: string, model: string): string {
  return API_MODEL_IDS[`${provider}/${model}`] ?? model;
}

export type GatewayCompletion = {
  id: string;
  model: string;
  content: string;
  toolCalls: GatewayToolCall[];
  finishReason: string;
  usage: NormalizedUsage | null;
  latencyMs: number;
  status: number;
  attempts: number;
  providerRequestId: string | null;
  error: ProviderErrorInfo | null;
};

export class GatewayTransportError extends Error {
  info: ProviderErrorInfo;
  status: number;
  providerRequestId: string | null;
  attempts: number;
  constructor(info: ProviderErrorInfo, status: number, providerRequestId: string | null, attempts: number) {
    super(info.message);
    this.name = "GatewayTransportError";
    this.info = info;
    this.status = status;
    this.providerRequestId = providerRequestId;
    this.attempts = attempts;
  }
}

export type GatewayTransportInput = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  request: GatewayChatRequest;
  /** Resolved output cap: request max_tokens, policy cap, or default. */
  maxOutputTokens: number;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requestIdFrom(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("request-id") ?? headers.get("x-amzn-requestid") ?? null;
}

function joinSystem(request: GatewayChatRequest): string {
  return request.messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => messageText(message.content))
    .filter(Boolean)
    .join("\n\n");
}

function jsonInstruction(request: GatewayChatRequest): string | null {
  if (request.response_format?.type === "json_object") {
    return "Return a single valid JSON value and nothing else. Do not use markdown fences or add commentary.";
  }
  if (request.response_format?.type === "json_schema") {
    return `Return only JSON that validates against this JSON Schema:\n${JSON.stringify(
      request.response_format.json_schema.schema,
    )}`;
  }
  return null;
}

function safeJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function maxTokenField(request: GatewayChatRequest, fallback: number): { max_tokens: number } | { max_completion_tokens: number } {
  return request.max_completion_tokens !== undefined
    ? { max_completion_tokens: fallback }
    : { max_tokens: fallback };
}

type BuiltRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** Provider-side forced structured-output tool name, when one is used. */
  structuredTool: string | null;
};

function openAICompatibleBody(input: GatewayTransportInput, stream: boolean): Record<string, unknown> {
  const { request, provider } = input;
  const messages = request.messages.map((message) =>
    message.role === "developer" ? { ...message, role: "system" } : message,
  );
  const instruction = jsonInstruction(request);
  const needsInstruction = instruction && (provider !== "openai" || request.response_format?.type === "json_object");
  const withInstruction = needsInstruction
    ? [{ role: "system", content: instruction }, ...messages]
    : messages;

  const body: Record<string, unknown> = {
    model: apiModelId(provider, input.model),
    messages: withInstruction,
    stream,
    ...maxTokenField(request, input.maxOutputTokens),
  };
  if (stream && (provider === "openai" || provider === "groq")) {
    body.stream_options = { include_usage: true };
  }
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.top_p !== undefined) body.top_p = request.top_p;
  if (request.stop !== undefined) body.stop = request.stop;
  if (request.presence_penalty !== undefined) body.presence_penalty = request.presence_penalty;
  if (request.frequency_penalty !== undefined) body.frequency_penalty = request.frequency_penalty;
  if (request.user) body.user = request.user;
  if (request.seed !== undefined) {
    if (provider === "mistral") body.random_seed = request.seed;
    else body.seed = request.seed;
  }
  if (request.response_format) {
    if (provider === "openai") {
      body.response_format = request.response_format;
    } else if (request.response_format.type === "json_schema") {
      body.response_format = { type: "json_object" };
    } else {
      body.response_format = request.response_format;
    }
  }
  if (request.tools?.length) {
    body.tools = request.tools;
    if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice;
  }
  return body;
}

function anthropicParts(content: GatewayMessage["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    const url = part.image_url.url;
    if (url.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (match) {
        return {
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] },
        };
      }
    }
    return { type: "image", source: { type: "url", url } };
  });
}

type AnthropicMessage = { role: "user" | "assistant"; content: Array<Record<string, unknown>> };

function pushAnthropic(messages: AnthropicMessage[], role: "user" | "assistant", blocks: Array<Record<string, unknown>>) {
  if (!blocks.length) return;
  const last = messages[messages.length - 1];
  if (last && last.role === role) last.content.push(...blocks);
  else messages.push({ role, content: blocks });
}

function buildAnthropicMessages(request: GatewayChatRequest): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const message of request.messages) {
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) {
        const id = call.id ?? "";
        const name = call.function?.name ?? "";
        if (id && name) toolNames.set(id, name);
      }
    }
  }

  for (const message of request.messages) {
    if (message.role === "system" || message.role === "developer") continue;
    if (message.role === "user") {
      pushAnthropic(out, "user", anthropicParts(message.content));
    } else if (message.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      const text = messageText(message.content);
      if (text) blocks.push({ type: "text", text });
      for (const call of message.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id ?? `toolu_${uuid()}`,
          name: call.function?.name ?? "tool",
          input: safeJsonObject(call.function?.arguments),
        });
      }
      pushAnthropic(out, "assistant", blocks);
    } else if (message.role === "tool") {
      const id = message.tool_call_id ?? "";
      pushAnthropic(out, "user", [
        {
          type: "tool_result",
          tool_use_id: id,
          content: [{ type: "text", text: messageText(message.content) || toolNames.get(id) || "" }],
        },
      ]);
    }
  }
  return out;
}

function buildAnthropicBody(input: GatewayTransportInput): { body: Record<string, unknown>; structuredTool: string | null } {
  const { request } = input;
  const instruction = jsonInstruction(request);
  let system = joinSystem(request);
  if (instruction) system = system ? `${system}\n\n${instruction}` : instruction;

  let tools: Array<Record<string, unknown>> | null = request.tools?.length
    ? request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters ?? { type: "object", properties: {} },
      }))
    : null;
  let toolChoice: Record<string, unknown> | null = null;
  let structuredTool: string | null = null;

  if (request.response_format?.type === "json_schema" && !request.tools?.length) {
    const name = /^[a-zA-Z0-9_-]{1,64}$/.test(request.response_format.json_schema.name)
      ? request.response_format.json_schema.name
      : "structured_output";
    structuredTool = name;
    tools = [
      {
        name,
        description: request.response_format.json_schema.description ?? "Return the requested structured output.",
        input_schema: request.response_format.json_schema.schema,
      },
    ];
    toolChoice = { type: "tool", name };
  } else if (request.tools?.length && request.tool_choice !== undefined) {
    const choice = request.tool_choice;
    if (choice === "auto") toolChoice = { type: "auto" };
    else if (choice === "required") toolChoice = { type: "any" };
    else if (choice === "none") {
      tools = null;
      toolChoice = null;
    } else toolChoice = { type: "tool", name: choice.function.name };
  }

  const body: Record<string, unknown> = {
    model: apiModelId(input.provider, input.model),
    max_tokens: input.maxOutputTokens,
    messages: buildAnthropicMessages(request),
    ...(system ? { system } : {}),
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.top_p !== undefined) body.top_p = request.top_p;
  if (request.stop !== undefined) body.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  return { body, structuredTool };
}

function geminiParts(content: GatewayMessage["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.map((part) => {
    if (part.type === "text") return { text: part.text };
    const url = part.image_url.url;
    const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url } };
  });
}

type GeminiTurn = { role: "user" | "model"; parts: Array<Record<string, unknown>> };

function buildGeminiBody(input: GatewayTransportInput): { body: Record<string, unknown>; structuredTool: string | null } {
  const { request } = input;
  const toolNames = new Map<string, string>();
  for (const message of request.messages) {
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) {
        if (call.id && call.function?.name) toolNames.set(call.id, call.function.name);
      }
    }
  }

  const turns: GeminiTurn[] = [];
  const push = (role: "user" | "model", parts: Array<Record<string, unknown>>) => {
    if (!parts.length) return;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else turns.push({ role, parts });
  };

  for (const message of request.messages) {
    if (message.role === "system" || message.role === "developer") continue;
    if (message.role === "user") {
      push("user", geminiParts(message.content));
    } else if (message.role === "assistant") {
      const parts = geminiParts(message.content);
      for (const call of message.tool_calls ?? []) {
        parts.push({
          functionCall: {
            name: call.function?.name ?? "tool",
            args: safeJsonObject(call.function?.arguments),
          },
        });
      }
      push("model", parts);
    } else if (message.role === "tool") {
      const name = toolNames.get(message.tool_call_id ?? "") ?? "tool_result";
      push("user", [
        {
          functionResponse: {
            name,
            response: { result: messageText(message.content) },
          },
        },
      ]);
    }
  }
  if (turns.length === 0) turns.push({ role: "user", parts: [{ text: "Continue." }] });
  if (turns[0].role === "model") turns.unshift({ role: "user", parts: [{ text: "Continue." }] });

  let system = joinSystem(request);
  const instruction = jsonInstruction(request);
  if (instruction) system = system ? `${system}\n\n${instruction}` : instruction;

  const generationConfig: Record<string, unknown> = { maxOutputTokens: input.maxOutputTokens };
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.top_p !== undefined) generationConfig.topP = request.top_p;
  if (request.presence_penalty !== undefined) generationConfig.presencePenalty = request.presence_penalty;
  if (request.frequency_penalty !== undefined) generationConfig.frequencyPenalty = request.frequency_penalty;
  if (request.stop !== undefined) {
    generationConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
  }
  if (request.response_format && request.response_format.type !== "text") {
    generationConfig.responseMimeType = "application/json";
  }

  const body: Record<string, unknown> = { contents: turns, generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (request.tools?.length) {
    body.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      },
    ];
    if (request.tool_choice !== undefined) {
      const choice = request.tool_choice;
      if (choice === "auto") body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
      else if (choice === "required") body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      else if (choice === "none") body.toolConfig = { functionCallingConfig: { mode: "NONE" } };
      else
        body.toolConfig = {
          functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.function.name] },
        };
    }
  }
  return { body, structuredTool: null };
}

function buildRequest(input: GatewayTransportInput, stream: boolean): BuiltRequest {
  const adapter = getAdapter(input.provider);
  if (!adapter) throw new Error(`Unknown provider ${input.provider}`);
  const apiModel = apiModelId(input.provider, input.model);

  if (adapter.apiStyle === "anthropic") {
    const { body, structuredTool } = buildAnthropicBody(input);
    return {
      url: adapter.defaultEndpoint,
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        accept: stream ? "text/event-stream" : "application/json",
      },
      body: { ...body, ...(stream ? { stream: true } : {}) },
      structuredTool,
    };
  }

  if (adapter.apiStyle === "gemini") {
    const { body, structuredTool } = buildGeminiBody(input);
    const method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiModel)}:${method}`,
      headers: {
        "x-goog-api-key": input.apiKey,
        "content-type": "application/json",
        accept: stream ? "text/event-stream" : "application/json",
      },
      body,
      structuredTool,
    };
  }

  return {
    url: adapter.defaultEndpoint,
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json",
    },
    body: openAICompatibleBody(input, stream),
    structuredTool: null,
  };
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => asString(asRecord(part).text) ?? "")
      .filter(Boolean)
      .join("");
  }
  return "";
}

function normalizeToolCalls(value: unknown): GatewayToolCall[] {
  const out: GatewayToolCall[] = [];
  for (const entry of asArray(value)) {
    const row = asRecord(entry);
    const fn = asRecord(row.function);
    const name = asString(fn.name);
    if (!name) continue;
    out.push({
      id: asString(row.id) ?? `call_${uuid()}`,
      type: "function",
      function: { name, arguments: asString(fn.arguments) ?? "{}" },
    });
  }
  return out;
}

function mapFinishReason(reason: string | undefined, hasTools: boolean): string {
  if (!reason) return hasTools ? "tool_calls" : "stop";
  const normalized = reason.toLowerCase();
  if (normalized === "function_call" || normalized === "tool_calls" || normalized === "tool_use") return "tool_calls";
  if (normalized === "length" || normalized === "max_tokens") return "length";
  if (normalized === "content_filter" || normalized === "safety" || normalized === "recitation") return "content_filter";
  if (normalized === "stop" || normalized === "end_turn" || normalized === "stop_sequence") return "stop";
  return normalized;
}

function parseOpenAICompatible(
  provider: ProviderId,
  payload: unknown,
  input: GatewayTransportInput,
  latencyMs: number,
  attempts: number,
  headerRequestId: string | null,
): GatewayCompletion {
  const adapter = getAdapter(provider)!;
  const body = asRecord(payload);
  const choice = asRecord(asArray(body.choices)[0]);
  const message = asRecord(choice.message);
  const toolCalls = normalizeToolCalls(message.tool_calls);
  const finishReason = mapFinishReason(asString(choice.finish_reason), toolCalls.length > 0);
  const usage = adapter.normalize(body);
  return {
    id: asString(body.id) ?? `chatcmpl-${uuid()}`,
    model: input.model,
    content: flattenContent(message.content),
    toolCalls,
    finishReason,
    usage: usage.inputTokens + usage.outputTokens > 0 ? usage : null,
    latencyMs,
    status: 200,
    attempts,
    providerRequestId: asString(body.id) ?? headerRequestId,
    error: null,
  };
}

function parseAnthropic(
  payload: unknown,
  input: GatewayTransportInput,
  structuredTool: string | null,
  latencyMs: number,
  attempts: number,
  headerRequestId: string | null,
): GatewayCompletion {
  const adapter = getAdapter("anthropic")!;
  const body = asRecord(payload);
  let content = "";
  const toolCalls: GatewayToolCall[] = [];
  for (const block of asArray(body.content)) {
    const row = asRecord(block);
    if (row.type === "text") content += asString(row.text) ?? "";
    if (row.type === "tool_use") {
      const name = asString(row.name) ?? "tool";
      toolCalls.push({
        id: asString(row.id) ?? `toolu_${uuid()}`,
        type: "function",
        function: { name, arguments: JSON.stringify(row.input ?? {}) },
      });
    }
  }

  // A forced structured-output tool becomes ordinary JSON content for OpenAI compatibility.
  let forced = false;
  if (structuredTool && toolCalls.length === 1 && toolCalls[0].function?.name === structuredTool) {
    content = toolCalls[0].function?.arguments ?? "{}";
    toolCalls.length = 0;
    forced = true;
  }

  const usage = adapter.normalize(body);
  const stop = asString(body.stop_reason);
  return {
    id: asString(body.id) ?? `chatcmpl-${uuid()}`,
    model: input.model,
    content,
    toolCalls,
    finishReason: forced ? "stop" : mapFinishReason(stop, toolCalls.length > 0),
    usage: usage.inputTokens + usage.outputTokens > 0 ? usage : null,
    latencyMs,
    status: 200,
    attempts,
    providerRequestId: asString(body.id) ?? headerRequestId,
    error: null,
  };
}

function parseGemini(
  payload: unknown,
  input: GatewayTransportInput,
  latencyMs: number,
  attempts: number,
  headerRequestId: string | null,
): GatewayCompletion {
  const adapter = getAdapter("gemini")!;
  const body = asRecord(payload);
  const candidate = asRecord(asArray(body.candidates)[0]);
  const contentRecord = asRecord(candidate.content);
  let content = "";
  const toolCalls: GatewayToolCall[] = [];
  for (const part of asArray(contentRecord.parts)) {
    const row = asRecord(part);
    if (typeof row.text === "string") content += row.text;
    const call = asRecord(row.functionCall);
    const name = asString(call.name);
    if (name) {
      toolCalls.push({
        id: `call_${uuid()}`,
        type: "function",
        function: { name, arguments: JSON.stringify(call.args ?? {}) },
      });
    }
  }
  const usage = adapter.normalize(body);
  return {
    id: asString(body.responseId) ?? `chatcmpl-${uuid()}`,
    model: input.model,
    content,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : mapFinishReason(asString(candidate.finishReason), false),
    usage: usage.inputTokens + usage.outputTokens > 0 ? usage : null,
    latencyMs,
    status: 200,
    attempts,
    providerRequestId: asString(body.responseId) ?? headerRequestId,
    error: null,
  };
}

export function toOpenAIUsage(usage: NormalizedUsage | null): Record<string, unknown> | undefined {
  if (!usage) return undefined;
  const prompt = usage.inputTokens + usage.cacheWriteTokens;
  const completion = usage.outputTokens + usage.reasoningTokens;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: usage.cachedInputTokens },
    completion_tokens_details: { reasoning_tokens: usage.reasoningTokens },
  };
}

export function openAIErrorBody(info: ProviderErrorInfo, status: number): Record<string, unknown> {
  return {
    error: {
      message: info.message,
      type: status === 429 ? "rate_limit_error" : status >= 500 ? "provider_error" : "invalid_request_error",
      code: info.code,
      param: null,
    },
  };
}

/**
 * Executes a non-streaming completion, normalizes provider usage and translates the response to a
 * canonical shape. Retries 429/5xx/network failures with backoff; the API key is never logged.
 */
export async function completeChat(input: GatewayTransportInput): Promise<GatewayCompletion> {
  const adapter = getAdapter(input.provider);
  if (!adapter) {
    throw new GatewayTransportError(
      { code: "unknown_provider", message: `Unknown provider ${input.provider}`, retryable: false },
      0,
      null,
      0,
    );
  }
  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? sleepImpl;
  const maxAttempts = Math.min(Math.max(input.maxAttempts ?? 3, 1), 5);
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), 600_000);
  const built = buildRequest(input, false);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = performance.now();
    try {
      const response = await doFetch(built.url, {
        method: "POST",
        headers: built.headers,
        body: JSON.stringify(built.body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const headerRequestId = requestIdFrom(response.headers);
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { message: redactSecrets(text.slice(0, 300)) };
      }
      const latencyMs = Math.round(performance.now() - started);

      if (!response.ok) {
        const info = normalizeProviderError(input.provider, response.status, payload);
        if (!info.retryable || attempt === maxAttempts) {
          throw new GatewayTransportError(info, response.status, headerRequestId, attempt);
        }
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10_000)
          : RETRY_BASE_MS * 2 ** (attempt - 1);
        await sleep(delay);
        continue;
      }

      if (input.provider === "anthropic") {
        return parseAnthropic(payload, input, built.structuredTool, latencyMs, attempt, headerRequestId);
      }
      if (input.provider === "gemini") {
        return parseGemini(payload, input, latencyMs, attempt, headerRequestId);
      }
      return parseOpenAICompatible(input.provider, payload, input, latencyMs, attempt, headerRequestId);
    } catch (error) {
      if (error instanceof GatewayTransportError) throw error;
      const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      const info: ProviderErrorInfo = {
        code: aborted ? "provider_timeout" : "provider_network_error",
        message: aborted
          ? `${adapter.label} did not respond within ${timeoutMs}ms`
          : `Network error contacting ${adapter.label}`,
        retryable: true,
      };
      if (attempt === maxAttempts) throw new GatewayTransportError(info, 0, null, attempt);
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw new GatewayTransportError(
    { code: "provider_error", message: "Provider request failed", retryable: false },
    0,
    null,
    maxAttempts,
  );
}

type StreamState = {
  text: string;
  toolCalls: Map<number, { id: string; name: string; args: string }>;
  finishReason: string | null;
  usage: NormalizedUsage | null;
  headerRequestId: string | null;
  structuredTool: string | null;
  anthropic: {
    inputTokens: number;
    cacheRead: number;
    cacheWrite: number;
    outputTokens: number;
    sawUsage: boolean;
  };
  sawDone: boolean;
};

function parseSSEData(rawEvent: string): string | null {
  const data: string[] = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? data.join("\n") : null;
}

function takeEvent(buffer: string): { event: string; rest: string } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match || match.index === undefined) return null;
  return { event: buffer.slice(0, match.index), rest: buffer.slice(match.index + match[0].length) };
}

function streamChunk(
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  usage?: Record<string, unknown>,
): string {
  const payload: Record<string, unknown> = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  if (usage) payload.usage = usage;
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseError(info: ProviderErrorInfo): string {
  return `data: ${JSON.stringify({ error: { message: info.message, type: "provider_error", code: info.code } })}\n\n`;
}

/**
 * Starts a streaming completion. The initial HTTP request is performed before returning so callers
 * can fall back to another model on connection/auth/HTTP errors. Chunks are translated into the
 * OpenAI SSE format for Anthropic and Gemini; OpenAI-compatible providers are passed through
 * verbatim while usage is parsed from the stream.
 */
export async function streamChat(
  input: GatewayTransportInput,
): Promise<{ stream: ReadableStream<Uint8Array>; done: Promise<GatewayCompletion> }> {
  const adapter = getAdapter(input.provider);
  if (!adapter) {
    throw new GatewayTransportError(
      { code: "unknown_provider", message: `Unknown provider ${input.provider}`, retryable: false },
      0,
      null,
      0,
    );
  }
  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? sleepImpl;
  const maxAttempts = Math.min(Math.max(input.maxAttempts ?? 2, 1), 4);
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), 600_000);
  const built = buildRequest(input, true);
  const passThrough = adapter.apiStyle === "openai";

  let response: Response | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    try {
      const candidate = await doFetch(built.url, {
        method: "POST",
        headers: built.headers,
        body: JSON.stringify(built.body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!candidate.ok) {
        const text = await candidate.text();
        let payload: unknown = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = { message: redactSecrets(text.slice(0, 300)) };
        }
        const info = normalizeProviderError(input.provider, candidate.status, payload);
        if (!info.retryable || attempt === maxAttempts) {
          throw new GatewayTransportError(info, candidate.status, requestIdFrom(candidate.headers), attempt);
        }
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      response = candidate;
      break;
    } catch (error) {
      if (error instanceof GatewayTransportError) throw error;
      const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      const info: ProviderErrorInfo = {
        code: aborted ? "provider_timeout" : "provider_network_error",
        message: aborted
          ? `${adapter.label} did not respond within ${timeoutMs}ms`
          : `Network error contacting ${adapter.label}`,
        retryable: true,
      };
      if (attempt === maxAttempts) throw new GatewayTransportError(info, 0, null, attempt);
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  if (!response || !response.body) {
    throw new GatewayTransportError(
      { code: "provider_unavailable", message: `${adapter.label} returned no response body`, retryable: true },
      0,
      null,
      attempts,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const id = `chatcmpl-${uuid()}`;
  const started = performance.now();
  const state: StreamState = {
    text: "",
    toolCalls: new Map(),
    finishReason: null,
    usage: null,
    headerRequestId: requestIdFrom(response.headers),
    structuredTool: built.structuredTool,
    anthropic: { inputTokens: 0, cacheRead: 0, cacheWrite: 0, outputTokens: 0, sawUsage: false },
    sawDone: false,
  };

  let resolveDone!: (value: GatewayCompletion) => void;
  const done = new Promise<GatewayCompletion>((resolve) => {
    resolveDone = resolve;
  });
  let settled = false;
  let buffer = "";
  const pending: Uint8Array[] = [];
  let finished = false;

  const finish = (error: ProviderErrorInfo | null, status = 200) => {
    if (settled) return;
    settled = true;
    const toolCalls = [...state.toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.args || "{}" },
      }));
    let content = state.text;
    let finalToolCalls = toolCalls;
    let finishReason = state.finishReason ?? (toolCalls.length ? "tool_calls" : "stop");
    if (state.structuredTool && toolCalls.length === 1 && toolCalls[0].function?.name === state.structuredTool) {
      content = toolCalls[0].function?.arguments ?? "{}";
      finalToolCalls = [];
      finishReason = "stop";
    }
    let usage = state.usage;
    if (!usage && state.anthropic.sawUsage) {
      usage = {
        model: input.model,
        inputTokens: state.anthropic.inputTokens + state.anthropic.cacheRead,
        cachedInputTokens: state.anthropic.cacheRead,
        cacheWriteTokens: state.anthropic.cacheWrite,
        outputTokens: state.anthropic.outputTokens,
        reasoningTokens: 0,
        provenance: "provider_reported",
      };
    }
    resolveDone({
      id,
      model: input.model,
      content,
      toolCalls: finalToolCalls,
      finishReason,
      usage,
      latencyMs: Math.round(performance.now() - started),
      status: error ? (status >= 400 ? status : 502) : 200,
      attempts,
      providerRequestId: state.headerRequestId,
      error,
    });
  };

  const enqueue = (bytes: Uint8Array) => {
    pending.push(bytes);
  };
  const enqueueText = (text: string) => enqueue(encoder.encode(text));

  const handleAnthropic = (payload: Record<string, unknown>) => {
    const type = asString(payload.type) ?? "";
    if (type === "message_start") {
      const message = asRecord(payload.message);
      if (asString(message.id)) state.headerRequestId = asString(message.id) ?? state.headerRequestId;
      const usage = asRecord(message.usage);
      if (Object.keys(usage).length) state.anthropic.sawUsage = true;
      state.anthropic.inputTokens = asNumber(usage.input_tokens, state.anthropic.inputTokens);
      state.anthropic.cacheRead = asNumber(usage.cache_read_input_tokens, state.anthropic.cacheRead);
      state.anthropic.cacheWrite = asNumber(usage.cache_creation_input_tokens, state.anthropic.cacheWrite);
      enqueueText(streamChunk(id, input.model, { role: "assistant", content: "" }));
    } else if (type === "content_block_start") {
      const index = asNumber(payload.index);
      const block = asRecord(payload.content_block);
      if (block.type === "tool_use") {
        const name = asString(block.name) ?? "tool";
        const callId = asString(block.id) ?? `toolu_${uuid()}`;
        state.toolCalls.set(index, { id: callId, name, args: "" });
        enqueueText(
          streamChunk(id, input.model, {
            tool_calls: [{ index, id: callId, type: "function", function: { name, arguments: "" } }],
          }),
        );
      }
    } else if (type === "content_block_delta") {
      const index = asNumber(payload.index);
      const delta = asRecord(payload.delta);
      if (delta.type === "text_delta") {
        const text = asString(delta.text) ?? "";
        state.text += text;
        if (text) enqueueText(streamChunk(id, input.model, { content: text }));
      } else if (delta.type === "input_json_delta") {
        const partial = asString(delta.partial_json) ?? "";
        const call = state.toolCalls.get(index);
        if (call) {
          call.args += partial;
          enqueueText(
            streamChunk(id, input.model, {
              tool_calls: [{ index, function: { arguments: partial } }],
            }),
          );
        }
      }
    } else if (type === "message_delta") {
      const delta = asRecord(payload.delta);
      if (asString(delta.stop_reason)) {
        state.finishReason = mapFinishReason(asString(delta.stop_reason), state.toolCalls.size > 0);
      }
      const usage = asRecord(payload.usage);
      if (Object.keys(usage).length) {
        state.anthropic.sawUsage = true;
        state.anthropic.outputTokens = asNumber(usage.output_tokens, state.anthropic.outputTokens);
      }
    } else if (type === "error") {
      const error = asRecord(payload.error);
      throw new Error(asString(error.message) ?? "Provider stream error");
    }
  };

  const handleGemini = (payload: Record<string, unknown>) => {
    if (asString(payload.responseId)) state.headerRequestId = asString(payload.responseId) ?? state.headerRequestId;
    const candidate = asRecord(asArray(payload.candidates)[0]);
    const content = asRecord(candidate.content);
    for (const part of asArray(content.parts)) {
      const row = asRecord(part);
      if (typeof row.text === "string" && row.text) {
        state.text += row.text;
        enqueueText(streamChunk(id, input.model, { content: row.text }));
      }
      const call = asRecord(row.functionCall);
      const name = asString(call.name);
      if (name) {
        const index = state.toolCalls.size;
        const callId = `call_${uuid()}`;
        const args = JSON.stringify(call.args ?? {});
        state.toolCalls.set(index, { id: callId, name, args });
        enqueueText(
          streamChunk(id, input.model, {
            tool_calls: [{ index, id: callId, type: "function", function: { name, arguments: args } }],
          }),
        );
      }
    }
    if (asString(candidate.finishReason)) {
      state.finishReason = state.toolCalls.size
        ? "tool_calls"
        : mapFinishReason(asString(candidate.finishReason), false);
    }
    const usageRecord = asRecord(payload.usageMetadata);
    if (Object.keys(usageRecord).length) {
      state.usage = adapter.normalize(payload);
    }
  };

  const handleOpenAI = (payload: Record<string, unknown>) => {
    if (asString(payload.id)) state.headerRequestId = asString(payload.id) ?? state.headerRequestId;
    const choice = asRecord(asArray(payload.choices)[0]);
    const delta = asRecord(choice.delta);
    if (typeof delta.content === "string" && delta.content) state.text += delta.content;
    for (const rawCall of asArray(delta.tool_calls)) {
      const row = asRecord(rawCall);
      const index = asNumber(row.index, state.toolCalls.size);
      const existing = state.toolCalls.get(index) ?? { id: "", name: "", args: "" };
      const fn = asRecord(row.function);
      if (asString(row.id)) existing.id = asString(row.id)!;
      if (asString(fn.name)) existing.name = asString(fn.name)!;
      if (typeof fn.arguments === "string") existing.args += fn.arguments;
      state.toolCalls.set(index, existing);
    }
    if (asString(choice.finish_reason)) {
      state.finishReason = mapFinishReason(asString(choice.finish_reason), state.toolCalls.size > 0);
    }
    const usageRecord = asRecord(payload.usage);
    if (Object.keys(usageRecord).length) {
      const normalized = adapter.normalize(payload);
      if (normalized.inputTokens + normalized.outputTokens > 0) state.usage = normalized;
    }
  };

  const handleEvent = (rawEvent: string) => {
    const data = parseSSEData(rawEvent);
    if (data === null) {
      const trimmed = rawEvent.trim();
      if (trimmed && !trimmed.startsWith(":")) {
        try {
          handleJson(JSON.parse(trimmed) as unknown);
        } catch {
          // Ignore event/meta lines that are not JSON payloads.
        }
      }
      return;
    }
    if (data.trim() === "[DONE]") {
      state.sawDone = true;
      return;
    }
    if (!data.trim()) return;
    try {
      handleJson(JSON.parse(data) as unknown);
    } catch {
      // Ignore malformed provider events; the final usage/finish may still arrive.
    }
  };

  const handleJson = (parsed: unknown) => {
    const payload = asRecord(parsed);
    if (adapter.apiStyle === "anthropic") handleAnthropic(payload);
    else if (adapter.apiStyle === "gemini") handleGemini(payload);
    else handleOpenAI(payload);
  };

  const processBuffer = (chunk: string) => {
    buffer += chunk;
    let taken = takeEvent(buffer);
    while (taken) {
      buffer = taken.rest;
      handleEvent(taken.event);
      taken = takeEvent(buffer);
    }
  };

  const enqueueFinal = () => {
    if (passThrough) {
      if (!state.sawDone) enqueueText("data: [DONE]\n\n");
      return;
    }
    const usage = state.usage ?? (state.anthropic.sawUsage
      ? {
          model: input.model,
          inputTokens: state.anthropic.inputTokens + state.anthropic.cacheRead,
          cachedInputTokens: state.anthropic.cacheRead,
          cacheWriteTokens: state.anthropic.cacheWrite,
          outputTokens: state.anthropic.outputTokens,
          reasoningTokens: 0,
          provenance: "provider_reported" as const,
        }
      : null);
    enqueueText(
      streamChunk(
        id,
        input.model,
        {},
        state.finishReason ?? (state.toolCalls.size ? "tool_calls" : "stop"),
        toOpenAIUsage(usage),
      ),
    );
    enqueueText("data: [DONE]\n\n");
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        if (pending.length) {
          controller.enqueue(pending.shift()!);
          return;
        }
        if (finished) {
          controller.close();
          return;
        }
        try {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) {
            if (buffer.trim()) processBuffer("\n\n");
            enqueueFinal();
            finish(null);
            finished = true;
            continue;
          }
          if (passThrough) controller.enqueue(value);
          processBuffer(decoder.decode(value, { stream: true }));
        } catch (error) {
          const info: ProviderErrorInfo =
            error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
              ? { code: "provider_timeout", message: `${adapter.label} stream timed out`, retryable: false }
              : { code: "provider_stream_error", message: redactSecrets(String(error)), retryable: false };
          enqueueText(sseError(info));
          enqueueText("data: [DONE]\n\n");
          finish(info, 502);
          finished = true;
        }
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
      if (!settled) {
        finish({ code: "client_cancelled", message: "The client cancelled the stream", retryable: false }, 499);
      }
    },
  });

  return { stream, done };
}
