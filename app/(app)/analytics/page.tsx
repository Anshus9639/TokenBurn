import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Gauge,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { getDb } from "@/lib/db/client";
import { requireSession } from "@/lib/auth";
import { getUsageData } from "@/lib/analytics";
import { buildUsageQuery, parseUsageParams, type SearchParams } from "@/lib/usage-params";
import { PROVIDER_LABEL } from "@/lib/constants";
import { PageHeader, DataNote, EmptyState } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/kpi";
import { ProviderLogo } from "@/components/brand/provider-logo";
import {
  CategoryBars,
  ChartContainer,
  ChartLegend,
  CostTrendChart,
  LatencyTrendChart,
  ProviderDonut,
} from "@/components/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SEMANTIC, accentForName } from "@/lib/chart-colors";
import { providerBrand } from "@/lib/brand/providers";
import {
  cn,
  formatDateTimeUTC,
  formatInt,
  formatMs,
  formatPercent,
  formatUSD,
  pct,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

const selectClass =
  "h-8 w-full appearance-none rounded-md border border-hairline-strong bg-[#0D0D0D] pl-2.5 pr-7 text-[12px] text-ink-muted shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] transition-colors focus:border-[#6B6B6B] focus:outline-none focus:ring-2 focus:ring-white/[0.06]";

function FilterSelect({
  name,
  value,
  options,
  placeholder,
}: {
  name: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <select name={name} defaultValue={value ?? ""} className={selectClass}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronRight className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 rotate-90 text-ink-faint" />
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const db = await getDb();
  const { range, fromDate, toDate, filters } = parseUsageParams(sp);
  const data = await getUsageData(db, session.org.id, filters);

  const totalTokens = data.totals.inputTokens + data.totals.outputTokens;
  const totalPages = Math.max(Math.ceil(data.totalEvents / data.pageSize), 1);
  const activeFilters = [
    filters.projectId && "project",
    filters.environment && "environment",
    filters.feature && "feature",
    filters.provider && "provider",
    filters.model && "model",
    filters.onlyErrors && "errors",
    filters.query && "search",
  ].filter(Boolean) as string[];

  const breakdown = data.costBreakdown;
  const breakdownTotal =
    breakdown.inputUsd + breakdown.cachedInputUsd + breakdown.outputUsd + breakdown.cacheWriteUsd || 1;
  const breakdownRows = [
    { label: "Uncached input", value: breakdown.inputUsd, color: SEMANTIC.input },
    { label: "Cached input", value: breakdown.cachedInputUsd, color: SEMANTIC.cached },
    { label: "Output + reasoning", value: breakdown.outputUsd, color: SEMANTIC.output },
    { label: "Cache writes", value: breakdown.cacheWriteUsd, color: SEMANTIC.reasoning },
  ];
  const providerTotal = data.byProvider.reduce((s, p) => s + p.costUsd, 0);
  const latencySeries = data.series.map((p) => ({
    day: p.day,
    averageLatencyMs: p.avgLatencyMs,
    p95LatencyMs: p.p95LatencyMs,
  }));
  const errorTotal = data.series.reduce((s, p) => s + p.errors, 0);

  const presets = [
    { key: "7d", label: "7 days" },
    { key: "30d", label: "30 days" },
    { key: "90d", label: "90 days" },
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Overview · Request-level attribution"
        title="Usage Analytics"
        description="Every request normalized to a canonical event, attributed to a project, environment and feature, and priced server-side."
      >
        <Badge variant="outline">
          {fromDate} → {toDate}
        </Badge>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/api/export/usage?${buildUsageQuery(sp)}`} prefetch={false}>
            <Download className="size-3.5" />
            Export CSV
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="px-4 py-3">
          <form method="get" action="/analytics" className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex rounded-md border border-hairline-strong bg-[#0D0D0D] p-0.5">
                {presets.map((p) => (
                  <Link
                    key={p.key}
                    href={`/analytics?${buildUsageQuery(sp, {
                      range: p.key,
                      from: undefined,
                      to: undefined,
                      page: undefined,
                    })}`}
                    className={cn(
                      "rounded-[5px] px-2.5 py-1 text-[11px] transition-colors",
                      range === p.key
                        ? "bg-[#222222] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "text-ink-faint hover:text-ink-muted",
                    )}
                  >
                    {p.label}
                  </Link>
                ))}
              </div>
              <input type="hidden" name="range" value="custom" />
              <div className="flex items-end gap-1.5">
                <div>
                  <label htmlFor="from" className="mb-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                    From
                  </label>
                  <input
                    id="from"
                    type="date"
                    name="from"
                    defaultValue={fromDate}
                    className={cn(selectClass, "h-8 w-[132px] px-2 font-mono text-[11px]")}
                  />
                </div>
                <div>
                  <label htmlFor="to" className="mb-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                    To
                  </label>
                  <input
                    id="to"
                    type="date"
                    name="to"
                    defaultValue={toDate}
                    className={cn(selectClass, "h-8 w-[132px] px-2 font-mono text-[11px]")}
                  />
                </div>
              </div>
              <div className="min-w-[150px] flex-1">
                <label htmlFor="q" className="mb-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                  Search
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
                  <input
                    id="q"
                    name="q"
                    defaultValue={filters.query ?? ""}
                    placeholder="request id or prompt hash"
                    className={cn(selectClass, "h-8 pl-8 font-mono text-[11px]")}
                  />
                </div>
              </div>
              <Button type="submit" size="sm" variant="secondary" className="h-8">
                <Filter className="size-3.5" />
                Apply
              </Button>
              {activeFilters.length ? (
                <Button asChild size="sm" variant="ghost" className="h-8">
                  <Link href="/analytics">
                    <X className="size-3.5" />
                    Clear {activeFilters.length}
                  </Link>
                </Button>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <FilterSelect
                name="project"
                value={filters.projectId}
                placeholder="All projects"
                options={data.options.projects.map((p) => ({ value: p.id, label: p.name }))}
              />
              <FilterSelect
                name="environment"
                value={filters.environment}
                placeholder="All environments"
                options={data.options.environments.map((e) => ({ value: e, label: e }))}
              />
              <FilterSelect
                name="feature"
                value={filters.feature}
                placeholder="All features"
                options={data.options.features.map((f) => ({ value: f, label: f }))}
              />
              <FilterSelect
                name="provider"
                value={filters.provider}
                placeholder="All providers"
                options={Object.entries(PROVIDER_LABEL).map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                name="model"
                value={filters.model}
                placeholder="All models"
                options={data.options.models.map((m) => ({ value: m.split("/")[1] ?? m, label: m }))}
              />
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-[11.5px] text-ink-faint">
              <input
                type="checkbox"
                name="errors"
                value="1"
                defaultChecked={filters.onlyErrors}
                className="size-3.5 accent-[#D4D4D8]"
              />
              Only requests with status ≥ 400
            </label>
            <input type="hidden" name="pageSize" value={data.pageSize} />
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Spend"
          value={formatUSD(data.totals.costUsd)}
          hint={`${formatInt(data.totals.requests)} requests in range`}
          trend={data.series.slice(-14).map((p) => p.costUsd)}
          accent="blue"
        />
        <MetricCard
          label="Tokens"
          value={formatInt(totalTokens)}
          hint={`${formatInt(data.totals.inputTokens)} in · ${formatInt(data.totals.outputTokens)} out`}
          trend={data.series
            .slice(-14)
            .map((p) => p.inputTokens + p.outputTokens)}
          accent="violet"
        />
        <MetricCard
          label="Cache hit rate"
          value={formatPercent(data.totals.cacheHitRate)}
          hint={`${formatInt(data.totals.cachedTokens)} cached · ${formatInt(data.totals.cacheWriteTokens)} written`}
          tone={data.totals.cacheHitRate >= 0.35 ? "good" : data.totals.cacheHitRate < 0.15 ? "warn" : "default"}
          trend={data.series.slice(-14).map((p) => (p.inputTokens > 0 ? p.cachedTokens / p.inputTokens : 0))}
          accent="cyan"
        />
        <MetricCard
          label="Latency p50 / p95"
          value={`${formatMs(data.totals.p50Latency)} / ${formatMs(data.totals.p95Latency)}`}
          hint={`${formatPercent(data.totals.errorRate)} error rate · ${formatInt(errorTotal)} errors in range`}
          tone={data.totals.errorRate > 0.04 ? "bad" : "default"}
          trend={data.series.slice(-14).map((p) => p.p95LatencyMs)}
          accent="teal"
          sparklineColor={SEMANTIC.p95}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartContainer
          title="Spend over time"
          description={`Daily normalized cost · ${fromDate} → ${toDate}`}
          className="lg:col-span-2"
        >
          <CostTrendChart data={data.series} height={236} />
        </ChartContainer>

        <Card>
          <CardTopBar>
            <div className="text-[12.5px] font-medium text-ink">Cost composition</div>
            <Badge variant="outline">Versioned pricing</Badge>
          </CardTopBar>
          <CardContent className="pt-4">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05]" role="img" aria-label="Cost composition">
              {breakdownRows.map((row) => (
                <div
                  key={row.label}
                  style={{ width: `${pct(row.value, breakdownTotal) * 100}%`, background: row.color }}
                />
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {breakdownRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-2 text-ink-faint">
                    <span className="size-1.5 rounded-full" style={{ background: row.color }} />
                    {row.label}
                  </span>
                  <span className="font-mono tabular text-ink-muted">
                    {formatUSD(row.value)} · {formatPercent(pct(row.value, breakdownTotal), 1)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-accent-emerald/25 bg-accent-emerald/[0.06] px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#A7F3D0]">Cache discount applied</span>
                <span className="font-mono text-[12px] tabular text-[#D1FAE5]">{formatUSD(breakdown.cacheSavingsUsd)}</span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#6EE7B7]/70">
                Measured against uncached input rates for the same tokens and pricing version.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartContainer
          title="Latency trend"
          description="Average and P95 reported provider latency per day"
          className="lg:col-span-2"
          legend={
            <ChartLegend
              items={[
                { label: "Average", color: SEMANTIC.latency },
                { label: "P95", color: SEMANTIC.p95 },
              ]}
              columns={2}
            />
          }
        >
          <LatencyTrendChart data={latencySeries} height={236} />
        </ChartContainer>

        <ChartContainer title="Provider mix" description={`Spend attributed by provider · ${range}`}>
          {data.byProvider.length ? (
            <div className="space-y-1">
              <ProviderDonut
                data={data.byProvider.map((p) => ({ name: p.key, value: p.costUsd }))}
                height={156}
                centerValue={formatUSD(providerTotal)}
                centerLabel="in range"
                colorMode="provider"
              />
              <div className="mt-3 space-y-1.5">
                {data.byProvider.map((p) => (
                  <Link
                    key={p.key}
                    href={`/analytics?${buildUsageQuery(sp, { provider: p.key, page: undefined })}`}
                    className="row-hover -mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px]"
                  >
                    <span className="flex items-center gap-2 text-ink-muted">
                      <ProviderLogo provider={p.key} size={13} decorative />
                      {providerBrand(p.key).label}
                    </span>
                    <span className="font-mono tabular text-ink-faint">
                      {formatUSD(p.costUsd)} · {formatPercent(pct(p.costUsd, providerTotal), 0)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title="No provider usage" description="Nothing matched these filters." className="border-0 py-8" />
          )}
        </ChartContainer>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartContainer title="Spend by feature" description="Top 8 features by normalized cost">
          <CategoryBars
            data={data.byFeature}
            height={220}
            maxItems={8}
            colorMode="accent"
          />
        </ChartContainer>
        <ChartContainer title="Spend by model" description="Colored by provider for consistency with the rest of the app">
          <CategoryBars
            data={data.byModel}
            height={220}
            maxItems={8}
            colorMode="model"
          />
        </ChartContainer>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTopBar>
            <div className="text-[12.5px] font-medium text-ink">By project</div>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Drill down</span>
          </CardTopBar>
          <CardContent className="pt-2">
            {data.byProject.map((p) => {
              const project = data.options.projects.find((o) => o.name === p.key);
              return (
                <Link
                  key={p.key}
                  href={
                    project
                      ? `/analytics?${buildUsageQuery(sp, { project: project.id, page: undefined })}`
                      : `/analytics?${buildUsageQuery(sp, { page: undefined })}`
                  }
                  className="row-hover -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: accentForName(p.key) }} />
                  <span className="truncate text-[12px] text-ink-muted">{p.key}</span>
                  <span className="ml-auto font-mono text-[11px] tabular text-ink">{formatUSD(p.costUsd)}</span>
                  <span className="w-14 text-right font-mono text-[10px] text-ink-faint">
                    {formatPercent(pct(p.costUsd, data.totals.costUsd), 0)}
                  </span>
                </Link>
              );
            })}
            {data.byProject.length === 0 ? (
              <div className="py-6 text-center text-[11.5px] text-ink-faint">No project attribution in range.</div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardTopBar>
            <div className="text-[12.5px] font-medium text-ink">By environment</div>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Drill down</span>
          </CardTopBar>
          <CardContent className="pt-2">
            {data.byEnvironment.map((p) => (
              <Link
                key={p.key}
                href={`/analytics?${buildUsageQuery(sp, { environment: p.key, page: undefined })}`}
                className="row-hover -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
              >
                <Badge
                  variant={p.key === "production" ? "good" : p.key === "staging" ? "info" : "outline"}
                  className="px-1.5 py-0 text-[8.5px]"
                >
                  {p.key}
                </Badge>
                <span className="ml-auto font-mono text-[11px] tabular text-ink">{formatUSD(p.costUsd)}</span>
                <span className="w-14 text-right font-mono text-[10px] text-ink-faint">{formatInt(p.requests)} req</span>
              </Link>
            ))}
            {data.byEnvironment.length === 0 ? (
              <div className="py-6 text-center text-[11.5px] text-ink-faint">No environment attribution in range.</div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-3.5 text-ink-faint" />
            <span className="text-[12.5px] font-medium text-ink">Request explorer</span>
            <span className="font-mono text-[10px] text-ink-faint">
              {formatInt(data.totalEvents)} matching · page {data.page} of {totalPages}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon-sm" aria-disabled={data.page <= 1}>
              <Link
                href={`/analytics?${buildUsageQuery(sp, { page: Math.max(data.page - 1, 1) })}`}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-3.5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="icon-sm" aria-disabled={data.page >= totalPages}>
              <Link
                href={`/analytics?${buildUsageQuery(sp, { page: Math.min(data.page + 1, totalPages) })}`}
                aria-label="Next page"
              >
                <ChevronRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </CardTopBar>

        {data.events.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Timestamp · UTC</TableHead>
                <TableHead>Feature</TableHead>
                <TableHead>Project / env</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">In / cached / out</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-5 font-mono text-[10.5px] tabular text-ink-faint">
                    {formatDateTimeUTC(e.occurredAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] text-ink-muted">{e.feature}</span>
                      {e.isSynthetic ? (
                        <Badge variant="outline" className="px-1 py-0 text-[8px]">
                          syn
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-[11.5px] text-ink-muted">{e.projectName}</div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">{e.environment}</div>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-faint">
                      <ProviderLogo provider={e.provider} size={12} decorative />
                      {e.model}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-faint">
                    {formatInt(e.inputTokens)} / {formatInt(e.cachedInputTokens)} / {formatInt(e.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-faint">
                    {formatMs(e.latencyMs)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        "font-mono text-[10.5px] tabular",
                        e.statusCode >= 500
                          ? "text-[#FDA4AF]"
                          : e.statusCode >= 400
                            ? "text-[#FCD34D]"
                            : "text-ink-faint",
                      )}
                    >
                      {e.statusCode}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular text-ink">
                    {formatUSD(e.costUsd)}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button asChild variant="ghost" size="icon-sm" aria-label="Inspect request">
                      <Link href={`/analytics/requests/${e.id}`}>
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              title="No requests match these filters"
              description="Widen the date range, clear filters, or ingest events with the API to populate the explorer."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href="/analytics">
                    <ArrowLeft className="size-3.5" />
                    Reset filters
                  </Link>
                </Button>
              }
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline-faint px-5 py-3">
          <span className="font-mono text-[10px] text-ink-faint">
            Showing {formatInt(data.totalEvents ? (data.page - 1) * data.pageSize + 1 : 0)}–
            {formatInt(Math.min(data.page * data.pageSize, data.totalEvents))} of {formatInt(data.totalEvents)}
          </span>
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="sm" className="h-7">
              <Link href={`/analytics?${buildUsageQuery(sp, { page: 1 })}`}>First</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-7">
              <Link href={`/analytics?${buildUsageQuery(sp, { page: Math.max(data.page - 1, 1) })}`}>Prev</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-7">
              <Link href={`/analytics?${buildUsageQuery(sp, { page: Math.min(data.page + 1, totalPages) })}`}>Next</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-7">
              <Link href={`/analytics?${buildUsageQuery(sp, { page: totalPages })}`}>Last</Link>
            </Button>
          </div>
        </div>
      </Card>

      <DataNote>
        <Gauge className="size-3.5 shrink-0 text-ink-faint" />
        <span>
          Costs are recomputed from the pricing row effective at event time (versioned catalog). Token counts are
          provider-normalized: cached input is a subset of input for OpenAI; Anthropic cache read/write tokens are
          recombined; Gemini cached content is mapped to cached input. Ratios are measured, not projected.
        </span>
      </DataNote>
    </div>
  );
}
