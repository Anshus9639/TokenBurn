import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/lib/db/client";
import { usageEvents, type CostBreakdown } from "@/lib/db/schema";
import { resolvePricing } from "@/lib/pricing-db";
import { computeCost } from "@/lib/pricing";
import { sha256 } from "@/lib/crypto";
import { getAdapter } from "@/lib/providers";
import type { ApiKeyContext } from "@/lib/auth";
import { evaluateGovernance } from "@/lib/governance";

export const eventInputSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini", "groq", "mistral"]),
  usageSource: z.enum(["provider_reported", "estimated", "reconciled", "synthetic"]).default("provider_reported"),
  model: z.string().trim().min(1).max(120),
  environment: z.string().trim().max(40).optional(),
  feature: z.string().trim().max(80).optional(),
  inputTokens: z.coerce.number().int().min(0).max(50_000_000),
  outputTokens: z.coerce.number().int().min(0).max(50_000_000).default(0),
  cachedInputTokens: z.coerce.number().int().min(0).max(50_000_000).default(0),
  cacheWriteTokens: z.coerce.number().int().min(0).max(50_000_000).default(0),
  reasoningTokens: z.coerce.number().int().min(0).max(50_000_000).default(0),
  latencyMs: z.coerce.number().int().min(0).max(3_600_000).default(0),
  statusCode: z.coerce.number().int().min(100).max(599).default(200),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  requestId: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().trim().max(200).optional(),
  promptHash: z.string().trim().max(200).optional(),
  promptText: z.string().max(200_000).optional(),
  endpoint: z.string().trim().max(300).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EventInput = z.infer<typeof eventInputSchema>;

export type IngestResult = {
  id: string;
  duplicate: boolean;
  costUsd: number;
  pricingVersion: number;
  model: string;
  provider: string;
  occurredAt: string;
  breakdown: CostBreakdown | null;
};

export class IngestionError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(message: string, code: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 60) || fallback;
}

export function buildDedupeHash(ctx: ApiKeyContext, input: EventInput, occurredAt: Date): string {
  if (input.idempotencyKey) return `idem:${sha256(`${ctx.orgId}|${ctx.apiKeyId}|${input.idempotencyKey}`)}`;
  if (input.requestId) return `req:${sha256(`${ctx.orgId}|${ctx.apiKeyId}|${input.requestId}`)}`;
  return `fp:${sha256(
    JSON.stringify([
      ctx.orgId,
      ctx.apiKeyId,
      input.provider,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.cachedInputTokens,
      input.cacheWriteTokens,
      input.reasoningTokens,
      occurredAt.toISOString(),
      input.feature ?? "",
    ]),
  )}`;
}

export async function ingestEvent(
  db: AppDb,
  ctx: ApiKeyContext,
  raw: unknown,
): Promise<IngestResult> {
  const parsed = eventInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IngestionError("Event payload failed validation", "validation_error", 422, parsed.error.flatten());
  }
  const input = parsed.data;
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    throw new IngestionError("occurredAt is not a valid timestamp", "invalid_timestamp", 422);
  }
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
    throw new IngestionError("occurredAt cannot be more than 5 minutes in the future", "future_timestamp", 422);
  }

  const adapter = getAdapter(input.provider);
  const model = adapter ? adapter.normalizeModel(input.model) : input.model;
  const pricing = await resolvePricing(db, input.provider, model, occurredAt);
  if (!pricing) {
    throw new IngestionError(
      `No pricing entry for ${input.provider}/${model} effective at ${occurredAt.toISOString()}`,
      "pricing_missing",
      422,
      { provider: input.provider, model, hint: "Publish a pricing version in Settings → Pricing catalog." },
    );
  }

  const cachedInputTokens = Math.min(input.cachedInputTokens, input.inputTokens);
  const { costUsd, breakdown } = computeCost(pricing, {
    inputTokens: input.inputTokens,
    cachedInputTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    outputTokens: input.outputTokens,
    reasoningTokens: input.reasoningTokens,
  });

  const dedupeHash = buildDedupeHash(ctx, input, occurredAt);
  const promptHash =
    input.promptHash ?? (input.promptText ? `sha256:${sha256(input.promptText)}` : null);

  const inserted = await db
    .insert(usageEvents)
    .values({
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      environment: input.environment ?? ctx.environment ?? "production",
      feature: sanitizeSegment(input.feature ?? "unnamed", "unnamed"),
      provider: input.provider,
      model,
      pricingId: pricing.id,
      apiKeyId: ctx.apiKeyId,
      requestId: input.requestId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      dedupeHash,
      promptHash,
      endpoint: input.endpoint ?? null,
      inputTokens: input.inputTokens,
      cachedInputTokens,
      cacheWriteTokens: input.cacheWriteTokens,
      outputTokens: input.outputTokens,
      reasoningTokens: input.reasoningTokens,
      latencyMs: input.latencyMs,
      statusCode: input.statusCode,
      costUsd: costUsd.toFixed(6),
      costBreakdown: { ...breakdown, pricingVersion: pricing.version },
      occurredAt,
      usageSource: input.usageSource,
      isSynthetic: input.usageSource === "synthetic",
      tags: input.tags ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.promptText ? { promptChars: input.promptText.length } : {}),
      },
    })
    .onConflictDoNothing({ target: [usageEvents.orgId, usageEvents.dedupeHash] })
    .returning({ id: usageEvents.id });

  if (inserted.length === 0) {
    const existing = await db
      .select({ id: usageEvents.id, costUsd: usageEvents.costUsd, occurredAt: usageEvents.occurredAt })
      .from(usageEvents)
      .where(and(eq(usageEvents.orgId, ctx.orgId), eq(usageEvents.dedupeHash, dedupeHash)))
      .limit(1);
    const row = existing[0];
    return {
      id: row?.id ?? "",
      duplicate: true,
      costUsd: row ? Number(row.costUsd) : costUsd,
      pricingVersion: pricing.version,
      model,
      provider: input.provider,
      occurredAt: (row?.occurredAt ?? occurredAt).toISOString(),
      breakdown: null,
    };
  }

  await evaluateGovernance(db, ctx.orgId);

  return {
    id: inserted[0]!.id,
    duplicate: false,
    costUsd,
    pricingVersion: pricing.version,
    model,
    provider: input.provider,
    occurredAt: occurredAt.toISOString(),
    breakdown: { ...breakdown, pricingVersion: pricing.version },
  };
}
