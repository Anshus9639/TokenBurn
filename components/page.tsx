import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  kicker,
  title,
  description,
  children,
  className,
}: {
  kicker?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4 pb-6 animate-fade-up", className)}>
      <div className="min-w-0">
        {kicker ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="h-px w-5 bg-gradient-to-r from-white/60 to-transparent" aria-hidden />
            <span className="kicker">{kicker}</span>
          </div>
        ) : null}
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-faint">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function SectionHeader({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex items-baseline gap-3">
        <h2 className="text-[13px] font-medium tracking-tight text-ink">{title}</h2>
        {hint ? <span className="text-[11px] text-ink-faint">{hint}</span> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-white/[0.012] px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-full border border-hairline bg-white/[0.03] text-ink-faint">
          {icon}
        </div>
      ) : null}
      <div>
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {description ? <div className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-faint">{description}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function LoadingSkeleton({
  rows = 3,
  className,
  label = "Loading",
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)} role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-8"
          style={{ width: `${100 - i * 9}%`, animationDelay: `${i * 90}ms` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-accent-rose/30 bg-accent-rose/[0.06] px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#FDA4AF]">
        <AlertTriangle className="size-4" aria-hidden />
        {title}
      </div>
      {description ? <p className="text-xs leading-relaxed text-ink-muted">{description}</p> : null}
      {action}
    </div>
  );
}

export function Divider({ label, className }: { label?: string; className?: string }) {
  if (!label) return <div className={cn("h-px w-full bg-hairline", className)} />;
  return <div className={cn("divider-label kicker", className)}>{label}</div>;
}

export function DataNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "rounded-md border border-hairline-faint bg-white/[0.015] px-3 py-2 text-[11px] leading-relaxed text-ink-faint",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-sunken/60 px-3 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
