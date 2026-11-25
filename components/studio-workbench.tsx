"use client";

import * as React from "react";
import { ArrowRight, Calculator, ChevronDown, Database, Gauge, Info, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { compareModels, cacheLadder, forecastMonth, simulate } from "@/lib/studio";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { ProvenanceBadge } from "@/components/kpi";
import { cn, formatInt, formatMs, formatPercent, formatUSD, pct } from "@/lib/utils";

export type StudioModel = {
  key: string;
  label: string;
  provider: string;
  model: string;
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  cacheWritePerM: number | null;
  qualityScore: number;
  latencyMs: number;
  contextWindow: number;
  maxOutput: number;
  category: string;
};

export type StudioBaseline = {
  key: string;
  label: string;
  requests: number;
  avgInput: number;
  avgOutput: number;
  cachedShare: number;
  costUsd: number;
};

type Workload = {
  requests: number;
  avgInput: number;
  avgOutput: number;
  cachedShare: number;
};

function FieldInline({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="kicker">{label}</span>
        {hint ? <span className="text-[10px] text-ink-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Slider({
  value,
  onChange,
  min,
  max,
  step,
  label,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
  suffix: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="kicker">{label}</span>
        <span className="font-mono text-[11px] tabular text-ink-muted">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#303030] accent-[#D4D4D8]"
      />
    </div>
  );
}

export function StudioWorkbench({
  models,
  baselines,
  forecast,
}: {
  models: StudioModel[];
  baselines: StudioBaseline[];
  forecast: { mtdCost: number; dayOfMonth: number; daysInMonth: number; last30dCost: number };
}) {
  const chatModels = React.useMemo(
    () => models.filter((m) => m.category !== "embedding"),
    [models],
  );
  const defaultBaseline = baselines[0] ?? null;
  const defaultCurrent = chatModels.find((m) => m.key === defaultBaseline?.key) ?? chatModels[0];
  const defaultCandidate = chatModels[chatModels.length - 1] ?? chatModels[0];

  const [baselineKey, setBaselineKey] = React.useState<string>(defaultBaseline?.key ?? "custom");
  const [requests, setRequests] = React.useState(defaultBaseline?.requests ?? 100_000);
  const [avgInput, setAvgInput] = React.useState(defaultBaseline?.avgInput ?? 8_000);
  const [avgOutput, setAvgOutput] = React.useState(defaultBaseline?.avgOutput ?? 600);
  const [cachedShare, setCachedShare] = React.useState(defaultBaseline ? Math.round(defaultBaseline.cachedShare * 100) : 0);
  const [currentKey, setCurrentKey] = React.useState(defaultCurrent?.key ?? "");
  const [candidateKey, setCandidateKey] = React.useState(defaultCandidate?.key ?? "");
  const [inputReduction, setInputReduction] = React.useState(0);
  const [outputReduction, setOutputReduction] = React.useState(0);
  const [growth, setGrowth] = React.useState(10);

  const current = chatModels.find((m) => m.key === currentKey) ?? chatModels[0];
  const candidate = chatModels.find((m) => m.key === candidateKey) ?? chatModels[0];
  const workload: Workload = { requests, avgInput, avgOutput, cachedShare: cachedShare / 100 };

  const rows = React.useMemo(() => {
    const rowWorkload: Workload = { requests, avgInput, avgOutput, cachedShare: cachedShare / 100 };
    return chatModels
      .map((m) => ({
        model: m,
        cost: simulate(m, rowWorkload).costUsd,
        fit: avgInput + avgOutput <= m.contextWindow && avgOutput <= m.maxOutput,
      }))
      .sort((a, b) => a.cost - b.cost);
  }, [chatModels, requests, avgInput, avgOutput, cachedShare]);

  if (!current || !candidate) {
    return <Card><CardContent className="py-6 text-xs text-ink-faint">No pricing catalog is available.</CardContent></Card>;
  }

  const comparison = compareModels(current, candidate, workload, {
    inputReduction: inputReduction / 100,
    outputReduction: outputReduction / 100,
  });
  const { baseline: baselineResult, optimized: optimizedResult } = comparison;
  const currentCost = baselineResult.costUsd;
  const candidateCost = optimizedResult.costUsd;
  const delta = comparison.deltaUsd;
  const savingsPct = comparison.deltaPct;
  const qualityDelta = comparison.qualityDelta;
  const contextFit = comparison.contextFit;
  const outputFit = comparison.outputFit;
  const baseline = baselines.find((b) => b.key === baselineKey);

  const ladderRows = cacheLadder(current, workload);

  const routingRatio = currentCost > 0 ? candidateCost / currentCost : 1;
  const forecastResult = forecastMonth({
    mtdCost: forecast.mtdCost,
    dayOfMonth: forecast.dayOfMonth,
    daysInMonth: forecast.daysInMonth,
    growthPct: growth,
    routingRatio,
  });
  const dailyRate = forecastResult.dailyRate;
  const projected = forecastResult.projected;
  const projectedRouted = forecastResult.projectedRouted;

  function applyBaseline(key: string) {
    setBaselineKey(key);
    const b = baselines.find((x) => x.key === key);
    if (!b) return;
    setRequests(b.requests);
    setAvgInput(b.avgInput);
    setAvgOutput(b.avgOutput);
    setCachedShare(Math.round(b.cachedShare * 100));
    setCurrentKey(b.key);
  }

  const numOr = (raw: string, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <Calculator className="size-3.5 text-ink-faint" /> Workload simulator
            </div>
            <Badge variant="outline">Authoritative pricing engine</Badge>
          </CardTopBar>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldInline label="Load measured workload" hint={baseline ? `${formatUSD(baseline.costUsd)} / 30d` : undefined}>
                <select
                  value={baselineKey}
                  onChange={(e) => applyBaseline(e.target.value)}
                  className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink focus-visible:border-[#6B6B6B] focus-visible:outline-none"
                >
                  <option value="custom">Custom scenario</option>
                  {baselines.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.label} · {formatInt(b.requests)} req
                    </option>
                  ))}
                </select>
              </FieldInline>
              <FieldInline label="Requests / month" hint="scaled to 30 days">
                <Input
                  type="number"
                  min={1}
                  value={requests}
                  onChange={(e) => setRequests(Math.max(1, numOr(e.target.value, requests)))}
                  className="font-mono tabular"
                />
              </FieldInline>
              <FieldInline label="Avg input tokens / request">
                <Input
                  type="number"
                  min={1}
                  value={avgInput}
                  onChange={(e) => setAvgInput(Math.max(1, numOr(e.target.value, avgInput)))}
                  className="font-mono tabular"
                />
              </FieldInline>
              <FieldInline label="Avg output tokens / request">
                <Input
                  type="number"
                  min={0}
                  value={avgOutput}
                  onChange={(e) => setAvgOutput(Math.max(0, numOr(e.target.value, avgOutput)))}
                  className="font-mono tabular"
                />
              </FieldInline>
            </div>

            <Slider
              label="Cached input share"
              value={cachedShare}
              onChange={(v) => setCachedShare(v)}
              min={0}
              max={100}
              step={5}
              suffix="%"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <FieldInline label="Current model">
                <div className="relative">
                  <ProviderLogo
                    provider={current.provider}
                    size={13}
                    decorative
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                  />
                  <select
                    value={current.key}
                    onChange={(e) => setCurrentKey(e.target.value)}
                    className="h-9 w-full appearance-none rounded-md border border-hairline-strong bg-[#0D0D0D] pl-8 pr-7 text-[12px] text-ink focus-visible:border-[#6B6B6B] focus-visible:outline-none"
                  >
                    {chatModels.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-faint" />
                </div>
              </FieldInline>
              <FieldInline label="Candidate model">
                <div className="relative">
                  <ProviderLogo
                    provider={candidate.provider}
                    size={13}
                    decorative
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                  />
                  <select
                    value={candidate.key}
                    onChange={(e) => setCandidateKey(e.target.value)}
                    className="h-9 w-full appearance-none rounded-md border border-hairline-strong bg-[#0D0D0D] pl-8 pr-7 text-[12px] text-ink focus-visible:border-[#6B6B6B] focus-visible:outline-none"
                  >
                    {chatModels.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-faint" />
                </div>
              </FieldInline>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Slider
                label="Assumed context reduction"
                value={inputReduction}
                onChange={setInputReduction}
                min={0}
                max={50}
                step={5}
                suffix="%"
              />
              <Slider
                label="Assumed output reduction (cap scenario)"
                value={outputReduction}
                onChange={setOutputReduction}
                min={0}
                max={50}
                step={5}
                suffix="%"
              />
            </div>
            <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-ink-faint">
              <Info className="mt-0.5 size-3 shrink-0" />
              Reductions are what-if assumptions applied uniformly to every request, not measured results. Validate
              answer completeness and recall before setting context trimming or max_tokens in production.
            </p>

            <div className="rounded-md border border-hairline-faint bg-black/25 px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[10.5px] text-ink-faint">
                <span>
                  Baseline tokens per month{" "}
                  <span className="ml-1 font-mono tabular text-ink-muted">
                    {formatInt(baselineResult.inputTokens)}
                  </span>{" "}
                  in /{" "}
                  <span className="font-mono tabular text-ink-muted">{formatInt(baselineResult.outputTokens)}</span> out
                </span>
                <span>
                  Optimized{" "}
                  <span className="ml-1 font-mono tabular text-ink">
                    {formatInt(optimizedResult.inputTokens)}
                  </span>{" "}
                  in /{" "}
                  <span className="font-mono tabular text-ink">{formatInt(optimizedResult.outputTokens)}</span> out
                </span>
              </div>
              {inputReduction || outputReduction ? (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] tabular text-[#6EE7B7]">
                  <span>−{formatPercent(comparison.inputTokenDeltaPct)} input tokens</span>
                  <span>−{formatPercent(comparison.outputTokenDeltaPct)} output tokens</span>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <TrendingUp className="size-3.5 text-ink-faint" /> Comparison
              </div>
              <span className="flex items-center gap-1.5">
                <ProvenanceBadge kind="estimated" />
                <Badge variant={delta >= 0 ? "good" : "bad"}>{delta >= 0 ? "saves" : "costs more"}</Badge>
              </span>
            </CardTopBar>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-center gap-2 text-[11.5px] text-ink-muted">
                <ProviderLogo provider={current.provider} size={13} decorative />
                <span className="truncate">{current.label}</span>
                <ArrowRight className="size-3 shrink-0 text-ink-faint" />
                <ProviderLogo provider={candidate.provider} size={13} decorative />
                <span className="truncate text-ink">{candidate.label}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-hairline-faint bg-black/25 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">Current</div>
                  <div className="mt-1 font-num text-[16px] tabular text-ink">{formatUSD(currentCost)}</div>
                </div>
                <div className="rounded-md border border-hairline-faint bg-black/25 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">Candidate</div>
                  <div className="mt-1 font-num text-[16px] tabular text-ink">{formatUSD(candidateCost)}</div>
                </div>
              </div>
              <div className="space-y-1.5" aria-hidden>
                {[
                  { label: "Before", value: currentCost, color: "#3B82F6" },
                  { label: "After", value: candidateCost, color: delta >= 0 ? "#10B981" : "#FB7185" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2">
                    <span className="w-10 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">
                      {row.label}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className="h-full rounded-full transition-[width] duration-300"
                        style={{
                          width: `${Math.max(3, pct(row.value, Math.max(currentCost, candidateCost, 1)) * 100)}%`,
                          background: row.color,
                        }}
                      />
                    </div>
                    <span className="w-16 text-right font-mono text-[10px] tabular text-ink-muted">
                      {formatUSD(row.value)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-hairline-faint pt-2.5">
                <span className="text-[11px] text-ink-faint">Monthly delta</span>
                <span className={cn("font-num text-[18px] tabular", delta >= 0 ? "text-[#6EE7B7]" : "text-[#FDA4AF]")}>
                  {delta >= 0 ? "−" : "+"}
                  {formatUSD(Math.abs(delta))}
                  <span className="ml-1 font-mono text-[10px] text-ink-faint">{formatPercent(Math.abs(savingsPct))}</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10.5px] text-ink-faint">
                <div className="flex justify-between gap-2">
                  <span>Quality (catalog)</span>
                  <span className={cn("tabular", qualityDelta < 0 ? "text-[#FCD34D]" : "text-ink-muted")}>
                    {qualityDelta > 0 ? "+" : ""}
                    {qualityDelta}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Latency (catalog)</span>
                  <span className={cn("tabular", comparison.latencyDeltaMs > 0 ? "text-[#FCD34D]" : "text-ink-muted")}>
                    {formatMs(candidate.latencyMs)}
                    <span className="ml-1 text-ink-faint">
                      ({comparison.latencyDeltaMs > 0 ? "+" : ""}
                      {formatMs(comparison.latencyDeltaMs)})
                    </span>
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Context fit</span>
                  <span className={contextFit ? "text-[#6EE7B7]" : "text-[#FDA4AF]"}>{contextFit ? "yes" : "over"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Max output</span>
                  <span className={outputFit ? "text-[#6EE7B7]" : "text-[#FDA4AF]"}>{outputFit ? "fits" : "over"}</span>
                </div>
              </div>
              {!contextFit || !outputFit ? (
                <p className="rounded-md border border-accent-rose/30 bg-accent-rose/[0.07] px-2.5 py-2 text-[10.5px] text-[#FDA4AF]">
                  This workload exceeds the candidate&apos;s {contextFit ? "max output" : "context window"}. Truncate context
                  or choose a larger model before routing.
                </p>
              ) : null}
              {qualityDelta !== 0 || comparison.latencyDeltaMs > 0 ? (
                <p className="text-[10px] leading-relaxed text-ink-faint">
                  Quality and latency deltas are catalog approximations, not benchmark results. Run your eval set before
                  treating this route as equivalent.
                </p>
              ) : null}
              <Button
                asChild
                variant="outline"
                size="sm"
                className="w-full"
              >
                <a href={`/router?model=${encodeURIComponent(candidate.key)}&current=${encodeURIComponent(current.key)}`}>
                  Draft a routing policy <ArrowRight />
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <TrendingUp className="size-3.5 text-ink-faint" /> Month-end forecast
              </div>
              <ProvenanceBadge kind="projected" />
            </CardTopBar>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-baseline justify-between gap-2 text-[11px] text-ink-faint">
                <span>MTD spend</span>
                <span className="font-mono tabular text-ink-muted">{formatUSD(forecast.mtdCost)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2 text-[11px] text-ink-faint">
                <span>Last 30 days (measured)</span>
                <span className="font-mono tabular text-ink-muted">{formatUSD(forecast.last30dCost)}</span>
              </div>
              <Slider
                label="Month-over-month growth"
                value={growth}
                onChange={setGrowth}
                min={-20}
                max={50}
                step={5}
                suffix="%"
              />
              <div className="rounded-md border border-hairline-faint bg-black/25 px-3 py-2.5">
                <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">Projected month-end</div>
                <div className="mt-1 font-num text-[18px] tabular text-[#C4B5FD]">{formatUSD(projected)}</div>
                {Math.abs(routingRatio - 1) > 0.005 ? (
                  <div className="mt-1 text-[10.5px] text-ink-faint">
                    {formatUSD(projectedRouted)} if candidate routing applied
                  </div>
                ) : null}
              </div>
              <p className="text-[10.5px] leading-relaxed text-ink-faint">
                Run-rate extrapolation from {formatUSD(dailyRate)}/day across {forecast.daysInMonth} days. Routing impact
                assumes every request moves to the candidate — a ceiling, not a forecast.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            <Gauge className="size-3.5 text-ink-faint" /> Model comparison
          </div>
          <span className="text-[10.5px] text-ink-faint">Same workload · {formatInt(requests)} requests · {formatInt(avgInput)} in / {formatInt(avgOutput)} out</span>
        </CardTopBar>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Quality</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Context</TableHead>
                <TableHead className="text-right">Monthly cost</TableHead>
                <TableHead className="text-right">Δ vs current</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ model: m, cost, fit }) => {
                const isCurrent = m.key === current.key;
                const isCandidate = m.key === candidate.key;
                const diff = currentCost - cost;
                return (
                  <TableRow
                    key={m.key}
                    onClick={() => setCandidateKey(m.key)}
                    className={cn(
                      "cursor-pointer",
                      isCurrent && "bg-white/[0.03]",
                      isCandidate && !isCurrent && "bg-white/[0.02]",
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProviderLogo provider={m.provider} size={13} decorative />
                        <span className="font-medium text-ink">{m.label}</span>
                        <span className="font-mono text-[9.5px] uppercase text-ink-faint">{m.provider}</span>
                        {isCurrent ? <Badge variant="outline">current</Badge> : null}
                        {isCandidate && !isCurrent ? <Badge variant="chrome">candidate</Badge> : null}
                        {!fit ? <Badge variant="bad">no fit</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular text-ink-muted">{m.qualityScore}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular text-ink-muted">{formatMs(m.latencyMs)}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular text-ink-muted">{formatInt(m.contextWindow)}</TableCell>
                    <TableCell className="text-right font-mono text-[11.5px] tabular text-ink">{formatUSD(cost)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-[11px] tabular",
                        diff > 0 ? "text-[#6EE7B7]" : diff < 0 ? "text-[#FDA4AF]" : "text-ink-faint",
                      )}
                    >
                      {diff === 0 ? "—" : `${diff > 0 ? "−" : "+"}${formatUSD(Math.abs(diff))}`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <Database className="size-3.5 text-ink-faint" /> Caching simulation
            </div>
            <span className="text-[10.5px] text-ink-faint">{current.label}</span>
          </CardTopBar>
          <CardContent className="space-y-3 pt-4">
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              Reprices the same tokens at {current.label} cache rates as the cached prefix share grows. Cache writes are
              excluded — assume steady-state hits.
            </p>
            <div className="space-y-1">
              {ladderRows.map((row) => {
                const saved = row.savedUsd;
                const active = cachedShare === row.sharePct;
                return (
                  <button
                    key={row.sharePct}
                    type="button"
                    onClick={() => setCachedShare(row.sharePct)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                      active
                        ? "border-hairline-strong bg-white/[0.05]"
                        : "border-transparent hover:border-hairline hover:bg-white/[0.02]",
                    )}
                  >
                    <span className="font-mono text-[11px] tabular text-ink-muted">{row.sharePct}% cached</span>
                    <span className="flex items-center gap-4">
                      <span className="font-mono text-[11px] tabular text-ink">{formatUSD(row.costUsd)}</span>
                      <span className={cn("w-20 text-right font-mono text-[10.5px] tabular", saved > 0 ? "text-[#6EE7B7]" : "text-ink-faint")}>
                        {saved > 0 ? `−${formatUSD(saved)}` : "baseline"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10.5px] text-ink-faint">
              Cached share is a share of input tokens, not a hit rate. Real caching also needs a stable prefix and
              provider-specific minimums.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <Gauge className="size-3.5 text-ink-faint" /> Output cap sensitivity
            </div>
            <span className="text-[10.5px] text-ink-faint">{current.label}</span>
          </CardTopBar>
          <CardContent className="space-y-3 pt-4">
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              Output tokens dominate cost on verbose features. This what-if reduces average output by the selected share
              and reprices the workload.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[10, 20, 30].map((pct) => {
                const cost = simulate(current, workload, { outputReduction: pct / 100 }).costUsd;
                return (
                  <div key={pct} className="rounded-md border border-hairline-faint bg-black/25 px-3 py-2.5">
                    <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">−{pct}% output</div>
                    <div className="mt-1 font-num text-[14px] tabular text-ink">{formatUSD(cost)}</div>
                    <div className="mt-0.5 font-mono text-[10px] tabular text-[#6EE7B7]">
                      −{formatUSD(currentCost - cost)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="rounded-md border border-hairline-faint bg-black/25 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10.5px] text-ink-faint">Scenario applied in simulator</span>
                <span className="font-mono text-[11px] tabular text-ink">
                  {inputReduction}% context · {outputReduction}% output
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[10.5px] text-ink-faint">{candidate.label} with scenario</span>
                <span className="font-mono text-[11px] tabular text-ink">{formatUSD(candidateCost)}</span>
              </div>
            </div>
            <p className="text-[10.5px] text-ink-faint">
              Set the slider above to include the cap in the candidate comparison. Truncation can break structured output;
              test acceptance before enforcing.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
