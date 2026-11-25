import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import { routingHolds, routingRollouts } from "@/lib/db/schema";
import { checkRoutingAllowance } from "@/lib/governance";
import type { ApiKeyContext } from "@/lib/auth";
import type { PricingRecord } from "@/lib/pricing-db";
import { rateHeaders } from "@/lib/api-response";
import { logEvent } from "@/lib/log";
import { circuitFailure, circuitGate, circuitSuccess, isAvailabilityFailure } from "./circuit";
import { costForEstimate } from "./estimate";
import { loadGatewayContext, type GatewayContext } from "./context";
import { computeCost } from "@/lib/pricing";
import {
  finalizeGatewayRecord,
  insertFailedGatewayRequest,
  insertPendingGatewayRequest,
  type GatewayRecordSummary,
} from "./record";
import { estimatedSavings } from "./savings";
import { recordShadowSample } from "./rollout";
import { restrictionReason, resolveCatalogModel, selectModel } from "./selection";
import {
  completeChat,
  GatewayTransportError,
  streamChat,
  toOpenAIUsage,
  type GatewayCompletion,
} from "./transport";
import {
  modelKey,
  normalizeGatewayMode,
  type GatewayChatRequest,
  type ModelSelection,
  type ScoredCandidate,
  type SelectionContext,
  type TokenEstimate,
} from "./types";

export type GatewayExecution =
  | {
      kind: "response";
      body: Record<string, unknown>;
      headers: Record<string, string>;
      gatewayRequestId: string;
      selection: ModelSelection;
      completion: GatewayCompletion;
      summary: GatewayRecordSummary;
      background?: Promise<void>;
    }
  | {
      kind: "stream";
      stream: ReadableStream<Uint8Array>;
      headers: Record<string, string>;
      gatewayRequestId: string;
      selection: ModelSelection;
      finalize: () => Promise<void>;
      background?: Promise<void>;
    }
  | {
      kind: "recommendation";
      body: Record<string, unknown>;
      headers: Record<string, string>;
      selection: ModelSelection;
    };

