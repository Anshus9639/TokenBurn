"use client";

import * as React from "react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui/input";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions/types";

export function AuthForm({
  mode,
  action,
  demo,
}: {
  mode: "login" | "signup";
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  demo?: { email: string; password: string };
}) {
  const [email, setEmail] = React.useState(mode === "login" ? demo?.email ?? "" : "");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [orgName, setOrgName] = React.useState("");

  return (
    <div className="space-y-6">
      <ActionForm action={action} submitLabel={mode === "login" ? "Sign in" : "Create workspace"} pendingLabel={mode === "login" ? "Signing in…" : "Creating workspace…"} className="space-y-4">
        {mode === "signup" ? (
          <>
            <Field label="Full name">
              <Input name="name" autoComplete="name" placeholder="Ada Lovelace" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Organization">
              <Input
                name="orgName"
                placeholder="Northwind Labs"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </Field>
          </>
        ) : null}
        <Field label="Work email">
          <Input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password" hint={mode === "signup" ? "Minimum 10 characters" : undefined}>
          <Input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
      </ActionForm>

      {mode === "login" ? (
        <div className="space-y-3 border-t border-hairline-faint pt-5">
          <div className="flex items-center justify-between">
            <span className="kicker">Demo workspace</span>
            {demo ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEmail(demo.email);
                  setPassword(demo.password);
                }}
              >
                Use demo credentials
              </Button>
            ) : null}
          </div>
          <div className="rounded-md border border-hairline bg-[#0D0D0D] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-faint">
            <div className="flex justify-between gap-4">
              <span>email</span>
              <span className="text-ink-muted">{demo?.email ?? "demo@tokenburn.dev"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>password</span>
              <span className="text-ink-muted">{demo?.password ?? "tokenburn-demo"}</span>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            New here?{" "}
            <Link href="/signup" className="text-ink underline decoration-hairline-strong underline-offset-4 hover:decoration-white">
              Create a workspace
            </Link>{" "}
            — new workspaces start empty and ingest live keys.
          </p>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Already have an account?{" "}
          <Link href="/login" className="text-ink underline decoration-hairline-strong underline-offset-4 hover:decoration-white">
            Sign in
          </Link>
        </p>
      )}
    </div>
  );
}
