import Link from "next/link";
import { FlaskConical, Layers, Sparkles } from "lucide-react";
import { getDb, rawQuery } from "@/lib/db/client";
import { requireSession } from "@/lib/auth";
import { getActiveCatalog, type PricingRecord } from "@/lib/pricing-db";
import { PageHeader, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/kpi";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  StudioWorkbench,
  type StudioBaseline,
  type StudioModel,
} from "@/components/studio-workbench";
import { addDays, formatInt, formatPercent, formatUSD } from "@/lib/utils";

export const dynamic = "force-dynamic";

function toStudioModel(p: PricingRecord): StudioModel {
  return {
    key: `${p.provider}/${p.model}`,
    label: p.displayName,
    provider: p.provider,
    model: p.model,
    inputPerM: p.inputPerM,
    cachedInputPerM: p.cachedInputPerM,
    outputPerM: p.outputPerM,
    cacheWritePerM: p.cacheWritePerM,
    qualityScore: p.qualityScore,
    latencyMs: p.typicalLatencyMs,
    contextWindow: p.contextWindow,
    maxOutput: p.maxOutput,
    category: p.category,
  };
}

export default async function StudioPage() {
  const session = await requireSession();
  const db = await getDb();
  const since = addDays(new Date(), -30);
  const orgId = session.org.id;

  const [catalog, modelRows, totals, mtdRows, promptRows] = await Promise.all([
    getActiveCatalog(db),
    rawQuery<{
      provider: string;
      model: string;
      requests: string;
      input_tokens: string;
      cached_tokens: string;
      output_tokens: string;
      cost: string;
    }>(
      `select provider, model, count(*)::int as requests,
              coalesce(sum(input_tokens), 0)::int as input_tokens,
              coalesce(sum(cached_input_tokens), 0)::int as cached_tokens,
              coalesce(sum(output_tokens), 0)::int as output_tokens,
              coalesce(sum(cost_usd), 0)::float8 as cost
         from usage_events
        where org_id = $1 and occurred_at >= $2
        group by provider, model
        order by cost desc
        limit 12`,
      [orgId, since],
    ),
    rawQuery<{ cost: string; requests: string; input_tokens: string; output_tokens: string }>(
      `select coalesce(sum(cost_usd), 0)::float8 as cost, count(*)::int as requests,
              coalesce(sum(input_tokens), 0)::int as input_tokens,
              coalesce(sum(output_tokens), 0)::int as output_tokens
         from usage_events where org_id = $1 and occurred_at >= $2`,
      [orgId, since],
    ),
    rawQuery<{ cost: string }>(
      `select coalesce(sum(cost_usd), 0)::float8 as cost
         from usage_events where org_id = $1 and occurred_at >= date_trunc('month', now())`,
      [orgId],
    ),
    rawQuery<{
      feature: string;
      prompt_hash: string;
      provider: string;
      model: string;
      requests: string;
      avg_input: string;
      cost: string;
      input_usd: string;
      cached_ratio: string;
    }>(
      `select feature, prompt_hash,
              (array_agg(provider))[1] as provider,
              (array_agg(model))[1] as model,
              count(*)::int as requests,
              coalesce(avg(input_tokens), 0)::float8 as avg_input,
              coalesce(sum(cost_usd), 0)::float8 as cost,
              coalesce(sum((cost_breakdown->>'inputUsd')::float8), 0)::float8 as input_usd,
              coalesce(avg(cached_input_tokens::float8 / greatest(input_tokens, 1)), 0)::float8 as cached_ratio
         from usage_events
        where org_id = $1 and occurred_at >= $2 and prompt_hash is not null
        group by feature, prompt_hash
        having count(*) >= 5
        order by cost desc
        limit 8`,
      [orgId, since],
    ),
  ]);

  const pricingByKey = new Map(catalog.map((p) => [`${p.provider}/${p.model}`, p]));
  const models = catalog.map(toStudioModel);
  const baselines: StudioBaseline[] = modelRows.rows
    .filter((r) => pricingByKey.has(`${r.provider}/${r.model}`))
    .map((r) => {
      const pricing = pricingByKey.get(`${r.provider}/${r.model}`)!;
      const requests = Number(r.requests);
      const inputTokens = Number(r.input_tokens);
      return {
        key: `${r.provider}/${r.model}`,
        label: pricing.displayName,
        requests,
        avgInput: requests > 0 ? Math.round(inputTokens / requests) : 0,
        avgOutput: requests > 0 ? Math.round(Number(r.output_tokens) / requests) : 0,
        cachedShare: inputTokens > 0 ? Number(r.cached_tokens) / inputTokens : 0,
        costUsd: Number(r.cost),
      };
    });

  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const mtdCost = Number(mtdRows.rows[0]?.cost ?? 0);
  const last30dCost = Number(totals.rows[0]?.cost ?? 0);
  const totalRequests = Number(totals.rows[0]?.requests ?? 0);
  const totalInput = Number(totals.rows[0]?.input_tokens ?? 0);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Optimize · Simulate before you ship"
        title="Optimization Studio"
        description="Reprice real workloads against the versioned catalog. Compare models, cache coverage and output caps with the same cost engine that bills your events."
      >
        <Badge variant="outline">{catalog.length} active price points</Badge>
        <Badge variant="outline">Server-authoritative engine</Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Measured spend · 30d"
          value={formatUSD(last30dCost)}
          hint="From normalized usage events"
          accent="blue"
          provenance="measured"
        />
        <MetricCard
          label="Requests · 30d"
          value={formatInt(totalRequests)}
          hint="The workload the simulator can load"
          accent="cyan"
        />
        <MetricCard
          label="Avg input / request"
          value={formatInt(totalRequests ? totalInput / totalRequests : 0)}
          hint="Tokens before cached-input discount"
          accent="violet"
        />
        <MetricCard
          label="Month to date"
          value={formatUSD(mtdCost)}
          hint={`Day ${dayOfMonth} of ${daysInMonth} · run-rate forecast`}
          accent="purple"
          provenance="projected"
        />
      </div>

      <StudioWorkbench
        models={models}
        baselines={baselines}
        forecast={{ mtdCost, dayOfMonth, daysInMonth, last30dCost }}
      />

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            <FlaskConical className="size-3.5 text-ink-faint" /> Prompt analysis
          </div>
          <span className="text-[10.5px] text-ink-faint">Repeated fingerprints · last 30 days · content never stored</span>
        </CardTopBar>
        {promptRows.rows.length ? (
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Fingerprint</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Avg input</TableHead>
                  <TableHead className="text-right">Cached share</TableHead>
                  <TableHead className="text-right">Measured cost</TableHead>
                  <TableHead className="text-right">Cache upside</TableHead>
                  <TableHead className="text-right">20% trim upside</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promptRows.rows.map((r) => {
                  const pricing = pricingByKey.get(`${r.provider}/${r.model}`);
                  const discount =
                    pricing && pricing.inputPerM > 0
                      ? Math.max(0, Math.min(0.9, 1 - pricing.cachedInputPerM / pricing.inputPerM))
                      : 0.5;
                  const cachedRatio = Number(r.cached_ratio);
                  const upside = Number(r.input_usd) * 0.4 * discount * (1 - Math.min(1, cachedRatio));
                  const trimUpside = Number(r.input_usd) * 0.2;
                  return (
                    <TableRow key={`${r.feature}-${r.prompt_hash}`}>
                      <TableCell>
                        <Link
                          href={`/analytics?feature=${encodeURIComponent(r.feature)}`}
                          className="text-ink underline-offset-2 hover:underline"
                        >
                          {r.feature}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-[10.5px] text-ink-faint">
                        {r.prompt_hash.slice(0, 24)}…
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink-muted">
                        {formatInt(Number(r.requests))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink-muted">
                        {formatInt(Number(r.avg_input))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink-muted">
                        {formatPercent(cachedRatio)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink">
                        {formatUSD(Number(r.cost))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-[#6EE7B7]">
                        {upside > 0.5 ? formatUSD(upside) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink-muted">
                        {trimUpside > 0.5 ? formatUSD(trimUpside) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        ) : (
          <CardContent className="pt-4">
            <p className="text-[11.5px] text-ink-faint">
              No repeated prompt fingerprints with at least five requests were found in the last 30 days.
            </p>
          </CardContent>
        )}
      </Card>

      <DataNote>
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-hairline-strong">
          <Layers className="size-2.5" />
        </span>
        <span>
          Simulations reprice <span className="text-ink-muted">measured token volumes</span> at current catalog rates; they
          do not predict traffic or provider price changes. Context and output reductions are what-if assumptions, and
          cache upside assumes a stable 40% prefix becomes cacheable. Quality scores and latencies are catalog
          approximations — no eval has been run here, so validate before routing production traffic.
          <span className="ml-1 inline-flex items-center gap-1 text-ink-muted">
            <Sparkles className="size-3" /> Nothing here changes routing; draft changes go through Governance approvals.
          </span>
        </span>
      </DataNote>
    </div>
  );
}
