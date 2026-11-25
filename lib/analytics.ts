import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import { rawQuery } from "@/lib/db/client";
import { alerts, features, projects, recommendations, usageEvents } from "@/lib/db/schema";
import { addDays, dayKey, startOfDayUTC, startOfMonthUTC } from "@/lib/utils";
import { getBudgetSnapshots, type BudgetSnapshot } from "@/lib/governance";

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export type DailyPoint = {
  day: string;
  costUsd: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  errors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
};

export type BreakdownRow = {
  key: string;
  costUsd: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

async function dailySeries(
  db: AppDb,
  orgId: string,
  from: Date,
  to: Date,
  projectId?: string,
): Promise<DailyPoint[]> {
  const rows = await rawQuery<{
    day: string;
    cost: string;
    requests: string;
    input_tokens: string;
    output_tokens: string;
    cached_tokens: string;
    errors: string;
    avg_latency: string;
    p95_latency: string;
  }>(
    `select (occurred_at at time zone 'UTC')::date::text as day,
            coalesce(sum(cost_usd), 0)::float8 as cost,
            count(*)::int as requests,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens,
            coalesce(sum(cached_input_tokens), 0)::int as cached_tokens,
            count(*) filter (where status_code >= 400)::int as errors,
            coalesce(avg(latency_ms), 0)::float8 as avg_latency,
            coalesce(percentile_cont(0.95) within group (order by latency_ms)
              filter (where latency_ms > 0), 0)::float8 as p95_latency
       from usage_events
      where org_id = $1 and occurred_at >= $2 and occurred_at < $3
        ${projectId ? "and project_id = $4" : ""}
      group by 1 order by 1`,
    projectId ? [orgId, from, to, projectId] : [orgId, from, to],
  );
  const byDay = new Map(rows.rows.map((r) => [r.day, r]));
  const out: DailyPoint[] = [];
  const start = startOfDayUTC(from);
  const end = startOfDayUTC(to);
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = dayKey(d);
    const row = byDay.get(key);
    out.push({
      day: key,
      costUsd: num(row?.cost),
      requests: num(row?.requests),
      inputTokens: num(row?.input_tokens),
      outputTokens: num(row?.output_tokens),
      cachedTokens: num(row?.cached_tokens),
      errors: num(row?.errors),
      avgLatencyMs: num(row?.avg_latency),
      p95LatencyMs: num(row?.p95_latency),
    });
  }
  return out;
}

