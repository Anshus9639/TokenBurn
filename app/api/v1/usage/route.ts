import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth";
import { getDb, rawQuery } from "@/lib/db/client";
import { handleApiError, jsonError, rateHeaders } from "@/lib/api-response";
import { addDays, startOfDayUTC } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GROUP_EXPR: Record<string, string> = {
  day: "(ue.occurred_at at time zone 'UTC')::date::text",
  feature: "ue.feature",
  model: "ue.provider || '/' || ue.model",
  environment: "ue.environment",
};

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function GET(request: Request) {
  try {
    const ctx = await authenticateApiKey(request);
    await getDb();
    const url = new URL(request.url);
    const now = new Date();
    const fromDefault = addDays(startOfDayUTC(now), -29);
    const from = parseDate(url.searchParams.get("from"), fromDefault);
    const to = parseDate(url.searchParams.get("to"), addDays(startOfDayUTC(now), 1));
    if (to <= from) return jsonError(422, "invalid_range", "`to` must be after `from`");
    if (to.getTime() - from.getTime() > 366 * 86_400_000) {
      return jsonError(422, "range_too_large", "Maximum range is 366 days");
    }

    const groupBy = url.searchParams.get("groupBy") ?? "day";
    if (!GROUP_EXPR[groupBy]) {
      return jsonError(422, "invalid_group_by", `groupBy must be one of: ${Object.keys(GROUP_EXPR).join(", ")}`);
    }

    const clauses = ["ue.org_id = $1", "ue.project_id = $2", "ue.occurred_at >= $3", "ue.occurred_at < $4"];
    const params: unknown[] = [ctx.orgId, ctx.projectId, from, to];
    for (const [key, column] of [
      ["feature", "ue.feature"],
      ["environment", "ue.environment"],
      ["provider", "ue.provider"],
      ["model", "ue.model"],
    ] as const) {
      const value = url.searchParams.get(key);
      if (value) {
        params.push(value);
        clauses.push(`${column} = $${params.length}`);
      }
    }
    const where = clauses.join(" and ");

    const [totals, groups] = await Promise.all([
      rawQuery<{
        cost: string;
        requests: string;
        input_tokens: string;
        cached_tokens: string;
        output_tokens: string;
        errors: string;
        avg_latency: string;
      }>(
        `select coalesce(sum(ue.cost_usd), 0)::float8 as cost, count(*)::int as requests,
                coalesce(sum(ue.input_tokens), 0)::int as input_tokens,
                coalesce(sum(ue.cached_input_tokens), 0)::int as cached_tokens,
                coalesce(sum(ue.output_tokens), 0)::int as output_tokens,
                count(*) filter (where ue.status_code >= 400)::int as errors,
                coalesce(avg(ue.latency_ms), 0)::float8 as avg_latency
           from usage_events ue where ${where}`,
        params,
      ),
      rawQuery<{ key: string; cost: string; requests: string; input_tokens: string; output_tokens: string }>(
        `select ${GROUP_EXPR[groupBy]} as key,
                coalesce(sum(ue.cost_usd), 0)::float8 as cost,
                count(*)::int as requests,
                coalesce(sum(ue.input_tokens), 0)::int as input_tokens,
                coalesce(sum(ue.output_tokens), 0)::int as output_tokens
           from usage_events ue where ${where}
          group by 1 order by cost desc limit 366`,
        params,
      ),
    ]);

    const t = totals.rows[0];
    return NextResponse.json(
      {
        project: { id: ctx.projectId, name: ctx.projectName, slug: ctx.projectSlug },
        range: { from: from.toISOString(), to: to.toISOString() },
        totals: {
          costUsd: Number(t?.cost ?? 0),
          requests: Number(t?.requests ?? 0),
          inputTokens: Number(t?.input_tokens ?? 0),
          cachedInputTokens: Number(t?.cached_tokens ?? 0),
          outputTokens: Number(t?.output_tokens ?? 0),
          errorRate: Number(t?.requests ?? 0) > 0 ? Number(t?.errors ?? 0) / Number(t?.requests) : 0,
          avgLatencyMs: Number(t?.avg_latency ?? 0),
        },
        groupBy,
        groups: groups.rows.map((r) => ({
          key: r.key,
          costUsd: Number(r.cost),
          requests: Number(r.requests),
          inputTokens: Number(r.input_tokens),
          outputTokens: Number(r.output_tokens),
        })),
      },
      { headers: rateHeaders(ctx.rateLimit) },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
