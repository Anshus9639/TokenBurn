import { and, count, eq, gt, gte, lt, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import { alertRules, alerts, budgets, organizations, routingHolds, usageEvents } from "@/lib/db/schema";
import { startOfDayUTC, startOfMonthUTC, formatUSD, dayKey } from "@/lib/utils";

const globalState = globalThis as unknown as { __tokenburnGovernance?: Map<string, number> };
const lastRun = (globalState.__tokenburnGovernance ??= new Map());

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export type BudgetSnapshot = {
  id: string;
  name: string;
  scope: string;
  projectId: string | null;
  feature: string | null;
  period: string;
  limitUsd: number;
  spentUsd: number;
  utilization: number;
  hardLimit: boolean;
  thresholds: number[];
  crossedThreshold: number | null;
};

export function budgetScopeConditions(
  orgId: string,
  budget: { scope: string; projectId: string | null; feature: string | null; period: string },
  at = new Date(),
): SQL[] {
  const periodStart = budget.period === "daily" ? startOfDayUTC(at) : startOfMonthUTC(at);
  const conditions: SQL[] = [eq(usageEvents.orgId, orgId), gte(usageEvents.occurredAt, periodStart)];
  if (budget.scope === "project" && budget.projectId) {
    conditions.push(eq(usageEvents.projectId, budget.projectId));
  }
  if (budget.scope === "feature" && budget.projectId) {
    conditions.push(eq(usageEvents.projectId, budget.projectId));
    if (budget.feature) conditions.push(eq(usageEvents.feature, budget.feature));
  }
  return conditions;
}

export async function budgetSpend(
  db: AppDb,
  orgId: string,
  budget: { scope: string; projectId: string | null; feature: string | null; period: string },
  at = new Date(),
): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(and(...budgetScopeConditions(orgId, budget, at)));
  return num(rows[0]?.total);
}

export async function getBudgetSnapshots(
  db: AppDb,
  orgId: string,
  at = new Date(),
): Promise<BudgetSnapshot[]> {
  const rows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.orgId, orgId), eq(budgets.isActive, true)))
    .orderBy(budgets.createdAt);

  const out: BudgetSnapshot[] = [];
  for (const b of rows) {
    const limitUsd = num(b.limitUsd);
    const spentUsd = await budgetSpend(
      db,
      orgId,
      { scope: b.scope, projectId: b.projectId, feature: b.feature, period: b.period },
      at,
    );
    const utilization = limitUsd > 0 ? spentUsd / limitUsd : 0;
    const thresholds = [...(b.thresholds ?? [50, 75, 90, 100])].sort((a, b2) => a - b2);
    const crossed = [...thresholds].reverse().find((t) => utilization * 100 >= t) ?? null;
    out.push({
      id: b.id,
      name: b.name,
      scope: b.scope,
      projectId: b.projectId,
      feature: b.feature,
      period: b.period,
      limitUsd,
      spentUsd,
      utilization,
      hardLimit: b.hardLimit,
      thresholds,
      crossedThreshold: crossed,
    });
  }
  return out;
}

type RaiseInput = {
  orgId: string;
  ruleId?: string | null;
  budgetId?: string | null;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  metricValue: number;
  threshold: number;
  fingerprint: string;
};

async function raiseAlert(db: AppDb, input: RaiseInput) {
  await db
    .insert(alerts)
    .values({
      orgId: input.orgId,
      ruleId: input.ruleId ?? null,
      budgetId: input.budgetId ?? null,
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body,
      metricValue: input.metricValue.toFixed(4),
      threshold: input.threshold.toFixed(4),
      status: "open",
      fingerprint: input.fingerprint,
    })
    .onConflictDoNothing({ target: [alerts.orgId, alerts.fingerprint] });
}