export class GatewayError extends Error {
  status: number;
  code: string;
  details?: unknown;
  requestId?: string;
  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

type Attempt = {
  key: string;
  provider: string;
  model: string;
  pricing: PricingRecord;
};

function catalogPricing(context: GatewayContext, key: string | null | undefined): PricingRecord | null {
  if (!key) return null;
  const entry = resolveCatalogModel(context.catalog, key);
  if (!entry) return null;
  return context.catalog.find((row) => row.provider === entry.provider && row.model === entry.model) ?? null;
}

function scoredFromEntry(entry: PricingRecord, estimate: TokenEstimate, reason: string): ScoredCandidate {
  return {
    key: modelKey(entry.provider, entry.model),
    provider: entry.provider,
    model: entry.model,
    displayName: entry.displayName,
    costUsd: costForEstimate(entry, estimate),
    qualityScore: entry.qualityScore,
    typicalLatencyMs: entry.typicalLatencyMs,
    score: 1,
    reason,
    pricingVersion: entry.version,
  };
}

function selectionContextFor(
  request: GatewayChatRequest,
  context: GatewayContext,
  mode?: string | null,
): SelectionContext {
  return {
    allowedModels: context.settings.allowedModels ?? [],
    blockedModels: context.settings.blockedModels ?? [],
    fallbackModel: context.settings.fallbackModel ?? null,
    policy: context.policy,
    availableProviders: context.availableProviders,
    budgetRemainingUsd: context.budgetRemainingUsd,
    mode: normalizeGatewayMode(mode ?? request.tokenburn?.mode),
    requestedModel: request.model ?? null,
  };
}

function applyModeHeaders(request: GatewayChatRequest, headers: Headers): GatewayChatRequest {
  const next = { ...(request.tokenburn ?? {}) };
  const mode = headers.get("x-tokenburn-mode");
  const strategy = headers.get("x-tokenburn-strategy");
  const feature = headers.get("x-tokenburn-feature");
  const baselineModel = headers.get("x-tokenburn-baseline-model");
  const environment = headers.get("x-tokenburn-environment");
  if (mode) next.mode = mode;
  if (strategy) next.strategy = strategy;
  if (feature) next.feature = feature;
  if (baselineModel) next.baselineModel = baselineModel;
  if (environment) next.environment = environment;
  return Object.keys(next).length ? { ...request, tokenburn: next } : request;
}

export function withGatewayHeaders(request: GatewayChatRequest, headers: Headers): GatewayChatRequest {
  return applyModeHeaders(request, headers);
}

function selectionErrorStatus(code: string): number {
  if (code === "model_blocked") return 403;
  if (code === "budget_exhausted") return 402;
  if (code === "no_configured_provider") return 503;
  if (code === "provider_not_configured") return 400;
  if (code === "missing_model") return 400;
  return 422;
}

function providerErrorStatus(info: { code: string } | null): number {
  if (!info) return 502;
  if (info.code === "provider_rate_limited") return 429;
  if (info.code === "provider_timeout") return 504;
  if (info.code === "provider_circuit_open") return 503;
  if (info.code === "provider_invalid_request") return 400;
  return 502;
}

function shouldFallback(info: { code: string; retryable: boolean }): boolean {
  return (
    info.retryable ||
    info.code === "invalid_credentials" ||
    info.code === "model_not_found" ||
    info.code === "provider_unavailable"
  );
}

function attemptFor(context: GatewayContext, key: string): Attempt | null {
  const pricing = catalogPricing(context, key);
  if (!pricing) return null;
  return { key, provider: pricing.provider, model: pricing.model, pricing };
}

function resolveAttempts(context: GatewayContext, selection: ModelSelection): Attempt[] {
  if (!selection.selected) return [];
  const keys: string[] = [selection.selected.key];
  for (const key of selection.fallbackChain) {
    if (!keys.includes(key)) keys.push(key);
  }
  return keys
    .map((key) => attemptFor(context, key))
    .filter((attempt): attempt is Attempt => attempt !== null)
    .slice(0, 4);
}

async function releaseReservations(db: AppDb, holdIds: string[] | undefined) {
  if (!holdIds?.length) return;
  try {
    await db.delete(routingHolds).where(inArray(routingHolds.id, holdIds));
  } catch (error) {
    logEvent("error", "gateway.reservation_release_failed", { error });
  }
}

type RunningRollout = typeof routingRollouts.$inferSelect;

async function loadRunningRollout(db: AppDb, policyId: string | null): Promise<RunningRollout | null> {
  if (!policyId) return null;
  const rows = await db
    .select()
    .from(routingRollouts)
    .where(and(eq(routingRollouts.policyId, policyId), eq(routingRollouts.status, "running")))
    .orderBy(desc(routingRollouts.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

function applyRollout(
  selection: ModelSelection,
  rollout: RunningRollout,
  context: GatewayContext,
  canaryRoll?: number,
): ModelSelection {
  const selectionContext = selectionContextFor({ messages: [] }, context);
  const baselineEntry = catalogPricing(context, rollout.baselineModel);
  const candidateEntry = catalogPricing(context, rollout.candidateModel);
  const baselineEligible =
    baselineEntry &&
    !restrictionReason(baselineEntry, selectionContext) &&
    context.credentials.has(baselineEntry.provider);
  const candidateEligible =
    candidateEntry &&
    !restrictionReason(candidateEntry, selectionContext) &&
    context.credentials.has(candidateEntry.provider);

  const roll = canaryRoll ?? Math.random() * 100;
  const canaryHit = rollout.mode !== "shadow" && roll < rollout.trafficPercent;
  const chosen: PricingRecord | null =
    canaryHit && candidateEligible
      ? candidateEntry
      : baselineEligible
        ? baselineEntry
        : null;
  if (!chosen || !selection.selected) return selection;

  const reason = canaryHit
    ? `Canary rollout ${rollout.id.slice(0, 8)} routed this request to the approved candidate.`
    : `Canary rollout ${rollout.id.slice(0, 8)} kept this request on the approved baseline.`;
  const selected = scoredFromEntry(chosen, selection.estimate, reason);
  const baseline = baselineEntry
    ? { key: modelKey(baselineEntry.provider, baselineEntry.model), costUsd: costForEstimate(baselineEntry, selection.estimate) }
    : null;
  const candidates = [selected, ...selection.candidates.filter((candidate) => candidate.key !== selected.key)];
  return {
    ...selection,
    selected,
    candidates,
    decision: {
      ...selection.decision,
      estimatedCostUsd: selected.costUsd,
      candidates: candidates.slice(0, 10).map((candidate) => ({
        key: candidate.key,
        costUsd: candidate.costUsd,
        qualityScore: candidate.qualityScore,
        typicalLatencyMs: candidate.typicalLatencyMs,
        score: candidate.score,
        reason: candidate.reason,
      })),
      baselineModel: baseline?.key ?? selection.decision.baselineModel,
      baselineEstimateUsd: baseline?.costUsd ?? selection.decision.baselineEstimateUsd,
    },
  };
}

function shadowAttemptFor(context: GatewayContext, rollout: RunningRollout): Attempt | null {
  if (rollout.mode !== "shadow") return null;
  const attempt = attemptFor(context, rollout.candidateModel);
  if (!attempt) return null;
  return context.credentials.has(attempt.provider) ? attempt : null;
}

/**
 * Mirrors one request to the rollout candidate without affecting the caller's response, usage
 * events, budgets or analytics. The observation is stored on the rollout for comparison.
 */
async function runShadowMirror(args: {
  db: AppDb;
  ctx: ApiKeyContext;
  request: GatewayChatRequest;
  context: GatewayContext;
  rollout: RunningRollout;
  attempt: Attempt;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const apiKey = args.context.credentials.get(args.attempt.provider);
  if (!apiKey) return;
  const started = performance.now();
  try {
    const maxOutputTokens = Math.max(
      1,
      Math.min(
        args.request.max_tokens ??
          args.request.max_completion_tokens ??
          args.context.policy?.maxOutputTokens ??
          1024,
        args.attempt.pricing.maxOutput,
      ),
    );
    const completion = await completeChat({
      provider: args.attempt.provider as Parameters<typeof completeChat>[0]["provider"],
      model: args.attempt.model,
      apiKey,
      request: args.request,
      maxOutputTokens,
      fetchImpl: args.fetchImpl,
    });
    const usage = completion.usage;
    const costUsd = usage ? computeCost(args.attempt.pricing, usage).costUsd : null;
    await recordShadowSample(args.db, {
      orgId: args.ctx.orgId,
      projectId: args.ctx.projectId,
      rolloutId: args.rollout.id,
      model: args.attempt.key,
      status: "success",
      latencyMs: completion.latencyMs,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      costUsd,
      outputExcerpt: completion.content || (completion.toolCalls.length ? "(tool calls only)" : ""),
    });
  } catch (error) {
    const info = error instanceof GatewayTransportError ? error.info : null;
    await recordShadowSample(args.db, {
      orgId: args.ctx.orgId,
      projectId: args.ctx.projectId,
      rolloutId: args.rollout.id,
      model: args.attempt.key,
      status: "error",
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      errorCode: info?.code ?? "shadow_failed",
    }).catch((recordError) => {
      logEvent("error", "gateway.shadow_record_failed", { error: recordError, rolloutId: args.rollout.id });
    });
  }
}

function gatewayHeaders(args: {
  ctx: ApiKeyContext;
  gatewayId: string;
  selection: ModelSelection;
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  usageSource?: string;
  summary?: GatewayRecordSummary;
  streamed?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    ...(rateHeaders(args.ctx.rateLimit) ?? {}),
    "x-tokenburn-request-id": args.gatewayId,
    "x-tokenburn-mode": args.selection.mode,
    "x-tokenburn-strategy": args.selection.strategy,
    "x-tokenburn-fallback": args.fallbackUsed ? "true" : "false",
  };
  if (args.provider && args.model) headers["x-tokenburn-model"] = `${args.provider}/${args.model}`;
  if (args.selection.policyId) headers["x-tokenburn-policy-id"] = args.selection.policyId;
  if (args.usageSource) headers["x-tokenburn-usage-source"] = args.usageSource;
  if (args.summary?.costUsd !== null && args.summary?.costUsd !== undefined) {
    headers["x-tokenburn-cost-usd"] = args.summary.costUsd.toFixed(6);
  }
  if (args.summary?.realizedSavingsUsd !== null && args.summary?.realizedSavingsUsd !== undefined) {
    headers["x-tokenburn-realized-savings-usd"] = args.summary.realizedSavingsUsd.toFixed(6);
  }
  if (args.streamed) headers["x-tokenburn-streamed"] = "true";
  return headers;
}

function tokenburnMeta(args: {
  gatewayId: string;
  selection: ModelSelection;
  provider: string;
  model: string;
  requestedModel: string | null;
  rolloutId: string | null;
  fallbackUsed: boolean;
  summary?: GatewayRecordSummary;
}): Record<string, unknown> {
  const estimated = estimatedSavings(
    args.selection.decision.baselineEstimateUsd,
    args.selection.selected?.costUsd ?? null,
  );
  return {
    gatewayRequestId: args.gatewayId,
    mode: args.selection.mode,
    strategy: args.selection.strategy,
    policyId: args.selection.policyId,
    rolloutId: args.rolloutId,
    requestedModel: args.requestedModel,
    selectedModel: `${args.provider}/${args.model}`,
    baselineModel: args.selection.decision.baselineModel,
    estimatedInputTokens: args.selection.estimate.inputTokens,
    estimatedOutputTokens: args.selection.estimate.outputTokens,
    estimatedCostUsd: args.selection.selected?.costUsd ?? null,
    estimatedSavingsUsd: estimated,
    usageSource: args.summary?.usageSource ?? null,
    realizedSavingsUsd: args.summary?.realizedSavingsUsd ?? null,
    fallbackUsed: args.fallbackUsed,
  };
}

function completionBody(
  completion: GatewayCompletion,
  meta: Record<string, unknown>,
  summary: GatewayRecordSummary,
): Record<string, unknown> {
  return {
    id: completion.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: completion.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: completion.content || completion.toolCalls.length ? completion.content || null : "",
          ...(completion.toolCalls.length ? { tool_calls: completion.toolCalls } : {}),
        },
        finish_reason: completion.finishReason,
        logprobs: null,
      },
    ],
    ...(completion.usage ? { usage: toOpenAIUsage(completion.usage) } : {}),
    tokenburn: meta,
    ...(summary.usageSource === "estimated"
      ? {
          tokenburnEstimatedUsage: {
            input_tokens: summary.inputTokens,
            output_tokens: summary.outputTokens,
          },
        }
      : {}),
  };
}

/**
 * Routes and executes a gateway request.
 *
 * - Manual mode uses the requested model, never silently substituting another model.
 * - Recommendation mode returns a decision without executing a provider call.
 * - Automatic mode requires an active policy whose mode is automatic (an approved routing plan).
 * - Provider failures fall back only to models that were already permitted by the policy and
 *   organization restrictions, and every fallback is recorded.
 */
export async function executeGatewayRequest(
  db: AppDb,
  ctx: ApiKeyContext,
  rawRequest: GatewayChatRequest,
  options: { stream?: boolean; fetchImpl?: typeof fetch; canaryRoll?: number } = {},
): Promise<GatewayExecution> {
  const request = rawRequest;
  const streamed = options.stream === true;
  const feature = request.tokenburn?.feature ?? null;
  const environment = request.tokenburn?.environment ?? null;
  const context = await loadGatewayContext(db, ctx, { feature, environment });
  const requestedModel = request.model ?? null;
  const startedAt = performance.now();

  let selection = selectModel(request, context.catalog, selectionContextFor(request, context));
  const failSelection = async (code: string, message: string, status: number): Promise<never> => {
    let requestId: string | undefined;
    try {
      requestId = await insertFailedGatewayRequest(db, {
        ctx,
        selection,
        feature: context.feature,
        environment: context.environment,
        requestedModel,
        streamed,
        errorCode: code,
        errorMessage: message,
      });
    } catch (error) {
      logEvent("error", "gateway.selection_record_failed", { error, orgId: ctx.orgId });
    }
    throw new GatewayError(status, code, message, { decision: selection.decision }, requestId);
  };

  if (selection.error) {
    await failSelection(selection.error.code, selection.error.message, selectionErrorStatus(selection.error.code));
  }

  if (selection.mode === "automatic") {
    const policy = context.policy;
    if (!policy) {
      await failSelection(
        "policy_required",
        "Automatic routing requires an active, approved routing policy for this project and feature. Create one in Model Router, or send an explicit model.",
        409,
      );
    }
    if ((policy?.mode ?? "manual") !== "automatic") {
      await failSelection(
        "policy_not_automatic",
        `Routing policy "${policy?.name ?? ""}" is in ${policy?.mode ?? "manual"} mode. Switch it to automatic through the approval workflow before using automatic routing.`,
        409,
      );
    }
  }

  if (selection.mode === "recommendation") {
    const estimated = estimatedSavings(
      selection.decision.baselineEstimateUsd,
      selection.selected?.costUsd ?? null,
    );
    return {
      kind: "recommendation",
      selection,
      headers: {
        ...(rateHeaders(ctx.rateLimit) ?? {}),
        "x-tokenburn-mode": "recommendation",
        "x-tokenburn-strategy": selection.strategy,
      },
      body: {
        id: `rec_${crypto.randomUUID()}`,
        object: "tokenburn.recommendation",
        mode: "recommendation",
        task: selection.task,
        decision: selection.decision,
        selected: selection.selected,
        candidates: selection.candidates.slice(0, 5),
        excluded: selection.excluded,
        estimate: {
          inputTokens: selection.estimate.inputTokens,
          outputTokens: selection.estimate.outputTokens,
          costUsd: selection.selected?.costUsd ?? null,
          baselineCostUsd: selection.decision.baselineEstimateUsd,
          estimatedSavingsUsd: estimated,
          note: selection.estimate.note,
        },
        policy: context.policy
          ? {
              id: context.policy.id,
              name: context.policy.name,
              mode: context.policy.mode,
              strategy: context.policy.strategy,
              candidates: context.policy.candidates,
            }
          : null,
        note: "Recommendation only. No provider call was made and no usage event was created.",
      },
    };
  }

  if (!selection.selected) {
    await failSelection("no_eligible_model", "No model could be selected for this request.", 422);
  }

  const rollout = selection.mode === "automatic" ? await loadRunningRollout(db, selection.policyId) : null;
  if (rollout) {
    selection = applyRollout(selection, rollout, context, options.canaryRoll);
  }
  const rolloutId = rollout?.id ?? null;
  const shadowAttempt = rollout ? shadowAttemptFor(context, rollout) : null;
  const startShadow = () =>
    shadowAttempt && rollout
      ? runShadowMirror({
          db,
          ctx,
          request,
          context,
          rollout,
          attempt: shadowAttempt,
          fetchImpl: options.fetchImpl,
        })
      : undefined;

  if (!selection.selected) {
    await failSelection("no_eligible_model", "The rollout produced no eligible model.", 422);
  }

  const attempts = resolveAttempts(context, selection);
  if (!attempts.length) {
    await failSelection("no_eligible_model", "No catalog pricing is available for the selected model.", 422);
  }
  const initialSelected = selection.selected!;
  const baselinePricing = catalogPricing(context, selection.decision.baselineModel);

  let gatewayId = `gw_${crypto.randomUUID()}`;
  try {
    gatewayId = await insertPendingGatewayRequest(db, {
      ctx,
      selection,
      feature: context.feature,
      environment: context.environment,
      requestedModel,
      streamed,
      provider: attempts[0].provider,
      model: attempts[0].model,
      rolloutId,
    });
  } catch (error) {
    logEvent("error", "gateway.pending_record_failed", { error, orgId: ctx.orgId });
  }

  const attemptedModels: string[] = [];
  let fallbackReason: string | null = null;
  let lastFailure: { code: string; message: string; status: number; kind: "provider" | "governance" } | null = null;

  const failExecution = async (): Promise<never> => {
    const failure = lastFailure ?? {
      code: "gateway_failed",
      message: "No provider attempt succeeded.",
      status: 502,
      kind: "provider" as const,
    };
    try {
      await finalizeGatewayRecord(db, {
        gatewayId,
        ctx,
        selection,
        feature: context.feature,
        environment: context.environment,
        streamed,
        provider: attempts[0].provider,
        model: attempts[0].model,
        pricing: attempts[0].pricing,
        completion: null,
        status: "error",
        errorCode: failure.code,
        errorMessage: failure.message,
        attemptedModels,
        fallbackUsed: attemptedModels.length > 1 || attemptedModels[0] !== initialSelected.key,
        fallbackReason,
        rolloutId,
        baselinePricing,
        startedAt,
      });
    } catch (error) {
      logEvent("error", "gateway.failed_record_failed", { error, requestId: gatewayId });
    }
    throw new GatewayError(failure.status, failure.code, failure.message, {
      gatewayRequestId: gatewayId,
      attemptedModels,
      decision: selection.decision,
    }, gatewayId);
  };

  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index]!;
    // Circuit state is per organization and provider: one tenant's outage never blocks another.
    const circuitKey = `${ctx.orgId}:${attempt.provider}`;
    if (circuitGate(circuitKey) === "open") {
      lastFailure = {
        code: "provider_circuit_open",
        message: `Provider "${attempt.provider}" is cooling down after repeated failures.`,
        status: 503,
        kind: "provider",
      };
      fallbackReason = lastFailure.message;
      logEvent("warn", "gateway.circuit_open", {
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        provider: attempt.provider,
        model: attempt.key,
        attempt: index + 1,
      });
      continue;
    }
    const estimateCost = costForEstimate(attempt.pricing, selection.estimate);
    const governance = await checkRoutingAllowance(
      db,
      ctx.orgId,
      ctx.projectId,
      attempt.model,
      attempt.provider,
      { feature: context.feature, estimatedCostUsd: estimateCost, reserve: true },
    );
    if (!governance.allowed) {
      const reason = governance.reason ?? "Denied by organization governance.";
      lastFailure = {
        code: reason.toLowerCase().includes("hard limit") ? "budget_exhausted" : "governance_denied",
        message: reason,
        status: reason.toLowerCase().includes("hard limit") ? 402 : 403,
        kind: "governance",
      };
      continue;
    }
    const apiKey = context.credentials.get(attempt.provider);
    if (!apiKey) {
      await releaseReservations(db, governance.reservation?.holdIds);
      lastFailure = {
        code: "provider_not_configured",
        message: `Provider "${attempt.provider}" has no stored credential.`,
        status: 400,
        kind: "governance",
      };
      continue;
    }

    attemptedModels.push(attempt.key);
    const maxOutputTokens = Math.max(
      1,
      Math.min(
        request.max_tokens ?? request.max_completion_tokens ?? context.policy?.maxOutputTokens ?? 1024,
        attempt.pricing.maxOutput,
      ),
    );
    const transportInput = {
      provider: attempt.provider as Parameters<typeof completeChat>[0]["provider"],
      model: attempt.model,
      apiKey,
      request,
      maxOutputTokens,
      fetchImpl: options.fetchImpl,
    };
    const fallbackUsed = attempt.key !== initialSelected.key || attemptedModels.length > 1;

    if (!streamed) {
      try {
        const completion = await completeChat(transportInput);
        if (completion.error && isAvailabilityFailure(completion.error.code)) circuitFailure(circuitKey);
        else circuitSuccess(circuitKey);
        const summary = await finalizeGatewayRecord(db, {
          gatewayId,
          ctx,
          selection,
          feature: context.feature,
          environment: context.environment,
          streamed: false,
          provider: attempt.provider,
          model: attempt.model,
          pricing: attempt.pricing,
          completion,
          status: completion.error ? "error" : "success",
          errorCode: completion.error?.code ?? null,
          errorMessage: completion.error?.message ?? null,
          attemptedModels,
          fallbackUsed,
          fallbackReason,
          rolloutId,
          baselinePricing,
          startedAt,
        });
        await releaseReservations(db, governance.reservation?.holdIds);
        const meta = tokenburnMeta({
          gatewayId,
          selection,
          provider: attempt.provider,
          model: attempt.model,
          requestedModel,
          rolloutId,
          fallbackUsed,
          summary,
        });
        return {
          kind: "response",
          body: completionBody(completion, meta, summary),
          headers: {
            "content-type": "application/json",
            ...gatewayHeaders({
              ctx,
              gatewayId,
              selection,
              provider: attempt.provider,
              model: attempt.model,
              fallbackUsed,
              usageSource: summary.usageSource,
              summary,
            }),
          },
          gatewayRequestId: gatewayId,
          selection,
          completion,
          summary,
          background: startShadow(),
        };
      } catch (error) {
        await releaseReservations(db, governance.reservation?.holdIds);
        if (error instanceof GatewayTransportError) {
          if (isAvailabilityFailure(error.info.code)) circuitFailure(circuitKey);
          lastFailure = {
            code: error.info.code,
            message: error.info.message,
            status: providerErrorStatus(error.info),
            kind: "provider",
          };
          fallbackReason = error.info.message;
          logEvent("warn", "gateway.provider_failed", {
            orgId: ctx.orgId,
            provider: attempt.provider,
            model: attempt.key,
            code: error.info.code,
            attempt: index + 1,
            fallback: shouldFallback(error.info) && index < attempts.length - 1,
          });
          if (!shouldFallback(error.info) || index === attempts.length - 1) break;
          continue;
        }
        throw error;
      }
    }

    try {
      const { stream, done } = await streamChat(transportInput);
      circuitSuccess(circuitKey);
      const headers = {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...gatewayHeaders({
          ctx,
          gatewayId,
          selection,
          provider: attempt.provider,
          model: attempt.model,
          fallbackUsed,
          streamed: true,
        }),
      };
      const finalize = async () => {
        try {
          const completion = await done;
          if (completion.error && isAvailabilityFailure(completion.error.code)) circuitFailure(circuitKey);
          else if (!completion.error) circuitSuccess(circuitKey);
          const status = completion.error
            ? completion.error.code === "client_cancelled"
              ? "cancelled"
              : "error"
            : "success";
          await finalizeGatewayRecord(db, {
            gatewayId,
            ctx,
            selection,
            feature: context.feature,
            environment: context.environment,
            streamed: true,
            provider: attempt.provider,
            model: attempt.model,
            pricing: attempt.pricing,
            completion,
            status,
            errorCode: completion.error?.code ?? null,
            errorMessage: completion.error?.message ?? null,
            attemptedModels,
            fallbackUsed,
            fallbackReason,
            rolloutId,
            baselinePricing,
            startedAt,
          });
        } catch (error) {
          logEvent("error", "gateway.stream_finalize_failed", { error, requestId: gatewayId });
        } finally {
          await releaseReservations(db, governance.reservation?.holdIds);
        }
      };
      return {
        kind: "stream",
        stream,
        headers,
        gatewayRequestId: gatewayId,
        selection,
        finalize,
        background: startShadow(),
      };
    } catch (error) {
      await releaseReservations(db, governance.reservation?.holdIds);
      if (error instanceof GatewayTransportError) {
        if (isAvailabilityFailure(error.info.code)) circuitFailure(circuitKey);
        lastFailure = {
          code: error.info.code,
          message: error.info.message,
          status: providerErrorStatus(error.info),
          kind: "provider",
        };
        fallbackReason = error.info.message;
        logEvent("warn", "gateway.provider_failed", {
          orgId: ctx.orgId,
          provider: attempt.provider,
          model: attempt.key,
          code: error.info.code,
          attempt: index + 1,
          streamed: true,
          fallback: shouldFallback(error.info) && index < attempts.length - 1,
        });
        if (!shouldFallback(error.info) || index === attempts.length - 1) break;
        continue;
      }
      throw error;
    }
  }

  return failExecution();
}
