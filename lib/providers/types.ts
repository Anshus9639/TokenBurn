export const PROVIDER_IDS = ["openai", "anthropic", "gemini", "groq", "mistral"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type UsageProvenance = "provider_reported" | "estimated" | "reconciled" | "synthetic";

export type NormalizedUsage = {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  requestId?: string;
  promptHash?: string;
  latencyMs?: number;
  statusCode?: number;
  occurredAt?: string;
  provenance: UsageProvenance;
};

export type RawUsagePayload = Record<string, unknown>;

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  docsUrl: string;
  defaultEndpoint: string;
  apiStyle: "openai" | "anthropic" | "gemini";
  normalizeModel(rawModel: string): string;
  normalize(raw: RawUsagePayload): NormalizedUsage;
  supportedModels: string[];
  notes: string;
};

export type ProviderErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
};

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
