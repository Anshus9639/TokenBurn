"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  approvalRequests,
  organizations,
  projects,
  providers,
  routingPolicies,
  routingRollouts,
  type EvaluationCase,
} from "@/lib/db/schema";
import { requireAction, clientMeta, AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { withEnvProviderKeys } from "@/lib/providers/env-keys";
import { getActiveCatalog } from "@/lib/pricing-db";
import { DEFAULT_THRESHOLDS, evaluateGuardrails, rolloutMetrics } from "@/lib/gateway/rollout";
import { EVALUATION_LIMITS, runEvaluation } from "@/lib/gateway/evaluate";
import type { ActionState } from "./types";

const STRATEGIES = ["cost_optimized", "quality_first", "balanced", "fallback_only"] as const;
const MODES = ["manual", "recommendation", "automatic"] as const;
const ENVIRONMENTS = ["production", "staging", "development"] as const;

export async function createPolicyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("create_policy");
    const db = await getDb();
    const name = String(formData.get("name") ?? "").trim();
    const projectId = String(formData.get("projectId") ?? "");
    const feature = String(formData.get("feature") ?? "").trim() || null;
    const environment = String(formData.get("environment") ?? "production");
    const strategy = String(formData.get("strategy") ?? "cost_optimized");
    const mode = String(formData.get("mode") ?? "manual");
    const candidatesRaw = String(formData.get("candidates") ?? "").trim();
    const minQualityRaw = String(formData.get("minQualityScore") ?? "").trim();
    const maxLatencyRaw = String(formData.get("maxLatencyMs") ?? "").trim();
    const primaryModel = String(formData.get("primaryModel") ?? "");
    const fallbackModel = String(formData.get("fallbackModel") ?? "");
    const maxOutputRaw = String(formData.get("maxOutputTokens") ?? "").trim();
    const cacheEnabled = formData.get("cacheEnabled") === "on";
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (name.length < 3) return { error: "Give the policy a descriptive name." };
    if (!projectId) return { error: "Choose a project." };
    if (!(ENVIRONMENTS as readonly string[]).includes(environment)) return { error: "Invalid environment." };
    if (!(STRATEGIES as readonly string[]).includes(strategy)) return { error: "Invalid strategy." };
    if (!(MODES as readonly string[]).includes(mode)) return { error: "Invalid routing mode." };
    if (!primaryModel || !fallbackModel) return { error: "Choose a primary and fallback model." };
    if (primaryModel === fallbackModel) return { error: "Fallback must differ from the primary model." };

    const minQualityScore = minQualityRaw ? Number(minQualityRaw) : null;
    if (minQualityScore !== null && (!Number.isFinite(minQualityScore) || minQualityScore < 0 || minQualityScore > 100)) {
      return { error: "Minimum quality must be between 0 and 100." };
    }
    const maxLatencyMs = maxLatencyRaw ? Number(maxLatencyRaw) : null;
    if (maxLatencyMs !== null && (!Number.isFinite(maxLatencyMs) || maxLatencyMs < 100)) {
      return { error: "Max latency must be at least 100 ms." };
    }

    const owned = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, session.org.id)))
      .limit(1);
    if (!owned[0]) return { error: "Project not found." };

    const catalog = await getActiveCatalog(db);
    const keyOf = (p: { provider: string; model: string }) => `${p.provider}/${p.model}`;
    const primary = catalog.find((p) => keyOf(p) === primaryModel);
    const fallback = catalog.find((p) => keyOf(p) === fallbackModel);
    if (!primary) return { error: "Primary model is not in the active pricing catalog." };
    if (!fallback) return { error: "Fallback model is not in the active pricing catalog." };

    const candidateKeys = [
      ...new Set(
        (candidatesRaw ? candidatesRaw.split(/[,\s]+/) : [primaryModel, fallbackModel]).filter(Boolean),
      ),
    ];
    const candidateEntries: typeof catalog = [];
    for (const key of candidateKeys) {
      const entry = catalog.find((p) => keyOf(p) === key);
      if (!entry) return { error: `Candidate ${key} is not in the active pricing catalog.` };
      if (entry.category === "embedding") return { error: `Candidate ${entry.displayName} is an embedding model and cannot serve chat traffic.` };
      candidateEntries.push(entry);
    }
    if (mode === "automatic" && candidateEntries.length < 2) {
      return { error: "Automatic routing needs at least two candidate models." };
    }

    const orgRows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, session.org.id))
      .limit(1);
    const settings = orgRows[0]?.settings;
    for (const [label, p] of [
      ["Primary", primary],
      ["Fallback", fallback],
    ] as const) {
      const key = keyOf(p);
      if (settings?.blockedModels?.includes(key) || settings?.blockedModels?.includes(p.model)) {
        return { error: `${label} model ${p.displayName} is blocked by governance policy.` };
      }
      if (
        settings?.allowedModels?.length &&
        !settings.allowedModels.includes(key) &&
        !settings.allowedModels.includes(p.model)
      ) {
        return { error: `${label} model ${p.displayName} is not on the approved model list.` };
      }
    }
    for (const p of candidateEntries) {
      const key = keyOf(p);
      if (settings?.blockedModels?.includes(key) || settings?.blockedModels?.includes(p.model)) {
        return { error: `Candidate model ${p.displayName} is blocked by governance policy.` };
      }
      if (
        settings?.allowedModels?.length &&
        !settings.allowedModels.includes(key) &&
        !settings.allowedModels.includes(p.model)
      ) {
        return { error: `Candidate model ${p.displayName} is not on the approved model list.` };
      }
    }

    const maxOutputTokens = maxOutputRaw ? Number(maxOutputRaw) : null;
    if (maxOutputTokens !== null) {
      if (!Number.isFinite(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > primary.maxOutput) {
        return { error: `Max output tokens must be between 1 and ${primary.maxOutput} for this model.` };
      }
    }

    const [row] = await db
      .insert(routingPolicies)
      .values({
        orgId: session.org.id,
        projectId,
        feature,
        environment,
        name,
        strategy,
        mode,
        primaryModel,
        fallbackModel,
        candidates: candidateKeys,
        minQualityScore: minQualityScore === null ? null : Math.round(minQualityScore),
        maxLatencyMs: maxLatencyMs === null ? null : Math.round(maxLatencyMs),
        status: "draft",
        maxOutputTokens: maxOutputTokens === null ? null : Math.round(maxOutputTokens),
        cacheEnabled,
        notes,
        createdBy: session.user.email,
      })
      .returning({ id: routingPolicies.id });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "router.policy_created",
      targetType: "routing_policy",
      targetId: row?.id ?? null,
      summary: `Created draft routing policy "${name}" (${environment}${feature ? ` · ${feature}` : ""})`,
      metadata: { primaryModel, fallbackModel, strategy, mode, candidates: candidateKeys },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/router");
    return { ok: true, message: "Draft policy created. Submit it for activation when ready." };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[router] createPolicy failed", error);
    return { error: "Could not create the routing policy." };
  }
}

