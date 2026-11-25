import { eq } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import { gatewayRequests } from "@/lib/db/schema";
import type { ApiKeyContext } from "@/lib/auth";
import type { PricingRecord } from "@/lib/pricing-db";
import { computeCost } from "@/lib/pricing";
import { ingestEvent } from "@/lib/ingest";
import { logEvent } from "@/lib/log";
import { computeRealizedSavings, type SavingsUsage } from "./savings";
import { maybeAutoRollback } from "./rollout";
import type { GatewayCompletion } from "./transport";
import type { ModelSelection } from "./types";

export type GatewayRecordSummary = {
  usageSource: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  baselineCostUsd: number | null;
  realizedSavingsUsd: number | null;
};

export async function insertPendingGatewayRequest(
  db: AppDb,
  args: {
    ctx: ApiKeyContext;
    selection: ModelSelection;
    feature: string | null;
    environment: string;
    requestedModel: string | null;
    streamed: boolean;
    provider: string;
    model: string;
    rolloutId?: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(gatewayRequests)
    .values({
      orgId: args.ctx.orgId,
      projectId: args.ctx.projectId,
      apiKeyId: args.ctx.apiKeyId,
      environment: args.environment,
      feature: args.feature ?? "unnamed",
      mode: args.selection.mode,
      strategy: args.selection.strategy,
      policyId: args.selection.policyId,
      rolloutId: args.rolloutId ?? null,
      requestedModel: args.requestedModel?.slice(0, 120) ?? null,
      baselineModel: args.selection.decision.baselineModel,
      selectedModel: args.model,
      provider: args.provider,
      status: "pending",
      streamed: args.streamed,
      decision: args.selection.decision,
    })
    .returning({ id: gatewayRequests.id });
  return row!.id;
}

export async function insertFailedGatewayRequest(
  db: AppDb,
  args: {
    ctx: ApiKeyContext;
    selection: ModelSelection;
    feature: string | null;
    environment: string;
    requestedModel: string | null;
    streamed: boolean;
    errorCode: string;
    errorMessage: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(gatewayRequests)
    .values({
      orgId: args.ctx.orgId,
      projectId: args.ctx.projectId,
      apiKeyId: args.ctx.apiKeyId,
      environment: args.environment,
      feature: args.feature ?? "unnamed",
      mode: args.selection.mode,
      strategy: args.selection.strategy,
      policyId: args.selection.policyId,
      requestedModel: args.requestedModel?.slice(0, 120) ?? null,
      baselineModel: args.selection.decision.baselineModel,
      status: "error",
      errorCode: args.errorCode,
      errorMessage: args.errorMessage.slice(0, 500),
      streamed: args.streamed,
      statusCode: 400,
      decision: args.selection.decision,
    })
    .returning({ id: gatewayRequests.id });
  logEvent("warn", "gateway.request_rejected", {
    requestId: row!.id,
    orgId: args.ctx.orgId,
    projectId: args.ctx.projectId,
    errorCode: args.errorCode,
    requestedModel: args.requestedModel,
    mode: args.selection.mode,
  });
  return row!.id;
}

/**
 * Finalizes a gateway request: persists token/cost/savings telemetry, writes the corresponding
 * usage event so existing dashboards and budgets see the traffic, and returns what the response
 * metadata should expose. Realized savings are only produced for provider-reported usage.
 */
export async function finalizeGatewayRecord(
  db: AppDb,
  args: {
    gatewayId: string;
    ctx: ApiKeyContext;
    selection: ModelSelection;
    feature: string | null;
    environment: string;
    streamed: boolean;
    provider: string;
    model: string;
    pricing: PricingRecord;
    completion: GatewayCompletion | null;
    status: "success" | "error" | "cancelled";
    errorCode?: string | null;
    errorMessage?: string | null;
    attemptedModels: string[];
    fallbackUsed: boolean;
    fallbackReason: string | null;
    rolloutId?: string | null;
    baselinePricing: PricingRecord | null;
    startedAt: number;
  },
): Promise<GatewayRecordSummary> {
  const providerUsage = args.completion?.usage ?? null;
  const usageSource: "provider_reported" | "estimated" =
    providerUsage ? "provider_reported" : "estimated";
  const usage: SavingsUsage = providerUsage
    ? {
        inputTokens: providerUsage.inputTokens,
        cachedInputTokens: providerUsage.cachedInputTokens,
        cacheWriteTokens: providerUsage.cacheWriteTokens,
        outputTokens: providerUsage.outputTokens,
        reasoningTokens: providerUsage.reasoningTokens,
      }
    : args.status === "success"
      ? {
          inputTokens: args.selection.estimate.inputTokens,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: args.selection.estimate.outputTokens,
          reasoningTokens: 0,
        }
      : { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0 };

  const costUsd =
    args.completion || args.status === "success"
      ? computeCost(args.pricing, usage).costUsd
      : null;
  const realized =
    costUsd === null
      ? { realized: false, baselineCostUsd: null, realizedSavingsUsd: null, reason: "No usage to price" }
      : computeRealizedSavings({
          usage,
          actualCostUsd: costUsd,
          usageSource,
          baselinePricing: args.baselinePricing,
        });

  const latencyMs =
    args.completion?.latencyMs ?? Math.max(0, Math.round(performance.now() - args.startedAt));
  const statusCode =
    args.completion?.status ?? (args.status === "cancelled" ? 499 : args.status === "error" ? 502 : 200);

  await db
    .update(gatewayRequests)
    .set({
      selectedModel: args.model,
      provider: args.provider,
      status: args.status,
      errorCode: args.errorCode ?? null,
      errorMessage: args.errorMessage?.slice(0, 500) ?? null,
      fallbackUsed: args.fallbackUsed,
      fallbackReason: args.fallbackReason?.slice(0, 300) ?? null,
      attemptedModels: args.attemptedModels,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      usageSource,
      latencyMs,
      statusCode,
      costUsd: costUsd === null ? null : costUsd.toFixed(6),
      baselineCostUsd: realized.baselineCostUsd === null ? null : realized.baselineCostUsd.toFixed(6),
      realizedSavingsUsd:
        realized.realizedSavingsUsd === null ? null : realized.realizedSavingsUsd.toFixed(6),
      pricingVersion: args.pricing.version,
      providerRequestId: args.completion?.providerRequestId ?? null,
      requestId: args.gatewayId,
      rolloutId: args.rolloutId ?? null,
    })
    .where(eq(gatewayRequests.id, args.gatewayId));

  const shouldRecordUsage =
    args.completion !== null &&
    (providerUsage !== null || args.status === "success") &&
    (usage.inputTokens > 0 || usage.outputTokens > 0);
  if (shouldRecordUsage) {
    try {
      await ingestEvent(db, args.ctx, {
        provider: args.provider,
        usageSource,
        model: args.model,
        environment: args.environment,
        feature: args.feature ?? "unnamed",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens: usage.reasoningTokens,
        latencyMs,
        statusCode,
        idempotencyKey: `gateway:${args.gatewayId}`,
        requestId: args.gatewayId,
        endpoint: "/v1/chat/completions",
        tags: {
          gateway: "true",
          mode: args.selection.mode,
          strategy: args.selection.strategy,
        },
        metadata: {
          gatewayRequestId: args.gatewayId,
          selectedModel: `${args.provider}/${args.model}`,
          fallbackUsed: args.fallbackUsed,
          rolloutId: args.rolloutId ?? null,
          baselineModel: args.selection.decision.baselineModel,
          realizedSavingsUsd: realized.realizedSavingsUsd,
        },
      });
    } catch (error) {
      logEvent("error", "gateway.usage_record_failed", { error, requestId: args.gatewayId });
    }
  }

  // Canary guardrails are evaluated after every finalized request that belongs to a rollout.
  if (args.rolloutId) {
    await maybeAutoRollback(db, args.rolloutId);
  }

  logEvent(args.status === "error" ? "warn" : "info", "gateway.request_finalized", {
    requestId: args.gatewayId,
    orgId: args.ctx.orgId,
    projectId: args.ctx.projectId,
    provider: args.provider,
    model: args.model,
    status: args.status,
    errorCode: args.errorCode ?? null,
    streamed: args.streamed,
    fallbackUsed: args.fallbackUsed,
    rolloutId: args.rolloutId ?? null,
    usageSource,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
    latencyMs,
    pricingVersion: args.pricing.version,
  });

  return {
    usageSource,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
    baselineCostUsd: realized.baselineCostUsd,
    realizedSavingsUsd: realized.realizedSavingsUsd,
  };
}
