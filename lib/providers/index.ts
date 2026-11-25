import {
  asNumber,
  asRecord,
  type NormalizedUsage,
  type ProviderAdapter,
  type ProviderErrorInfo,
  type ProviderId,
  type RawUsagePayload,
} from "./types";

function stripDateSuffix(model: string): string {
  return model
    .replace(/-20\d{2}-\d{2}-\d{2}$/, "")
    .replace(/-20\d{2}\d{2}\d{2}$/, "");
}

function sseData(payload: unknown): RawUsagePayload {
  if (typeof payload === "string") {
    let trimmed = payload.trim();
    if (trimmed.startsWith("data:")) trimmed = trimmed.slice(5).trim();
    if (trimmed === "[DONE]" || trimmed === "") return {};
    try {
      return asRecord(JSON.parse(trimmed));
    } catch {
      return {};
    }
  }
  return asRecord(payload);
}

const OPENAI_ALIASES: Record<string, string> = {
  "gpt-4o-latest": "gpt-4o",
  "gpt-4.1-latest": "gpt-4.1",
  "gpt-4.1-mini-latest": "gpt-4.1-mini",
  "gpt-4.1-nano-latest": "gpt-4.1-nano",
};

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  docsUrl: "https://platform.openai.com/docs/api-reference/usage",
  defaultEndpoint: "https://api.openai.com/v1/chat/completions",
  apiStyle: "openai",
  normalizeModel(rawModel) {
    const base = stripDateSuffix(rawModel.trim().toLowerCase());
    return OPENAI_ALIASES[base] ?? base;
  },
  normalize(raw: RawUsagePayload): NormalizedUsage {
    const usage = asRecord(raw.usage);
    const promptDetails = asRecord(usage.prompt_tokens_details);
    const completionDetails = asRecord(usage.completion_tokens_details);
    const cached = asNumber(promptDetails.cached_tokens, asNumber(usage.cached_tokens));
    return {
      model: this.normalizeModel(String(raw.model ?? "")),
      inputTokens: asNumber(usage.prompt_tokens, asNumber(usage.input_tokens)),
      cachedInputTokens: cached,
      cacheWriteTokens: 0,
      outputTokens: asNumber(usage.completion_tokens, asNumber(usage.output_tokens)),
      reasoningTokens: asNumber(completionDetails.reasoning_tokens),
      requestId: typeof raw.id === "string" ? raw.id : undefined,
      statusCode: 200,
      provenance: "provider_reported",
    };
  },
  supportedModels: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini", "text-embedding-3-small"],
  notes: "OpenAI reports cached prompt tokens as a subset of prompt_tokens. Reasoning tokens are billed as output.",
};

const ANTHROPIC_ALIASES: Record<string, string> = {
  "claude-3-5-haiku-latest": "claude-3-5-haiku",
  "claude-3-5-haiku": "claude-3-5-haiku",
  "claude-sonnet-4-0": "claude-sonnet-4",
  "claude-opus-4-0": "claude-opus-4",
};

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  docsUrl: "https://docs.anthropic.com/en/api/usage",
  defaultEndpoint: "https://api.anthropic.com/v1/messages",
  apiStyle: "anthropic",
  normalizeModel(rawModel) {
    const base = stripDateSuffix(rawModel.trim().toLowerCase());
    return ANTHROPIC_ALIASES[base] ?? base;
  },
  normalize(raw: RawUsagePayload): NormalizedUsage {
    const usage = asRecord(raw.usage);
    // Anthropic's input_tokens EXCLUDES cache reads and cache writes.
    const uncachedInput = asNumber(usage.input_tokens);
    const cacheRead = asNumber(usage.cache_read_input_tokens);
    const cacheWrite = asNumber(usage.cache_creation_input_tokens);
    return {
      model: this.normalizeModel(String(raw.model ?? "")),
      inputTokens: uncachedInput + cacheRead,
      cachedInputTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens: asNumber(usage.output_tokens),
      reasoningTokens: 0,
      requestId: typeof raw.id === "string" ? raw.id : undefined,
      statusCode: 200,
      provenance: "provider_reported",
    };
  },
  supportedModels: ["claude-opus-4", "claude-sonnet-4", "claude-3-5-haiku"],
  notes: "Cache reads and cache writes are reported separately from input_tokens and are re-combined before pricing.",
};

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  label: "Google Gemini",
  docsUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
  apiStyle: "gemini",
  normalizeModel(rawModel) {
    return rawModel
      .trim()
      .toLowerCase()
      .replace(/^models\//, "")
      .replace(/-latest$/, "")
      .replace(/-\d{3}$/, "");
  },
  normalize(raw: RawUsagePayload): NormalizedUsage {
    const usage = asRecord(raw.usageMetadata);
    return {
      model: this.normalizeModel(String(raw.modelVersion ?? raw.model ?? "")),
      inputTokens: asNumber(usage.promptTokenCount),
      cachedInputTokens: asNumber(usage.cachedContentTokenCount),
      cacheWriteTokens: 0,
      outputTokens: asNumber(usage.candidatesTokenCount),
      reasoningTokens: asNumber(usage.thoughtsTokenCount),
      requestId: typeof raw.responseId === "string" ? raw.responseId : undefined,
      statusCode: 200,
      provenance: "provider_reported",
    };
  },
  supportedModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  notes: "Uses usageMetadata; cachedContentTokenCount is a subset of promptTokenCount and is billed at the cached input rate.",
};

