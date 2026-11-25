import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-hairline-strong bg-white/[0.04] text-ink-muted",
        solid: "border-transparent bg-chrome text-[#0A0A0A]",
        outline: "border-hairline-strong bg-transparent text-ink-muted",
        good: "border-accent-emerald/35 bg-accent-emerald/10 text-accent-emerald",
        warn: "border-accent-amber/35 bg-accent-amber/10 text-accent-amber",
        bad: "border-accent-rose/35 bg-accent-rose/10 text-accent-rose",
        info: "border-accent-blue/35 bg-accent-blue/10 text-[#93C5FD]",
        accent: "border-accent-violet/35 bg-accent-violet/10 text-[#C4B5FD]",
        pending: "border-neutral-500/40 bg-neutral-500/10 text-neutral-300",
        chrome: "border-white/25 bg-gradient-to-b from-white/[0.14] to-white/[0.04] text-ink",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