export type CommandCenterData = {
  orgName: string;
  monthLabel: string;
  mtd: {
    costUsd: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    avgCost: number;
    errorRate: number;
    avgLatency: number;
    activeFeatures: number;
    activeModels: number;
  };
  previous: { costUsd: number; requests: number };
  projectedCostUsd: number;
  daysElapsed: number;
  daysInMonth: number;
  series: DailyPoint[];
  topFeatures: BreakdownRow[];
  topModels: BreakdownRow[];
  providers: Array<{
    provider: string;
    costUsd: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  gateway: {
    requests: number;
    failed: number;
    realizedSavingsUsd: number;
    estimatedSavingsUsd: number;
  };
  projectSpend: Array<{ projectId: string; name: string; costUsd: number; requests: number }>;
  budgets: BudgetSnapshot[];
  alerts: { open: number; critical: number; warning: number };
  recentAlerts: Array<{
    id: string;
    title: string;
    severity: string;
    createdAt: Date;
    status: string;
  }>;
  savingsOpportunityUsd: number;
  recommendationCount: number;
  lastEventAt: Date | null;
  events24h: number;
  anomalyDays: Array<{ day: string; costUsd: number; zScore: number; baseline: number }>;
};

export async function getCommandCenterData(db: AppDb, orgId: string): Promise<CommandCenterData> {
  const now = new Date();
  const monthStart = startOfMonthUTC(now);
  const daysElapsed = Math.floor((now.getTime() - monthStart.getTime()) / 86_400_000) + 1;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevEnd = new Date(prevStart.getTime() + daysElapsed * 86_400_000);

  const totals = await rawQuery<{
    cost: string;
    requests: string;
    input_tokens: string;
    output_tokens: string;
    cached_tokens: string;
    errors: string;
    avg_latency: string;
    features: string;
    models: string;
  }>(
    `select coalesce(sum(cost_usd), 0)::float8 as cost,
            count(*)::int as requests,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens,
            coalesce(sum(cached_input_tokens), 0)::int as cached_tokens,
            count(*) filter (where status_code >= 400)::int as errors,
            coalesce(avg(latency_ms), 0)::float8 as avg_latency,
            count(distinct feature)::int as features,
            count(distinct model)::int as models
       from usage_events
      where org_id = $1 and occurred_at >= $2`,
    [orgId, monthStart],
  );
  const t = totals.rows[0];
  const mtdCost = num(t?.cost);
  const mtdRequests = num(t?.requests);

  const prev = await rawQuery<{ cost: string; requests: string }>(
    `select coalesce(sum(cost_usd), 0)::float8 as cost, count(*)::int as requests
       from usage_events where org_id = $1 and occurred_at >= $2 and occurred_at < $3`,
    [orgId, prevStart, prevEnd],
  );

  const series = await dailySeries(db, orgId, addDays(startOfDayUTC(now), -29), now);

  const featureRows = await rawQuery<{
    key: string;
    project_name: string;
    cost: string;
    requests: string;
    input_tokens: string;
    output_tokens: string;
    cached_tokens: string;
  }>(
    `select ue.feature as key, p.name as project_name,
            coalesce(sum(ue.cost_usd), 0)::float8 as cost,
            count(*)::int as requests,
            coalesce(sum(ue.input_tokens), 0)::int as input_tokens,
            coalesce(sum(ue.output_tokens), 0)::int as output_tokens,
            coalesce(sum(ue.cached_input_tokens), 0)::int as cached_tokens
       from usage_events ue join projects p on p.id = ue.project_id
      where ue.org_id = $1 and ue.occurred_at >= $2
      group by 1, 2 order by cost desc limit 8`,
    [orgId, monthStart],
  );

  const modelRows = await db.select({
    provider: usageEvents.provider,
    model: usageEvents.model,
    cost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
    requests: sql<string>`count(*)`,
    inputTokens: sql<string>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
    outputTokens: sql<string>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
    cachedTokens: sql<string>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)`,
  })
    .from(usageEvents)
    .where(and(eq(usageEvents.orgId, orgId), gte(usageEvents.occurredAt, monthStart)))
    .groupBy(usageEvents.provider, usageEvents.model)
    .orderBy(desc(sql`sum(${usageEvents.costUsd})`))
    .limit(6);

  const projectRows = await rawQuery<{
    project_id: string;
    name: string;
    cost: string;
    requests: string;
  }>(
    `select p.id as project_id, p.name, coalesce(sum(ue.cost_usd), 0)::float8 as cost, count(ue.id)::int as requests
       from projects p left join usage_events ue
         on ue.project_id = p.id and ue.org_id = $1 and ue.occurred_at >= $2
      where p.org_id = $1
      group by p.id, p.name order by cost desc`,
    [orgId, monthStart],
  );

  const budgetSnaps = await getBudgetSnapshots(db, orgId, now);

  const providerRows = await rawQuery<{
    provider: string;
    cost: string;
    requests: string;
    input_tokens: string;
    output_tokens: string;
  }>(
    `select provider,
            coalesce(sum(cost_usd), 0)::float8 as cost,
            count(*)::int as requests,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens
       from usage_events
      where org_id = $1 and occurred_at >= $2
      group by provider order by cost desc`,
    [orgId, monthStart],
  );

  const gatewayRows = await rawQuery<{
    requests: string;
    failed: string;
    realized: string;
    estimated: string;
  }>(
    `select count(*)::int as requests,
            count(*) filter (where status <> 'success')::int as failed,
            coalesce(sum(realized_savings_usd), 0)::float8 as realized,
            coalesce(sum(greatest(
              coalesce((decision->>'baselineEstimateUsd')::float8, 0) -
              coalesce((decision->>'estimatedCostUsd')::float8, 0), 0)), 0)::float8 as estimated
       from gateway_requests
      where org_id = $1 and created_at >= $2`,
    [orgId, monthStart],
  );

  const alertRows = await db
    .select({
      id: alerts.id,
      title: alerts.title,
      severity: alerts.severity,
      createdAt: alerts.createdAt,
      status: alerts.status,
    })
    .from(alerts)
    .where(eq(alerts.orgId, orgId))
    .orderBy(desc(alerts.createdAt))
    .limit(50);

  const openAlerts = alertRows.filter((a) => a.status === "open");

  const recRows = await db
    .select({
      savings: sql<string>`coalesce(sum(${recommendations.estimatedMonthlySavingsUsd}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.orgId, orgId),
        eq(recommendations.status, "new"),
        sql`${recommendations.kind} <> 'anomaly'`,
      ),
    );

  const lastEvent = await db
    .select({ occurredAt: usageEvents.occurredAt })
    .from(usageEvents)
    .where(eq(usageEvents.orgId, orgId))
    .orderBy(desc(usageEvents.occurredAt))
    .limit(1);

  const events24h = await rawQuery<{ count: string }>(
    `select count(*)::int from usage_events where org_id = $1 and occurred_at >= $2`,
    [orgId, new Date(now.getTime() - 86_400_000)],
  );

  // Anomaly scan: last 7 days vs prior 30-day baseline.
  const recent = series.slice(-7);
  const baselineWindow = series.slice(0, -7);
  const baselineValues = baselineWindow.map((p) => p.costUsd);
  const mean = baselineValues.length ? baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length : 0;
  const variance = baselineValues.length
    ? baselineValues.reduce((a, b) => a + (b - mean) ** 2, 0) / baselineValues.length
    : 0;
  const std = Math.sqrt(variance);
  const anomalyDays = recent
    .filter((p) => std > 0 && (p.costUsd - mean) / std >= 1.8 && p.costUsd > 0)
    .map((p) => ({ day: p.day, costUsd: p.costUsd, zScore: (p.costUsd - mean) / std, baseline: mean }));

  const orgRow = await rawQuery<{ name: string }>(
    `select name from organizations where id = $1 limit 1`,
    [orgId],
  );

  return {
    orgName: orgRow.rows[0]?.name ?? "Organization",
    monthLabel: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(now),
    mtd: {
      costUsd: mtdCost,
      requests: mtdRequests,
      inputTokens: num(t?.input_tokens),
      outputTokens: num(t?.output_tokens),
      cachedTokens: num(t?.cached_tokens),
      avgCost: mtdRequests ? mtdCost / mtdRequests : 0,
      errorRate: mtdRequests ? num(t?.errors) / mtdRequests : 0,
      avgLatency: num(t?.avg_latency),
      activeFeatures: num(t?.features),
      activeModels: num(t?.models),
    },
    previous: { costUsd: num(prev.rows[0]?.cost), requests: num(prev.rows[0]?.requests) },
    projectedCostUsd: daysElapsed ? (mtdCost / daysElapsed) * daysInMonth : 0,
    daysElapsed,
    daysInMonth,
    series,
    topFeatures: featureRows.rows.map((r) => ({
      key: `${r.project_name} / ${r.key}`,
      costUsd: num(r.cost),
      requests: num(r.requests),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cachedTokens: num(r.cached_tokens),
    })),
    topModels: modelRows.map((r) => ({
      key: `${r.provider}/${r.model}`,
      costUsd: num(r.cost),
      requests: num(r.requests),
      inputTokens: num(r.inputTokens),
      outputTokens: num(r.outputTokens),
      cachedTokens: num(r.cachedTokens),
    })),
    providers: providerRows.rows.map((r) => ({
      provider: r.provider,
      costUsd: num(r.cost),
      requests: num(r.requests),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
    })),
    gateway: {
      requests: num(gatewayRows.rows[0]?.requests),
      failed: num(gatewayRows.rows[0]?.failed),
      realizedSavingsUsd: num(gatewayRows.rows[0]?.realized),
      estimatedSavingsUsd: num(gatewayRows.rows[0]?.estimated),
    },
    projectSpend: projectRows.rows.map((r) => ({
      projectId: r.project_id,
      name: r.name,
      costUsd: num(r.cost),
      requests: num(r.requests),
    })),
    budgets: budgetSnaps,
    alerts: {
      open: openAlerts.length,
      critical: openAlerts.filter((a) => a.severity === "critical").length,
      warning: openAlerts.filter((a) => a.severity === "warning").length,
    },
    recentAlerts: alertRows.slice(0, 4),
    savingsOpportunityUsd: num(recRows[0]?.savings),
    recommendationCount: num(recRows[0]?.count),
    lastEventAt: lastEvent[0]?.occurredAt ?? null,
    events24h: num(events24h.rows[0]?.count),
    anomalyDays,
  };
}

export type UsageFilters = {
  from: Date;
  to: Date;
  projectId?: string;
  environment?: string;
  feature?: string;
  provider?: string;
  model?: string;
  onlyErrors?: boolean;
  query?: string;
  page?: number;
  pageSize?: number;
};

export type UsageData = {
  totals: {
    costUsd: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    cacheHitRate: number;
    errorRate: number;
    avgLatency: number;
    p50Latency: number;
    p95Latency: number;
  };
  costBreakdown: {
    inputUsd: number;
    cachedInputUsd: number;
    outputUsd: number;
    cacheWriteUsd: number;
    cacheSavingsUsd: number;
  };
  series: DailyPoint[];
  byFeature: BreakdownRow[];
  byModel: BreakdownRow[];
  byProvider: BreakdownRow[];
  byProject: BreakdownRow[];
  byEnvironment: BreakdownRow[];
  events: Array<{
    id: string;
    requestId: string | null;
    feature: string;
    environment: string;
    projectName: string;
    provider: string;
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    latencyMs: number;
    statusCode: number;
    costUsd: number;
    occurredAt: Date;
    isSynthetic: boolean;
    promptHash: string | null;
  }>;
  totalEvents: number;
  options: {
    projects: Array<{ id: string; name: string }>;
    features: string[];
    models: string[];
    environments: string[];
  };
  page: number;
  pageSize: number;
};

export function filterSql(filters: UsageFilters, orgId: string): { where: string; params: unknown[] } {
  const clauses = ["ue.org_id = $1", "ue.occurred_at >= $2", "ue.occurred_at < $3"];
  const params: unknown[] = [orgId, filters.from, filters.to];
  if (filters.projectId) {
    params.push(filters.projectId);
    clauses.push(`ue.project_id = $${params.length}`);
  }
  if (filters.environment) {
    params.push(filters.environment);
    clauses.push(`ue.environment = $${params.length}`);
  }
  if (filters.feature) {
    params.push(filters.feature);
    clauses.push(`ue.feature = $${params.length}`);
  }
  if (filters.provider) {
    params.push(filters.provider);
    clauses.push(`ue.provider = $${params.length}`);
  }
  if (filters.model) {
    params.push(filters.model);
    clauses.push(`ue.model = $${params.length}`);
  }
  if (filters.onlyErrors) clauses.push("ue.status_code >= 400");
  if (filters.query) {
    params.push(`%${filters.query.toLowerCase()}%`);
    clauses.push(`(lower(coalesce(ue.request_id,'')) like $${params.length} or lower(coalesce(ue.prompt_hash,'')) like $${params.length})`);
  }
  return { where: clauses.join(" and "), params };
}

export async function getUsageData(db: AppDb, orgId: string, filters: UsageFilters): Promise<UsageData> {
  const { where, params } = filterSql(filters, orgId);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 5), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  const totals = await rawQuery<{
    cost: string;
    requests: string;
    input_tokens: string;
    output_tokens: string;
    cached_tokens: string;
    cache_write_tokens: string;
    errors: string;
    avg_latency: string;
    p50_latency: string;
    p95_latency: string;
  }>(
    `select coalesce(sum(ue.cost_usd), 0)::float8 as cost,
            count(*)::int as requests,
            coalesce(sum(ue.input_tokens), 0)::int as input_tokens,
            coalesce(sum(ue.output_tokens), 0)::int as output_tokens,
            coalesce(sum(ue.cached_input_tokens), 0)::int as cached_tokens,
            coalesce(sum(ue.cache_write_tokens), 0)::int as cache_write_tokens,
            count(*) filter (where ue.status_code >= 400)::int as errors,
            coalesce(avg(ue.latency_ms), 0)::float8 as avg_latency,
            coalesce(percentile_cont(0.5) within group (order by ue.latency_ms)
              filter (where ue.latency_ms > 0), 0)::float8 as p50_latency,
            coalesce(percentile_cont(0.95) within group (order by ue.latency_ms)
              filter (where ue.latency_ms > 0), 0)::float8 as p95_latency
       from usage_events ue where ${where}`,
    params,
  );
  const t = totals.rows[0];
  const requestCount = num(t?.requests);
  const inputTokens = num(t?.input_tokens);
  const cachedTokens = num(t?.cached_tokens);

  const breakdownRows = await rawQuery<{
    input_usd: string;
    cached_usd: string;
    output_usd: string;
    write_usd: string;
    savings_usd: string;
  }>(
    `select coalesce(sum((ue.cost_breakdown->>'inputUsd')::float8), 0)::float8 as input_usd,
            coalesce(sum((ue.cost_breakdown->>'cachedInputUsd')::float8), 0)::float8 as cached_usd,
            coalesce(sum((ue.cost_breakdown->>'outputUsd')::float8), 0)::float8 as output_usd,
            coalesce(sum((ue.cost_breakdown->>'cacheWriteUsd')::float8), 0)::float8 as write_usd,
            coalesce(sum((ue.cost_breakdown->>'discountApplied')::float8), 0)::float8 as savings_usd
       from usage_events ue where ${where}`,
    params,
  );
  const bd = breakdownRows.rows[0];

  const seriesRows = await rawQuery<{
    day: string;
    cost: string;
    requests: string;
    input_tokens: string;
    output_tokens: string;
    cached_tokens: string;
    errors: string;
    avg_latency: string;
    p95_latency: string;
  }>(
    `select (ue.occurred_at at time zone 'UTC')::date::text as day,
            coalesce(sum(ue.cost_usd), 0)::float8 as cost,
            count(*)::int as requests,
            coalesce(sum(ue.input_tokens), 0)::int as input_tokens,
            coalesce(sum(ue.output_tokens), 0)::int as output_tokens,
            coalesce(sum(ue.cached_input_tokens), 0)::int as cached_tokens,
            count(*) filter (where ue.status_code >= 400)::int as errors,
            coalesce(avg(ue.latency_ms), 0)::float8 as avg_latency,
            coalesce(percentile_cont(0.95) within group (order by ue.latency_ms)
              filter (where ue.latency_ms > 0), 0)::float8 as p95_latency
       from usage_events ue where ${where} group by 1 order by 1`,
    params,
  );
  const dayMap = new Map(seriesRows.rows.map((r) => [r.day, r]));
  const series: DailyPoint[] = [];
  for (let d = startOfDayUTC(filters.from); d <= filters.to; d = addDays(d, 1)) {
    const key = dayKey(d);
    const r = dayMap.get(key);
    series.push({
      day: key,
      costUsd: num(r?.cost),
      requests: num(r?.requests),
      inputTokens: num(r?.input_tokens),
      outputTokens: num(r?.output_tokens),
      cachedTokens: num(r?.cached_tokens),
      errors: num(r?.errors),
      avgLatencyMs: num(r?.avg_latency),
      p95LatencyMs: num(r?.p95_latency),
    });
  }

  const groupBy = async (expr: string): Promise<BreakdownRow[]> => {
    const rows = await rawQuery<{
      key: string;
      cost: string;
      requests: string;
      input_tokens: string;
      output_tokens: string;
      cached_tokens: string;
    }>(
      `select ${expr} as key,
              coalesce(sum(ue.cost_usd), 0)::float8 as cost,
              count(*)::int as requests,
              coalesce(sum(ue.input_tokens), 0)::int as input_tokens,
              coalesce(sum(ue.output_tokens), 0)::int as output_tokens,
              coalesce(sum(ue.cached_input_tokens), 0)::int as cached_tokens
         from usage_events ue join projects p on p.id = ue.project_id
        where ${where} group by 1 order by cost desc limit 12`,
      params,
    );
    return rows.rows.map((r) => ({
      key: r.key,
      costUsd: num(r.cost),
      requests: num(r.requests),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cachedTokens: num(r.cached_tokens),
    }));
  };

  const [byFeature, byModel, byProvider, byProject, byEnvironment, countRows, eventRows, projectOptions, featureOptions, modelOptions, envOptions] =
    await Promise.all([
      groupBy("ue.feature"),
      groupBy("ue.provider || '/' || ue.model"),
      groupBy("ue.provider"),
      groupBy("p.name"),
      groupBy("ue.environment"),
      rawQuery<{ count: string }>(`select count(*)::int from usage_events ue where ${where}`, params),
      rawQuery<{
        id: string;
        request_id: string | null;
        feature: string;
        environment: string;
        project_name: string;
        provider: string;
        model: string;
        input_tokens: string;
        cached_input_tokens: string;
        output_tokens: string;
        latency_ms: string;
        status_code: string;
        cost_usd: string;
        occurred_at: string;
        is_synthetic: boolean;
        prompt_hash: string | null;
      }>(
        `select ue.id, ue.request_id, ue.feature, ue.environment, p.name as project_name,
                ue.provider, ue.model, ue.input_tokens, ue.cached_input_tokens, ue.output_tokens,
                ue.latency_ms, ue.status_code, ue.cost_usd, ue.occurred_at, ue.is_synthetic, ue.prompt_hash
           from usage_events ue join projects p on p.id = ue.project_id
          where ${where}
          order by ue.occurred_at desc limit ${pageSize} offset ${offset}`,
        params,
      ),
      db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)),
      rawQuery<{ feature: string }>(
        `select distinct feature from usage_events where org_id = $1 order by feature limit 50`,
        [orgId],
      ),
      rawQuery<{ model: string }>(
        `select distinct provider || '/' || model as model from usage_events where org_id = $1 order by model limit 50`,
        [orgId],
      ),
      rawQuery<{ environment: string }>(
        `select distinct environment from usage_events where org_id = $1 order by environment limit 10`,
        [orgId],
      ),
      ]);

  return {
    totals: {
      costUsd: num(t?.cost),
      requests: requestCount,
      inputTokens,
      outputTokens: num(t?.output_tokens),
      cachedTokens,
      cacheWriteTokens: num(t?.cache_write_tokens),
      cacheHitRate: inputTokens > 0 ? cachedTokens / inputTokens : 0,
      errorRate: requestCount ? num(t?.errors) / requestCount : 0,
      avgLatency: num(t?.avg_latency),
      p50Latency: num(t?.p50_latency),
      p95Latency: num(t?.p95_latency),
    },
    costBreakdown: {
      inputUsd: num(bd?.input_usd),
      cachedInputUsd: num(bd?.cached_usd),
      outputUsd: num(bd?.output_usd),
      cacheWriteUsd: num(bd?.write_usd),
      cacheSavingsUsd: num(bd?.savings_usd),
    },
    series,
    byFeature,
    byModel,
    byProvider,
    byProject,
    byEnvironment,
    events: eventRows.rows.map((r) => ({
      id: r.id,
      requestId: r.request_id,
      feature: r.feature,
      environment: r.environment,
      projectName: r.project_name,
      provider: r.provider,
      model: r.model,
      inputTokens: num(r.input_tokens),
      cachedInputTokens: num(r.cached_input_tokens),
      outputTokens: num(r.output_tokens),
      latencyMs: num(r.latency_ms),
      statusCode: num(r.status_code),
      costUsd: num(r.cost_usd),
      occurredAt: new Date(r.occurred_at),
      isSynthetic: r.is_synthetic,
      promptHash: r.prompt_hash,
    })),
    totalEvents: num(countRows.rows[0]?.count),
    options: {
      projects: projectOptions,
      features: featureOptions.rows.map((r) => r.feature),
      models: modelOptions.rows.map((r) => r.model),
      environments: envOptions.rows.map((r) => r.environment),
    },
    page,
    pageSize,
  };
}

