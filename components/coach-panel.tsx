"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/actions/types";
import {
  askCoachAction,
  decideRecommendationAction,
  refreshCoachAction,
} from "@/lib/actions/coach";

function inline(text: string, prefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${prefix}-b-${i}`} className="font-medium text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${prefix}-c-${i}`} className="rounded bg-white/[0.05] px-1 py-0.5 font-mono text-[11px] text-ink-muted">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${prefix}-t-${i}`}>{part}</React.Fragment>;
  });
}

function AnswerBody({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-muted">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} className="h-1" />;
        if (line.startsWith("- ")) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-chrome/50" />
              <span>{inline(line.slice(2), `l${i}`)}</span>
            </div>
          );
        }
        return <p key={i}>{inline(line, `l${i}`)}</p>;
      })}
    </div>
  );
}

const SUGGESTIONS = [
  "Where can we save the most this month?",
  "Why did spend spike recently?",
  "How is prompt caching performing?",
  "Are we on track to hit any budget limit?",
];

export function CoachAsk() {
  const [state, formAction, pending] = React.useActionState(askCoachAction, {} as ActionState);
  const formRef = React.useRef<HTMLFormElement>(null);
  const data = state.data as
    | { answer?: string; source?: "rules" | "llm"; cited?: string[]; question?: string }
    | null
    | undefined;

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="space-y-2.5">
        <Textarea
          name="question"
          required
          minLength={4}
          maxLength={500}
          placeholder="Ask about spend, caching, model choice or anomalies…"
          className="min-h-[76px] resize-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10.5px] text-ink-faint">Answers cite open recommendations. Numbers come from your events.</span>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />} Ask coach
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              const el = formRef.current?.elements.namedItem("question") as HTMLTextAreaElement | null;
              if (el) {
                el.value = s;
                el.focus();
              }
            }}
            className="rounded-full border border-hairline-strong bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-ink-faint transition-colors hover:border-[#454545] hover:text-ink-muted"
          >
            {s}
          </button>
        ))}
      </div>

      {state.error ? (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/[0.07] px-3 py-2 text-xs text-[#FDA4AF]">{state.error}</div>
      ) : null}

      {data?.answer ? (
        <div className="rounded-lg border border-hairline-strong bg-[#0D0D0D] p-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-faint">
              <Sparkles className="size-3" /> Coach answer
            </span>
            <div className="flex items-center gap-1.5">
              <Badge variant={data.source === "llm" ? "chrome" : "outline"}>
                {data.source === "llm" ? "LLM narration" : "Rules engine"}
              </Badge>
              {data.cited?.length ? <Badge variant="outline">{data.cited.length} cited</Badge> : null}
            </div>
          </div>
          <AnswerBody text={data.answer} />
          <div className="mt-3 border-t border-hairline-faint pt-2.5 text-[10.5px] leading-relaxed text-ink-faint">
            Grounded in measured usage. Savings are projections unless labelled measured. Verify quality before routing
            changes.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RecommendationActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [choice, setChoice] = React.useState<"accepted" | "dismissed" | null>(null);

  function decide(decision: "accepted" | "dismissed") {
    setChoice(decision);
    startTransition(async () => {
      const res = await decideRecommendationAction(id, decision);
      if (res.error) toast.error(res.error);
      else toast.success(res.message ?? "Updated");
      setChoice(null);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("accepted")}>
        {pending && choice === "accepted" ? <Loader2 className="animate-spin" /> : <Check />} Accept
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide("dismissed")}>
        {pending && choice === "dismissed" ? <Loader2 className="animate-spin" /> : <X />} Dismiss
      </Button>
    </div>
  );
}

export function RefreshCoachButton({ label = "Run analysis" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      className={cn(pending && "opacity-80")}
      onClick={() =>
        startTransition(async () => {
          const res = await refreshCoachAction();
          if (res.error) toast.error(res.error);
          else toast.success(res.message ?? "Analysis refreshed");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {pending ? "Analyzing…" : label}
    </Button>
  );
}
