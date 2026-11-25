import { and, eq, desc } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import { gatewayRequests, rolloutShadowSamples, routingRollouts, type RolloutThresholds } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { logEvent } from "@/lib/log";

export const DEFAULT_THRESHOLDS: RolloutThresholds = {
  minSamples: 20,
  maxErrorRatePct: 5,
  maxP95LatencyMs: 4_000,
  minAverageQuality: 70,
};

export type RolloutSideMetrics = {
  samples: number;
  errors: number;
  errorRatePct: number;
  p95LatencyMs: number;
  averageLatencyMs: number;
  averageQuality: number | null;
  totalCostUsd: number;
  realizedSavingsUsd: number;
};

export type ShadowMetrics = {
  samples: number;
  errors: number;
  errorRatePct: number;
  averageLatencyMs: number;
  averageQuality: number | null;
  totalCostUsd: number;
};

export type RolloutMetrics = {
  canary: RolloutSideMetrics;
  baseline: RolloutSideMetrics;
  shadow: ShadowMetrics;
};

export type GuardrailEvaluation = {
  ok: boolean;
  insufficientSamples: boolean;
  reasons: string[];
  notes: string[];
  metrics: RolloutMetrics;
};

type RolloutRow = typeof routingRollouts.$inferSelect;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index]!;
}

function sideMetrics(
  rows: Array<{ status: string; latencyMs: number; qualityScore: number | null; costUsd: string | null; realizedSavingsUsd: string | null }>,
): RolloutSideMetrics {
  const samples = rows.length;
  const errors = rows.filter((row) => row.status !== "success").length;
  const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
  const qualities = rows.map((row) => row.qualityScore).filter((value): value is number => value !== null);
  return {
    samples,
    errors,
    errorRatePct: samples ? Math.round((errors / samples) * 1_000) / 10 : 0,
    p95LatencyMs: percentile(latencies, 0.95),
    averageLatencyMs: samples ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / samples) : 0,
    averageQuality: qualities.length
      ? Math.round(qualities.reduce((sum, value) => sum + value, 0) / qualities.length)
      : null,
    totalCostUsd: rows.reduce((sum, row) => sum + Number(row.costUsd ?? 0), 0),
    realizedSavingsUsd: rows.reduce((sum, row) => sum + Number(row.realizedSavingsUsd ?? 0), 0),
  };
}

export async function rolloutMetrics(db: AppDb, rollout: RolloutRow): Promise<RolloutMetrics> {
  const rows = await db
    .select({
      selectedModel: gatewayRequests.selectedModel,
      provider: gatewayRequests.provider,
      status: gatewayRequests.status,
      latencyMs: gatewayRequests.latencyMs,
      qualityScore: gatewayRequests.qualityScore,
      costUsd: gatewayRequests.costUsd,
      realizedSavingsUsd: gatewayRequests.realizedSavingsUsd,
    })
    .from(gatewayRequests)
    .where(and(eq(gatewayRequests.rolloutId, rollout.id), eq(gatewayRequests.orgId, rollout.orgId)))
    .orderBy(desc(gatewayRequests.createdAt))
    .limit(5_000);

  const matches = (row: { selectedModel: string | null; provider: string | null }, key: string) => {
    if (!row.selectedModel) return false;
    const bare = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
    if (row.selectedModel === key || row.selectedModel === bare) return true;
    return row.provider !== null && `${row.provider}/${row.selectedModel}` === key;
  };

  const canaryRows = rows.filter((row) => matches(row, rollout.candidateModel));
  const baselineRows = rows.filter((row) => matches(row, rollout.baselineModel));
  const shadowRows = await db
    .select({
      status: rolloutShadowSamples.status,
      latencyMs: rolloutShadowSamples.latencyMs,
      qualityScore: rolloutShadowSamples.qualityScore,
      costUsd: rolloutShadowSamples.costUsd,
    })
    .from(rolloutShadowSamples)
    .where(eq(rolloutShadowSamples.rolloutId, rollout.id))
    .orderBy(desc(rolloutShadowSamples.createdAt))
    .limit(5_000);

  const shadowErrors = shadowRows.filter((row) => row.status !== "success").length;
  const shadowQualities = shadowRows
    .map((row) => row.qualityScore)
    .filter((value): value is number => value !== null);

  return {
    canary: sideMetrics(canaryRows),
    baseline: sideMetrics(baselineRows),
    shadow: {
      samples: shadowRows.length,
      errors: shadowErrors,
      errorRatePct: shadowRows.length ? Math.round((shadowErrors / shadowRows.length) * 1_000) / 10 : 0,
      averageLatencyMs: shadowRows.length
        ? Math.round(shadowRows.reduce((sum, row) => sum + row.latencyMs, 0) / shadowRows.length)
        : 0,
      averageQuality: shadowQualities.length
        ? Math.round(shadowQualities.reduce((sum, value) => sum + value, 0) / shadowQualities.length)
        : null,
      totalCostUsd: shadowRows.reduce((sum, row) => sum + Number(row.costUsd ?? 0), 0),
    },
  };
}

