import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  CircleDollarSign,
  Cpu,
  Database,
  Gauge,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  Timer,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { getDb } from "@/lib/db/client";
import { requireSession } from "@/lib/auth";
import { getCommandCenterData } from "@/lib/analytics";
import { PageHeader, SectionHeader, EmptyState, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BurnBar } from "@/components/burn-bar";
import { MetricCard, MiniStat, ProvenanceBadge } from "@/components/kpi";
import { ProviderLogo } from "@/components/brand/provider-logo";
import {
  CategoryBars,
  ChartContainer,
  ChartLegend,
  CostTrendChart,
  ErrorRateChart,
  LatencyTrendChart,
  MultiSeriesAreaChart,
  ProviderDonut,
  TokenSplitBars,
} from "@/components/charts";
import { SEMANTIC } from "@/lib/chart-colors";
import { providerForModel, providerBrand } from "@/lib/brand/providers";
import {
  cn,
  formatInt,
  formatMs,
  formatPercent,
  formatUSD,
  pct,
  relativeTime,
} from "@/lib/utils";

export default async function DashboardPage() {
  const session = await requireSession();
  const db = await getDb();
  const data = await getCommandCenterData(db, session.org.id);

  const spendDelta =
    data.previous.costUsd > 0 ? (data.mtd.costUsd - data.previous.costUsd) / data.previous.costUsd : null;
  const cacheHitRate = data.mtd.inputTokens > 0 ? data.mtd.cachedTokens / data.mtd.inputTokens : 0;
  const overBudget = data.budgets.filter((b) => b.utilization >= 1);
  const nearBudget = data.budgets.filter((b) => b.utilization >= 0.9 && b.utilization < 1);
  const latestAnomaly = data.anomalyDays[data.anomalyDays.length - 1];
  const totalTokens = data.mtd.inputTokens + data.mtd.outputTokens;
  const failedRequests = Math.round(data.mtd.errorRate * data.mtd.requests);
  const tokenSeries = data.series.map((p) => p.inputTokens + p.outputTokens);
  const errorSeries = data.series.map((p) => ({
    day: p.day,
    errorRatePct: p.requests > 0 ? Math.round((p.errors / p.requests) * 10_000) / 100 : 0,
    errors: p.errors,
  }));
  const tokenFlow = data.series.map((p) => ({
    day: p.day,
    uncached: Math.max(p.inputTokens - p.cachedTokens, 0),
    cached: p.cachedTokens,
    output: p.outputTokens,
  }));
  const modelMax = data.topModels[0]?.costUsd ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={`Overview · ${data.monthLabel}`}
        title="Command Center"
        description="Server-computed spend, budget burn, anomaly detection and ingestion health for this organization."
      >
        <Badge variant="outline">
          {data.daysElapsed} / {data.daysInMonth} days elapsed
        </Badge>
        <Button asChild variant="secondary" size="sm">
          <Link href="/analytics">
            <TrendingUp className="size-3.5" />
            Open analytics
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/coach">
            <Sparkles className="size-3.5" />
            Ask the coach
          </Link>
        </Button>
      </PageHeader>

      {overBudget.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-rose/30 bg-accent-rose/[0.07] px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 text-[#FDA4AF]" aria-hidden />
            <div>
              <div className="text-[12.5px] font-medium text-[#FDA4AF]">
                {overBudget.length} budget{overBudget.length > 1 ? "s" : ""} at or above 100%
              </div>
              <p className="mt-0.5 text-[11.5px] text-ink-muted">
                {overBudget.map((b) => `${b.name} (${formatUSD(b.spentUsd)} / ${formatUSD(b.limitUsd)})`).join(" · ")}
                {overBudget.some((b) => b.hardLimit) ? " — hard limits active, routing will deny over-budget requests." : ""}
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/governance">
              Review governance
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      ) : nearBudget.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-amber/30 bg-accent-amber/[0.06] px-4 py-3">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 size-4 text-accent-amber" aria-hidden />
            <div>
              <div className="text-[12.5px] font-medium text-[#FCD34D]">
                {nearBudget.length} budget{nearBudget.length > 1 ? "s" : ""} above 90%
              </div>
              <p className="mt-0.5 text-[11.5px] text-ink-muted">
                {nearBudget.map((b) => `${b.name} at ${(b.utilization * 100).toFixed(0)}%`).join(" · ")}
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/alerts">View alerts</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <MetricCard
          label="Month-to-date spend"
          value={formatUSD(data.mtd.costUsd)}
          delta={spendDelta}
          deltaLabel="vs. same days last month"
          hint={`Projected ${formatUSD(data.projectedCostUsd)} at current run rate`}
          trend={data.series.slice(-14).map((p) => p.costUsd)}
          accent="blue"
          icon={CircleDollarSign}
        />
        <MetricCard
          label="Tokens consumed"
          value={formatInt(totalTokens)}
          hint={`${formatInt(data.mtd.inputTokens)} input · ${formatInt(data.mtd.outputTokens)} output`}
          trend={tokenSeries.slice(-14)}
          accent="violet"
          icon={Cpu}
        />
        <MetricCard
          label="Requests (MTD)"
          value={formatInt(data.mtd.requests)}
          hint={`${formatInt(data.events24h)} in the last 24h · ${formatInt(data.mtd.requests / Math.max(data.daysElapsed, 1))}/day avg`}
          trend={data.series.slice(-14).map((p) => p.requests)}
          accent="cyan"
          icon={Activity}
        />
        <MetricCard
          label="Avg cost / request"
          value={formatUSD(data.mtd.avgCost, true)}
          hint={`Blended across ${formatInt(data.mtd.activeModels)} active models`}
          accent="indigo"
          icon={Wallet}
        />
        <MetricCard
          label="Avg latency"
          value={formatMs(data.mtd.avgLatency)}
          hint="Server-side provider latency across all usage events"
          accent="teal"
          icon={Timer}
        />
        <MetricCard
          label="Verified savings"
          value={formatUSD(data.gateway.realizedSavingsUsd)}
          hint={
            data.gateway.requests > 0
              ? `Realized on ${formatInt(data.gateway.requests)} gateway requests · provider-reported usage`
              : "No gateway traffic this month"
          }
          accent="emerald"
          icon={ShieldCheck}
          provenance="verified"
          hintTone="good"
        />
        <MetricCard
          label="Projected savings"
          value={formatUSD(data.gateway.estimatedSavingsUsd)}
          hint="Baseline minus selected estimate at routing time · not realized"
          accent="purple"
          icon={Sparkles}
          provenance="projected"
        />
        <MetricCard
          label="Failed requests"
          value={formatInt(failedRequests)}
          hint={`${formatPercent(data.mtd.errorRate)} error rate MTD`}
          tone={failedRequests > 0 ? "warn" : "default"}
          accent="rose"
          icon={AlertTriangle}
          sparklineColor={SEMANTIC.errors}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartContainer
          title="Spend · last 30 days"
          description="Normalized usage events priced server-side · USD"
          className="lg:col-span-2"
          action={
            <span className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">30d total</span>
              <span className="font-mono text-[12px] tabular text-ink">
                {formatUSD(data.series.reduce((s, p) => s + p.costUsd, 0))}
              </span>
            </span>
          }
        >
          <CostTrendChart data={data.series} height={248} />
        </ChartContainer>

        <Card>
          <CardTopBar>
            <div>
              <div className="text-[12.5px] font-medium text-ink">Provider distribution</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">MTD spend</div>
            </div>
          </CardTopBar>
          <CardContent className="pt-3">
            <ProviderDonut
              data={data.providers.map((p) => ({ name: p.provider, value: p.costUsd }))}
              centerValue={formatUSD(data.mtd.costUsd)}
              centerLabel="total"
              height={188}
              colorMode="provider"
            />
            <div className="mt-3 space-y-1.5">
              {data.providers.slice(0, 5).map((p) => (
                <div key={p.provider} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-2 text-ink-faint">
                    <ProviderLogo provider={p.provider} size={13} decorative />
                    {providerBrand(p.provider).short}
                  </span>
                  <span className="font-mono tabular text-ink-muted">
                    {formatUSD(p.costUsd)} · {formatPercent(pct(p.costUsd, data.mtd.costUsd), 0)}
                  </span>
                </div>
              ))}
              {data.providers.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-ink-faint">No provider usage yet.</div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartContainer
          title="Token consumption"
          description="Uncached input, cached input and output tokens per day"
          className="lg:col-span-2"
          legend={
            <ChartLegend
              items={[
                { label: "Uncached input", color: SEMANTIC.input },
                { label: "Cached input", color: SEMANTIC.cached },
                { label: "Output", color: SEMANTIC.output },
              ]}
              columns={3}
            />
          }
        >
          <MultiSeriesAreaChart
            data={tokenFlow}
            series={[
              { key: "uncached", name: "Uncached input", color: SEMANTIC.input },
              { key: "cached", name: "Cached input", color: SEMANTIC.cached },
              { key: "output", name: "Output", color: SEMANTIC.output },
            ]}
            height={248}
          />
        </ChartContainer>

        <Card>
          <CardTopBar>
            <div>
              <div className="text-[12.5px] font-medium text-ink">Model distribution</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Top models · MTD</div>
            </div>
            <Link href="/studio" className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-white">
              Simulate
            </Link>
          </CardTopBar>
          <CardContent className="space-y-2.5 pt-4">
            {data.topModels.length ? (
              data.topModels.map((m) => {
                const brand = providerForModel(m.key);
                return (
                  <div key={m.key} className="flex items-center gap-2.5">
                    <ProviderLogo provider={brand.id} size={14} decorative />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-ink-muted">{m.key}</span>
                        <span className="shrink-0 font-mono text-[10.5px] tabular text-ink">{formatUSD(m.costUsd)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                        <div
                          className="h-full rounded-full transition-[width] duration-500"
                          style={{
                            width: `${Math.max(pct(m.costUsd, modelMax) * 100, 2)}%`,
                            background: brand.color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-[11.5px] text-ink-faint">No model usage yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartContainer
          title="Input vs output tokens"
          description="Stacked daily token split · last 30 days"
          className="lg:col-span-2"
          legend={
            <ChartLegend
              items={[
                { label: "Uncached input", color: SEMANTIC.input },
                { label: "Cached input", color: SEMANTIC.cached },
                { label: "Output", color: SEMANTIC.output },
              ]}
              columns={3}
            />
          }
        >
          <TokenSplitBars
            data={tokenFlow}
            height={230}
            series={[
              { key: "uncached", name: "Uncached input", color: SEMANTIC.input },
              { key: "cached", name: "Cached input", color: SEMANTIC.cached },
              { key: "output", name: "Output", color: SEMANTIC.output },
            ]}
          />
        </ChartContainer>

        <Card>
          <CardTopBar>
            <div className="text-[12.5px] font-medium text-ink">Budget burn</div>
            <Link href="/governance" className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-white">
              Manage
            </Link>
          </CardTopBar>
          <CardContent className="space-y-4 pt-4">
            {data.budgets.length ? (
              data.budgets.map((b) => (
                <div key={b.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="truncate text-[12px] text-ink-muted">{b.name}</span>
                    <Badge
                      variant={b.utilization >= 1 ? "bad" : b.utilization >= 0.9 ? "warn" : "outline"}
                      className="px-1.5 py-0 text-[8.5px]"
                    >
                      {b.period}
                    </Badge>
                  </div>
                  <BurnBar spent={b.spentUsd} limit={b.limitUsd} thresholds={b.thresholds} />
                </div>
              ))
            ) : (
              <EmptyState
                title="No budgets yet"
                description="Set monthly or daily budgets per organization, project or feature."
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/governance">Create budget</Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartContainer
          title="Spend by feature"
          description="Project / feature attribution · MTD"
          className="lg:col-span-2"
        >
          <CategoryBars
            data={data.topFeatures.map((f) => ({ key: f.key, costUsd: f.costUsd }))}
            height={230}
            maxItems={7}
            colorMode="accent"
          />
        </ChartContainer>

        <Card>
          <CardTopBar>
            <div className="text-[12.5px] font-medium text-ink">Ingestion health</div>
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  data.lastEventAt && Date.now() - data.lastEventAt.getTime() < 3_600_000
                    ? "animate-pulse-dot bg-accent-emerald shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                    : "bg-neutral-500",
                )}
              />
              {data.lastEventAt && Date.now() - data.lastEventAt.getTime() < 3_600_000 ? "Live" : "Recent"}
            </span>
          </CardTopBar>
          <CardContent className="pt-2">
            <MiniStat label="Requests · MTD" value={formatInt(data.mtd.requests)} />
            <MiniStat
              label="Error rate"
              value={formatPercent(data.mtd.errorRate)}
              tone={data.mtd.errorRate > 0.04 ? "bad" : data.mtd.errorRate > 0.02 ? "warn" : "good"}
            />
            <MiniStat label="Avg latency" value={formatMs(data.mtd.avgLatency)} />
            <MiniStat
              label="Cache hit rate"
              value={formatPercent(cacheHitRate)}
              tone={cacheHitRate >= 0.35 ? "good" : cacheHitRate < 0.15 ? "warn" : "default"}
            />
            <MiniStat label="Active features" value={formatInt(data.mtd.activeFeatures)} />
            <MiniStat label="Last event" value={data.lastEventAt ? relativeTime(data.lastEventAt) : "—"} />
            <MiniStat label="Events · 24h" value={formatInt(data.events24h)} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartContainer title="Latency trend" description="Average and P95 provider latency · last 30 days">
          <LatencyTrendChart
            data={data.series.map((p) => ({
              day: p.day,
              averageLatencyMs: p.avgLatencyMs,
              p95LatencyMs: p.p95LatencyMs,
            }))}
            height={220}
          />
        </ChartContainer>

        <ChartContainer
          title="Error rate"
          description="Share of requests with a 4xx/5xx status · last 30 days"
          action={<Badge variant={data.mtd.errorRate > 0.04 ? "bad" : "good"}>{formatPercent(data.mtd.errorRate)} MTD</Badge>}
        >
          <ErrorRateChart data={errorSeries} height={220} />
        </ChartContainer>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <Database className="size-3.5 text-ink-faint" />
              Project spend
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">MTD</span>
          </CardTopBar>
          <CardContent className="pt-2">
            {data.projectSpend.length ? (
              data.projectSpend.map((p) => (
                <Link
                  key={p.projectId}
                  href={`/projects/${p.projectId}`}
                  className="row-hover -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
                >
                  <div className="flex size-7 items-center justify-center rounded-[6px] border border-hairline bg-white/[0.03] font-mono text-[9px] text-ink-muted">
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-ink-muted">{p.name}</div>
                    <div className="font-mono text-[9.5px] text-ink-faint">{formatInt(p.requests)} requests</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[11.5px] tabular text-ink">{formatUSD(p.costUsd)}</div>
                    <div className="font-mono text-[9px] text-ink-faint">
                      {formatPercent(pct(p.costUsd, data.mtd.costUsd), 0)} of total
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="py-6 text-center text-[11.5px] text-ink-faint">No projects recorded yet.</div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="relative overflow-hidden">
            <div className="grid-etch pointer-events-none absolute inset-0 opacity-40" />
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                <Lightbulb className="size-3.5 text-accent-amber" />
                Savings opportunity
              </div>
              <ProvenanceBadge kind="estimated" />
            </CardTopBar>
            <CardContent className="relative pt-4">
              <div className="font-num text-[26px] leading-none tabular text-ink">
                {formatUSD(data.savingsOpportunityUsd)}
                <span className="ml-1.5 font-sans text-[11px] font-normal text-ink-faint">/ month</span>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
                Across {formatInt(data.recommendationCount)} open recommendation
                {data.recommendationCount === 1 ? "" : "s"}, one primary lever per feature. Estimates recompute from
                measured events and are labeled until verified in production.
              </p>
              <Button asChild variant="secondary" size="sm" className="mt-3">
                <Link href="/coach">
                  Review recommendations
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardTopBar>
              <div className="text-[12.5px] font-medium text-ink">Anomaly scan</div>
              <Badge variant={latestAnomaly ? "warn" : "good"}>{latestAnomaly ? "1 detected" : "Nominal"}</Badge>
            </CardTopBar>
            <CardContent className="pt-4">
              {latestAnomaly ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 size-4 text-accent-amber" />
                    <div>
                      <div className="text-[12px] text-ink">
                        {formatUSD(latestAnomaly.costUsd)} on {latestAnomaly.day}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                        {latestAnomaly.zScore.toFixed(1)}σ above the 30-day baseline of {formatUSD(latestAnomaly.baseline)}
                        /day. Cost-spike rules and the coach use this series for evidence.
                      </p>
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/coach?focus=anomaly">Explain this anomaly</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 text-[12px] text-ink-muted">
                    <Gauge className="size-4 text-ink-faint" />
                    No day in the last 7 exceeded the anomaly threshold.
                  </div>
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    Scanning daily spend against a trailing 30-day baseline (z ≥ 1.8).
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
            <BellRing className="size-3.5 text-ink-faint" />
            Recent alerts
          </div>
          <Link href="/alerts" className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-white">
            Inbox
          </Link>
        </CardTopBar>
        <CardContent className="grid gap-x-8 pt-2 md:grid-cols-2">
          {data.recentAlerts.length ? (
            data.recentAlerts.map((a) => (
              <Link key={a.id} href="/alerts" className="row-hover -mx-2 flex min-w-0 items-start gap-3 rounded-md px-2 py-2.5">
                <span
                  className={cn(
                    "mt-1 size-1.5 shrink-0 rounded-full",
                    a.severity === "critical"
                      ? "bg-accent-rose"
                      : a.severity === "warning"
                        ? "bg-accent-amber"
                        : "bg-neutral-400",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] text-ink-muted">{a.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-faint">
                    <span>{relativeTime(a.createdAt)}</span>
                    <span className="text-ink-faint/50">·</span>
                    <span>{a.status}</span>
                  </div>
                </div>
                <Badge
                  variant={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "default"}
                  className="px-1.5 py-0 text-[8px]"
                >
                  {a.severity}
                </Badge>
              </Link>
            ))
          ) : (
            <div className="py-6 text-center text-[11.5px] text-ink-faint md:col-span-2">No alerts raised yet.</div>
          )}
        </CardContent>
      </Card>

      <DataNote>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Data provenance</span>
        <span>
          All figures are computed server-side from normalized usage events. Seeded events are marked{" "}
          <span className="font-mono text-[10px] text-ink-muted">is_synthetic = true</span> and shown with the Synthetic
          badge in the sidebar. Verified savings come only from gateway requests whose usage was provider-reported;
          projected savings are the baseline-minus-selected estimate captured at routing time.
        </span>
      </DataNote>

      <SectionHeader title="Next actions" hint="Every surface is wired to the same event store" className="pt-1" />
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            href: "/analytics",
            title: "Trace expensive requests",
            body: "Filter by feature, model or error status in the request explorer and export CSV.",
          },
          {
            href: "/studio",
            title: "Simulate a cheaper route",
            body: "Compare current spend against downgrade, caching and output-cap scenarios.",
          },
          {
            href: "/governance",
            title: "Tighten guardrails",
            body: "Hard limits, model allowlists, fallback models and an approval trail for routing changes.",
          },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="panel hairline-top group p-4 transition-all hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-lift"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-ink">{c.title}</span>
              <ArrowRight className="size-3.5 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