export const groqAdapter: ProviderAdapter = {
  id: "groq",
  label: "Groq",
  docsUrl: "https://console.groq.com/docs/rate-limits",
  defaultEndpoint: "https://api.groq.com/openai/v1/chat/completions",
  apiStyle: "openai",
  normalizeModel(rawModel) {
    return stripDateSuffix(rawModel.trim().toLowerCase());
  },
  normalize(raw: RawUsagePayload): NormalizedUsage {
    const usage = asRecord(raw.usage);
    const details = asRecord(usage.prompt_tokens_details);
    return {
      model: this.normalizeModel(String(raw.model ?? "")),
      inputTokens: asNumber(usage.prompt_tokens),
      cachedInputTokens: asNumber(details.cached_tokens, asNumber(usage.cached_tokens)),
      cacheWriteTokens: 0,
      outputTokens: asNumber(usage.completion_tokens),
      reasoningTokens: 0,
      requestId: typeof raw.id === "string" ? raw.id : undefined,
      statusCode: 200,
      provenance: "provider_reported",
    };
  },
  supportedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  notes: "OpenAI-compatible usage payload. Cached-token details are read when Groq reports them.",
};

export const mistralAdapter: ProviderAdapter = {
  id: "mistral",
  label: "Mistral",
  docsUrl: "https://docs.mistral.ai/platform/pricing/",
  defaultEndpoint: "https://api.mistral.ai/v1/chat/completions",
  apiStyle: "openai",
  normalizeModel(rawModel) {
    return stripDateSuffix(rawModel.trim().toLowerCase());
  },
  normalize(raw: RawUsagePayload): NormalizedUsage {
    const usage = asRecord(raw.usage);
    const details = asRecord(usage.prompt_tokens_details);
    return {
      model: this.normalizeModel(String(raw.model ?? "")),
      inputTokens: asNumber(usage.prompt_tokens),
      cachedInputTokens: asNumber(details.cached_tokens, asNumber(usage.cached_tokens)),
      cacheWriteTokens: 0,
      outputTokens: asNumber(usage.completion_tokens),
      reasoningTokens: 0,
      requestId: typeof raw.id === "string" ? raw.id : undefined,
      statusCode: 200,
      provenance: "provider_reported",
    };
  },
  supportedModels: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
  notes:
    "OpenAI-compatible usage payload. Standard Mistral usage does not break out cached tokens, so cache reads are only counted when explicitly reported.",
};

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  groq: groqAdapter,
  mistral: mistralAdapter,
};

export function getAdapter(provider: string): ProviderAdapter | null {
  return ADAPTERS[provider as ProviderId] ?? null;
}

export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, value);
}

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /gsk_[A-Za-z0-9_-]{8,}/g,
  /AIza[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
];

/** Removes credential-shaped substrings before an upstream error reaches logs or the UI. */
export function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

