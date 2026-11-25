import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-3 py-1 text-[13px] text-ink shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] transition-colors placeholder:text-ink-faint focus-visible:border-[#6B6B6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-3 py-2 text-[13px] leading-relaxed text-ink shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] transition-colors placeholder:text-ink-faint focus-visible:border-[#6B6B6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("kicker block text-ink-muted", className)}
      style={{ letterSpacing: "0.12em" }}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label>{label}</Label>
        {hint ? <span className="text-[11px] text-ink-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