export async function evaluateGovernance(db: AppDb, orgId: string, force = false) {
  const now = Date.now();
  const last = lastRun.get(orgId) ?? 0;
  if (!force && now - last < 30_000) return { skipped: true };
  lastRun.set(orgId, now);

  let created = 0;

  const orgRows = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const hardLimitsEnabled = orgRows[0]?.settings?.hardLimitsEnabled !== false;

  const budgetRows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.orgId, orgId), eq(budgets.isActive, true)));

  for (const b of budgetRows) {
    const limitUsd = num(b.limitUsd);
    if (limitUsd <= 0) continue;
    const spentUsd = await budgetSpend(db, orgId, {
      scope: b.scope,
      projectId: b.projectId,
      feature: b.feature,
      period: b.period,
    });
    const utilization = spentUsd / limitUsd;
    const thresholds = [...(b.thresholds ?? [50, 75, 90, 100])].sort((x, y) => x - y);
    const periodKey = b.period === "daily" ? dayKey(new Date()) : new Date().toISOString().slice(0, 7);
    const crossed = [...thresholds].reverse().find((t) => utilization * 100 >= t);
    if (crossed !== undefined) {
      const t = crossed;
      const severity: RaiseInput["severity"] = utilization >= 1 ? "critical" : t >= 75 ? "warning" : "info";
      await raiseAlert(db, {
        orgId,
        budgetId: b.id,
        type: "budget_utilization",
        severity,
        title: `${b.name} at ${(utilization * 100).toFixed(0)}% of ${b.period} budget`,
        body: `${formatUSD(spentUsd)} of ${formatUSD(limitUsd)} consumed (threshold ${t}%).${
          utilization >= 1 && b.hardLimit && hardLimitsEnabled
            ? " Hard limit is enabled: routing requests will be denied."
            : utilization >= 1 && b.hardLimit
              ? " Hard limit is switched off at the organization level, so routing is not denied."
              : ""
        }`,
        metricValue: utilization * 100,
        threshold: t,
        fingerprint: `budget:${b.id}:${periodKey}:${t}`,
      });
      created++;
    }
  }

  const ruleRows = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.orgId, orgId), eq(alertRules.enabled, true)));

  for (const rule of ruleRows) {
    const threshold = num(rule.threshold);
    const windowStart = new Date(now - rule.windowHours * 3_600_000);
    const scopeConditions = [eq(usageEvents.orgId, orgId), gte(usageEvents.occurredAt, windowStart)];
    if (rule.scope === "project" && rule.projectId) {
      scopeConditions.push(eq(usageEvents.projectId, rule.projectId));
    }
    if (rule.scope === "feature" && rule.feature) {
      scopeConditions.push(eq(usageEvents.feature, rule.feature));
    }

    if (rule.type === "daily_spend") {
      const rows = await db
        .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
        .from(usageEvents)
        .where(and(...scopeConditions));
      const spend = num(rows[0]?.total);
      if (spend > threshold) {
        await raiseAlert(db, {
          orgId,
          ruleId: rule.id,
          type: "daily_spend",
          severity: rule.severity as RaiseInput["severity"],
          title: `${rule.name}: ${formatUSD(spend)} in the last ${rule.windowHours}h`,
          body: `Spend exceeded the ${formatUSD(threshold)} threshold for window ${rule.windowHours}h.`,
          metricValue: spend,
          threshold,
          fingerprint: `rule:${rule.id}:${dayKey(new Date())}`,
        });
        created++;
      }
    }

    if (rule.type === "cost_spike") {
      const currentRows = await db
        .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
        .from(usageEvents)
        .where(and(...scopeConditions));
      const current = num(currentRows[0]?.total);
      const baselineStart = new Date(windowStart.getTime() - 14 * 86_400_000);
      const baselineRows = await db
        .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.orgId, orgId),
            gte(usageEvents.occurredAt, baselineStart),
            lt(usageEvents.occurredAt, windowStart),
          ),
        );
      const baseline = num(baselineRows[0]?.total);
      const avg = baseline / 14;
      const ratio = avg > 0 ? current / avg : 0;
      if (avg > 0 && ratio > threshold) {
        await raiseAlert(db, {
          orgId,
          ruleId: rule.id,
          type: "cost_spike",
          severity: "critical",
          title: `${rule.name}: ${ratio.toFixed(1)}x baseline spend`,
          body: `Last ${rule.windowHours}h spend ${formatUSD(current)} vs 14-day average ${formatUSD(avg)} (${ratio.toFixed(1)}x, threshold ${threshold}x).`,
          metricValue: ratio,
          threshold,
          fingerprint: `rule:${rule.id}:${dayKey(new Date())}`,
        });
        created++;
      }
    }

    if (rule.type === "error_rate") {
      const rows = await db
        .select({
          total: sql<string>`count(*)`,
          errors: sql<string>`count(*) filter (where ${usageEvents.statusCode} >= 400)`,
        })
        .from(usageEvents)
        .where(and(...scopeConditions));
      const total = num(rows[0]?.total);
      const errors = num(rows[0]?.errors);
      const rate = total > 0 ? (errors / total) * 100 : 0;
      if (total >= 10 && rate > threshold) {
        await raiseAlert(db, {
          orgId,
          ruleId: rule.id,
          type: "error_rate",
          severity: rule.severity as RaiseInput["severity"],
          title: `${rule.name}: ${rate.toFixed(1)}% provider errors`,
          body: `${errors} of ${total} requests in the last ${rule.windowHours}h returned >= 400 (threshold ${threshold}%).`,
          metricValue: rate,
          threshold,
          fingerprint: `rule:${rule.id}:${dayKey(new Date())}`,
        });
        created++;
      }
    }
  }

  const openRows = await db
    .select({ open: count() })
    .from(alerts)
    .where(and(eq(alerts.orgId, orgId), eq(alerts.status, "open")));
  return { created, open: openRows[0]?.open ?? 0, skipped: false };
}

export type RoutingDecision = {
  allowed: boolean;
  reason?: string;
  budget?: { id: string; name: string; spentUsd: number; limitUsd: number; remainingUsd: number };
  reservation?: { holdIds: string[]; estimatedUsd: number; expiresAt: string } | null;
};

