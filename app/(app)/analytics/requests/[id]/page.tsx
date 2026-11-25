import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Coins, Cpu, Fingerprint, Repeat2, ShieldCheck, Timer, Zap } from "lucide-react";
import { getDb, rawQuery } from "@/lib/db/client";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { MetricCard } from "@/components/kpi";
import { SEMANTIC } from "@/lib/chart-colors";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CostBreakdown } from "@/lib/db/schema";
import { formatDateTimeUTC, formatInt, formatMs, formatPercent, formatUSD, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  project_id: string;
  environment: string;
  feature: string;
  provider: string;
  model: string;
  request_id: string | null;
  idempotency_key: string | null;
  dedupe_hash: string;
  prompt_hash: string | null;
  endpoint: string | null;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  latency_ms: number;
  status_code: number;
  cost_usd: string;
  cost_breakdown: CostBreakdown | null;
  occurred_at: string;
  ingested_at: string;
  is_synthetic: boolean;
  tags: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
  project_name: string;
  api_key_name: string | null;
  pricing_version: number | null;
  input_per_m: string | null;
  cached_input_per_m: string | null;
  output_per_m: string | null;
  cache_write_per_m: string | null;
};

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  await getDb();

  const rows = await rawQuery<EventRow>(
    `select ue.*, p.name as project_name, ak.name as api_key_name,
            mp.version as pricing_version, mp.input_per_m, mp.cached_input_per_m,
            mp.output_per_m, mp.cache_write_per_m
       from usage_events ue
       join projects p on p.id = ue.project_id
       left join api_keys ak on ak.id = ue.api_key_id
       left join model_pricing mp on mp.id = ue.pricing_id
      where ue.id = $1 and ue.org_id = $2
      limit 1`,
    [id, session.org.id],
  );
  const event = rows.rows[0];
  if (!event) notFound();

  const repeatRows = event.prompt_hash
    ? await rawQuery<{ count: string; cost: string }>(
        `select count(*)::int as count, coalesce(sum(cost_usd), 0)::float8 as cost
           from usage_events
          where org_id = $1 and prompt_hash = $2 and occurred_at >= $3`,
        [session.org.id, event.prompt_hash, new Date(Date.now() - 30 * 86_400_000)],
      )
    : null;
  const repeats = Number(repeatRows?.rows[0]?.count ?? 0);
  const repeatCost = Number(repeatRows?.rows[0]?.cost ?? 0);

  const cb = event.cost_breakdown;
  const costUsd = Number(event.cost_usd);
  const parts = cb
    ? [
        { label: "Uncached input", usd: cb.inputUsd, color: SEMANTIC.input },
        { label: "Cached input", usd: cb.cachedInputUsd, color: SEMANTIC.cached },
        { label: "Output + reasoning", usd: cb.outputUsd, color: SEMANTIC.output },
        { label: "Cache writes", usd: cb.cacheWriteUsd, color: SEMANTIC.latency },
      ]
    : [];
  const partsTotal = parts.reduce((s, p) => s + p.usd, 0) || 1;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`Request explorer · ${event.project_name}`}
        title={event.feature}
        description={`${event.provider}/${event.model} · ${event.environment} · ${formatDateTimeUTC(event.occurred_at)}`}
      >
        <Button asChild variant="ghost" size="sm">
          <Link href="/analytics">
            <ArrowLeft className="size-3.5" />
            Back to explorer
          </Link>
        </Button>
        <Badge variant={event.is_synthetic ? "warn" : "good"}>
          {event.is_synthetic ? "Synthetic seed" : "Live provider"}
        </Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Request cost"
          value={formatUSD(costUsd)}
          hint={`${formatUSD((costUsd / Math.max(event.input_tokens + event.output_tokens, 1)) * 1_000_000, true)} / M tokens`}
          accent="blue"
          icon={Coins}
        />
        <MetricCard
          label="Tokens"
          value={formatInt(event.input_tokens + event.output_tokens)}
          hint={`${formatInt(event.input_tokens)} in · ${formatInt(event.output_tokens)} out`}
          accent="violet"
          icon={Cpu}
        />
        <MetricCard
          label="Cache"
          value={formatPercent(event.input_tokens ? event.cached_input_tokens / event.input_tokens : 0)}
          hint={`${formatInt(event.cached_input_tokens)} cached · ${formatInt(event.cache_write_tokens)} written`}
          accent="cyan"
          icon={Zap}
        />
        <MetricCard
          label="Latency / status"
          value={formatMs(event.latency_ms)}
          hint={`HTTP ${event.status_code}`}
          hintTone={event.status_code >= 400 ? "bad" : "neutral"}
          tone={event.status_code >= 400 ? "bad" : "default"}
          accent={event.status_code >= 400 ? "rose" : "teal"}
          icon={Timer}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTopBar>
            <div className="text-[12.5px] font-medium text-ink">Cost composition</div>
            {cb ? <Badge variant="outline">Pricing v{cb.pricingVersion}</Badge> : null}
          </CardTopBar>
          <CardContent className="pt-4">
            {cb ? (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#222222]">
                  {parts.map((p) => (
                    <div key={p.label} style={{ width: `${pct(p.usd, partsTotal) * 100}%`, background: p.color }} />
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {parts.map((p) => (
                    <div key={p.label} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="flex items-center gap-2 text-ink-faint">
                        <span className="size-1.5 rounded-full" style={{ background: p.color }} />
                        {p.label}
                      </span>
                      <span className="font-mono tabular text-ink-muted">{formatUSD(p.usd)}</span>
                    </div>
                  ))}
                </div>
                {cb.discountApplied > 0 ? (
                  <div className="mt-3 flex items-center justify-between rounded-md border border-accent-emerald/25 bg-accent-emerald/[0.06] px-3 py-2 text-[11px]">
                    <span className="text-[#6EE7B7]">Cache discount applied</span>
                    <span className="font-mono tabular text-[#A7F3D0]">−{formatUSD(cb.discountApplied)}</span>
                  </div>
                ) : null}
                {cb.reasoningUsd > 0 ? (
                  <div className="mt-2 font-mono text-[10px] text-ink-faint">
                    Reasoning tokens billed at output rate: {formatUSD(cb.reasoningUsd)}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-[11.5px] text-ink-faint">No stored breakdown for this event.</p>
            )}

            <div className="mt-4 border-t border-hairline-faint pt-3">
              <div className="kicker mb-2">Pricing row</div>
              {event.input_per_m ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-7 px-0">Per 1M</TableHead>
                      <TableHead className="h-7 px-0 text-right">Input</TableHead>
                      <TableHead className="h-7 px-0 text-right">Cached</TableHead>
                      <TableHead className="h-7 px-0 text-right">Output</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="hover:bg-transparent">
                      <TableCell className="px-0 font-mono text-[10px] text-ink-faint">v{event.pricing_version}</TableCell>
                      <TableCell className="px-0 text-right font-mono text-[11px] tabular text-ink-muted">
                        {formatUSD(Number(event.input_per_m), true)}
                      </TableCell>
                      <TableCell className="px-0 text-right font-mono text-[11px] tabular text-ink-muted">
                        {formatUSD(Number(event.cached_input_per_m), true)}
                      </TableCell>
                      <TableCell className="px-0 text-right font-mono text-[11px] tabular text-ink-muted">
                        {formatUSD(Number(event.output_per_m), true)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <p className="text-[11px] text-ink-faint">Pricing row was removed; cost is stored immutably on the event.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <Fingerprint className="size-3.5 text-ink-faint" />
              Request attributes
            </div>
            <CopyButton value={event.id} label="Copy event id" />
          </CardTopBar>
          <CardContent className="pt-2">
            {[
              ["Event ID", event.id],
              ["Project", event.project_name],
              ["Environment", event.environment],
              ["Feature", event.feature],
              ["Provider / model", `${event.provider}/${event.model}`],
              ["Endpoint", event.endpoint ?? "—"],
              ["Request ID", event.request_id ?? "—"],
              ["Idempotency key", event.idempotency_key ?? "—"],
              ["Prompt hash", event.prompt_hash ?? "—"],
              ["Dedupe key", event.dedupe_hash],
              ["API key", event.api_key_name ?? "—"],
              ["Occurred at", formatDateTimeUTC(event.occurred_at)],
              ["Ingested at", formatDateTimeUTC(event.ingested_at)],
              ["Reasoning tokens", formatInt(event.reasoning_tokens)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline-faint py-2 last:border-0"
              >
                <span className="text-[11px] text-ink-faint">{label}</span>
                <span className="max-w-[70%] truncate font-mono text-[10.5px] text-ink-muted" title={value}>
                  {value}
                </span>
              </div>
            ))}
            {event.tags && Object.keys(event.tags).length ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="kicker mr-1">Tags</span>
                {Object.entries(event.tags).map(([k, v]) => (
                  <Badge key={k} variant="default">
                    {k}: {v}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
            <Repeat2 className="size-3.5 text-ink-faint" />
            Prompt fingerprint
          </div>
          <Badge variant={repeats > 5 ? "warn" : "outline"}>{formatInt(repeats)} requests / 30d</Badge>
        </CardTopBar>
        <CardContent className="pt-3">
          {event.prompt_hash ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-mono text-[11px] text-ink-muted">{event.prompt_hash}</div>
                <p className="mt-2 max-w-xl text-[11.5px] leading-relaxed text-ink-faint">
                  {repeats > 1
                    ? `This exact prompt fingerprint appears ${formatInt(repeats)} times in the last 30 days, costing ${formatUSD(repeatCost)}. Repeated prompts are the strongest signal for caching or prompt consolidation. The coach uses this count as measured evidence.`
                    : "No repeated occurrences of this prompt fingerprint in the last 30 days. Caching would yield little benefit for this call pattern."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-3.5 text-ink-faint" />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">
                  Hash only · prompt text is never stored
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-faint">No prompt fingerprint was supplied for this event.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
