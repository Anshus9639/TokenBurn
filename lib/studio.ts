import { computeCost } from "@/lib/pricing";

/**
 * Pure simulation math for the Optimization Studio. All costs route through the
 * same authoritative computeCost engine used for ingestion, so a simulated
 * reprice and a billed event cannot drift apart.
 */

export type SimModel = {
  key: string;
  label: string;
  provider: string;
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  cacheWritePerM: number | null;
  qualityScore: number;
  latencyMs: number;
  contextWindow: number;
  maxOutput: number;
};

export type SimWorkload = {
  requests: number;
  avgInput: number;
  avgOutput: number;
  /** Share of input tokens served from cache, 0..1. */
  cachedShare: number;
};

export type SimOptions = {
  /** Assumed reduction of average input tokens, 0..1. */
  inputReduction?: number;
  /** Assumed reduction of average output tokens, 0..1. */
  outputReduction?: number;
};

export type SimResult = {
  requests: number;
  avgInput: number;
  avgOutput: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  inputUsd: number;
  outputUsd: number;
  cachedInputUsd: number;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const nonNegative = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);

export function simulate(model: SimModel, workload: SimWorkload, opts: SimOptions = {}): SimResult {
  const requests = nonNegative(workload.requests);
  const inputReduction = clamp01(opts.inputReduction ?? 0);
  const outputReduction = clamp01(opts.outputReduction ?? 0);
  const avgInput = nonNegative(workload.avgInput) * (1 - inputReduction);
  const avgOutput = nonNegative(workload.avgOutput) * (1 - outputReduction);
  const inputTokens = requests * avgInput;
  const outputTokens = requests * avgOutput;
  const cachedInputTokens = inputTokens * clamp01(workload.cachedShare);

  const { costUsd, breakdown } = computeCost(
    {
      provider: model.provider,
      model: model.key,
      displayName: model.label,
      inputPerM: model.inputPerM,
      cachedInputPerM: model.cachedInputPerM,
      outputPerM: model.outputPerM,
      cacheWritePerM: model.cacheWritePerM,
      category: "chat",
      qualityScore: model.qualityScore,
      typicalLatencyMs: model.latencyMs,
      contextWindow: model.contextWindow,
      maxOutput: model.maxOutput,
    },
    { inputTokens, cachedInputTokens, outputTokens },
  );

  return {
    requests,
    avgInput,
    avgOutput,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costUsd,
    inputUsd: breakdown.inputUsd + breakdown.cachedInputUsd,
    outputUsd: breakdown.outputUsd,
    cachedInputUsd: breakdown.cachedInputUsd,
  };
}

export type SimComparison = {
  baseline: SimResult;
  optimized: SimResult;
  deltaUsd: number;
  deltaPct: number;
  inputTokenDeltaPct: number;
  outputTokenDeltaPct: number;
  qualityDelta: number;
  latencyDeltaMs: number;
  contextFit: boolean;
  outputFit: boolean;
};

/**
 * Compares the same measured workload running on the current model unmodified
 * against the candidate model under the assumed reductions. Latency and quality
 * come from catalog metadata and are labeled as estimates in the UI.
 */
export function compareModels(
  current: SimModel,
  candidate: SimModel,
  workload: SimWorkload,
  opts: SimOptions = {},
): SimComparison {
  const baseline = simulate(current, workload);
  const optimized = simulate(candidate, workload, opts);
  const deltaUsd = baseline.costUsd - optimized.costUsd;
  return {
    baseline,
    optimized,
    deltaUsd,
    deltaPct: baseline.costUsd > 0 ? deltaUsd / baseline.costUsd : 0,
    inputTokenDeltaPct:
      baseline.inputTokens > 0 ? (baseline.inputTokens - optimized.inputTokens) / baseline.inputTokens : 0,
    outputTokenDeltaPct:
      baseline.outputTokens > 0 ? (baseline.outputTokens - optimized.outputTokens) / baseline.outputTokens : 0,
    qualityDelta: candidate.qualityScore - current.qualityScore,
    latencyDeltaMs: candidate.latencyMs - current.latencyMs,
    contextFit: optimized.avgInput + optimized.avgOutput <= candidate.contextWindow,
    outputFit: optimized.avgOutput <= candidate.maxOutput,
  };
}

export type CacheLadderRow = { sharePct: number; costUsd: number; savedUsd: number };

export function cacheLadder(
  model: SimModel,
  workload: SimWorkload,
  shares = [0, 20, 40, 60, 80],
): CacheLadderRow[] {
  const uncached = simulate(model, { ...workload, cachedShare: 0 }).costUsd;
  return shares.map((sharePct) => {
    const costUsd = simulate(model, { ...workload, cachedShare: sharePct / 100 }).costUsd;
    return { sharePct, costUsd, savedUsd: Math.max(0, uncached - costUsd) };
  });
}

export type Forecast = {
  dailyRate: number;
  projected: number;
  projectedRouted: number;
};

export function forecastMonth(input: {
  mtdCost: number;
  dayOfMonth: number;
  daysInMonth: number;
  growthPct?: number;
  routingRatio?: number;
}): Forecast {
  const dailyRate = input.dayOfMonth > 0 ? nonNegative(input.mtdCost) / input.dayOfMonth : 0;
  const growth = 1 + (Number.isFinite(input.growthPct ?? 0) ? (input.growthPct ?? 0) / 100 : 0);
  const projected = dailyRate * nonNegative(input.daysInMonth) * Math.max(0, growth);
  const routed = projected * (Number.isFinite(input.routingRatio ?? 1) ? (input.routingRatio ?? 1) : 1);
  return { dailyRate, projected, projectedRouted: routed };
}
