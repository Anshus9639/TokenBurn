import { cn } from "@/lib/utils";
import { formatUSD } from "@/lib/utils";

export type UtilizationTone = "normal" | "approaching" | "high" | "exceeded";

export function utilizationTone(ratio: number): UtilizationTone {
  if (ratio >= 1) return "exceeded";
  if (ratio >= 0.9) return "high";
  if (ratio >= 0.7) return "approaching";
  return "normal";
}

const TONE_STYLE: Record<UtilizationTone, { bar: string; text: string; label: string }> = {
  normal: {
    bar: "bg-gradient-to-r from-accent-emerald to-accent-teal",
    text: "text-[#6EE7B7]",
    label: "Within budget",
  },
  approaching: {
    bar: "bg-gradient-to-r from-accent-amber to-accent-orange",
    text: "text-[#FCD34D]",
    label: "Approaching limit",
  },
  high: {
    bar: "bg-gradient-to-r from-accent-orange to-accent-rose",
    text: "text-[#FDBA74]",
    label: "High utilization",
  },
  exceeded: {
    bar: "bg-gradient-to-r from-accent-rose to-accent-pink",
    text: "text-[#FDA4AF]",
    label: "Exceeded",
  },
};

export function UsageProgressBar({
  ratio,
  tone,
  className,
  height = "md",
  ticks = [],
  label,
}: {
  /** 0..1+; values above 1 clamp the fill but keep the exceeded tone. */
  ratio: number;
  tone?: UtilizationTone;
  className?: string;
  height?: "sm" | "md" | "lg";
  ticks?: number[];
  label?: string;
}) {
  const resolved = tone ?? utilizationTone(ratio);
  const style = TONE_STYLE[resolved];
  const pct = Math.max(0, Math.min(ratio * 100, 100));
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/[0.04]", className)}
      style={{ height: height === "sm" ? 4 : height === "lg" ? 8 : 6 }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
      aria-label={label ?? `${Math.round(ratio * 100)}% of budget used`}
    >
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", style.bar)}
        style={{ width: `${pct}%` }}
      />
      {ticks
        .filter((t) => t > 0 && t < 100)
        .map((t) => (
          <span
            key={t}
            className="absolute top-0 h-full w-px bg-[#141414]/70"
            style={{ left: `${t}%` }}
            aria-hidden
          />
        ))}
    </div>
  );
}

export function BudgetIndicator({
  label,
  spent,
  limit,
  compact = false,
  className,
}: {
  label?: string;
  spent: number;
  limit: number;
  compact?: boolean;
  className?: string;
}) {
  const ratio = limit > 0 ? spent / limit : 0;
  const style = TONE_STYLE[utilizationTone(ratio)];
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-ink-muted">{label}</span>
          <span className={cn("font-mono text-[10px] tabular", style.text)}>{style.label}</span>
        </div>
      ) : null}
      <UsageProgressBar ratio={ratio} ticks={[70, 90]} label={label ? `${label} budget usage` : undefined} />
      <div className="flex items-center justify-between font-mono text-[10px] tabular text-ink-faint">
        <span>{formatUSD(spent)}</span>
        <span className={style.text}>
          {(ratio * 100).toFixed(0)}%{compact ? "" : ` of ${formatUSD(limit)}`}
        </span>
      </div>
    </div>
  );
}
