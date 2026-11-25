import { getAdapter, normalizeProviderError, redactSecrets } from "./index";
import type { NormalizedUsage, ProviderErrorInfo, ProviderId } from "./types";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ProviderChatInput = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  system?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type ProviderChatResult = {
  usage: NormalizedUsage;
  latencyMs: number;
  attempts: number;
  status: number;
  providerRequestId: string | null;
};

export class ProviderRuntimeError extends Error {
  info: ProviderErrorInfo;
  status: number;
  attempts: number;
  providerRequestId: string | null;
  constructor(info: ProviderErrorInfo, status: number, attempts: number, providerRequestId: string | null) {
    super(info.message);
    this.name = "ProviderRuntimeError";
    this.info = info;
    this.status = status;
    this.attempts = attempts;
    this.providerRequestId = providerRequestId;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_BASE_MS = 300;

const sleepImpl = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function requestIdFrom(headers: Headers): string | null {
  return (
    headers.get("x-request-id") ??
    headers.get("request-id") ??
    headers.get("x-amzn-requestid") ??
    null
  );
}

function buildRequest(input: ProviderChatInput): { url: string; headers: Record<string, string>; body: unknown } {
  const adapter = getAdapter(input.provider);
  if (!adapter) throw new Error(`Unknown provider ${input.provider}`);
  const messages = input.system
    ? [{ role: "system" as const, content: input.system }, ...input.messages]
    : input.messages;
  const maxTokens = input.maxOutputTokens ?? 1024;

  if (adapter.apiStyle === "anthropic") {
    return {
      url: adapter.defaultEndpoint,
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: {
        model: input.model,
        max_tokens: maxTokens,
        ...(input.system ? { system: input.system } : {}),
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
      },
    };
  }

  if (adapter.apiStyle === "gemini") {
    const contents = input.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    return {
      url: `${adapter.defaultEndpoint}/${encodeURIComponent(input.model)}:generateContent`,
      headers: {
        "x-goog-api-key": input.apiKey,
        "content-type": "application/json",
      },
      body: {
        contents,
        ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
        },
      },
    };
  }

  return {
    url: adapter.defaultEndpoint,
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: {
      model: input.model,
      messages,
      max_tokens: maxTokens,
      ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
    },
  };
}

/**
 * Executes a non-streaming chat completion, measures latency and returns provider-reported
 * usage normalized by the provider adapter. Retries rate limits, 5xx and transient network
 * failures with exponential backoff. The API key is never logged or included in errors.
 */
export async function chatWithProvider(input: ProviderChatInput): Promise<ProviderChatResult> {
  const adapter = getAdapter(input.provider);
  if (!adapter) {
    throw new ProviderRuntimeError(
      { code: "unknown_provider", message: `Unknown provider ${input.provider}`, retryable: false },
      0,
      0,
      null,
    );
  }
  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? sleepImpl;
  const maxAttempts = Math.min(Math.max(input.maxAttempts ?? 3, 1), 5);
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), 120_000);
  const { url, headers, body } = buildRequest(input);

  let lastError: ProviderRuntimeError | null = null;
  let retryDelayMs = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = performance.now();
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const requestId = requestIdFrom(response.headers);
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { message: redactSecrets(text.slice(0, 200)) };
      }

      if (!response.ok) {
        const info = normalizeProviderError(input.provider, response.status, parsed);
        lastError = new ProviderRuntimeError(info, response.status, attempt, requestId);
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        retryDelayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 0;
        if (!info.retryable || attempt === maxAttempts) throw lastError;
      } else {
        const usage = adapter.normalize((parsed ?? {}) as Record<string, unknown>);
        return {
          usage: {
            ...usage,
            model: input.model,
            latencyMs: Math.round(performance.now() - started),
            requestId: usage.requestId ?? requestId ?? undefined,
          },
          latencyMs: Math.round(performance.now() - started),
          attempts: attempt,
          status: response.status,
          providerRequestId: usage.requestId ?? requestId,
        };
      }
    } catch (error) {
      if (error instanceof ProviderRuntimeError) {
        if (!error.info.retryable || attempt === maxAttempts) throw error;
        lastError = error;
      } else {
        const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        const info: ProviderErrorInfo = {
          code: aborted ? "provider_timeout" : "provider_network_error",
          message: aborted
            ? `${adapter.label} did not respond within ${timeoutMs}ms`
            : `Network error contacting ${adapter.label}`,
          retryable: true,
        };
        lastError = new ProviderRuntimeError(info, 0, attempt, null);
        if (attempt === maxAttempts) throw lastError;
      }
    }

    const backoff = retryDelayMs || RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
    retryDelayMs = 0;
    await sleep(backoff);
  }

  throw lastError ?? new ProviderRuntimeError(
    { code: "provider_error", message: "Provider request failed", retryable: false },
    0,
    maxAttempts,
    null,
  );
}

export type ConnectionTestResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message: string;
  modelCount: number;
  sampleModels: string[];
  requestId: string | null;
};

function verificationEndpoint(provider: ProviderId): { url: string; headers: Record<string, string> } {
  const adapter = getAdapter(provider)!;
  if (provider === "gemini") {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      headers: { "x-goog-api-key": "" },
    };
  }
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/models?limit=20",
      headers: { "anthropic-version": "2023-06-01" },
    };
  }
  return { url: `${adapter.defaultEndpoint.replace(/\/chat\/completions$/, "")}/models`, headers: {} };
}

function readModelIds(provider: ProviderId, payload: unknown): string[] {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : typeof row.name === "string" ? row.name : "";
      return provider === "gemini" ? id.replace(/^models\//, "") : id;
    })
    .filter(Boolean)
    .slice(0, 5);
}

/**
 * Verifies a provider credential against the provider's model-listing endpoint. This makes a
 * real network call; callers must persist the result and must not claim verification when it fails.
 */
export async function verifyProviderCredential(
  provider: ProviderId,
  apiKey: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ConnectionTestResult> {
  const adapter = getAdapter(provider);
  if (!adapter) {
    return { ok: false, status: 0, latencyMs: 0, message: `Unknown provider ${provider}`, modelCount: 0, sampleModels: [], requestId: null };
  }
  const endpoint = verificationEndpoint(provider);
  const headers: Record<string, string> = { ...endpoint.headers };
  if (provider === "gemini") headers["x-goog-api-key"] = apiKey;
  else if (provider === "anthropic") headers["x-api-key"] = apiKey;
  else headers.authorization = `Bearer ${apiKey}`;

  const started = performance.now();
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint.url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      cache: "no-store",
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const latencyMs = Math.round(performance.now() - started);
    const requestId = requestIdFrom(response.headers);
    if (!response.ok) {
      const info = normalizeProviderError(provider, response.status, payload);
      return { ok: false, status: response.status, latencyMs, message: info.message, modelCount: 0, sampleModels: [], requestId };
    }
    const sampleModels = readModelIds(provider, payload);
    return {
      ok: true,
      status: response.status,
      latencyMs,
      message: `Credential accepted by ${adapter.label}. ${sampleModels.length} model${sampleModels.length === 1 ? "" : "s"} sampled.`,
      modelCount: sampleModels.length,
      sampleModels,
      requestId,
    };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      message: timedOut ? `${adapter.label} did not respond in time.` : `Network error contacting ${adapter.label}.`,
      modelCount: 0,
      sampleModels: [],
      requestId: null,
    };
  }
}
