import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/sparkline";
import { TrendIndicator } from "@/components/ui/trend";

export type MetricAccent =
  | "blue"
  | "cyan"
  | "violet"
  | "purple"
  | "emerald"
  | "teal"
  | "amber"
  | "orange"
  | "rose"
  | "pink"
  | "sky"
  | "indigo";

const ACCENT: Record<MetricAccent, { hex: string; chip: string; line: string; text: string }> = {
  blue: { hex: "#3B82F6", chip: "bg-accent-blue/12 text-[#93C5FD] border-accent-blue/25", line: "via-accent-blue/70", text: "text-[#93C5FD]" },
  cyan: { hex: "#06B6D4", chip: "bg-accent-cyan/12 text-[#67E8F9] border-accent-cyan/25", line: "via-accent-cyan/70", text: "text-[#67E8F9]" },
  violet: { hex: "#8B5CF6", chip: "bg-accent-violet/12 text-[#C4B5FD] border-accent-violet/25", line: "via-accent-violet/70", text: "text-[#C4B5FD]" },
  purple: { hex: "#A855F7", chip: "bg-accent-purple/12 text-[#D8B4FE] border-accent-purple/25", line: "via-accent-purple/70", text: "text-[#D8B4FE]" },
  emerald: { hex: "#10B981", chip: "bg-accent-emerald/12 text-[#6EE7B7] border-accent-emerald/25", line: "via-accent-emerald/70", text: "text-[#6EE7B7]" },
  teal: { hex: "#14B8A6", chip: "bg-accent-teal/12 text-[#5EEAD4] border-accent-teal/25", line: "via-accent-teal/70", text: "text-[#5EEAD4]" },
  amber: { hex: "#F59E0B", chip: "bg-accent-amber/12 text-[#FCD34D] border-accent-amber/25", line: "via-accent-amber/70", text: "text-[#FCD34D]" },
  orange: { hex: "#F97316", chip: "bg-accent-orange/12 text-[#FDBA74] border-accent-orange/25", line: "via-accent-orange/70", text: "text-[#FDBA74]" },
  rose: { hex: "#F43F5E", chip: "bg-accent-rose/12 text-[#FDA4AF] border-accent-rose/25", line: "via-accent-rose/70", text: "text-[#FDA4AF]" },
  pink: { hex: "#EC4899", chip: "bg-accent-pink/12 text-[#F9A8D4] border-accent-pink/25", line: "via-accent-pink/70", text: "text-[#F9A8D4]" },
  sky: { hex: "#38BDF8", chip: "bg-accent-sky/12 text-[#7DD3FC] border-accent-sky/25", line: "via-accent-sky/70", text: "text-[#7DD3FC]" },
  indigo: { hex: "#6366F1", chip: "bg-accent-indigo/12 text-[#A5B4FC] border-accent-indigo/25", line: "via-accent-indigo/70", text: "text-[#A5B4FC]" },
};

export type Provenance = "verified" | "estimated" | "projected" | "measured";

const PROVENANCE: Record<Provenance, { label: string; className: string; title: string }> = {
  verified: {
    label: "Verified",
    className: "border-accent-emerald/35 bg-accent-emerald/10 text-accent-emerald",
    title: "Measured from provider-reported usage and priced server-side.",
  },
  measured: {
    label: "Measured",
    className: "border-accent-teal/35 bg-accent-teal/10 text-accent-teal",
    title: "Replayed against stored token counts from your own events.",
  },
  estimated: {
    label: "Estimated",
    className: "border-accent-amber/35 bg-accent-amber/10 text-accent-amber",
    title: "Projected from catalog pricing and token estimates. Not realized savings.",
  },
  projected: {
    label: "Projected",
    className: "border-accent-violet/35 bg-accent-violet/10 text-[#C4B5FD]",
    title: "Forward-looking simulation. Not realized savings.",
  },
};

export function ProvenanceBadge({ kind, className }: { kind: Provenance; className?: string }) {
  const p = PROVENANCE[kind];
  return (
    <span
      title={p.title}
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.1em]",
        p.className,
        className,
      )}
    >
      {p.label}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  trend,
  tone = "default",
  accent = "blue",
  icon: Icon,
  href,
  className,
  provenance,
  hintTone = "neutral",
  sparklineColor,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  deltaLabel?: string;
  trend?: number[];
  tone?: "default" | "good" | "warn" | "bad";
  accent?: MetricAccent;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  href?: string;
  className?: string;
  provenance?: Provenance;
  hintTone?: "neutral" | "good" | "warn" | "bad";
  sparklineColor?: string;
}) {
  const a = ACCENT[accent];
  const content = (
    <div
      className={cn(
        "panel hairline-top group relative overflow-hidden px-4 pb-4 pt-3.5 transition-all duration-200",
        href && "hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-lift",
        className,
      )}
    >
      <span
        className={cn("pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent", a.line)}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-[7px] border", a.chip)}>
              <Icon className="size-3.5" strokeWidth={1.8} />
            </span>
          ) : null}
          <span className="kicker truncate">{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {provenance ? <ProvenanceBadge kind={provenance} /> : null}
          {trend && trend.length > 1 ? (
            <Sparkline
              values={trend}
              width={58}
              height={18}
              color={sparklineColor ?? a.hex}
              positive={tone !== "bad"}
              className="opacity-90"
            />
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="font-num text-[23px] leading-none tabular text-ink">
          {value}
        </div>
        {typeof delta === "number" ? (
          <TrendIndicator
            value={delta}
            label={deltaLabel}
            invert={tone !== "good"}
            className="mb-0.5"
          />
        ) : null}
      </div>
      {hint ? (
        <div
          className={cn(
            "mt-2 text-[10.5px] leading-relaxed text-ink-faint",
            hintTone === "good" && "text-[#6EE7B7]",
            hintTone === "warn" && "text-[#FCD34D]",
            hintTone === "bad" && "text-[#FDA4AF]",
          )}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50">
      {content}
    </Link>
  ) : (
    content
  );
}

/** Backwards-compatible wrapper used across 1.x pages. */
export function Kpi({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  trend,
  tone = "default",
  href,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  deltaLabel?: string;
  trend?: number[];
  tone?: "default" | "good" | "warn" | "bad";
  href?: string;
  className?: string;
}) {
  const accent: MetricAccent =
    tone === "bad" ? "rose" : tone === "warn" ? "amber" : tone === "good" ? "emerald" : "blue";
  return (
    <MetricCard
      label={label}
      value={value}
      hint={hint}
      delta={delta}
      deltaLabel={deltaLabel}
      trend={trend}
      tone={tone}
      accent={accent}
      href={href}
      className={className}
    />
  );
}

export function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "bad" | "good";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline-faint py-2.5 last:border-0">
      <span className="text-[11.5px] text-ink-faint">{label}</span>
      <span
        className={cn(
          "font-mono text-[11.5px] tabular text-ink-muted",
          tone === "bad" && "text-[#FDA4AF]",
          tone === "warn" && "text-[#FCD34D]",
          tone === "good" && "text-[#6EE7B7]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
