import * as React from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const STATUS_MAP: Record<string, { variant: BadgeVariant; label?: string }> = {
  active: { variant: "good" },
  enabled: { variant: "good" },
  connected: { variant: "good" },
  completed: { variant: "good" },
  success: { variant: "good" },
  succeeded: { variant: "good" },
  approved: { variant: "good" },
  healthy: { variant: "good" },
  verified: { variant: "good" },
  accepted: { variant: "good" },
  promoted: { variant: "good" },

  running: { variant: "info" },
  in_progress: { variant: "info" },
  automatic: { variant: "info" },
  live: { variant: "info" },
  hybrid: { variant: "info" },
  canary: { variant: "info" },

  testing: { variant: "pending" },
  pending_approval: { variant: "pending", label: "Pending approval" },
  pending: { variant: "pending" },
  queued: { variant: "pending" },
  draft: { variant: "pending" },
  paused: { variant: "pending" },
  shadow: { variant: "accent" },
  manual: { variant: "pending" },
  recommendation: { variant: "accent" },

  warning: { variant: "warn" },
  warn: { variant: "warn" },
  approaching_limit: { variant: "warn", label: "Approaching limit" },
  high_utilization: { variant: "warn", label: "High utilization" },
  soft_limit: { variant: "warn", label: "Soft limit" },
  synthetic: { variant: "warn" },
  stale: { variant: "warn" },

  error: { variant: "bad" },
  failed: { variant: "bad" },
  failure: { variant: "bad" },
  critical: { variant: "bad" },
  revoked: { variant: "bad" },
  rejected: { variant: "bad" },
  exceeded: { variant: "bad", label: "Exceeded" },
  rolled_back: { variant: "bad", label: "Rolled back" },
  blocked: { variant: "bad" },
  verification_failed: { variant: "bad", label: "Verification failed" },
  connection_error: { variant: "warn", label: "Connection error" },
  not_configured: { variant: "pending", label: "Not configured" },
  hard_limit: { variant: "bad", label: "Hard limit" },

  dismissed: { variant: "outline" },
  archived: { variant: "outline" },
  cancelled: { variant: "outline" },
  custom: { variant: "outline" },
};

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StatusBadge({
  status,
  label,
  variant,
  className,
  dot = false,
}: {
  status: string;
  label?: string;
  variant?: BadgeVariant;
  className?: string;
  dot?: boolean;
}) {
  const entry = STATUS_MAP[status.toLowerCase()];
  const resolved = variant ?? entry?.variant ?? "default";
  const text = label ?? entry?.label ?? humanize(status);
  return (
    <Badge variant={resolved} className={cn(dot && "gap-1", className)}>
      {dot ? (
        <span
          className={cn(
            "size-1.5 rounded-full",
            resolved === "good" && "bg-accent-emerald",
            resolved === "info" && "bg-accent-blue",
            resolved === "warn" && "bg-accent-amber",
            resolved === "bad" && "bg-accent-rose",
            resolved === "accent" && "bg-accent-violet",
            (resolved === "pending" || resolved === "default" || resolved === "outline") && "bg-neutral-400",
          )}
          aria-hidden
        />
      ) : null}
      {text}
    </Badge>
  );
}
