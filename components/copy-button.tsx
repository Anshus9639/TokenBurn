"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label = "Copy",
  className,
  size = "icon-sm",
}: {
  value: string;
  label?: string;
  className?: string;
  size?: "icon-sm" | "sm" | "default";
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      className={cn("font-mono text-[11px]", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {size !== "icon-sm" ? <span>{copied ? "Copied" : label}</span> : <span className="sr-only">Copy</span>}
    </Button>
  );
}
