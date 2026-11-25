export type PricingLike = {
  provider: string;
  model: string;
  displayName: string;
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  cacheWritePerM: number | null;
  category: string;
  qualityScore: number;
  typicalLatencyMs: number;
  contextWindow: number;
  maxOutput: number;
};

export type UsageTokens = {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
};

export type CostResult = {
  costUsd: number;
  breakdown: {
    inputUsd: number;
    cachedInputUsd: number;
    cacheWriteUsd: number;
    outputUsd: number;
    reasoningUsd: number;
    discountApplied: number;
  };
};

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/**
 * Cost model (per 1M tokens, server-authoritative):
 * - inputTokens is the TOTAL prompt token count.
 * - cachedInputTokens is a subset billed at the discounted cached rate.
 * - cacheWriteTokens are billed at the cache-write rate (or 1.25x input).
 * - reasoningTokens are billed at the output rate when reported separately.
 */
export function computeCost(pricing: PricingLike, usage: UsageTokens): CostResult {
  const inputTokens = Math.max(0, usage.inputTokens || 0);
  const cachedInput = Math.min(Math.max(0, usage.cachedInputTokens || 0), inputTokens);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens || 0);
  const output = Math.max(0, usage.outputTokens || 0);
  const reasoning = Math.max(0, usage.reasoningTokens || 0);

  const uncachedInput = Math.max(0, inputTokens - cachedInput);
  const inputUsd = (uncachedInput * pricing.inputPerM) / 1_000_000;
  const cachedInputUsd = (cachedInput * pricing.cachedInputPerM) / 1_000_000;
  const cacheWriteRate = pricing.cacheWritePerM ?? pricing.inputPerM * 1.25;
  const cacheWriteUsd = (cacheWrite * cacheWriteRate) / 1_000_000;
  const outputUsd = (output * pricing.outputPerM) / 1_000_000;
  const reasoningUsd = (reasoning * pricing.outputPerM) / 1_000_000;
  const discountApplied = (cachedInput * (pricing.inputPerM - pricing.cachedInputPerM)) / 1_000_000;

  return {
    costUsd: round6(inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd + reasoningUsd),
    breakdown: {
      inputUsd: round6(inputUsd),
      cachedInputUsd: round6(cachedInputUsd),
      cacheWriteUsd: round6(cacheWriteUsd),
      outputUsd: round6(outputUsd),
      reasoningUsd: round6(reasoningUsd),
      discountApplied: round6(discountApplied),
    },
  };
}

export function blendedPerM(pricing: PricingLike, outputShare = 0.25): number {
  return pricing.inputPerM * (1 - outputShare) + pricing.outputPerM * outputShare;
}

export function siblingModels<T extends { provider: string; model: string; qualityScore: number; category: string; outputPerM: number }>(
  all: T[],
  current: { model: string; qualityScore: number },
  minQualityDrop = 12,
): T[] {
  return all
    .filter(
      (p) =>
        p.model !== current.model &&
        p.qualityScore >= current.qualityScore - minQualityDrop &&
        p.qualityScore >= 45,
    )
    .sort((a, b) => a.outputPerM - b.outputPerM);
}

export type CatalogSeed = {
  provider: string;
  model: string;
  displayName: string;
  family: string;
  category: "frontier" | "mid" | "economy" | "reasoning" | "embedding";
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  cacheWritePerM: number | null;
  contextWindow: number;
  maxOutput: number;
  qualityScore: number;
  typicalLatencyMs: number;
  notes?: string;
};

