import { computeCost, type PricingLike } from "@/lib/pricing";

export type SavingsUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type RealizedSavings = {
  /** True only when provider-reported usage and baseline pricing are both available. */
  realized: boolean;
  baselineCostUsd: number | null;
  realizedSavingsUsd: number | null;
  reason: string | null;
};

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/**
 * Savings measured against the baseline model using the tokens the provider actually reported.
 * Projected differences are never reported as realized: estimated usage yields a null result.
 */
export function computeRealizedSavings(args: {
  usage: SavingsUsage;
  actualCostUsd: number;
  usageSource: string;
  baselinePricing: PricingLike | null;
}): RealizedSavings {
  const reported = args.usageSource === "provider_reported" || args.usageSource === "reconciled";
  if (!reported) {
    return {
      realized: false,
      baselineCostUsd: null,
      realizedSavingsUsd: null,
      reason: `Usage source is "${args.usageSource}", so savings stay unrealized until provider usage is reconciled.`,
    };
  }
  if (!args.baselinePricing) {
    return {
      realized: false,
      baselineCostUsd: null,
      realizedSavingsUsd: null,
      reason: "No baseline pricing is available for the comparison model.",
    };
  }
  const tokenTotal =
    args.usage.inputTokens + args.usage.cacheWriteTokens + args.usage.outputTokens + args.usage.reasoningTokens;
  if (tokenTotal <= 0) {
    return {
      realized: false,
      baselineCostUsd: null,
      realizedSavingsUsd: null,
      reason: "The provider did not report token usage, so savings cannot be measured.",
    };
  }

  const baselineCostUsd = computeCost(args.baselinePricing, {
    inputTokens: args.usage.inputTokens,
    cachedInputTokens: args.usage.cachedInputTokens,
    cacheWriteTokens: args.usage.cacheWriteTokens,
    outputTokens: args.usage.outputTokens,
    reasoningTokens: args.usage.reasoningTokens,
  }).costUsd;

  return {
    realized: true,
    baselineCostUsd: round6(baselineCostUsd),
    realizedSavingsUsd: round6(baselineCostUsd - args.actualCostUsd),
    reason: null,
  };
}

/** Preflight difference between baseline and selected model. Always labelled estimated. */
export function estimatedSavings(baselineEstimateUsd: number | null, selectedEstimateUsd: number | null): number | null {
  if (baselineEstimateUsd === null || selectedEstimateUsd === null) return null;
  return round6(baselineEstimateUsd - selectedEstimateUsd);
}

export function realizedSavingsTotal(
  rows: Array<{ realizedSavingsUsd: string | number | null; usageSource: string }>,
): number {
  let total = 0;
  for (const row of rows) {
    if (row.usageSource !== "provider_reported" && row.usageSource !== "reconciled") continue;
    if (row.realizedSavingsUsd === null) continue;
    total += Number(row.realizedSavingsUsd);
  }
  return round6(total);
}
