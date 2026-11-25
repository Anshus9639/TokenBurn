"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-hairline-strong bg-[#0D0D0D] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[#A1A1AA] data-[state=checked]:bg-gradient-to-b data-[state=checked]:from-[#E4E4E7] data-[state=checked]:to-[#A1A1AA]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block size-3 rounded-full bg-[#737373] shadow-sm ring-0 transition-transform duration-200 data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-[#0A0A0A] data-[state=unchecked]:translate-x-[2px]",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = "Switch";

export { Switch };
