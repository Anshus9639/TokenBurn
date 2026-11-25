import Link from "next/link";
import {
  CheckCircle2,
  ClipboardList,
  Coins,
  FileClock,
  Lock,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { getDb, rawQuery } from "@/lib/db/client";
import { requireSession, can } from "@/lib/auth";
import { getBudgetSnapshots } from "@/lib/governance";
import { auditLogs, approvalRequests, budgets, organizations, projects } from "@/lib/db/schema";
import {
  createBudgetAction,
  decideApprovalAction,
  updateBudgetAction,
  updateGovernanceSettingsAction,
} from "@/lib/actions/governance";
import { PageHeader, SectionHeader, EmptyState, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/input";
import { DialogForm } from "@/components/dialog-form";
import { ActionForm } from "@/components/action-form";
import { ConfirmForm } from "@/components/confirm-form";
import { MetricCard } from "@/components/kpi";
import { BurnBar } from "@/components/burn-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatDateTimeUTC, formatUSD } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "budgets", label: "Budgets" },
  { key: "approvals", label: "Approvals" },
  { key: "policy", label: "Restrictions" },
  { key: "audit", label: "Audit trail" },
] as const;

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab = (TABS.find((t) => t.key === tabParam)?.key ?? "budgets") as (typeof TABS)[number]["key"];
  const session = await requireSession();
  const db = await getDb();
  const canManageBudgets = can(session.role, "manage_budgets");
  const canApprove = can(session.role, "approve");

  const [budgetRows, snapshots, approvals, auditRows, projectRows, featureRows, orgRows] = await Promise.all([
    db.select().from(budgets).where(eq(budgets.orgId, session.org.id)).orderBy(desc(budgets.createdAt)),
    getBudgetSnapshots(db, session.org.id),
    db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.orgId, session.org.id))
      .orderBy(desc(approvalRequests.createdAt)),
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, session.org.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(60),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, session.org.id)),
    rawQuery<{ feature: string }>(
      `select distinct feature from usage_events where org_id = $1 order by feature limit 100`,
      [session.org.id],
    ),
    db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, session.org.id)).limit(1),
  ]);

  const settings = orgRows[0]?.settings;
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const snapMap = new Map(snapshots.map((s) => [s.id, s]));
  const activeBudgets = budgetRows.filter((b) => b.isActive);
  const inactiveBudgets = budgetRows.filter((b) => !b.isActive);
  const totalLimit = activeBudgets.reduce((s, b) => s + Number(b.limitUsd), 0);
  const totalSpent = snapshots.reduce((s, b) => s + b.spentUsd, 0);
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const overBudgets = snapshots.filter((s) => s.utilization >= 1);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Control · Guardrails & accountability"
        title="Governance Center"
        description="Budgets, hard limits, model restrictions and an approval trail for production routing changes."
      >
        <Badge variant={settings?.hardLimitsEnabled ? "warn" : "outline"}>
          Hard limits {settings?.hardLimitsEnabled ? "enabled" : "disabled"}
        </Badge>
        <Badge variant="outline">
          Approval {settings?.requireApprovalForRouting ? "required" : "optional"}
        </Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Active budgets"
          value={String(activeBudgets.length)}
          hint={`${inactiveBudgets.length} disabled`}
          accent="blue"
          icon={Coins}
        />
        <MetricCard
          label="Committed limits"
          value={formatUSD(totalLimit)}
          hint="Sum of active limits"
          accent="violet"
        />
        <MetricCard
          label="Spent this period"
          value={formatUSD(totalSpent)}
          hint={overBudgets.length ? `${overBudgets.length} over limit` : "Within limits"}
          tone={overBudgets.length ? "bad" : "good"}
          accent="emerald"
          provenance="measured"
        />
        <MetricCard
          label="Pending approvals"
          value={String(pendingApprovals.length)}
          hint="Production changes awaiting review"
          tone={pendingApprovals.length ? "warn" : "default"}
          accent="amber"
          icon={FileClock}
          href="/governance?tab=approvals"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/governance?tab=${t.key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-[11.5px] transition-colors",
              tab === t.key
                ? "border-hairline-strong bg-[#222222] text-ink"
                : "border-transparent text-ink-faint hover:bg-white/[0.03] hover:text-ink-muted",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "budgets" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader title="Budgets" hint="Organization · project · feature scope" />
            {canManageBudgets ? (
              <DialogForm
                trigger={
                  <Button size="sm">
                    <Coins className="size-3.5" />
                    New budget
                  </Button>
                }
                title="Create a budget"
                description="Budgets are evaluated on every ingest. Hard limits deny routing at /api/v1/route once exceeded."
                action={createBudgetAction}
                submitLabel="Create budget"
              >
                <Field label="Name">
                  <Input name="name" placeholder="Orbit monthly" maxLength={60} required />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Scope">
                    <select
                      name="scope"
                      defaultValue="project"
                      className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
                    >
                      <option value="organization">Organization</option>
                      <option value="project">Project</option>
                      <option value="feature">Project + feature</option>
                    </select>
                  </Field>
                  <Field label="Period">
                    <select
                      name="period"
                      defaultValue="monthly"
                      className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="daily">Daily</option>
                    </select>
                  </Field>
                </div>
                <Field label="Project" hint="required for project/feature">
                  <select
                    name="projectId"
                    defaultValue=""
                    className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
                  >
                    <option value="">—</option>
                    {projectRows.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Feature" hint="feature scope only">
                  <Input name="feature" list="feature-options" placeholder="chat-completion" />
                  <datalist id="feature-options">
                    {featureRows.rows.map((f) => (
                      <option key={f.feature} value={f.feature} />
                    ))}
                  </datalist>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Limit (USD)">
                    <Input name="limitUsd" type="number" min="0.01" step="1" placeholder="250" required />
                  </Field>
                  <Field label="Alert thresholds" hint="%">
                    <Input name="thresholds" defaultValue="50, 75, 90, 100" />
                  </Field>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-ink-faint">
                  <input type="checkbox" name="hardLimit" className="size-3.5 accent-[#D4D4D8]" />
                  Enable hard limit — deny requests at /api/v1/route once exceeded
                </label>
              </DialogForm>
            ) : null}
          </div>

          {activeBudgets.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {activeBudgets.map((b) => {
                const snap = snapMap.get(b.id);
                return (
                  <Card key={b.id}>
                    <CardTopBar>
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-medium text-ink">{b.name}</div>
                        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                          {b.scope}
                          {b.projectId ? ` · ${projectName.get(b.projectId) ?? "project"}` : ""}
                          {b.feature ? ` · ${b.feature}` : ""} · {b.period}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {snap && snap.utilization >= 0.9 ? (
                          <Badge variant={snap.utilization >= 1 ? "bad" : "warn"}>
                            {Math.round(snap.utilization * 100)}%
                          </Badge>
                        ) : null}
                        <Badge variant={b.hardLimit ? "warn" : "outline"}>{b.hardLimit ? "hard" : "soft"}</Badge>
                      </div>
                    </CardTopBar>
                    <CardContent className="pt-4">
                      {snap ? <BurnBar spent={snap.spentUsd} limit={snap.limitUsd} thresholds={snap.thresholds} /> : null}
                      <div className="mt-3 text-[10.5px] text-ink-faint">
                        Remaining{" "}
                        <span className="font-mono text-ink-muted">
                          {formatUSD(Math.max(Number(b.limitUsd) - (snap?.spentUsd ?? 0), 0))}
                        </span>{" "}
                        · thresholds {snap?.thresholds.join(" / ")}%
                      </div>
                      {canManageBudgets ? (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hairline-faint pt-3">
                          <form action={updateBudgetAction} className="flex items-center gap-1">
                            <input type="hidden" name="budgetId" value={b.id} />
                            <input type="hidden" name="intent" value="set-limit" />
                            <input
                              name="limitUsd"
                              type="number"
                              min="1"
                              step="1"
                              defaultValue={Number(b.limitUsd).toFixed(0)}
                              className="h-7 w-[84px] rounded border border-hairline-strong bg-[#0D0D0D] px-2 font-mono text-[10.5px] text-ink focus:border-[#6B6B6B] focus:outline-none"
                              aria-label="New limit"
                            />
                            <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-[10.5px]">
                              Set
                            </Button>
                          </form>
                          <span className="mx-0.5 h-3 w-px bg-hairline" />
                          {b.hardLimit ? (
                            <ConfirmForm
                              action={updateBudgetAction}
                              message={`Remove the hard limit from "${b.name}"? Over-budget requests will no longer be denied at /api/v1/route.`}
                            >
                              <input type="hidden" name="budgetId" value={b.id} />
                              <input type="hidden" name="intent" value="toggle-hard" />
                              <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-[10.5px]">
                                Make soft
                              </Button>
                            </ConfirmForm>
                          ) : (
                            <form action={updateBudgetAction}>
                              <input type="hidden" name="budgetId" value={b.id} />
                              <input type="hidden" name="intent" value="toggle-hard" />
                              <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-[10.5px]">
                                Make hard
                              </Button>
                            </form>
                          )}
                          <ConfirmForm
                            action={updateBudgetAction}
                            message={`Disable budget "${b.name}"? It stops raising alerts and stops enforcing hard limits immediately.`}
                          >
                            <input type="hidden" name="budgetId" value={b.id} />
                            <input type="hidden" name="intent" value="toggle-active" />
                            <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-[10.5px] text-ink-faint">
                              Disable
                            </Button>
                          </ConfirmForm>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No active budgets"
              description="Budgets drive alerts and hard-limit enforcement. Create one to activate governance."
              icon={<Coins className="size-4" />}
            />
          )}

          {inactiveBudgets.length ? (
            <Card>
              <CardTopBar>
                <div className="text-[12.5px] font-medium text-ink">Disabled budgets</div>
                <span className="font-mono text-[10px] text-ink-faint">{inactiveBudgets.length}</span>
              </CardTopBar>
              <CardContent className="pt-2">
                {inactiveBudgets.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 border-b border-hairline-faint py-2.5 last:border-0">
                    <span className="text-[12px] text-ink-muted">{b.name}</span>
                    <span className="font-mono text-[10px] text-ink-faint">
                      {b.scope} · {formatUSD(Number(b.limitUsd))}
                    </span>
                    {canManageBudgets ? (
                      <form action={updateBudgetAction} className="ml-auto">
                        <input type="hidden" name="budgetId" value={b.id} />
                        <input type="hidden" name="intent" value="toggle-active" />
                        <Button type="submit" variant="ghost" size="sm" className="h-7 text-[10.5px]">
                          Re-enable
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === "approvals" ? (
        <div className="space-y-4">
          <SectionHeader title="Approval queue" hint="Production routing changes require admin approval" />
          {approvals.length ? (
            approvals.map((a) => (
              <Card key={a.id}>
                <CardTopBar>
                  <div className="flex min-w-0 items-center gap-2.5">
                    {a.status === "pending" ? (
                      <FileClock className="size-4 text-[#FCD34D]" />
                    ) : a.status === "approved" ? (
                      <CheckCircle2 className="size-4 text-[#6EE7B7]" />
                    ) : (
                      <XCircle className="size-4 text-[#FDA4AF]" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium text-ink">{a.title}</div>
                      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                        {a.type} · requested by {a.requestedByEmail} · {formatDateTimeUTC(a.createdAt)}
                      </div>
                    </div>
                  </div>
                  <Badge variant={a.status === "pending" ? "warn" : a.status === "approved" ? "good" : "bad"}>
                    {a.status}
                  </Badge>
                </CardTopBar>
                <CardContent className="pt-3">
                  <p className="text-[11.5px] leading-relaxed text-ink-muted">{a.description}</p>
                  <div className="mt-3 grid gap-1.5 rounded-md border border-hairline-faint bg-surface-sunken/60 p-3 sm:grid-cols-2">
                    {Object.entries(a.payload).map(([key, value]) => (
                      <div key={key} className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">{key}</span>
                        <span className="truncate font-mono text-[10.5px] text-ink-muted">
                          {typeof value === "string" ? value : JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {a.status === "pending" && canApprove ? (
                    <form action={decideApprovalAction} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="approvalId" value={a.id} />
                      <div className="min-w-[220px] flex-1">
                        <Label htmlFor={`note-${a.id}`}>Decision note</Label>
                        <Input id={`note-${a.id}`} name="note" placeholder="Optional context recorded in the audit trail" />
                      </div>
                      <Button type="submit" name="decision" value="approve" size="sm">
                        <ShieldCheck className="size-3.5" />
                        Approve & apply
                      </Button>
                      <Button type="submit" name="decision" value="reject" variant="destructive" size="sm">
                        Reject
                      </Button>
                    </form>
                  ) : a.decidedBy ? (
                    <div className="mt-3 border-t border-hairline-faint pt-2 text-[10.5px] text-ink-faint">
                      Decided by {a.decidedBy} on {formatDateTimeUTC(a.decidedAt)}
                      {a.decisionNote ? ` — ${a.decisionNote}` : ""}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))
          ) : (
            <EmptyState
              title="No approval requests"
              description="Routing changes requested from the Model Router page will appear here when approval is required."
              icon={<ClipboardList className="size-4" />}
            />
          )}
        </div>
      ) : null}

      {tab === "policy" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                <SlidersHorizontal className="size-3.5 text-ink-faint" />
                Model restrictions
              </div>
              <Badge variant="outline">applies to /api/v1/route</Badge>
            </CardTopBar>
            <CardContent className="pt-4">
              {settings ? (
                <ActionForm
                  action={updateGovernanceSettingsAction}
                  submitLabel="Save policy"
                  pendingLabel="Saving…"
                  className="space-y-4"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Allowed models" hint="blank = all allowed">
                      <Textarea
                        name="allowedModels"
                        rows={4}
                        defaultValue={settings.allowedModels.join(", ")}
                        placeholder="gpt-4.1-mini, claude-sonnet-4, gemini-2.5-flash"
                        className="font-mono text-[11px]"
                      />
                    </Field>
                    <Field label="Blocked models" hint="deny overrides allow">
                      <Textarea
                        name="blockedModels"
                        rows={4}
                        defaultValue={settings.blockedModels.join(", ")}
                        placeholder="claude-opus-4"
                        className="font-mono text-[11px]"
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Fallback model">
                      <Input
                        name="fallbackModel"
                        defaultValue={settings.fallbackModel}
                        className="font-mono text-[11px]"
                      />
                    </Field>
                    <Field label="Timezone">
                      <Input name="timezone" defaultValue={settings.timezone} className="font-mono text-[11px]" />
                    </Field>
                  </div>
                  <div className="space-y-2 rounded-md border border-hairline-faint bg-white/[0.015] p-3">
                    <label className="flex cursor-pointer items-start gap-2.5 text-[11.5px] text-ink-muted">
                      <input
                        type="checkbox"
                        name="requireApprovalForRouting"
                        defaultChecked={settings.requireApprovalForRouting}
                        className="mt-0.5 size-3.5 accent-[#D4D4D8]"
                      />
                      <span>
                        Require approval for production routing changes
                        <span className="block text-[10.5px] text-ink-faint">
                          Router changes create a pending approval instead of applying immediately.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2.5 text-[11.5px] text-ink-muted">
                      <input
                        type="checkbox"
                        name="hardLimitsEnabled"
                        defaultChecked={settings.hardLimitsEnabled}
                        className="mt-0.5 size-3.5 accent-[#D4D4D8]"
                      />
                      <span>
                        Enforce hard budget limits
                        <span className="block text-[10.5px] text-ink-faint">
                          When a hard budget is exhausted, /api/v1/route denies new requests until the period resets.
                        </span>
                      </span>
                    </label>
                  </div>
                </ActionForm>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                <Lock className="size-3.5 text-ink-faint" />
                Enforcement path
              </div>
            </CardTopBar>
            <CardContent className="space-y-3 pt-4 text-[11.5px] leading-relaxed text-ink-faint">
              <p>
                <span className="text-ink-muted">1. Model allowlist.</span> A model must be allowed and not blocked. The
                check runs before pricing so no cost leaks through denied routes.
              </p>
              <p>
                <span className="text-ink-muted">2. Hard budgets.</span> Active budgets with{" "}
                <span className="font-mono text-[10.5px]">hard_limit = true</span> are evaluated against period spend.
              </p>
              <p>
                <span className="text-ink-muted">3. Audit.</span> Every settings change, approval decision and budget edit
                writes a row to the immutable audit trail.
              </p>
              <div className="rounded-md border border-accent-amber/30 bg-accent-amber/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-[#FCD34D]">
                Your role: <span className="font-mono uppercase">{session.role}</span>.{" "}
                {canManageBudgets ? "You can edit this policy." : "Read-only for policy changes."}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "audit" ? (
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <Scale className="size-3.5 text-ink-faint" />
              Audit trail
            </div>
            <span className="font-mono text-[10px] text-ink-faint">last {auditRows.length} events</span>
          </CardTopBar>
          {auditRows.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="pr-5">Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-5 font-mono text-[10px] tabular text-ink-faint">
                      {formatDateTimeUTC(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="text-[11px] text-ink-muted">{row.actorEmail}</div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">
                        {row.actorType}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 font-mono text-[10.5px] text-ink-muted">
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            /delete|revoke|reject|disable/i.test(row.action)
                              ? "bg-accent-rose"
                              : /approve/i.test(row.action)
                                ? "bg-accent-emerald"
                                : /update|edit/i.test(row.action)
                                  ? "bg-accent-amber"
                                  : "bg-accent-blue",
                          )}
                        />
                        {row.action}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[380px] text-[11px] text-ink-faint">{row.summary}</TableCell>
                    <TableCell className="pr-5 font-mono text-[9.5px] text-ink-faint">
                      {row.targetType}
                      {row.targetId ? ` · ${row.targetId.slice(0, 8)}…` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState title="No audit events yet" description="Actions taken in this organization will appear here." />
            </div>
          )}
        </Card>
      ) : null}

      <DataNote>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Note</span>
        <span>
          Budget utilization is computed from usage events at request time using the same server-authoritative pricing.
          Soft budgets raise alerts; hard budgets additionally deny routing in <span className="font-mono">/api/v1/route</span>.
          Ingested usage is never blocked retroactively.
        </span>
      </DataNote>
    </div>
  );
}