export function normalizeProviderError(
  provider: ProviderId,
  status: number,
  payload: unknown,
): ProviderErrorInfo {
  const body = asRecord(payload);
  const error = asRecord(body.error);
  const rawMessage =
    typeof error.message === "string"
      ? error.message
      : typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : `Provider returned HTTP ${status}`;
  const message = redactSecrets(rawMessage).slice(0, 300);

  if (status === 401 || status === 403) {
    return { code: "invalid_credentials", message: `Authentication failed for ${provider}. ${message}`, retryable: false };
  }
  if (status === 404) {
    return { code: "model_not_found", message: `Model or endpoint not found for ${provider}. ${message}`, retryable: false };
  }
  if (status === 429) {
    return { code: "provider_rate_limited", message: `Rate limited by ${provider}. ${message}`, retryable: true };
  }
  if (status >= 500) {
    return { code: "provider_unavailable", message: `${provider} is unavailable. ${message}`, retryable: true };
  }
  if (status === 408) {
    return { code: "provider_timeout", message: `Request to ${provider} timed out. ${message}`, retryable: true };
  }
  if (status === 400 || status === 422) {
    return { code: "provider_invalid_request", message: `Request rejected by ${provider}. ${message}`, retryable: false };
  }
  return { code: "provider_error", message, retryable: status >= 500 };
}

/**
 * Merges token usage from streaming chunks or SSE payload strings. Callers may pass raw
 * `data:` lines, JSON chunks, or SDK event objects. Returns null when no usage was reported.
 */
export function extractStreamUsage(provider: ProviderId, events: unknown[]): NormalizedUsage | null {
  const adapter = ADAPTERS[provider];
  const parsed = events.map(sseData).filter((e) => Object.keys(e).length > 0);
  if (!parsed.length) return null;

  if (provider === "anthropic") {
    let model = "";
    let requestId: string | undefined;
    let inputTokens = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let outputTokens = 0;
    let sawUsage = false;
    for (const event of parsed) {
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "message_start") {
        const message = asRecord(event.message);
        model = String(message.model ?? model);
        requestId = typeof message.id === "string" ? message.id : requestId;
        const usage = asRecord(message.usage);
        if (Object.keys(usage).length) sawUsage = true;
        inputTokens = asNumber(usage.input_tokens, inputTokens);
        cacheRead = asNumber(usage.cache_read_input_tokens, cacheRead);
        cacheWrite = asNumber(usage.cache_creation_input_tokens, cacheWrite);
        outputTokens = Math.max(outputTokens, asNumber(usage.output_tokens));
      }
      if (type === "message_delta") {
        const usage = asRecord(event.usage);
        if (Object.keys(usage).length) sawUsage = true;
        outputTokens = asNumber(usage.output_tokens, outputTokens);
      }
    }
    if (!sawUsage) return null;
    return {
      model: adapter.normalizeModel(model),
      inputTokens: inputTokens + cacheRead,
      cachedInputTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens,
      reasoningTokens: 0,
      requestId,
      statusCode: 200,
      provenance: "provider_reported",
    };
  }

  if (provider === "gemini") {
    let usage: RawUsagePayload | null = null;
    let model = "";
    let requestId: string | undefined;
    for (const event of parsed) {
      const candidate = asRecord(event.usageMetadata);
      if (Object.keys(candidate).length) usage = candidate;
      model = String(event.modelVersion ?? model);
      requestId = typeof event.responseId === "string" ? event.responseId : requestId;
    }
    if (!usage) return null;
    return {
      model: adapter.normalizeModel(model),
      inputTokens: asNumber(usage.promptTokenCount),
      cachedInputTokens: asNumber(usage.cachedContentTokenCount),
      cacheWriteTokens: 0,
      outputTokens: asNumber(usage.candidatesTokenCount),
      reasoningTokens: asNumber(usage.thoughtsTokenCount),
      requestId,
      statusCode: 200,
      provenance: "provider_reported",
    };
  }

  let usage: RawUsagePayload | null = null;
  let model = "";
  let requestId: string | undefined;
  for (const event of parsed) {
    const candidate = asRecord(event.usage);
    if (Object.keys(candidate).length) usage = candidate;
    model = String(event.model ?? model);
    requestId = typeof event.id === "string" ? event.id : requestId;
  }
  if (!usage) return null;
  const details = asRecord(usage.prompt_tokens_details);
  const completionDetails = asRecord(usage.completion_tokens_details);
  return {
    model: adapter.normalizeModel(model),
    inputTokens: asNumber(usage.prompt_tokens),
    cachedInputTokens: asNumber(details.cached_tokens, asNumber(usage.cached_tokens)),
    cacheWriteTokens: 0,
    outputTokens: asNumber(usage.completion_tokens),
    reasoningTokens: asNumber(completionDetails.reasoning_tokens),
    requestId,
    statusCode: 200,
    provenance: "provider_reported",
  };
}
