import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function TrendIndicator({
  value,
  label,
  invert = false,
  className,
  showIcon = true,
}: {
  /** Fractional change, e.g. 0.12 for +12%. */
  value: number;
  label?: string;
  /** When true, a decrease is an improvement (cost, latency, errors). */
  invert?: boolean;
  className?: string;
  showIcon?: boolean;
}) {
  const flat = Math.abs(value) <= 0.0001;
  const improving = invert ? value < 0 : value > 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-[10px] tabular",
        flat ? "text-ink-faint" : improving ? "text-accent-emerald" : "text-accent-rose",
        className,
      )}
      title={label}
    >
      {showIcon ? <Icon className="size-3" aria-hidden /> : null}
      {Math.abs(value * 100).toFixed(1)}%
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
