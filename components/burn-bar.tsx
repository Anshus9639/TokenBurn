import { cn } from "@/lib/utils";
import { formatUSD } from "@/lib/utils";
import { BudgetIndicator, UsageProgressBar, utilizationTone } from "@/components/ui/progress";

export function BurnBar({
  spent,
  limit,
  thresholds = [50, 75, 90, 100],
  compact = false,
  className,
}: {
  spent: number;
  limit: number;
  thresholds?: number[];
  compact?: boolean;
  className?: string;
}) {
  const ratio = limit > 0 ? spent / limit : 0;
  const tone = utilizationTone(ratio);
  if (compact) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <UsageProgressBar ratio={ratio} height="sm" label="Budget usage" />
        <div className="flex items-center justify-between font-mono text-[10px] tabular text-ink-faint">
          <span>{formatUSD(spent)}</span>
          <span className={cn(tone === "exceeded" && "text-[#FDA4AF]", tone === "high" && "text-[#FDBA74]", tone === "approaching" && "text-[#FCD34D]")}>
            {(ratio * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <UsageProgressBar ratio={ratio} ticks={thresholds} label="Budget usage" />
      <div className="flex items-center justify-between font-mono text-[10px] tabular text-ink-faint">
        <span>{formatUSD(spent)}</span>
        <span className={cn(tone === "exceeded" && "text-[#FDA4AF]", tone === "high" && "text-[#FDBA74]", tone === "approaching" && "text-[#FCD34D]")}>
          {(ratio * 100).toFixed(0)}% of {formatUSD(limit)}
        </span>
      </div>
    </div>
  );
}

export { BudgetIndicator };
