"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, rawQuery } from "@/lib/db/client";
import {
  alertRules,
  alerts,
  approvalRequests,
  budgets,
  organizations,
  projects,
  reports,
  routingPolicies,
  routingRollouts,
  type OrgSettings,
} from "@/lib/db/schema";
import { requireAction, clientMeta, AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { dayKey, startOfDayUTC, addDays } from "@/lib/utils";
import type { ActionState } from "./types";

function parseThresholds(raw: unknown): number[] {
  const text = String(raw ?? "");
  const values = text
    .split(/[,\s]+/)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0 && v <= 500);
  return values.length ? [...new Set(values)].sort((a, b) => a - b) : [50, 75, 90, 100];
}

export async function createBudgetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("manage_budgets");
    const db = await getDb();
    const name = String(formData.get("name") ?? "").trim();
    const scope = String(formData.get("scope") ?? "project");
    const period = String(formData.get("period") ?? "monthly");
    const projectId = String(formData.get("projectId") ?? "") || null;
    const feature = String(formData.get("feature") ?? "").trim() || null;
    const limitUsd = Number(formData.get("limitUsd"));
    const hardLimit = formData.get("hardLimit") === "on";
    const thresholds = parseThresholds(formData.get("thresholds"));

    if (name.length < 2) return { error: "Give the budget a name." };
    if (!["organization", "project", "feature"].includes(scope)) return { error: "Invalid budget scope." };
    if (!["monthly", "daily"].includes(period)) return { error: "Invalid budget period." };
    if (!Number.isFinite(limitUsd) || limitUsd <= 0 || limitUsd > 1_000_000) {
      return { error: "Limit must be between $0.01 and $1,000,000." };
    }
    if (scope !== "organization" && !projectId) return { error: "Choose a project for this budget scope." };
    if (scope === "feature" && !feature) return { error: "Choose a feature for a feature budget." };

    if (projectId) {
      const owned = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.orgId, session.org.id)))
        .limit(1);
      if (!owned[0]) return { error: "Project not found." };
    }

    const [row] = await db
      .insert(budgets)
      .values({
        orgId: session.org.id,
        name,
        scope,
        period,
        projectId: scope === "organization" ? null : projectId,
        feature: scope === "feature" ? feature : null,
        limitUsd: limitUsd.toFixed(2),
        hardLimit,
        thresholds,
        createdBy: session.user.email,
      })
      .returning({ id: budgets.id });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "budget.created",
      targetType: "budget",
      targetId: row?.id ?? null,
      summary: `Created ${period} ${scope} budget "${name}" at $${limitUsd.toFixed(2)}.`,
      metadata: { thresholds, hardLimit },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/governance");
    revalidatePath("/dashboard");
    return { ok: true, message: `Budget "${name}" created.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[governance] createBudget failed", error);
    return { error: "Could not create the budget." };
  }
}

export async function updateBudgetAction(formData: FormData): Promise<void> {
  const session = await requireAction("manage_budgets");
  const db = await getDb();
  const id = String(formData.get("budgetId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  if (!id) return;
  const rows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, id), eq(budgets.orgId, session.org.id)))
    .limit(1);
  const budget = rows[0];
  if (!budget) return;

  if (intent === "toggle-hard") {
    await db.update(budgets).set({ hardLimit: !budget.hardLimit, updatedAt: new Date() }).where(eq(budgets.id, id));
  } else if (intent === "toggle-active") {
    await db.update(budgets).set({ isActive: !budget.isActive, updatedAt: new Date() }).where(eq(budgets.id, id));
  } else if (intent === "set-limit") {
    const limit = Number(formData.get("limitUsd"));
    if (Number.isFinite(limit) && limit > 0 && limit <= 1_000_000) {
      await db.update(budgets).set({ limitUsd: limit.toFixed(2), updatedAt: new Date() }).where(eq(budgets.id, id));
    }
  }

  const meta = await clientMeta();
  await writeAudit(db, {
    orgId: session.org.id,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "budget.updated",
    targetType: "budget",
    targetId: id,
    summary: `Updated budget "${budget.name}" (${intent}).`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  revalidatePath("/governance");
  revalidatePath("/dashboard");
}

export async function alertDecisionAction(formData: FormData): Promise<void> {
  const session = await requireAction("ack_alerts");
  const db = await getDb();
  const id = String(formData.get("alertId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  if (!id) return;
  const rows = await db
    .select({ id: alerts.id, title: alerts.title, status: alerts.status })
    .from(alerts)
    .where(and(eq(alerts.id, id), eq(alerts.orgId, session.org.id)))
    .limit(1);
  const alert = rows[0];
  if (!alert) return;

  if (intent === "acknowledge" && alert.status === "open") {
    await db
      .update(alerts)
      .set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: session.user.email })
      .where(eq(alerts.id, id));
  } else if (intent === "resolve") {
    await db
      .update(alerts)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        acknowledgedAt: alert.status === "open" ? new Date() : undefined,
        acknowledgedBy: alert.status === "open" ? session.user.email : undefined,
      })
      .where(eq(alerts.id, id));
  } else if (intent === "reopen") {
    await db.update(alerts).set({ status: "open", resolvedAt: null }).where(eq(alerts.id, id));
  }

  const meta = await clientMeta();
  await writeAudit(db, {
    orgId: session.org.id,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: `alert.${intent}`,
    targetType: "alert",
    targetId: id,
    summary: `${intent} alert "${alert.title}".`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
}

export async function createAlertRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireAction("manage_rules");
    const db = await getDb();
    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "daily_spend");
    const scope = String(formData.get("scope") ?? "organization");
    const projectId = String(formData.get("projectId") ?? "") || null;
    const feature = String(formData.get("feature") ?? "").trim() || null;
    const threshold = Number(formData.get("threshold"));
    const windowHours = Number(formData.get("windowHours") ?? 24);
    const severity = String(formData.get("severity") ?? "warning");

    if (name.length < 2) return { error: "Give the rule a name." };
    if (!["daily_spend", "cost_spike", "error_rate"].includes(type)) return { error: "Invalid rule type." };
    if (!["organization", "project", "feature"].includes(scope)) return { error: "Invalid scope." };
    if (!Number.isFinite(threshold) || threshold <= 0) return { error: "Threshold must be greater than zero." };
    if (![1, 6, 12, 24, 72].includes(windowHours)) return { error: "Window must be 1, 6, 12, 24 or 72 hours." };
    if (scope !== "organization" && !projectId) return { error: "Choose a project for this scope." };
    if (scope === "feature" && !feature) return { error: "Choose a feature for this scope." };
    if (type === "error_rate" && threshold > 100) return { error: "Error-rate threshold is a percentage (0-100)." };

    if (projectId) {
      const owned = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.orgId, session.org.id)))
        .limit(1);
      if (!owned[0]) return { error: "Project not found." };
    }

    const [row] = await db
      .insert(alertRules)
      .values({
        orgId: session.org.id,
        name,
        type,
        scope,
        projectId: scope === "organization" ? null : projectId,
        feature: scope === "feature" ? feature : null,
        threshold: threshold.toFixed(4),
        windowHours,
        severity,
        createdBy: session.user.email,
      })
      .returning({ id: alertRules.id });

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "alert_rule.created",
      targetType: "alert_rule",
      targetId: row?.id ?? null,
      summary: `Created ${type} rule "${name}" at ${threshold} over ${windowHours}h.`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath("/alerts");
    return { ok: true, message: `Rule "${name}" created.` };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[governance] createRule failed", error);
    return { error: "Could not create the alert rule." };
  }
}

export async function toggleAlertRuleAction(formData: FormData): Promise<void> {
  const session = await requireAction("manage_rules");
  const db = await getDb();
  const id = String(formData.get("ruleId") ?? "");
  if (!id) return;
  const rows = await db
    .select({ id: alertRules.id, name: alertRules.name, enabled: alertRules.enabled })
    .from(alertRules)
    .where(and(eq(alertRules.id, id), eq(alertRules.orgId, session.org.id)))
    .limit(1);
  if (!rows[0]) return;
  await db.update(alertRules).set({ enabled: !rows[0].enabled }).where(eq(alertRules.id, id));
  const meta = await clientMeta();
  await writeAudit(db, {
    orgId: session.org.id,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "alert_rule.toggled",
    targetType: "alert_rule",
    targetId: id,
    summary: `${rows[0].enabled ? "Paused" : "Enabled"} rule "${rows[0].name}".`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  revalidatePath("/alerts");
}

export async function updateGovernanceSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireAction("manage_budgets");
    const db = await getDb();
    const orgRows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, session.org.id))
      .limit(1);
    const current = orgRows[0]?.settings;
    if (!current) return { error: "Organization settings not found." };

    const allowed = String(formData.get("allowedModels") ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const blocked = String(formData.get("blockedModels") ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const fallbackModel = String(formData.get("fallbackModel") ?? "").trim() || current.fallbackModel;
    const requireApprovalForRouting = formData.get("requireApprovalForRouting") === "on";
    const hardLimitsEnabled = formData.get("hardLimitsEnabled") === "on";
    const timezone = String(formData.get("timezone") ?? current.timezone).trim() || "UTC";

    const overlap = allowed.filter((m) => blocked.includes(m));
    if (overlap.length) return { error: `Models cannot be both allowed and blocked: ${overlap.join(", ")}` };

    const next: OrgSettings = {
      ...current,
      timezone,
      allowedModels: allowed,
      blockedModels: blocked,
      fallbackModel,
      requireApprovalForRouting,
      hardLimitsEnabled,
    };

    await db.update(organizations).set({ settings: next }).where(eq(organizations.id, session.org.id));

    const meta = await clientMeta();
    await writeAudit(db, {
      orgId: session.org.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "governance.settings_updated",
      targetType: "organization",
      targetId: session.org.id,
      summary: `Updated governance policy: ${allowed.length} allowed, ${blocked.length} blocked, approval ${requireApprovalForRouting ? "required" : "optional"}.`,
      metadata: { requireApprovalForRouting, hardLimitsEnabled, fallbackModel },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath("/governance");
    revalidatePath("/router");
    return { ok: true, message: "Governance settings saved." };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error("[governance] updateSettings failed", error);
    return { error: "Could not save governance settings." };
  }
}

export async function decideApprovalAction(formData: FormData): Promise<void> {
  const session = await requireAction("approve");
  const db = await getDb();
  const id = String(formData.get("approvalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id || !["approve", "reject"].includes(decision)) return;

  const rows = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, id), eq(approvalRequests.orgId, session.org.id)))
    .limit(1);
  const request = rows[0];
  if (!request || request.status !== "pending") return;

  // Claim the pending request atomically so two approvers cannot both apply it.
  const claimed = await db.transaction(async (tx) => {
    const claimedRows = await tx
      .update(approvalRequests)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        decidedBy: session.user.email,
        decidedAt: new Date(),
        decisionNote: note,
      })
      .where(
        and(
          eq(approvalRequests.id, id),
          eq(approvalRequests.orgId, session.org.id),
          eq(approvalRequests.status, "pending"),
        ),
      )
      .returning({ id: approvalRequests.id });
    if (!claimedRows[0]) return false;

    if (decision === "approve" && request.type === "routing_change" && request.targetId) {      const payload = request.payload as {
        primaryModel?: string;
        fallbackModel?: string;
        strategy?: string;
        mode?: string;
        candidates?: string[] | null;
        minQualityScore?: number | null;
        maxLatencyMs?: number | null;
        maxOutputTokens?: number | null;
        cacheEnabled?: boolean;
      };
      const policyRows = await tx
        .select({ id: routingPolicies.id, name: routingPolicies.name })
        .from(routingPolicies)
        .where(and(eq(routingPolicies.id, request.targetId), eq(routingPolicies.orgId, session.org.id)))
        .limit(1);
      if (policyRows[0]) {
        await tx
          .update(routingPolicies)
          .set({
            primaryModel: payload.primaryModel ?? undefined,
            fallbackModel: payload.fallbackModel ?? undefined,
            strategy: payload.strategy ?? undefined,
            mode: payload.mode ?? undefined,
            candidates: payload.candidates ?? undefined,
            minQualityScore: payload.minQualityScore ?? null,
            maxLatencyMs: payload.maxLatencyMs ?? null,
            maxOutputTokens: payload.maxOutputTokens ?? null,
            cacheEnabled: payload.cacheEnabled ?? undefined,
            status: "active",
            approvedBy: session.user.email,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(routingPolicies.id, request.targetId));
      }
    }

    if (request.type === "routing_rollout" && request.targetId) {
      const rolloutRows = await tx
        .select({ id: routingRollouts.id })
        .from(routingRollouts)
        .where(and(eq(routingRollouts.id, request.targetId), eq(routingRollouts.orgId, session.org.id)))
        .limit(1);
      if (rolloutRows[0]) {
        if (decision === "approve") {
          await tx
            .update(routingRollouts)
            .set({
              status: "running",
              startedAt: new Date(),
              approvedBy: session.user.email,
              approvedAt: new Date(),
            })
            .where(
              and(
                eq(routingRollouts.id, request.targetId),
                eq(routingRollouts.status, "pending_approval"),
              ),
            );
        } else {
          await tx
            .update(routingRollouts)
            .set({
              status: "cancelled",
              endedAt: new Date(),
              outcomeReason: `Approval rejected by ${session.user.email}.`,
            })
            .where(
              and(
                eq(routingRollouts.id, request.targetId),
                eq(routingRollouts.status, "pending_approval"),
              ),
            );
        }
      }
    }
    return true;
  });
  if (!claimed) return;

  const meta = await clientMeta();
  await writeAudit(db, {
    orgId: session.org.id,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: `approval.${decision}`,
    targetType: request.targetType,
    targetId: request.targetId,
    summary: `${decision === "approve" ? "Approved" : "Rejected"} request "${request.title}".`,
    metadata: { approvalId: id, note },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  revalidatePath("/governance");
  revalidatePath("/router");
  revalidatePath("/dashboard");
}

export async function generateReportAction(): Promise<void> {
  const session = await requireAction("view");
  const db = await getDb();
  const end = new Date();
  const start = addDays(startOfDayUTC(end), -6);

  const totals = await rawQuery<{
    cost: string;
    requests: string;
    errors: string;
  }>(
    `select coalesce(sum(cost_usd), 0)::float8 as cost, count(*)::int as requests,
            count(*) filter (where status_code >= 400)::int as errors
       from usage_events where org_id = $1 and occurred_at >= $2 and occurred_at < $3`,
    [session.org.id, start, end],
  );
  const top = await rawQuery<{ feature: string; cost: string }>(
    `select feature, coalesce(sum(cost_usd), 0)::float8 as cost
       from usage_events where org_id = $1 and occurred_at >= $2 and occurred_at < $3
      group by feature order by cost desc limit 1`,
    [session.org.id, start, end],
  );
  const t = totals.rows[0];
  const summary = {
    totalCostUsd: Number(Number(t?.cost ?? 0).toFixed(2)),
    requests: Number(t?.requests ?? 0),
    errors: Number(t?.errors ?? 0),
    topFeature: top.rows[0]?.feature ?? null,
    topFeatureCostUsd: Number(Number(top.rows[0]?.cost ?? 0).toFixed(2)),
    projectedMonthlyUsd: Number((Number(t?.cost ?? 0) * 4.345).toFixed(2)),
    synthetic: true,
  };

  await db.insert(reports).values({
    orgId: session.org.id,
    type: "weekly",
    title: `Weekly cost report · week of ${dayKey(start)}`,
    periodStart: start,
    periodEnd: end,
    summary,
    createdBy: session.user.email,
  });

  const meta = await clientMeta();
  await writeAudit(db, {
    orgId: session.org.id,
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "report.generated",
    targetType: "report",
    targetId: null,
    summary: `Generated weekly report for ${dayKey(start)} → ${dayKey(end)}.`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  revalidatePath("/alerts");
}
