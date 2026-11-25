import { getAdapter } from "@/lib/providers";
import { PROVIDER_IDS } from "@/lib/providers/types";
import { classifyTask } from "./classify";
import { costForEstimate, estimateTokens, requestedOutputCap } from "./estimate";
import {
  modelKey,
  normalizeGatewayMode,
  normalizeStrategy,
  type CatalogModel,
  type ExcludedCandidate,
  type GatewayChatRequest,
  type GatewayMode,
  type GatewayRoutingDecision,
  type ModelSelection,
  type RoutingStrategy,
  type ScoredCandidate,
  type SelectionContext,
  type SelectionPolicy,
  type TaskClassification,
  type TokenEstimate,
} from "./types";

/** Resolves `provider/model`, a bare model id, or a provider alias to a catalog entry. */
export function resolveCatalogModel(catalog: CatalogModel[], raw: string | null | undefined): CatalogModel | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const provider = trimmed.slice(0, slash).toLowerCase();
    const model = trimmed.slice(slash + 1).toLowerCase();
    const exact = catalog.find((entry) => entry.provider === provider && entry.model === model);
    if (exact) return exact;
    const normalized = getAdapter(provider)?.normalizeModel(model) ?? model;
    return catalog.find((entry) => entry.provider === provider && entry.model === normalized) ?? null;
  }

  const lower = trimmed.toLowerCase();
  for (const provider of PROVIDER_IDS) {
    const normalized = getAdapter(provider)?.normalizeModel(lower) ?? lower;
    const match = catalog.find((entry) => entry.provider === provider && entry.model === normalized);
    if (match) return match;
  }
  return catalog.find((entry) => entry.model === lower) ?? null;
}

function listed(models: string[], entry: CatalogModel): boolean {
  return models.includes(entry.model) || models.includes(modelKey(entry.provider, entry.model));
}

export function restrictionReason(entry: CatalogModel, context: SelectionContext): string | null {
  const allowed = context.allowedModels ?? [];
  const blocked = context.blockedModels ?? [];
  if (allowed.length && !listed(allowed, entry)) {
    return `Model ${modelKey(entry.provider, entry.model)} is not on the organization allow-list`;
  }
  if (blocked.length && listed(blocked, entry)) {
    return `Model ${modelKey(entry.provider, entry.model)} is blocked by organization governance`;
  }
  return null;
}

