"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatCompactUSD, formatInt, formatMs, formatUSD } from "@/lib/utils";
import { SEMANTIC, accentForName, paletteColor, seriesColorForModel } from "@/lib/chart-colors";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { providerBrand, providerForModel } from "@/lib/brand/providers";
import { EmptyState, LoadingSkeleton } from "@/components/page";

const axisTick = {
  fill: "#8A8A8A",
  fontSize: 10,
  fontFamily: "'JetBrains Mono', monospace",
};

const grid = { stroke: SEMANTIC.grid, strokeDasharray: "2 5" };

function dayLabel(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

function labelFor(value: string | number) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayLabel(value) : String(value);
}

type TooltipItem = {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
};

export type ChartValueMode = "currency" | "number" | "compact" | "percent" | "ms";

function formatValue(value: number, mode: ChartValueMode) {
  switch (mode) {
    case "currency":
      return formatUSD(value);
    case "compact":
      return formatInt(value);
    case "percent":
      return `${Number(value).toFixed(1)}%`;
    case "ms":
      return formatMs(value);
    default:
      return formatInt(value);
  }
}

export function ChartTooltip({
  active,
  payload,
  label,
  mode = "currency",
  showTotal = true,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  mode?: ChartValueMode;
  showTotal?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
  return (
    <div className="min-w-[160px] rounded-lg border border-hairline-strong bg-[#1B1B1B]/95 px-3 py-2 shadow-pop backdrop-blur">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        {label !== undefined ? labelFor(label) : ""}
      </div>
      {payload.map((item) => (
        <div key={String(item.dataKey)} className="flex items-center justify-between gap-4 py-0.5 text-[11px]">
          <span className="flex items-center gap-1.5 text-ink-muted">
            <span className="size-1.5 rounded-full" style={{ background: item.color }} />
            {item.name}
          </span>
          <span className="font-mono tabular text-ink">{formatValue(Number(item.value ?? 0), mode)}</span>
        </div>
      ))}
      {showTotal && payload.length > 1 ? (
        <div className="mt-1 flex justify-between gap-4 border-t border-hairline-faint pt-1 text-[11px]">
          <span className="text-ink-faint">Total</span>
          <span className="font-mono tabular text-ink">{formatValue(total, mode)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ChartLegend({
  items,
  className,
  columns = 2,
}: {
  items: Array<{ label: string; value?: string; color?: string; provider?: string }>;
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-2",
        columns === 1 ? "grid-cols-1" : columns === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
          <span className="flex min-w-0 items-center gap-2 text-ink-faint">
            {item.provider ? (
              <ProviderLogo provider={item.provider} size={12} decorative />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: item.color ?? paletteColor(0) }} />
            )}
            <span className="truncate">{item.label}</span>
          </span>
          {item.value ? <span className="shrink-0 font-mono tabular text-ink-muted">{item.value}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function ChartContainer({
  title,
  description,
  action,
  legend,
  loading,
  empty,
  emptyDescription,
  height = 260,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  legend?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyDescription?: string;
  height?: number;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel hairline-top flex flex-col", className)}>
      {title || action ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline-faint px-5 py-3.5">
          <div className="min-w-0">
            {title ? <h3 className="text-[13px] font-medium tracking-tight text-ink">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{description}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("px-4 pb-4 pt-3", bodyClassName)}>
        {loading ? (
          <div style={{ height }} className="flex items-end">
            <LoadingSkeleton rows={4} className="w-full" label="Loading chart" />
          </div>
        ) : empty ? (
          <EmptyState
            title="No data in this range"
            description={emptyDescription ?? "Usage recorded in the selected filters will appear here."}
            className="border-0 bg-transparent py-10"
          />
        ) : (
          children
        )}
      </div>
      {legend && !loading && !empty ? <div className="border-t border-hairline-faint px-5 py-3">{legend}</div> : null}
    </section>
  );
}

export function CostTrendChart({
  data,
  height = 260,
  showRequests = false,
  color = SEMANTIC.cost,
  name = "Spend",
}: {
  data: Array<{ day: string; costUsd: number; requests?: number }>;
  height?: number;
  showRequests?: boolean;
  color?: string;
  name?: string;
}) {
  if (!data.length) {
    return (
      <EmptyState
        title="No spend recorded"
        description="Ingest events or connect a provider to see spend over time."
        className="border-0 bg-transparent py-10"
      />
    );
  }
  const gradientId = `costFill-${color.replace("#", "")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="65%" stopColor={color} stopOpacity={0.07} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "#303030" }}
          minTickGap={36}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => formatCompactUSD(v)}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={50}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#4A4A4A", strokeDasharray: "3 3" }} />
        <Area
          type="monotone"
          dataKey="costUsd"
          name={name}
          stroke={color}
          strokeWidth={1.8}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 3.2, fill: "#141414", stroke: color, strokeWidth: 2 }}
        />
        {showRequests ? (
          <Area
            type="monotone"
            dataKey="requests"
            name="Requests"
            stroke={SEMANTIC.requests}
            strokeWidth={1}
            fill="transparent"
            strokeDasharray="3 3"
            yAxisId={1}
            hide
          />
        ) : null}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export type SeriesDef = {
  key: string;
  name: string;
  color?: string;
  stack?: boolean;
};

export function MultiSeriesAreaChart({
  data,
  series,
  height = 260,
  mode = "compact",
}: {
  data: Array<Record<string, string | number>>;
  series: SeriesDef[];
  height?: number;
  mode?: ChartValueMode;
}) {
  if (!data.length) {
    return <EmptyState title="No series data" className="border-0 bg-transparent py-10" />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => {
            const color = s.color ?? paletteColor(0);
            return (
              <linearGradient key={s.key} id={`area-${s.key}-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "#303030" }}
          minTickGap={36}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => (mode === "currency" ? formatCompactUSD(v) : formatInt(v))}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip content={<ChartTooltip mode={mode} />} cursor={{ stroke: "#4A4A4A", strokeDasharray: "3 3" }} />
        {series.map((s) => {
          const color = s.color ?? paletteColor(0);
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stackId={s.stack === false ? undefined : "tokens"}
              stroke={color}
              strokeWidth={1.6}
              fill={`url(#area-${s.key}-${color.replace("#", "")})`}
              activeDot={{ r: 2.6, fill: "#141414", stroke: color, strokeWidth: 1.6 }}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

type BarColorMode = "palette" | "provider" | "model" | "accent";

function resolveBarColor(mode: BarColorMode | undefined, key: string, index: number) {
  switch (mode) {
    case "provider":
      return providerBrand(key).color;
    case "model":
      return providerForModel(key).color;
    case "accent":
      return accentForName(key);
    default:
      return paletteColor(index);
  }
}

export function CategoryBars({
  data,
  height = 240,
  currency = true,
  color = "#3B82F6",
  maxItems = 8,
  colorMode,
}: {
  data: Array<{ key: string; costUsd?: number; requests?: number; color?: string }>;
  height?: number;
  currency?: boolean;
  color?: string;
  maxItems?: number;
  colorMode?: BarColorMode;
}) {
  const rows = data.slice(0, maxItems);
  if (!rows.length) {
    return <EmptyState title="Nothing to rank yet" className="border-0 bg-transparent py-10" />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }} barCategoryGap={10}>
        <CartesianGrid {...grid} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => (currency ? formatCompactUSD(v) : formatInt(v))}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="key"
          width={160}
          tick={{ ...axisTick, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={<ChartTooltip mode={currency ? "currency" : "number"} />}
          cursor={{ fill: "rgba(59,130,246,0.06)" }}
        />
        <Bar dataKey={currency ? "costUsd" : "requests"} name={currency ? "Spend" : "Requests"} radius={[0, 4, 4, 0]}>
          {rows.map((row, i) => (
            <Cell
              key={row.key}
              fill={row.color ?? (colorMode ? resolveBarColor(colorMode, row.key, i) : color)}
              fillOpacity={colorMode || row.color ? 0.9 : Math.max(0.45, 0.92 - i * 0.07)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TokenSplitBars({
  data,
  height = 260,
  series,
}: {
  data: Array<Record<string, string | number>>;
  height?: number;
  series: Array<{ key: string; name: string; color: string }>;
}) {
  if (!data.length) {
    return <EmptyState title="No token data" className="border-0 bg-transparent py-10" />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "#303030" }}
          minTickGap={36}
          interval="preserveStartEnd"
        />
        <YAxis tickFormatter={(v: number) => formatInt(v)} tick={axisTick} tickLine={false} axisLine={false} width={52} />
        <Tooltip content={<ChartTooltip mode="number" />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
        {series.map((s, index) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="tokens"
            fill={s.color}
            radius={index === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ProviderDonut({
  data,
  height = 230,
  centerLabel,
  centerValue,
  mode = "currency",
  colorMode,
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  mode?: ChartValueMode;
  colorMode?: "palette" | "provider";
}) {
  if (!data.length) {
    return <EmptyState title="No distribution data" className="border-0 bg-transparent py-10" />;
  }
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="86%"
            paddingAngle={2.5}
            stroke="#141414"
            strokeWidth={2}
          >
            {data.map((entry, i) => (
              <Cell
                key={entry.name}
                fill={colorMode === "provider" ? providerBrand(entry.name).color : paletteColor(i)}
                style={{ filter: "drop-shadow(0 0 6px rgba(0,0,0,0.35))" }}
              />
            ))}
          </Pie>
          <Tooltip
            content={
              colorMode === "provider" ? (
                <ProviderSliceTooltip mode={mode} />
              ) : (
                <ChartTooltip mode={mode} />
              )
            }
          />
        </PieChart>
      </ResponsiveContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-num text-[16px] tabular text-ink">{centerValue}</div>
          {centerLabel ? <div className="kicker mt-1">{centerLabel}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function ProviderSliceTooltip({
  active,
  payload,
  mode = "currency",
}: {
  active?: boolean;
  payload?: TooltipItem[];
  mode?: ChartValueMode;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0]!;
  const brand = providerBrand(String(item.name ?? ""));
  return (
    <div className="min-w-[150px] rounded-lg border border-hairline-strong bg-[#1B1B1B]/95 px-3 py-2 shadow-pop backdrop-blur">
      <div className="flex items-center gap-1.5 text-[11px] text-ink">
        <ProviderLogo provider={brand.id} size={12} decorative />
        <span className="truncate">{brand.label}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4 font-mono text-[11px] tabular text-ink-muted">
        <span className="text-ink-faint">Spend</span>
        <span className="text-ink">{formatValue(Number(item.value ?? 0), mode)}</span>
      </div>
    </div>
  );
}

/** Backwards-compatible donut (1.x name). Uses the chromatic palette. */
export function TokenMixDonut({
  data,
  height = 220,
  centerLabel,
  centerValue,
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  return (
    <ProviderDonut
      data={data}
      height={height}
      centerLabel={centerLabel}
      centerValue={centerValue}
      mode="number"
    />
  );
}

export function LatencyTrendChart({
  data,
  height = 240,
  series,
}: {
  data: Array<Record<string, string | number>>;
  height?: number;
  series?: Array<{ key: string; name: string; color: string }>;
}) {
  const defs = series ?? [
    { key: "averageLatencyMs", name: "Avg latency", color: SEMANTIC.latency },
    { key: "p95LatencyMs", name: "P95 latency", color: SEMANTIC.p95 },
  ];
  if (!data.length) {
    return <EmptyState title="No latency samples" className="border-0 bg-transparent py-10" />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "#303030" }}
          minTickGap={36}
          interval="preserveStartEnd"
        />
        <YAxis tickFormatter={(v: number) => formatMs(v)} tick={axisTick} tickLine={false} axisLine={false} width={48} />
        <Tooltip content={<ChartTooltip mode="ms" showTotal={false} />} cursor={{ stroke: "#4A4A4A", strokeDasharray: "3 3" }} />
        {defs.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={1.7}
            dot={false}
            activeDot={{ r: 3, fill: "#141414", stroke: s.color, strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ErrorRateChart({
  data,
  height = 240,
}: {
  data: Array<{ day: string; errorRatePct: number; errors?: number }>;
  height?: number;
}) {
  if (!data.length) {
    return <EmptyState title="No request errors recorded" className="border-0 bg-transparent py-10" />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SEMANTIC.errors} stopOpacity={0.3} />
            <stop offset="100%" stopColor={SEMANTIC.errors} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...grid} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "#303030" }}
          minTickGap={36}
          interval="preserveStartEnd"
        />
        <YAxis tickFormatter={(v: number) => `${v}%`} tick={axisTick} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={<ChartTooltip mode="percent" showTotal={false} />} cursor={{ stroke: "#4A4A4A", strokeDasharray: "3 3" }} />
        <Area
          type="monotone"
          dataKey="errorRatePct"
          name="Error rate"
          stroke={SEMANTIC.errors}
          strokeWidth={1.6}
          fill="url(#errorFill)"
          activeDot={{ r: 3, fill: "#141414", stroke: SEMANTIC.errors, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export type ScatterPoint = {
  model: string;
  provider?: string | null;
  averageLatencyMs: number;
  costUsd: number;
  requests?: number;
  qualityScore?: number | null;
};

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ScatterPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const brand = providerForModel(point.model, point.provider);
  return (
    <div className="min-w-[180px] rounded-lg border border-hairline-strong bg-[#1B1B1B]/95 px-3 py-2 shadow-pop backdrop-blur">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-ink">
        <ProviderLogo provider={brand.id} size={12} decorative />
        <span className="font-mono">{point.model}</span>
      </div>
      <div className="space-y-0.5 font-mono text-[10.5px] text-ink-muted">
        <div className="flex justify-between gap-4">
          <span className="text-ink-faint">Avg latency</span>
          <span>{formatMs(point.averageLatencyMs)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink-faint">Cost / request</span>
          <span>{formatUSD(point.costUsd)}</span>
        </div>
        {typeof point.requests === "number" ? (
          <div className="flex justify-between gap-4">
            <span className="text-ink-faint">Requests</span>
            <span>{formatInt(point.requests)}</span>
          </div>
        ) : null}
        {typeof point.qualityScore === "number" ? (
          <div className="flex justify-between gap-4">
            <span className="text-ink-faint">Quality</span>
            <span>{point.qualityScore}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CostLatencyScatter({
  data,
  height = 280,
}: {
  data: ScatterPoint[];
  height?: number;
}) {
  if (!data.length) {
    return <EmptyState title="No model samples" className="border-0 bg-transparent py-10" />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid {...grid} />
        <XAxis
          type="number"
          dataKey="averageLatencyMs"
          name="Latency"
          tickFormatter={(v: number) => formatMs(v)}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "#303030" }}
        />
        <YAxis
          type="number"
          dataKey="costUsd"
          name="Cost"
          tickFormatter={(v: number) => formatUSD(v)}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={54}
        />
        <ZAxis type="number" dataKey="requests" range={[50, 360]} />
        <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3", stroke: "#4A4A4A" }} />
        <Scatter data={data} name="Models">
          {data.map((point) => (
            <Cell key={point.model} fill={seriesColorForModel(point.model, point.provider)} fillOpacity={0.82} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export type QualityPoint = {
  model: string;
  provider?: string | null;
  costUsd: number;
  qualityScore: number;
  requests?: number;
  averageLatencyMs?: number | null;
};

function QualityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: QualityPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const brand = providerForModel(point.model, point.provider);
  return (
    <div className="min-w-[180px] rounded-lg border border-hairline-strong bg-[#1B1B1B]/95 px-3 py-2 shadow-pop backdrop-blur">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-ink">
        <ProviderLogo provider={brand.id} size={12} decorative />
        <span className="font-mono">{point.model}</span>
      </div>
      <div className="space-y-0.5 font-mono text-[10.5px] text-ink-muted">
        <div className="flex justify-between gap-4">
          <span className="text-ink-faint">Quality</span>
          <span>{point.qualityScore}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink-faint">Cost / request</span>
          <span>{formatUSD(point.costUsd)}</span>
        </div>
        {typeof point.requests === "number" ? (
          <div className="flex justify-between gap-4">
            <span className="text-ink-faint">Requests</span>
            <span>{formatInt(point.requests)}</span>
          </div>
        ) : null}
        {typeof point.averageLatencyMs === "number" ? (
          <div className="flex justify-between gap-4">
            <span className="text-ink-faint">Avg latency</span>
            <span>{formatMs(point.averageLatencyMs)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CostQualityScatter({
  data,
  height = 280,
}: {
  data: QualityPoint[];
  height?: number;
}) {
  if (!data.length) {
    return (
      <EmptyState
        title="No quality samples"
        description="Quality appears once evaluation tooling scores routed traffic."
        className="border-0 bg-transparent py-10"
      />
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 18, left: 0, bottom: 4 }}>
        <CartesianGrid {...grid} />
        <XAxis
          type="number"
          dataKey="costUsd"
          name="Cost / request"
          tickFormatter={(v: number) => formatUSD(v)}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "#303030" }}
        />
        <YAxis
          type="number"
          dataKey="qualityScore"
          name="Quality"
          domain={["dataMin - 4", "dataMax + 4"]}
          tickFormatter={(v: number) => String(v)}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <ZAxis type="number" dataKey="requests" range={[60, 340]} />
        <Tooltip content={<QualityTooltip />} cursor={{ strokeDasharray: "3 3", stroke: "#4A4A4A" }} />
        <Scatter data={data} name="Models">
          {data.map((point) => (
            <Cell
              key={point.model}
              fill={seriesColorForModel(point.model, point.provider)}
              fillOpacity={0.82}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