export async function submitPolicyAction(id: string): Promise<ActionState> {
  try {
    const session = await requireAction("create_policy");
    const db = await getDb();
    const rows = await db
      .select()
      .from(routingPolicies)
      .where(and(eq(routingPolicies.id, id), eq(routingPolicies.orgId, session.org.id)))
      .limit(1);
    const policy = rows[0];
    if (!policy) return { error: "Policy not found." };
    if (policy.status === "active") return { error: "This policy is already active." };

    const existing = await db
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.orgId, session.org.id),
          eq(approvalRequests.targetId, policy.id),
          eq(approvalRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (existing[0]) return { error: "This policy is already awaiting approval." };

    const orgRows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, session.org.id))
      .limit(1);
    const settings = orgRows[0]?.settings;
    const requiresApproval = settings?.requireApprovalForRouting === true || policy.environment === "production";

    const meta = await clientMeta();

    if (requiresApproval) {
      await db.insert(approvalRequests).values({
        orgId: session.org.id,
        type: "routing_change",
        title: `Activate routing policy "${policy.name}"`,
        description: `${policy.environment} · ${policy.primaryModel} → fallback ${policy.fallbackModel}. Requested by ${session.user.email}.`,
        payload: {
          primaryModel: policy.primaryModel,
          fallbackModel: policy.fallbackModel,
          strategy: policy.strategy,
          mode: policy.mode,
          candidates: policy.candidates,
          minQualityScore: policy.minQualityScore,
          maxLatencyMs: policy.maxLatencyMs,
          maxOutputTokens: policy.maxOutputTokens,
          cacheEnabled: policy.cacheEnabled,
        },
        targetType: "routing_policy",
        targetId: policy.id,
        status: "pending",
        requestedBy: session.user.id,
        requestedByEmail: session.user.email,
      });

      await writeAudit(db, {
        orgId: session.org.id,
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: "router.approval_requested",
        targetType: "routing_policy",
        targetId: policy.id,
        summary: `Requested approval to activate "${policy.name}" in ${policy.environment}`,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      revalidatePath("/router");
      revalidatePath("/governance");
      return { ok: true, message: "Submitted for approval. An admin must approve before traffic uses it." };
    }

    await db
      .update(routingPolicies)
      .set({
        status: "active",
        approvedBy: session.user.email,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(routingPolicies.id, policy.id));

    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "router.policy_activated",
      targetType: "routing_policy",
      targetId: policy.id,
      summary: `Activated non-production policy "${policy.name}" in ${policy.environment}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/router");
    return { ok: true, message: "Policy activated." };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[router] submitPolicy failed", error);
    return { error: "Could not submit the policy." };
  }
}

export async function pausePolicyAction(id: string): Promise<ActionState> {
  try {
    const session = await requireAction("approve");
    const db = await getDb();
    const rows = await db
      .select({ id: routingPolicies.id, name: routingPolicies.name, status: routingPolicies.status })
      .from(routingPolicies)
      .where(and(eq(routingPolicies.id, id), eq(routingPolicies.orgId, session.org.id)))
      .limit(1);
    const policy = rows[0];
    if (!policy) return { error: "Policy not found." };
    if (policy.status !== "active") return { error: "Only active policies can be paused." };

    await db
      .update(routingPolicies)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(routingPolicies.id, policy.id));

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "router.policy_paused",
      targetType: "routing_policy",
      targetId: policy.id,
      summary: `Paused routing policy "${policy.name}". Requests fall back to caller-specified models.`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/router");
    revalidatePath("/governance");
    return { ok: true, message: "Policy paused." };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[router] pausePolicy failed", error);
    return { error: "Could not pause the policy." };
  }
}

const ROLLOUT_MODES = ["canary", "shadow"] as const;

function numberField(formData: FormData, name: string, fallback: number): number {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export async function createRolloutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("create_policy");
    const db = await getDb();
    const policyId = String(formData.get("policyId") ?? "");
    const mode = String(formData.get("mode") ?? "canary");
    const candidateModel = String(formData.get("candidateModel") ?? "").trim();
    if (!policyId) return { error: "Choose a routing policy." };
    if (!(ROLLOUT_MODES as readonly string[]).includes(mode)) return { error: "Invalid rollout mode." };

    const [policy] = await db
      .select()
      .from(routingPolicies)
      .where(and(eq(routingPolicies.id, policyId), eq(routingPolicies.orgId, session.org.id)))
      .limit(1);
    if (!policy) return { error: "Policy not found." };
    if (policy.status !== "active") return { error: "Only active policies can run a rollout." };
    if (!candidateModel) return { error: "Choose the candidate model." };
    if (candidateModel === policy.primaryModel) {
      return { error: "The candidate must differ from the policy's production model." };
    }

    const catalog = await getActiveCatalog(db);
    const candidate = catalog.find((entry) => `${entry.provider}/${entry.model}` === candidateModel);
    if (!candidate) return { error: "Candidate model is not in the active pricing catalog." };

    const [org] = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, session.org.id))
      .limit(1);
    const settings = org?.settings;
    if (settings?.blockedModels?.includes(candidateModel) || settings?.blockedModels?.includes(candidate.model)) {
      return { error: "Candidate model is blocked by governance policy." };
    }
    if (
      settings?.allowedModels?.length &&
      !settings.allowedModels.includes(candidateModel) &&
      !settings.allowedModels.includes(candidate.model)
    ) {
      return { error: "Candidate model is not on the approved model list." };
    }

    const activeRollout = await db
      .select({ id: routingRollouts.id, status: routingRollouts.status })
      .from(routingRollouts)
      .where(
        and(
          eq(routingRollouts.orgId, session.org.id),
          eq(routingRollouts.policyId, policy.id),
          inArray(routingRollouts.status, ["pending_approval", "running"]),
        ),
      )
      .limit(1);
    if (activeRollout[0]) {
      return {
        error: `This policy already has a ${activeRollout[0].status === "running" ? "running" : "pending"} rollout.`,
      };
    }

    const trafficPercent =
      mode === "shadow" ? 0 : Math.min(50, Math.max(1, Math.round(numberField(formData, "trafficPercent", 10))));
    const thresholds = {
      minSamples: Math.max(5, Math.round(numberField(formData, "minSamples", DEFAULT_THRESHOLDS.minSamples))),
      maxErrorRatePct: Math.min(100, Math.max(0, numberField(formData, "maxErrorRatePct", DEFAULT_THRESHOLDS.maxErrorRatePct))),
      maxP95LatencyMs: Math.max(500, Math.round(numberField(formData, "maxP95LatencyMs", DEFAULT_THRESHOLDS.maxP95LatencyMs))),
      minAverageQuality: Math.min(100, Math.max(0, numberField(formData, "minAverageQuality", DEFAULT_THRESHOLDS.minAverageQuality))),
    };

    const [rollout] = await db
      .insert(routingRollouts)
      .values({
        orgId: session.org.id,
        policyId: policy.id,
        projectId: policy.projectId,
        mode,
        status: "pending_approval",
        baselineModel: policy.primaryModel,
        candidateModel,
        trafficPercent,
        thresholds,
        createdBy: session.user.email,
      })
      .returning({ id: routingRollouts.id });
    if (!rollout) return { error: "Could not create the rollout." };

    await db.insert(approvalRequests).values({
      orgId: session.org.id,
      type: "routing_rollout",
      title: `${mode === "shadow" ? "Shadow-evaluate" : "Canary"} ${candidate.displayName}`,
      description: `${
        mode === "shadow"
          ? "Mirror production traffic to the candidate without serving it"
          : `Serve ${trafficPercent}% of policy traffic with the candidate`
      }. Baseline ${policy.primaryModel} → candidate ${candidateModel}. Requested by ${session.user.email}.`,
      payload: { rolloutId: rollout.id, mode, baselineModel: policy.primaryModel, candidateModel, trafficPercent, thresholds },
      targetType: "routing_rollout",
      targetId: rollout.id,
      status: "pending",
      requestedBy: session.user.id,
      requestedByEmail: session.user.email,
    });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "router.rollout_requested",
      targetType: "routing_rollout",
      targetId: rollout.id,
      summary: `Requested a ${mode} rollout of ${candidateModel} for policy "${policy.name}"`,
      metadata: { policyId: policy.id, trafficPercent, thresholds },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/router");
    revalidatePath("/governance");
    return { ok: true, message: "Rollout submitted for approval. Traffic changes only after an admin approves it." };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[router] createRollout failed", error);
    return { error: "Could not create the rollout." };
  }
}

async function loadOwnedRollout(id: string, orgId: string) {
  const db = await getDb();
  const [rollout] = await db
    .select()
    .from(routingRollouts)
    .where(and(eq(routingRollouts.id, id), eq(routingRollouts.orgId, orgId)))
    .limit(1);
  return { db, rollout };
}

export async function rampRolloutAction(id: string, trafficPercent: number): Promise<ActionState> {
  try {
    const session = await requireAction("approve");
    const { db, rollout } = await loadOwnedRollout(id, session.org.id);
    if (!rollout) return { error: "Rollout not found." };
    if (rollout.status !== "running") return { error: "Only a running rollout can be ramped." };
    if (rollout.mode !== "canary") return { error: "Shadow rollouts do not serve traffic and cannot be ramped." };
    const next = Math.round(trafficPercent);
    if (!Number.isFinite(next) || next <= rollout.trafficPercent || next > 100) {
      return { error: `Traffic must increase from ${rollout.trafficPercent}% and be at most 100%.` };
    }

    await db
      .update(routingRollouts)
      .set({ trafficPercent: next })
      .where(and(eq(routingRollouts.id, rollout.id), eq(routingRollouts.status, "running")));

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "router.rollout_ramped",
      targetType: "routing_rollout",
      targetId: rollout.id,
      summary: `Raised canary traffic from ${rollout.trafficPercent}% to ${next}%`,
      metadata: { from: rollout.trafficPercent, to: next },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath("/router");
    return { ok: true, message: `Canary traffic is now ${next}%.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[router] rampRollout failed", error);
    return { error: "Could not ramp the rollout." };
  }
}

export async function rollbackRolloutAction(id: string): Promise<ActionState> {
  try {
    const session = await requireAction("approve");
    const { db, rollout } = await loadOwnedRollout(id, session.org.id);
    if (!rollout) return { error: "Rollout not found." };
    if (rollout.status !== "running") return { error: "Only a running rollout can be rolled back." };

    await db
      .update(routingRollouts)
      .set({
        status: "rolled_back",
        endedAt: new Date(),
        outcomeReason: `Manually rolled back by ${session.user.email}.`,
      })
      .where(and(eq(routingRollouts.id, rollout.id), eq(routingRollouts.status, "running")));

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "router.rollout_rolled_back",
      targetType: "routing_rollout",
      targetId: rollout.id,
      summary: `Rolled back ${rollout.mode} rollout to ${rollout.baselineModel}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath("/router");
    return { ok: true, message: "Rollout rolled back. Traffic returns to the baseline model." };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[router] rollbackRollout failed", error);
    return { error: "Could not roll back the rollout." };
  }
}

export async function promoteRolloutAction(id: string): Promise<ActionState> {
  try {
    const session = await requireAction("approve");
    const { db, rollout } = await loadOwnedRollout(id, session.org.id);
    if (!rollout) return { error: "Rollout not found." };
    if (rollout.status !== "running" || rollout.mode !== "canary") {
      return { error: "Only a running canary can be promoted." };
    }

    const metrics = await rolloutMetrics(db, rollout);
    const guardrails = evaluateGuardrails(rollout, metrics);
    if (guardrails.insufficientSamples) {
      return {
        error: `Need at least ${rollout.thresholds.minSamples} canary samples before promotion (have ${metrics.canary.samples}).`,
      };
    }
    if (!guardrails.ok) return { error: guardrails.reasons.join(" ") };

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(routingRollouts)
        .set({
          status: "completed",
          trafficPercent: 100,
          endedAt: now,
          outcomeReason: `Promoted by ${session.user.email} after ${metrics.canary.samples} samples.`,
          approvedBy: session.user.email,
          approvedAt: now,
        })
        .where(eq(routingRollouts.id, rollout.id));
      await tx
        .update(routingPolicies)
        .set({
          primaryModel: rollout.candidateModel,
          fallbackModel: rollout.baselineModel,
          updatedAt: now,
          approvedBy: session.user.email,
          approvedAt: now,
        })
        .where(and(eq(routingPolicies.id, rollout.policyId), eq(routingPolicies.orgId, session.org.id)));
    });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "router.rollout_promoted",
      targetType: "routing_rollout",
      targetId: rollout.id,
      summary: `Promoted ${rollout.candidateModel} to production for policy ${rollout.policyId.slice(0, 8)}`,
      metadata: { metrics, thresholds: rollout.thresholds },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath("/router");
    revalidatePath("/governance");
    return { ok: true, message: `${rollout.candidateModel} is now the production model for this policy.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[router] promoteRollout failed", error);
    return { error: "Could not promote the rollout." };
  }
}

function parseDataset(raw: string): EvaluationCase[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "Dataset must be valid JSON.";
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return "Dataset must be a non-empty JSON array.";
  if (parsed.length > EVALUATION_LIMITS.maxCases) {
    return `Datasets are limited to ${EVALUATION_LIMITS.maxCases} cases per evaluation.`;
  }
  const cases: EvaluationCase[] = [];
  for (const [index, item] of parsed.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `Case ${index + 1} must be a JSON object.`;
    }
    const row = item as Record<string, unknown>;
    const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
    if (!prompt) return `Case ${index + 1} needs a prompt.`;
    const keywords = Array.isArray(row.expectedKeywords)
      ? row.expectedKeywords.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    cases.push({
      id:
        typeof row.id === "string" && row.id.trim()
          ? row.id.trim().slice(0, 80)
          : `case-${index + 1}`,
      prompt: prompt.slice(0, 4_000),
      system: typeof row.system === "string" && row.system.trim() ? row.system.slice(0, 2_000) : undefined,
      expectedKeywords: keywords.length ? keywords.slice(0, 10) : undefined,
      mustBeJson: row.mustBeJson === true,
      referenceAnswer:
        typeof row.referenceAnswer === "string" && row.referenceAnswer.trim()
          ? row.referenceAnswer.slice(0, 2_000)
          : undefined,
      maxLatencyMs:
        typeof row.maxLatencyMs === "number" && Number.isFinite(row.maxLatencyMs)
          ? Math.max(100, Math.round(row.maxLatencyMs))
          : undefined,
    });
  }
  return cases;
}