function policyRestrictionKeys(policy: SelectionPolicy | null | undefined): string[] {
  if (!policy) return [];
  if (policy.candidates?.length) return policy.candidates;
  return [policy.primaryModel, policy.fallbackModel].filter((value): value is string => Boolean(value));
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeMode(
  request: GatewayChatRequest,
  context: SelectionContext,
): { mode: GatewayMode; inferredFromModel: boolean } {
  const explicit = normalizeGatewayMode(context.mode) ?? normalizeGatewayMode(request.tokenburn?.mode);
  if (explicit) return { mode: explicit, inferredFromModel: false };

  const requested = (context.requestedModel ?? request.model ?? "").trim().toLowerCase();
  if (requested === "auto") return { mode: "automatic", inferredFromModel: true };
  if (requested === "recommend" || requested === "recommendation") {
    return { mode: "recommendation", inferredFromModel: true };
  }
  // An explicit concrete model always means manual selection unless the caller opted into
  // automatic/recommendation through a header or the tokenburn extension.
  if (requested) return { mode: "manual", inferredFromModel: false };

  return { mode: normalizeGatewayMode(context.policy?.mode) ?? "manual", inferredFromModel: false };
}

type ScoredEligible = ScoredCandidate & { entry: CatalogModel };

function reasonFor(
  strategy: RoutingStrategy,
  entry: CatalogModel,
  estimate: TokenEstimate,
  costUsd: number,
): string {
  const tokens = `${formatTokens(estimate.inputTokens)} in / ${formatTokens(estimate.outputTokens)} out`;
  switch (strategy) {
    case "lowest_cost":
      return `Lowest estimated cost ($${costUsd.toFixed(6)} for ~${tokens}).`;
    case "best_quality":
      return `Highest quality within the applied budget/floors (score ${entry.qualityScore}) at $${costUsd.toFixed(6)}.`;
    case "lowest_latency":
      return `Lowest typical latency (${entry.typicalLatencyMs}ms) while meeting quality floors.`;
    case "custom":
      return `Matches the policy's explicit candidate order at $${costUsd.toFixed(6)}.`;
    default:
      return `Best blended cost/quality/latency score ($${costUsd.toFixed(6)}, quality ${entry.qualityScore}, ${entry.typicalLatencyMs}ms).`;
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function scoreEligible(
  entries: CatalogModel[],
  estimate: TokenEstimate,
  strategy: RoutingStrategy,
): ScoredEligible[] {
  if (!entries.length) return [];
  const costs = entries.map((entry) => Math.max(costForEstimate(entry, estimate), 1e-9));
  const minCost = Math.min(...costs);
  const minLatency = Math.min(...entries.map((entry) => Math.max(entry.typicalLatencyMs, 1)));
  const scored = entries.map((entry, index) => {
    const costUsd = costs[index];
    const costScore = minCost / costUsd;
    const latencyScore = minLatency / Math.max(entry.typicalLatencyMs, 1);
    const qualityScore = Math.min(1, Math.max(0, entry.qualityScore / 100));
    let score: number;
    switch (strategy) {
      case "lowest_cost":
        score = costScore * 0.85 + qualityScore * 0.1 + latencyScore * 0.05;
        break;
      case "best_quality":
        score = qualityScore * 0.85 + costScore * 0.1 + latencyScore * 0.05;
        break;
      case "lowest_latency":
        score = latencyScore * 0.8 + qualityScore * 0.15 + costScore * 0.05;
        break;
      case "custom":
        score = qualityScore * 0.4 + costScore * 0.4 + latencyScore * 0.2;
        break;
      default:
        score = costScore * 0.45 + qualityScore * 0.35 + latencyScore * 0.2;
        break;
    }
    return {
      entry,
      key: modelKey(entry.provider, entry.model),
      provider: entry.provider,
      model: entry.model,
      displayName: entry.displayName,
      costUsd,
      qualityScore: entry.qualityScore,
      typicalLatencyMs: entry.typicalLatencyMs,
      score: Math.round(score * 10_000) / 10_000,
      reason: reasonFor(strategy, entry, estimate, costUsd),
      pricingVersion: entry.version,
    };
  });

  const primary: Record<RoutingStrategy, (a: ScoredEligible, b: ScoredEligible) => number> = {
    lowest_cost: (a, b) => a.costUsd - b.costUsd || b.qualityScore - a.qualityScore,
    best_quality: (a, b) => b.qualityScore - a.qualityScore || a.costUsd - b.costUsd,
    lowest_latency: (a, b) => a.typicalLatencyMs - b.typicalLatencyMs || b.qualityScore - a.qualityScore,
    balanced: (a, b) => b.score - a.score,
    custom: (a, b) => b.score - a.score,
  };
  return scored.sort(primary[strategy]);
}

function toScored(candidate: ScoredEligible): ScoredCandidate {
  return {
    key: candidate.key,
    provider: candidate.provider,
    model: candidate.model,
    displayName: candidate.displayName,
    costUsd: candidate.costUsd,
    qualityScore: candidate.qualityScore,
    typicalLatencyMs: candidate.typicalLatencyMs,
    score: candidate.score,
    reason: candidate.reason,
    pricingVersion: candidate.pricingVersion,
  };
}

function decisionOf(args: {
  mode: GatewayMode;
  strategy: RoutingStrategy;
  task: TaskClassification;
  estimate: TokenEstimate;
  candidates: ScoredEligible[];
  excluded: ExcludedCandidate[];
  selected: ScoredEligible | null;
  baseline: { key: string; costUsd: number } | null;
}): GatewayRoutingDecision {
  return {
    classifier: `${args.task.kind}:${args.task.complexity}`,
    strategy: args.strategy,
    mode: args.mode,
    estimatedInputTokens: args.estimate.inputTokens,
    estimatedOutputTokens: args.estimate.outputTokens,
    estimatedCostUsd: args.selected?.costUsd ?? 0,
    candidates: args.candidates.slice(0, 10).map((candidate) => ({
      key: candidate.key,
      costUsd: candidate.costUsd,
      qualityScore: candidate.qualityScore,
      typicalLatencyMs: candidate.typicalLatencyMs,
      score: candidate.score,
      reason: candidate.reason,
    })),
    excluded: args.excluded.slice(0, 25),
    baselineModel: args.baseline?.key ?? null,
    baselineEstimateUsd: args.baseline?.costUsd ?? null,
  };
}

/**
 * Selects a model for a gateway request.
 *
 * - manual: uses exactly the requested model and never silently substitutes another model.
 * - recommendation: scores the full catalog and returns the decision without executing it.
 * - automatic: scores the policy's permitted candidate set and returns a fallback order.
 *
 * Organization allow/block lists always apply in every mode.
 */
export function selectModel(
  request: GatewayChatRequest,
  catalog: CatalogModel[],
  context: SelectionContext,
): ModelSelection {
  const { mode } = normalizeMode(request, context);
  const policy = context.policy ?? null;
  const strategy =
    normalizeStrategy(request.tokenburn?.strategy) ??
    normalizeStrategy(policy?.strategy) ??
    (mode === "manual" ? "custom" : "balanced");
  const task = classifyTask(request);
  const estimate = estimateTokens(request, task, { policyMaxOutputTokens: policy?.maxOutputTokens ?? null });
  const requestedCap = requestedOutputCap(request);
  const available = new Set(context.availableProviders);
  const policyId = policy?.id ?? null;
  const requestedRaw = (context.requestedModel ?? request.model ?? "").trim();
  const routableCatalog = catalog.filter((entry) => entry.category !== "embedding" && entry.maxOutput > 0);

  const excluded: ExcludedCandidate[] = [];
  const fitsContext = (entry: CatalogModel): string | null => {
    if (estimate.inputTokens + Math.min(estimate.outputTokens, entry.maxOutput) > entry.contextWindow) {
      return `Estimated ${formatTokens(estimate.inputTokens + estimate.outputTokens)} tokens exceed the ${formatTokens(entry.contextWindow)} context window`;
    }
    if (requestedCap && requestedCap > entry.maxOutput) {
      return `Requested max_tokens ${requestedCap} exceeds the model output limit ${entry.maxOutput}`;
    }
    return null;
  };
  const fitsBudget = (entry: CatalogModel): string | null => {
    if (context.budgetRemainingUsd === null || context.budgetRemainingUsd === undefined) return null;
    const cost = costForEstimate(entry, estimate);
    return cost > context.budgetRemainingUsd + 1e-9
      ? `Estimated $${cost.toFixed(6)} exceeds remaining hard-budget headroom $${context.budgetRemainingUsd.toFixed(6)}`
      : null;
  };
  const floorFor = (entry: CatalogModel): string | null => {
    const floor = Math.max(task.minQuality, policy?.minQualityScore ?? 0);
    return entry.qualityScore < floor
      ? `Quality score ${entry.qualityScore} is below the required floor ${floor}`
      : null;
  };
  const latencyFor = (entry: CatalogModel): string | null => {
    if (!policy?.maxLatencyMs) return null;
    return entry.typicalLatencyMs > policy.maxLatencyMs
      ? `Typical latency ${entry.typicalLatencyMs}ms exceeds the policy ceiling ${policy.maxLatencyMs}ms`
      : null;
  };

  const baselineRaw =
    request.tokenburn?.baselineModel ??
    (mode === "manual" ? requestedRaw : policy?.primaryModel ?? null) ??
    null;
  const baselineEntry = resolveCatalogModel(routableCatalog, baselineRaw);
  const baseline = baselineEntry
    ? { key: modelKey(baselineEntry.provider, baselineEntry.model), costUsd: costForEstimate(baselineEntry, estimate) }
    : null;

  const fail = (code: string, message: string): ModelSelection => ({
    mode,
    strategy,
    task,
    estimate,
    selected: null,
    candidates: [],
    excluded,
    fallbackChain: [],
    baseline,
    policyId,
    error: { code, message },
    decision: decisionOf({ mode, strategy, task, estimate, candidates: [], excluded, selected: null, baseline }),
  });

  if (mode === "manual") {
    if (!requestedRaw || requestedRaw.toLowerCase() === "auto" || requestedRaw.toLowerCase() === "recommend") {
      return fail("missing_model", "Manual mode requires an explicit model, for example openai/gpt-4.1-mini.");
    }
    const entry = resolveCatalogModel(routableCatalog, requestedRaw);
    if (!entry) {
      return fail(
        "model_not_found",
        `Model "${requestedRaw}" is not in the active pricing catalog. Use provider/model or add its pricing first.`,
      );
    }
    const key = modelKey(entry.provider, entry.model);
    const restriction = restrictionReason(entry, context);
    if (restriction) {
      excluded.push({ key, reason: restriction });
      return fail("model_blocked", restriction);
    }
    if (!available.has(entry.provider)) {
      const message = `Provider "${entry.provider}" has no stored credential. Add one in Settings → Providers.`;
      excluded.push({ key, reason: "Provider credential not configured" });
      return fail("provider_not_configured", message);
    }
    const contextIssue = fitsContext(entry);
    if (contextIssue) {
      excluded.push({ key, reason: contextIssue });
      return fail("context_window_exceeded", contextIssue);
    }
    const budgetIssue = fitsBudget(entry);
    if (budgetIssue) {
      excluded.push({ key, reason: budgetIssue });
      return fail("budget_exceeded", budgetIssue);
    }

    const selected: ScoredEligible = {
      entry,
      key,
      provider: entry.provider,
      model: entry.model,
      displayName: entry.displayName,
      costUsd: costForEstimate(entry, estimate),
      qualityScore: entry.qualityScore,
      typicalLatencyMs: entry.typicalLatencyMs,
      score: 1,
      reason: "Manual selection requested by the caller. Organization restrictions were checked.",
      pricingVersion: entry.version,
    };

    const fallbackKeys = uniq(
      [policy?.fallbackModel, context.fallbackModel].filter((value): value is string => Boolean(value)),
    );
    const fallbackChain: string[] = [];
    for (const raw of fallbackKeys) {
      const fallbackEntry = resolveCatalogModel(routableCatalog, raw);
      if (!fallbackEntry) continue;
      const fallbackKey = modelKey(fallbackEntry.provider, fallbackEntry.model);
      if (fallbackKey === key) continue;
      if (restrictionReason(fallbackEntry, context)) continue;
      if (!available.has(fallbackEntry.provider)) continue;
      if (fitsContext(fallbackEntry)) continue;
      fallbackChain.push(fallbackKey);
      if (fallbackChain.length >= 3) break;
    }

    return {
      mode,
      strategy,
      task,
      estimate,
      selected: toScored(selected),
      candidates: [toScored(selected)],
      excluded,
      fallbackChain,
      baseline: baseline ?? { key, costUsd: selected.costUsd },
      policyId,
      error: null,
      decision: decisionOf({
        mode,
        strategy,
        task,
        estimate,
        candidates: [selected],
        excluded,
        selected,
        baseline: baseline ?? { key, costUsd: selected.costUsd },
      }),
    };
  }

  // recommendation and automatic share filtering/scoring; they differ in the candidate pool and in
  // whether the caller executes the result.
  const restricted = mode === "automatic";
  const poolKeys = restricted ? policyRestrictionKeys(policy) : [];
  const poolEntries: CatalogModel[] = [];
  if (restricted && poolKeys.length) {
    for (const raw of poolKeys) {
      const entry = resolveCatalogModel(routableCatalog, raw);
      if (!entry) {
        excluded.push({ key: raw, reason: "Not in the active pricing catalog" });
        continue;
      }
      poolEntries.push(entry);
    }
  } else {
    poolEntries.push(...routableCatalog);
  }

  const seen = new Set<string>();
  const eligible: CatalogModel[] = [];
  for (const entry of poolEntries) {
    const key = modelKey(entry.provider, entry.model);
    if (seen.has(key)) continue;
    seen.add(key);
    const restriction = restrictionReason(entry, context);
    if (restriction) {
      excluded.push({ key, reason: restriction });
      continue;
    }
    const qualityIssue = floorFor(entry);
    if (qualityIssue) {
      excluded.push({ key, reason: qualityIssue });
      continue;
    }
    const latencyIssue = latencyFor(entry);
    if (latencyIssue) {
      excluded.push({ key, reason: latencyIssue });
      continue;
    }
    const contextIssue = fitsContext(entry);
    if (contextIssue) {
      excluded.push({ key, reason: contextIssue });
      continue;
    }
    if (!available.has(entry.provider)) {
      excluded.push({ key, reason: `Provider "${entry.provider}" has no stored credential` });
      continue;
    }
    const budgetIssue = fitsBudget(entry);
    if (budgetIssue) {
      excluded.push({ key, reason: budgetIssue });
      continue;
    }
    eligible.push(entry);
  }

  let candidates = scoreEligible(eligible, estimate, strategy);
  if (strategy === "custom" && policy?.candidates?.length) {
    const order = new Map<string, number>();
    policy.candidates.forEach((raw, index) => {
      const entry = resolveCatalogModel(routableCatalog, raw);
      const key = entry ? modelKey(entry.provider, entry.model) : raw;
      if (!order.has(key)) order.set(key, index);
    });
    candidates = [...candidates].sort(
      (a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  if (candidates.length === 0) {
    if (available.size === 0) {
      return fail(
        "no_configured_provider",
        "No provider credentials are configured. Add a provider key in Settings → Providers before routing.",
      );
    }
    if (context.budgetRemainingUsd !== null && context.budgetRemainingUsd !== undefined) {
      return fail(
        "budget_exhausted",
        "Remaining hard-budget headroom cannot cover any eligible model. Raise the budget or wait for the period to reset.",
      );
    }
    return fail(
      "no_eligible_model",
      restricted
        ? "No model in this policy satisfies the organization restrictions, quality floor, latency ceiling and context requirements."
        : "No catalog model satisfies the organization restrictions, quality floor, latency ceiling and context requirements.",
    );
  }

  const selected = candidates[0];
  const fallbackChain: string[] = [];
  const policyFallback = resolveCatalogModel(routableCatalog, policy?.fallbackModel ?? null);
  const orgFallback = resolveCatalogModel(routableCatalog, context.fallbackModel ?? null);
  for (const fallbackEntry of [policyFallback, orgFallback]) {
    if (!fallbackEntry) continue;
    const key = modelKey(fallbackEntry.provider, fallbackEntry.model);
    if (key === selected.key || fallbackChain.includes(key)) continue;
    if (restrictionReason(fallbackEntry, context)) continue;
    if (!available.has(fallbackEntry.provider)) continue;
    if (fitsContext(fallbackEntry)) continue;
    if (floorFor(fallbackEntry)) continue;
    if (latencyFor(fallbackEntry)) continue;
    fallbackChain.push(key);
  }
  for (const candidate of candidates.slice(1)) {
    if (fallbackChain.length >= 3) break;
    if (!fallbackChain.includes(candidate.key)) fallbackChain.push(candidate.key);
  }

  return {
    mode,
    strategy,
    task,
    estimate,
    selected: toScored(selected),
    candidates: candidates.map(toScored),
    excluded,
    fallbackChain: fallbackChain.slice(0, 3),
    baseline:
      baseline ??
      (baselineEntry
        ? { key: modelKey(baselineEntry.provider, baselineEntry.model), costUsd: costForEstimate(baselineEntry, estimate) }
        : null),
    policyId,
    error: null,
    decision: decisionOf({
      mode,
      strategy,
      task,
      estimate,
      candidates,
      excluded,
      selected,
      baseline:
        baseline ??
        (baselineEntry
          ? {
              key: modelKey(baselineEntry.provider, baselineEntry.model),
              costUsd: costForEstimate(baselineEntry, estimate),
            }
          : null),
    }),
  };
}
