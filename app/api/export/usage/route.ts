import { getSession } from "@/lib/auth";
import { getDb, rawQuery } from "@/lib/db/client";
import { filterSql } from "@/lib/analytics";
import { objectFromSearchParams, parseUsageParams } from "@/lib/usage-params";

export const dynamic = "force-dynamic";

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading =, +, -, @ or tab makes Excel and Sheets treat the cell as a formula.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  await getDb();
  const url = new URL(request.url);
  const { filters } = parseUsageParams(objectFromSearchParams(url.searchParams));
  const { where, params } = filterSql(filters, session.org.id);

  const rows = await rawQuery<{
    occurred_at: string;
    project_name: string;
    environment: string;
    feature: string;
    provider: string;
    model: string;
    request_id: string | null;
    prompt_hash: string | null;
    input_tokens: number;
    cached_input_tokens: number;
    cache_write_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    latency_ms: number;
    status_code: number;
    cost_usd: string;
    is_synthetic: boolean;
  }>(
    `select ue.occurred_at, p.name as project_name, ue.environment, ue.feature, ue.provider, ue.model,
            ue.request_id, ue.prompt_hash, ue.input_tokens, ue.cached_input_tokens, ue.cache_write_tokens,
            ue.output_tokens, ue.reasoning_tokens, ue.latency_ms, ue.status_code, ue.cost_usd, ue.is_synthetic
       from usage_events ue join projects p on p.id = ue.project_id
      where ${where}
      order by ue.occurred_at desc
      limit 20000`,
    params,
  );

  const header = [
    "occurred_at_utc",
    "project",
    "environment",
    "feature",
    "provider",
    "model",
    "request_id",
    "prompt_hash",
    "input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "output_tokens",
    "reasoning_tokens",
    "latency_ms",
    "status_code",
    "cost_usd",
    "is_synthetic",
  ];

  const lines = [header.join(",")];
  for (const row of rows.rows) {
    lines.push(
      [
        new Date(row.occurred_at).toISOString(),
        row.project_name,
        row.environment,
        row.feature,
        row.provider,
        row.model,
        row.request_id,
        row.prompt_hash,
        row.input_tokens,
        row.cached_input_tokens,
        row.cache_write_tokens,
        row.output_tokens,
        row.reasoning_tokens,
        row.latency_ms,
        row.status_code,
        Number(row.cost_usd).toFixed(6),
        row.is_synthetic,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tokenburn-usage-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