function thresholdsFor(rollout: RolloutRow): RolloutThresholds {
  const stored = rollout.thresholds ?? DEFAULT_THRESHOLDS;
  return {
    minSamples: stored.minSamples ?? DEFAULT_THRESHOLDS.minSamples,
    maxErrorRatePct: stored.maxErrorRatePct ?? DEFAULT_THRESHOLDS.maxErrorRatePct,
    maxP95LatencyMs: stored.maxP95LatencyMs ?? DEFAULT_THRESHOLDS.maxP95LatencyMs,
    minAverageQuality: stored.minAverageQuality ?? DEFAULT_THRESHOLDS.minAverageQuality,
  };
}

/**
 * Evaluates canary health against the rollout's guardrails. Quality is only enforced when
 * at least one quality sample exists; gateway quality is populated by evaluation tooling, not
 * guessed from provider output.
 */
export function evaluateGuardrails(rollout: RolloutRow, metrics: RolloutMetrics): GuardrailEvaluation {
  const thresholds = thresholdsFor(rollout);
  const canary = metrics.canary;
  const reasons: string[] = [];
  const notes: string[] = [];

  if (canary.samples === 0) {
    notes.push("No canary traffic has been routed yet.");
  } else if (canary.samples < thresholds.minSamples) {
    notes.push(
      `Collecting samples: ${canary.samples}/${thresholds.minSamples} required before guardrails are enforced.`,
    );
  }

  if (canary.samples >= thresholds.minSamples) {
    if (canary.errorRatePct > thresholds.maxErrorRatePct) {
      reasons.push(`Error rate ${canary.errorRatePct}% exceeds ${thresholds.maxErrorRatePct}%.`);
    }
    if (canary.p95LatencyMs > thresholds.maxP95LatencyMs) {
      reasons.push(`P95 latency ${canary.p95LatencyMs}ms exceeds ${thresholds.maxP95LatencyMs}ms.`);
    }
    if (canary.averageQuality !== null && canary.averageQuality < thresholds.minAverageQuality) {
      reasons.push(
        `Average quality ${canary.averageQuality} is below ${thresholds.minAverageQuality}.`,
      );
    }
    if (canary.averageQuality === null) {
      notes.push("Quality guardrail inactive: no quality-scored canary samples yet.");
    }
  }

  return {
    ok: reasons.length === 0,
    insufficientSamples: canary.samples < thresholds.minSamples,
    reasons,
    notes,
    metrics,
  };
}

export async function getRolloutReport(db: AppDb, rolloutId: string) {
  const [rollout] = await db.select().from(routingRollouts).where(eq(routingRollouts.id, rolloutId)).limit(1);
  if (!rollout) return null;
  const metrics = await rolloutMetrics(db, rollout);
  return { rollout, metrics, guardrails: evaluateGuardrails(rollout, metrics) };
}

/** Automatically rolls a canary back when its guardrails are breached. */
export async function maybeAutoRollback(db: AppDb, rolloutId: string): Promise<void> {
  try {
    const [rollout] = await db
      .select()
      .from(routingRollouts)
      .where(and(eq(routingRollouts.id, rolloutId), eq(routingRollouts.status, "running")))
      .limit(1);
    if (!rollout || rollout.mode === "shadow") return;

    const metrics = await rolloutMetrics(db, rollout);
    const guardrails = evaluateGuardrails(rollout, metrics);
    if (guardrails.ok || guardrails.insufficientSamples) return;

    const reason = `Automatic rollback: ${guardrails.reasons.join(" ")}`;
    const updated = await db
      .update(routingRollouts)
      .set({ status: "rolled_back", endedAt: new Date(), outcomeReason: reason })
      .where(and(eq(routingRollouts.id, rollout.id), eq(routingRollouts.status, "running")))
      .returning({ id: routingRollouts.id });
    if (!updated.length) return;

    await writeAudit(db, {
      orgId: rollout.orgId,
      actorType: "system",
      actorEmail: "guardrail@tokenburn",
      action: "rollout.auto_rolled_back",
      targetType: "routing_rollout",
      targetId: rollout.id,
      summary: `Rolled back canary ${rollout.id.slice(0, 8)} to ${rollout.baselineModel}.`,
      metadata: { reasons: guardrails.reasons, metrics: guardrails.metrics },
    });
  } catch (error) {
    logEvent("error", "rollout.guardrail_check_failed", { error, rolloutId });
  }
}

export async function recordShadowSample(
  db: AppDb,
  input: {
    orgId: string;
    projectId: string;
    rolloutId: string;
    model: string;
    status: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    qualityScore?: number | null;
    errorCode?: string | null;
    outputExcerpt?: string | null;
  },
): Promise<void> {
  await db.insert(rolloutShadowSamples).values({
    orgId: input.orgId,
    projectId: input.projectId,
    rolloutId: input.rolloutId,
    model: input.model,
    status: input.status,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUsd: input.costUsd === null ? null : input.costUsd.toFixed(6),
    qualityScore: input.qualityScore ?? null,
    errorCode: input.errorCode ?? null,
    outputExcerpt: input.outputExcerpt?.slice(0, 500) ?? null,
  });
}