/** List prices per 1M tokens. Verify against provider pricing pages before production use. */
export const PRICING_CATALOG: CatalogSeed[] = [
  {
    provider: "openai",
    model: "gpt-4.1",
    displayName: "GPT-4.1",
    family: "GPT-4.1",
    category: "frontier",
    inputPerM: 2.0,
    cachedInputPerM: 0.5,
    outputPerM: 8.0,
    cacheWritePerM: null,
    contextWindow: 1_047_576,
    maxOutput: 32_768,
    qualityScore: 92,
    typicalLatencyMs: 1400,
    notes: "Frontier general model with 75% cached-input discount.",
  },
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    displayName: "GPT-4.1 mini",
    family: "GPT-4.1",
    category: "mid",
    inputPerM: 0.4,
    cachedInputPerM: 0.1,
    outputPerM: 1.6,
    cacheWritePerM: null,
    contextWindow: 1_047_576,
    maxOutput: 32_768,
    qualityScore: 82,
    typicalLatencyMs: 850,
  },
  {
    provider: "openai",
    model: "gpt-4.1-nano",
    displayName: "GPT-4.1 nano",
    family: "GPT-4.1",
    category: "economy",
    inputPerM: 0.1,
    cachedInputPerM: 0.025,
    outputPerM: 0.4,
    cacheWritePerM: null,
    contextWindow: 1_047_576,
    maxOutput: 32_768,
    qualityScore: 63,
    typicalLatencyMs: 480,
  },
  {
    provider: "openai",
    model: "gpt-4o",
    displayName: "GPT-4o",
    family: "GPT-4o",
    category: "frontier",
    inputPerM: 2.5,
    cachedInputPerM: 1.25,
    outputPerM: 10.0,
    cacheWritePerM: null,
    contextWindow: 128_000,
    maxOutput: 16_384,
    qualityScore: 88,
    typicalLatencyMs: 1100,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    displayName: "GPT-4o mini",
    family: "GPT-4o",
    category: "mid",
    inputPerM: 0.15,
    cachedInputPerM: 0.075,
    outputPerM: 0.6,
    cacheWritePerM: null,
    contextWindow: 128_000,
    maxOutput: 16_384,
    qualityScore: 74,
    typicalLatencyMs: 620,
  },
  {
    provider: "openai",
    model: "o3",
    displayName: "o3",
    family: "o-series",
    category: "reasoning",
    inputPerM: 2.0,
    cachedInputPerM: 0.5,
    outputPerM: 8.0,
    cacheWritePerM: null,
    contextWindow: 200_000,
    maxOutput: 100_000,
    qualityScore: 95,
    typicalLatencyMs: 6400,
    notes: "Reasoning tokens are billed as output.",
  },
  {
    provider: "openai",
    model: "o4-mini",
    displayName: "o4-mini",
    family: "o-series",
    category: "reasoning",
    inputPerM: 1.1,
    cachedInputPerM: 0.275,
    outputPerM: 4.4,
    cacheWritePerM: null,
    contextWindow: 200_000,
    maxOutput: 100_000,
    qualityScore: 86,
    typicalLatencyMs: 3800,
  },
  {
    provider: "openai",
    model: "text-embedding-3-small",
    displayName: "Embedding 3 Small",
    family: "embeddings",
    category: "embedding",
    inputPerM: 0.02,
    cachedInputPerM: 0.02,
    outputPerM: 0.0,
    cacheWritePerM: null,
    contextWindow: 8_191,
    maxOutput: 0,
    qualityScore: 70,
    typicalLatencyMs: 120,
  },
  {
    provider: "anthropic",
    model: "claude-opus-4",
    displayName: "Claude Opus 4",
    family: "Claude 4",
    category: "frontier",
    inputPerM: 15.0,
    cachedInputPerM: 1.5,
    outputPerM: 75.0,
    cacheWritePerM: 18.75,
    contextWindow: 200_000,
    maxOutput: 32_000,
    qualityScore: 96,
    typicalLatencyMs: 2600,
    notes: "Prompt caching read 90% discount; 5-minute cache writes billed at 1.25x input.",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4",
    displayName: "Claude Sonnet 4",
    family: "Claude 4",
    category: "frontier",
    inputPerM: 3.0,
    cachedInputPerM: 0.3,
    outputPerM: 15.0,
    cacheWritePerM: 3.75,
    contextWindow: 200_000,
    maxOutput: 64_000,
    qualityScore: 90,
    typicalLatencyMs: 1500,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-haiku",
    displayName: "Claude 3.5 Haiku",
    family: "Claude 3.5",
    category: "economy",
    inputPerM: 0.8,
    cachedInputPerM: 0.08,
    outputPerM: 4.0,
    cacheWritePerM: 1.0,
    contextWindow: 200_000,
    maxOutput: 8_192,
    qualityScore: 66,
    typicalLatencyMs: 700,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    family: "Gemini 2.5",
    category: "frontier",
    inputPerM: 1.25,
    cachedInputPerM: 0.31,
    outputPerM: 10.0,
    cacheWritePerM: null,
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    qualityScore: 91,
    typicalLatencyMs: 2100,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    family: "Gemini 2.5",
    category: "mid",
    inputPerM: 0.3,
    cachedInputPerM: 0.075,
    outputPerM: 2.5,
    cacheWritePerM: null,
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    qualityScore: 78,
    typicalLatencyMs: 640,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash Lite",
    family: "Gemini 2.5",
    category: "economy",
    inputPerM: 0.1,
    cachedInputPerM: 0.025,
    outputPerM: 0.4,
    cacheWritePerM: null,
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    qualityScore: 60,
    typicalLatencyMs: 380,
  },
  {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    displayName: "Llama 3.3 70B",
    family: "Llama",
    category: "mid",
    inputPerM: 0.59,
    cachedInputPerM: 0.59,
    outputPerM: 0.79,
    cacheWritePerM: null,
    contextWindow: 131_072,
    maxOutput: 32_768,
    qualityScore: 71,
    typicalLatencyMs: 280,
  },
  {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    displayName: "Llama 3.1 8B Instant",
    family: "Llama",
    category: "economy",
    inputPerM: 0.05,
    cachedInputPerM: 0.05,
    outputPerM: 0.08,
    cacheWritePerM: null,
    contextWindow: 131_072,
    maxOutput: 8_192,
    qualityScore: 52,
    typicalLatencyMs: 180,
  },
  {
    provider: "mistral",
    model: "mistral-large-latest",
    displayName: "Mistral Large",
    family: "Mistral",
    category: "frontier",
    inputPerM: 2.0,
    cachedInputPerM: 2.0,
    outputPerM: 6.0,
    cacheWritePerM: null,
    contextWindow: 131_072,
    maxOutput: 32_768,
    qualityScore: 84,
    typicalLatencyMs: 1200,
    notes:
      "List prices per 1M tokens; verify with Mistral before production. Cached input equals input because standard usage does not break out cache reads.",
  },
  {
    provider: "mistral",
    model: "mistral-small-latest",
    displayName: "Mistral Small",
    family: "Mistral",
    category: "mid",
    inputPerM: 0.1,
    cachedInputPerM: 0.1,
    outputPerM: 0.3,
    cacheWritePerM: null,
    contextWindow: 131_072,
    maxOutput: 32_768,
    qualityScore: 66,
    typicalLatencyMs: 520,
    notes: "List prices per 1M tokens; no cached-token discount applied without provider-reported cache reads.",
  },
  {
    provider: "mistral",
    model: "codestral-latest",
    displayName: "Codestral",
    family: "Codestral",
    category: "mid",
    inputPerM: 0.3,
    cachedInputPerM: 0.3,
    outputPerM: 0.9,
    cacheWritePerM: null,
    contextWindow: 262_144,
    maxOutput: 32_768,
    qualityScore: 70,
    typicalLatencyMs: 700,
    notes: "Code-oriented list price; validate against the Mistral console before production use.",
  },
];

export const MODEL_KEY_SEPARATOR = "/";

export function modelKey(provider: string, model: string): string {
  return `${provider}${MODEL_KEY_SEPARATOR}${model}`;
}

export function parseModelKey(key: string): { provider: string; model: string } {
  const [provider, ...rest] = key.split(MODEL_KEY_SEPARATOR);
  return { provider: provider ?? "", model: rest.join(MODEL_KEY_SEPARATOR) };
}

export function findCatalogEntry(provider: string, model: string): CatalogSeed | undefined {
  return PRICING_CATALOG.find((p) => p.provider === provider && p.model === model);
}
