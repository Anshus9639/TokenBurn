"use client";

import * as React from "react";
import { toast } from "sonner";
import { KeyRound, ShieldAlert } from "lucide-react";
import { createApiKeyAction } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { CopyButton } from "@/components/copy-button";
import type { ActionState } from "@/lib/actions/types";

export function ApiKeyForm({
  projectId,
  environments,
}: {
  projectId: string;
  environments: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = React.useActionState(createApiKeyAction, {} as ActionState);
  const formRef = React.useRef<HTMLFormElement>(null);
  const [created, setCreated] = React.useState<{ token: string; prefix: string } | null>(null);
  const last = React.useRef<ActionState | null>(null);

  React.useEffect(() => {
    if (last.current === state) return;
    last.current = state;
    if (state.ok) {
      toast.success(state.message ?? "API key created");
      const data = state.data as { token?: string; prefix?: string } | undefined;
      if (data?.token) setCreated({ token: data.token, prefix: data.prefix ?? "" });
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-[1fr_150px_110px_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`key-name-${projectId}`}>Key name</Label>
          <Input id={`key-name-${projectId}`} name="name" placeholder="Server · production" maxLength={60} required />
          <input type="hidden" name="projectId" value={projectId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`key-env-${projectId}`}>Environment</Label>
          <select
            id={`key-env-${projectId}`}
            name="environmentId"
            defaultValue=""
            className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
          >
            <option value="">Any</option>
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`key-kind-${projectId}`}>Kind</Label>
          <select
            id={`key-kind-${projectId}`}
            name="kind"
            defaultValue="live"
            className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
          >
            <option value="live">Live</option>
            <option value="test">Test</option>
          </select>
        </div>
        <Button type="submit" variant="secondary" size="sm" className="h-9" disabled={pending}>
          <KeyRound className="size-3.5" />
          {pending ? "Creating…" : "Create key"}
        </Button>
      </form>

      {created ? (
        <div className="rounded-md border border-[#453D2C] bg-[#171410] p-3">
          <div className="flex items-center gap-2 text-[11.5px] font-medium text-[#DCCFB3]">
            <ShieldAlert className="size-3.5" />
            Copy this key now. It is stored only as a SHA-256 hash and cannot be retrieved again.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded border border-hairline bg-[#0A0A0A] px-2.5 py-2 font-mono text-[11px] text-ink">
              {created.token}
            </code>
            <CopyButton value={created.token} size="sm" label="Copy key" className="h-8 shrink-0 border border-hairline" />
          </div>
          <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">
            prefix {created.prefix} · send as Authorization: Bearer …
          </div>
        </div>
      ) : null}
    </div>
  );
}