/** Two stable 32-bit advisory lock keys for an organization (no DB hash functions needed). */
function advisoryKeys(orgId: string): [number, number] {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < orgId.length; i++) {
    const c = orgId.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b + c, 2246822519);
  }
  return [a | 0, b | 0];
}

function budgetApplies(
  budget: { scope: string; projectId: string | null; feature: string | null },
  projectId: string,
  feature: string | null,
): boolean {
  if (budget.scope === "organization") return true;
  if (budget.projectId !== projectId) return false;
  if (budget.scope === "project") return true;
  // A feature budget must only govern traffic for its own feature; otherwise an
  // unrelated feature in the same project would be denied.
  return budget.scope === "feature" && !!feature && budget.feature === feature;
}

/**
 * Preflight governance check for routing requests.
 *
 * - Model allow/block lists always apply.
 * - Hard budgets apply only when the organization enables hard limits.
 * - When `estimatedCostUsd` is provided, the decision reserves the estimate
 *   against every applicable budget inside a per-organization advisory lock, so
 *   concurrent requests cannot all pass against the same remaining headroom.
 *   Reservations expire after five minutes.
 */
export async function checkRoutingAllowance(
  db: AppDb,
  orgId: string,
  projectId: string,
  model: string,
  provider?: string,
  opts: { feature?: string | null; estimatedCostUsd?: number; reserve?: boolean } = {},
): Promise<RoutingDecision> {
  const orgRows = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const settings = orgRows[0]?.settings;
  if (settings) {
    const fullKey = provider ? `${provider}/${model}` : null;
    const listed = (list: string[]) => list.includes(model) || (fullKey !== null && list.includes(fullKey));
    if (settings.allowedModels?.length && !listed(settings.allowedModels)) {
      return { allowed: false, reason: `Model ${fullKey ?? model} is not on the approved model list` };
    }
    if (settings.blockedModels && listed(settings.blockedModels)) {
      return { allowed: false, reason: `Model ${fullKey ?? model} is blocked by governance policy` };
    }
  }

  if (settings && settings.hardLimitsEnabled === false) {
    return { allowed: true, reservation: null };
  }

  const budgetRows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.orgId, orgId), eq(budgets.isActive, true), eq(budgets.hardLimit, true)));
  const applicable = budgetRows.filter(
    (b) => num(b.limitUsd) > 0 && budgetApplies(b, projectId, opts.feature ?? null),
  );
  if (applicable.length === 0) return { allowed: true, reservation: null };

  const estimate = Math.max(0, Number.isFinite(opts.estimatedCostUsd ?? 0) ? (opts.estimatedCostUsd ?? 0) : 0);
  const reserve = opts.reserve !== false && estimate > 0;
  const now = new Date();
  const deny = (b: (typeof applicable)[number], spentUsd: number, heldUsd: number): RoutingDecision => {
    const limitUsd = num(b.limitUsd);
    return {
      allowed: false,
      reason: `Hard limit reached for ${b.name}. Requests are denied until the period resets or the limit is raised.`,
      budget: {
        id: b.id,
        name: b.name,
        spentUsd,
        limitUsd,
        remainingUsd: Math.max(0, limitUsd - spentUsd - heldUsd),
      },
    };
  };

  if (!reserve) {
    for (const b of applicable) {
      const spentUsd = await budgetSpend(db, orgId, {
        scope: b.scope,
        projectId: b.projectId,
        feature: b.feature,
        period: b.period,
      });
      if (spentUsd >= num(b.limitUsd)) return deny(b, spentUsd, 0);
    }
    return { allowed: true, reservation: null };
  }

  const [lockA, lockB] = advisoryKeys(orgId);
  const expiresAt = new Date(now.getTime() + 5 * 60_000);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockA}, ${lockB})`);
    await tx
      .delete(routingHolds)
      .where(and(eq(routingHolds.orgId, orgId), lt(routingHolds.expiresAt, now)));

    for (const b of applicable) {
      const spentRows = await tx
        .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
        .from(usageEvents)
        .where(and(...budgetScopeConditions(orgId, b, now)));
      const spentUsd = num(spentRows[0]?.total);
      const holdRows = await tx
        .select({ total: sql<string>`coalesce(sum(${routingHolds.estimateUsd}), 0)` })
        .from(routingHolds)
        .where(and(eq(routingHolds.budgetId, b.id), gt(routingHolds.expiresAt, now)));
      const heldUsd = num(holdRows[0]?.total);
      const limitUsd = num(b.limitUsd);
      if (spentUsd + heldUsd >= limitUsd || spentUsd + heldUsd + estimate > limitUsd) {
        return deny(b, spentUsd, heldUsd);
      }
    }

    const holdRows = await tx
      .insert(routingHolds)
      .values(
        applicable.map((b) => ({
          orgId,
          projectId,
          budgetId: b.id,
          estimateUsd: estimate.toFixed(6),
          expiresAt,
        })),
      )
      .returning({ id: routingHolds.id });

    return {
      allowed: true,
      reservation: {
        holdIds: holdRows.map((h) => h.id),
        estimatedUsd: estimate,
        expiresAt: expiresAt.toISOString(),
      },
    };
  });
}
