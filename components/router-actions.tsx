"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PauseCircle, RotateCcw, Send, ShieldCheck, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  pausePolicyAction,
  promoteRolloutAction,
  rampRolloutAction,
  rollbackRolloutAction,
  submitPolicyAction,
} from "@/lib/actions/router";

export function SubmitPolicyButton({ id, label = "Submit for approval" }: { id: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await submitPolicyAction(id);
          if (res.error) toast.error(res.error);
          else toast.success(res.message ?? "Submitted");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Send />} {pending ? "Submitting…" : label}
    </Button>
  );
}

export function PausePolicyButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Pause this routing policy? Requests will stop inheriting it immediately.")) return;
        startTransition(async () => {
          const res = await pausePolicyAction(id);
          if (res.error) toast.error(res.error);
          else toast.success(res.message ?? "Paused");
          router.refresh();
        });
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <PauseCircle />} Pause
    </Button>
  );
}

export function RolloutControls({
  id,
  nextPercent,
  canPromote,
  canRollback,
}: {
  id: string;
  nextPercent: number | null;
  canPromote: boolean;
  canRollback: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const run = (action: () => Promise<{ error?: string; message?: string }>, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error(res.error);
      else toast.success(res.message ?? "Updated");
      router.refresh();
    });
  };

  if (nextPercent === null && !canPromote && !canRollback) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {nextPercent !== null ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () => rampRolloutAction(id, nextPercent),
              `Increase canary traffic to ${nextPercent}%?`,
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <TrendingUp />} Ramp to {nextPercent}%
        </Button>
      ) : null}
      {canPromote ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => promoteRolloutAction(id),
              "Promote the candidate to this policy's production model? Guardrails must pass.",
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Promote
        </Button>
      ) : null}
      {canRollback ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            run(() => rollbackRolloutAction(id), "Roll this rollout back to the baseline model?")
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Roll back
        </Button>
      ) : null}
    </div>
  );
}