export async function runEvaluationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("create_policy");
    const db = await getDb();
    const name = String(formData.get("name") ?? "").trim();
    const projectId = String(formData.get("projectId") ?? "");
    const baselineModel = String(formData.get("baselineModel") ?? "").trim() || null;
    const candidateModels = [
      ...new Set(
        String(formData.get("candidateModels") ?? "")
          .split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    const datasetRaw = String(formData.get("dataset") ?? "").trim();

    if (name.length < 3) return { error: "Give the evaluation a descriptive name." };
    if (!projectId) return { error: "Choose a project." };
    if (!candidateModels.length) return { error: "Add at least one candidate model." };
    if (candidateModels.length > EVALUATION_LIMITS.maxModels - 1) {
      return { error: `Candidate models are limited to ${EVALUATION_LIMITS.maxModels - 1}.` };
    }
    if (baselineModel && candidateModels.includes(baselineModel)) {
      return { error: "The baseline must differ from the candidate models." };
    }

    const dataset = parseDataset(datasetRaw);
    if (typeof dataset === "string") return { error: dataset };

    const owned = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, session.org.id)))
      .limit(1);
    if (!owned[0]) return { error: "Project not found." };

    const providerRows = await db
      .select({ provider: providers.provider, credentialsEnc: providers.credentialsEnc })
      .from(providers)
      .where(eq(providers.orgId, session.org.id));
    const credentials = new Map<string, string>();
    for (const row of providerRows) {
      if (!row.credentialsEnc) continue;
      try {
        credentials.set(row.provider, decryptSecret(row.credentialsEnc));
      } catch {
        // Undecryptable credentials are treated as unavailable.
      }
    }
    withEnvProviderKeys(credentials);
    if (!credentials.size) {
      return { error: "Connect at least one provider in Settings before running an evaluation." };
    }

    const result = await runEvaluation(db, {
      orgId: session.org.id,
      projectId,
      name,
      baselineModel,
      candidateModels,
      dataset,
      credentials,
      createdBy: session.user.email,
    });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "router.evaluation_run",
      targetType: "model_evaluation",
      targetId: result.id,
      summary: `Ran evaluation "${name}" over ${dataset.length} case${dataset.length === 1 ? "" : "s"}`,
      metadata: {
        baselineModel,
        candidateModels,
        cases: dataset.length,
        status: result.status,
        models: result.summary?.models.map((model) => ({
          model: model.model,
          taskSuccessRate: model.taskSuccessRate,
          averageQuality: model.averageQuality,
        })),
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/router");
    if (result.status === "failed") {
      return { error: result.error ?? "Evaluation failed. Check provider credentials and pricing." };
    }

    const lines = (result.summary?.models ?? []).map(
      (model) =>
        `${model.model}: ${model.passed}/${model.cases} passed, quality ${model.averageQuality ?? "n/a"}, p95 ${model.p95LatencyMs}ms`,
    );
    return {
      ok: true,
      message: lines.length
        ? `Evaluation completed. ${lines.join(" · ")}${result.error ? ` (${result.error})` : ""}`
        : "Evaluation completed.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[router] runEvaluation failed", error);
    return { error: "Could not run the evaluation." };
  }
}

