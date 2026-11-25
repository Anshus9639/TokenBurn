import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const primaryChrome =
  "bg-gradient-to-b from-[#FFFFFF] via-[#EFEFF1] to-[#D4D4D8] text-[#0A0A0A] shadow-chrome hover:brightness-[1.04] active:brightness-[0.97] border border-[#A1A1AA]";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        default: primaryChrome,
        secondary:
          "border border-hairline-strong bg-gradient-to-b from-[#232323] to-[#171717] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-[#4A4A4A] hover:from-[#2A2A2A] hover:to-[#1E1E1E]",
        outline:
          "border border-hairline-strong bg-transparent text-ink-muted hover:border-[#4A4A4A] hover:bg-white/[0.04] hover:text-ink",
        ghost: "text-ink-muted hover:bg-white/[0.06] hover:text-ink",
        link: "text-chrome-dim underline-offset-4 hover:text-white hover:underline",
        destructive:
          "border border-accent-rose/35 bg-accent-rose/10 text-[#FDA4AF] hover:bg-accent-rose/15 hover:text-[#FECDD3]",
        chrome: `${primaryChrome} font-semibold`,
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-[7px]",
        default: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "h-8 w-8 p-0",
        "icon-sm": "h-7 w-7 p-0 rounded-[6px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