export async function getProjectSummaries(db: AppDb, orgId: string, since: Date) {
  const rows = await rawQuery<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    status: string;
    cost: string;
    requests: string;
    features: string;
    last_event: string | null;
  }>(
    `select p.id, p.name, p.slug, p.description, p.status,
            coalesce(sum(ue.cost_usd), 0)::float8 as cost,
            count(ue.id)::int as requests,
            (select count(*)::int from features f where f.project_id = p.id) as features,
            max(ue.occurred_at)::text as last_event
       from projects p left join usage_events ue on ue.project_id = p.id and ue.occurred_at >= $2
      where p.org_id = $1
      group by p.id order by cost desc`,
    [orgId, since],
  );
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    status: r.status,
    costUsd: num(r.cost),
    requests: num(r.requests),
    featureCount: num(r.features),
    lastEventAt: r.last_event ? new Date(r.last_event) : null,
  }));
}

export async function getProjectDetail(db: AppDb, orgId: string, projectId: string, since: Date) {
  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  const project = projectRows[0];
  if (!project) return null;

  const featureRows = await rawQuery<{
    feature: string;
    cost: string;
    requests: string;
    input_tokens: string;
    output_tokens: string;
    cached_tokens: string;
    avg_latency: string;
  }>(
    `select ue.feature, coalesce(sum(ue.cost_usd), 0)::float8 as cost, count(*)::int as requests,
            coalesce(sum(ue.input_tokens), 0)::int as input_tokens,
            coalesce(sum(ue.output_tokens), 0)::int as output_tokens,
            coalesce(sum(ue.cached_input_tokens), 0)::int as cached_tokens,
            coalesce(avg(ue.latency_ms), 0)::float8 as avg_latency
       from usage_events ue where ue.org_id = $1 and ue.project_id = $2 and ue.occurred_at >= $3
      group by ue.feature order by cost desc`,
    [orgId, projectId, since],
  );

  const envRows = await rawQuery<{ environment: string; cost: string; requests: string }>(
    `select environment, coalesce(sum(cost_usd), 0)::float8 as cost, count(*)::int as requests
       from usage_events where org_id = $1 and project_id = $2 and occurred_at >= $3
      group by environment order by cost desc`,
    [orgId, projectId, since],
  );

  const modelRows = await rawQuery<{ model: string; provider: string; cost: string; requests: string }>(
    `select model, provider, coalesce(sum(cost_usd), 0)::float8 as cost, count(*)::int as requests
       from usage_events where org_id = $1 and project_id = $2 and occurred_at >= $3
      group by model, provider order by cost desc limit 8`,
    [orgId, projectId, since],
  );

  const featureList = await db
    .select()
    .from(features)
    .where(eq(features.projectId, projectId))
    .orderBy(features.name);

  const series = await dailySeries(db, orgId, addDays(startOfDayUTC(new Date()), -29), new Date(), projectId);

  return {
    project,
    features: featureList,
    usageByFeature: featureRows.rows.map((r) => ({
      feature: r.feature,
      costUsd: num(r.cost),
      requests: num(r.requests),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cachedTokens: num(r.cached_tokens),
      avgLatency: num(r.avg_latency),
    })),
    environments: envRows.rows.map((r) => ({ name: r.environment, costUsd: num(r.cost), requests: num(r.requests) })),
    models: modelRows.rows.map((r) => ({
      key: `${r.provider}/${r.model}`,
      provider: r.provider,
      model: r.model,
      costUsd: num(r.cost),
      requests: num(r.requests),
    })),
    series,
  };
}
