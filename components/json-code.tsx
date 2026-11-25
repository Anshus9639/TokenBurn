import * as React from "react";
import { cn } from "@/lib/utils";

const TOKEN =
  /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g;

export function highlightJson(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  let key = 0;
  while ((match = TOKEN.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [raw, propKey, str, num, literal] = match;
    const token = propKey ?? str ?? num ?? literal;
    const color = propKey ? "#F5F5F5" : str ? "#A1A1AA" : num ? "#D4D4D8" : "#8A8A8A";
    nodes.push(
      <span key={key++} style={{ color }}>
        {token}
      </span>,
    );
    last = match.index + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function JsonCode({
  code,
  className,
  tone = "default",
}: {
  code: string;
  className?: string;
  tone?: "default" | "muted";
}) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-md border border-hairline bg-[#0A0A0A] px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-ink-muted shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]",
        tone === "muted" && "text-ink-faint",
        className,
      )}
    >
      {highlightJson(code)}
    </pre>
  );
}
