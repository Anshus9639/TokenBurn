import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { authenticateApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { organizations, routingPolicies } from "@/lib/db/schema";
import { checkRoutingAllowance } from "@/lib/governance";
import { resolvePricing, getActiveCatalog } from "@/lib/pricing-db";
import { computeCost, blendedPerM } from "@/lib/pricing";
import { getAdapter } from "@/lib/providers";
import { handleApiError, jsonError, rateHeaders } from "@/lib/api-response";
import { normalizeGatewayMode, normalizeStrategy } from "@/lib/gateway/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  model: z.string().trim().min(1).max(120).optional(),
  feature: z.string().trim().max(80).optional(),
  environment: z.string().trim().max(40).optional(),
  mode: z.string().trim().max(40).optional(),
  strategy: z.string().trim().max(40).optional(),
  inputTokens: z.coerce.number().int().min(0).max(50_000_000),
  outputTokens: z.coerce.number().int().min(0).max(50_000_000).default(0),
  cachedInputTokens: z.coerce.number().int().min(0).max(50_000_000).default(0),
  cacheWriteTokens: z.coerce.number().int().min(0).max(50_000_000).default(0),
  reasoningTokens: z.coerce.number().int().min(0).max(50_000_000).default(0),
});

export async function POST(request: Request) {
  try {
    const ctx = await authenticateApiKey(request);
    const db = await getDb();
    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return jsonError(422, "validation_error", "Invalid routing request", parsed.error.flatten());
    }
    const input = parsed.data;

    const policies = await db
      .select()
      .from(routingPolicies)
      .where(
        and(
          eq(routingPolicies.orgId, ctx.orgId),
          eq(routingPolicies.projectId, ctx.projectId),
          eq(routingPolicies.status, "active"),
          input.feature
            ? or(eq(routingPolicies.feature, input.feature), isNull(routingPolicies.feature))
            : isNull(routingPolicies.feature),
          input.environment
            ? or(eq(routingPolicies.environment, input.environment), eq(routingPolicies.environment, "production"))
            : undefined,
        ),
      )
      .orderBy(desc(routingPolicies.updatedAt))
      .limit(1);
    const policy = policies[0] ?? null;

    const rawModel = input.model ?? policy?.primaryModel;
    if (!rawModel) {
      return jsonError(422, "model_required", "Provide a model or configure an active routing policy for this feature");
    }

    const routedMode =
      normalizeGatewayMode(request.headers.get("x-tokenburn-mode")) ??
      normalizeGatewayMode(input.mode) ??
      normalizeGatewayMode(rawModel) ??
      normalizeGatewayMode(policy?.mode) ??
      "manual";
    const routedStrategy =
      normalizeStrategy(request.headers.get("x-tokenburn-strategy")) ??
      normalizeStrategy(input.strategy) ??
      normalizeStrategy(policy?.strategy) ??
      "balanced";
    const automaticEnabled = Boolean(policy && policy.status === "active" && policy.mode === "automatic");

    const catalog = await getActiveCatalog(db);

    let provider: string;
    let modelName: string;
    if (rawModel.includes("/")) {
      const [head, ...tail] = rawModel.split("/");
      provider = head!;
      modelName = tail.join("/");
    } else {
      const match = catalog.find((c) => c.model === rawModel);
      if (!match) {
        return jsonError(422, "model_unknown", `Unknown model "${rawModel}". Pass "provider/model" or a catalog model name.`);
      }
      provider = match.provider;
      modelName = rawModel;
    }
    const adapter = getAdapter(provider);
    const model = adapter ? adapter.normalizeModel(modelName) : modelName;

    const pricing = await resolvePricing(db, provider, model, new Date());
    if (!pricing) {
      return jsonError(422, "pricing_missing", `No active pricing for ${provider}/${model}`);
    }

    const cachedInputTokens = Math.min(input.cachedInputTokens, input.inputTokens);
    const { costUsd, breakdown } = computeCost(pricing, {
      inputTokens: input.inputTokens,
      cachedInputTokens,
      cacheWriteTokens: input.cacheWriteTokens,
      outputTokens: input.outputTokens,
      reasoningTokens: input.reasoningTokens,
    });

    const decision = await checkRoutingAllowance(db, ctx.orgId, ctx.projectId, model, provider, {
      feature: input.feature ?? null,
      estimatedCostUsd: costUsd,
    });

    const orgRow = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);
    const settings = orgRow[0]?.settings;
    const currentBlended = blendedPerM(pricing);
    const allowedList = settings?.allowedModels ?? [];
    const modelPermitted = (p: { provider: string; model: string }) =>
      !settings?.blockedModels?.includes(p.model) &&
      !settings?.blockedModels?.includes(`${p.provider}/${p.model}`) &&
      (!allowedList.length ||
        allowedList.includes(p.model) ||
        allowedList.includes(`${p.provider}/${p.model}`));
    const alternatives = catalog
      .filter((p) => p.model !== model || p.provider !== provider)
      .filter((p) => p.category !== "embedding")
      .filter((p) => p.qualityScore >= Math.max(pricing.qualityScore - 12, 45))
      .filter(modelPermitted)
      .filter((p) => {
        const cost = computeCost(p, {
          inputTokens: input.inputTokens,
          cachedInputTokens,
          cacheWriteTokens: input.cacheWriteTokens,
          outputTokens: input.outputTokens,
          reasoningTokens: input.reasoningTokens,
        }).costUsd;
        return cost < costUsd;
      })
      .map((p) => {
        const alt = computeCost(p, {
          inputTokens: input.inputTokens,
          cachedInputTokens,
          cacheWriteTokens: input.cacheWriteTokens,
          outputTokens: input.outputTokens,
          reasoningTokens: input.reasoningTokens,
        });
        return {
          key: `${p.provider}/${p.model}`,
          provider: p.provider,
          model: p.model,
          costUsd: alt.costUsd,
          savingsUsd: costUsd - alt.costUsd,
          savingsPct: costUsd > 0 ? (costUsd - alt.costUsd) / costUsd : 0,
          qualityScore: p.qualityScore,
          qualityDelta: p.qualityScore - pricing.qualityScore,
          typicalLatencyMs: p.typicalLatencyMs,
          blendedPerM: blendedPerM(p),
        };
      })
      .sort((a, b) => a.costUsd - b.costUsd)
      .slice(0, 3);

    // When the primary route is denied, report whether the policy's fallback
    // model would be permitted. This is an availability check, not a reservation.
    let fallback: {
      key: string;
      allowed: boolean;
      reason: string | null;
      estimateUsd: number | null;
    } | null = null;
    if (!decision.allowed && policy?.fallbackModel) {
      const [head, ...tail] = policy.fallbackModel.split("/");
      const fallbackProvider = tail.length ? head! : catalog.find((c) => c.model === policy.fallbackModel)?.provider;
      const fallbackModelName = tail.length ? tail.join("/") : policy.fallbackModel;
      if (fallbackProvider) {
        const fallbackPricing = await resolvePricing(db, fallbackProvider, fallbackModelName, new Date());
        if (fallbackPricing) {
          const fallbackCost = computeCost(fallbackPricing, {
            inputTokens: input.inputTokens,
            cachedInputTokens,
            cacheWriteTokens: input.cacheWriteTokens,
            outputTokens: input.outputTokens,
            reasoningTokens: input.reasoningTokens,
          }).costUsd;
          const fallbackDecision = await checkRoutingAllowance(
            db,
            ctx.orgId,
            ctx.projectId,
            fallbackPricing.model,
            fallbackProvider,
            { feature: input.feature ?? null, estimatedCostUsd: fallbackCost, reserve: false },
          );
          fallback = {
            key: `${fallbackProvider}/${fallbackPricing.model}`,
            allowed: fallbackDecision.allowed,
            reason: fallbackDecision.reason ?? null,
            estimateUsd: fallbackCost,
          };
        } else {
          fallback = {
            key: policy.fallbackModel,
            allowed: false,
            reason: "The fallback model has no active pricing.",
            estimateUsd: null,
          };
        }
      }
    }

    return NextResponse.json(
      {
        allowed: decision.allowed,
        reason: decision.reason ?? null,
        project: { id: ctx.projectId, name: ctx.projectName, slug: ctx.projectSlug },
        requested: { provider, model, feature: input.feature ?? null, environment: input.environment ?? ctx.environment },
        policy: policy
          ? {
              id: policy.id,
              name: policy.name,
              strategy: policy.strategy,
              primaryModel: policy.primaryModel,
              fallbackModel: policy.fallbackModel,
              cacheEnabled: policy.cacheEnabled,
              maxOutputTokens: policy.maxOutputTokens,
            }
          : null,
        governance: {
          allowed: decision.allowed,
          reason: decision.reason ?? null,
          budget: decision.budget ?? null,
          reservation: decision.reservation ?? null,
        },
        routing: {
          mode: routedMode,
          strategy: routedStrategy,
          automaticEnabled,
          note:
            routedMode === "automatic" && !automaticEnabled
              ? "Automatic routing requires an active policy whose mode is automatic. POST /api/v1/chat/completions will refuse automatic requests until then."
              : routedMode === "recommendation"
                ? "Recommendation requests return a decision without calling a provider. POST /api/v1/chat/completions returns the full candidate set."
                : "This preflight endpoint never calls a provider. Use POST /api/v1/chat/completions to execute routing.",
        },
        estimate: {
          costUsd,
          breakdown,
          pricingVersion: pricing.version,
          effectiveFrom: pricing.effectiveFrom.toISOString(),
          blendedPerM: currentBlended,
        },
        fallback,
        alternatives,
      },
      { headers: rateHeaders(ctx.rateLimit) },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
