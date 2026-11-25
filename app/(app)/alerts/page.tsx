import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  CheckCheck,
  CircleDot,
  FileText,
  Plus,
  RotateCcw,
  Rss,
  ShieldAlert,
} from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { getDb, rawQuery } from "@/lib/db/client";
import { requireSession, can } from "@/lib/auth";
import { alertRules, alerts, projects, reports } from "@/lib/db/schema";
import { alertDecisionAction, createAlertRuleAction, generateReportAction, toggleAlertRuleAction } from "@/lib/actions/governance";
import { PageHeader, SectionHeader, EmptyState, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { DialogForm } from "@/components/dialog-form";
import { MetricCard, ProvenanceBadge } from "@/components/kpi";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatDate, formatInt, formatUSD, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "rules", label: "Rules" },
  { key: "reports", label: "Reports" },
] as const;

const STATUS_FILTERS = ["open", "acknowledged", "resolved", "all"] as const;

function severityVariant(severity: string) {
  return severity === "critical" ? "bad" : severity === "warning" ? "warn" : "default";
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "inbox") as (typeof TABS)[number]["key"];
  const status = (STATUS_FILTERS as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as (typeof STATUS_FILTERS)[number])
    : "open";
  const session = await requireSession();
  const db = await getDb();
  const canAck = can(session.role, "ack_alerts");
  const canRules = can(session.role, "manage_rules");

  const [alertRows, ruleRows, reportRows, projectRows, featureRows] = await Promise.all([
    db.select().from(alerts).where(eq(alerts.orgId, session.org.id)).orderBy(desc(alerts.createdAt)).limit(200),
    db.select().from(alertRules).where(eq(alertRules.orgId, session.org.id)).orderBy(desc(alertRules.createdAt)),
    db.select().from(reports).where(eq(reports.orgId, session.org.id)).orderBy(desc(reports.createdAt)).limit(24),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, session.org.id)),
    rawQuery<{ feature: string }>(
      `select distinct feature from usage_events where org_id = $1 order by feature limit 100`,
      [session.org.id],
    ),
  ]);

  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const visible = status === "all" ? alertRows : alertRows.filter((a) => a.status === status);
  const openCount = alertRows.filter((a) => a.status === "open").length;
  const criticalCount = alertRows.filter((a) => a.status === "open" && a.severity === "critical").length;
  const ackCount = alertRows.filter((a) => a.status === "acknowledged").length;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Control · Detection & reporting"
        title="Alerts & Reports"
        description="Budget thresholds, spend spikes and provider errors raise deduplicated alerts. Reports snapshot measured periods."
      >
        <Badge variant={openCount ? "warn" : "good"}>{openCount} open</Badge>
        <Button asChild variant="secondary" size="sm">
          <Link href="/governance?tab=budgets">Manage budgets</Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Open alerts"
          value={String(openCount)}
          hint="Deduplicated by fingerprint"
          tone={openCount > 0 ? "warn" : "good"}
          accent="amber"
          icon={BellRing}
        />
        <MetricCard
          label="Critical"
          value={String(criticalCount)}
          hint="Budget breach or spike"
          tone={criticalCount > 0 ? "bad" : "default"}
          accent="rose"
          icon={ShieldAlert}
        />
        <MetricCard
          label="Acknowledged"
          value={String(ackCount)}
          hint="Seen, not yet resolved"
          accent="blue"
          icon={CheckCheck}
        />
        <MetricCard
          label="Rules"
          value={`${ruleRows.filter((r) => r.enabled).length} / ${ruleRows.length}`}
          hint="Enabled / total"
          accent="violet"
          icon={Rss}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/alerts?tab=${t.key}`}
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

      {tab === "inbox" ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <Link
                key={s}
                href={`/alerts?tab=inbox&status=${s}`}
                className={cn(
                  "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
                  status === s
                    ? "border-hairline-strong bg-white/[0.07] text-ink"
                    : "border-hairline text-ink-faint hover:border-hairline-strong hover:text-ink-muted",
                )}
              >
                {s}
              </Link>
            ))}
            <span className="ml-auto font-mono text-[10px] text-ink-faint">{visible.length} alerts</span>
          </div>

          {visible.length ? (
            <div className="space-y-3">
              {visible.map((alert) => (
                <Card key={alert.id} className="relative overflow-hidden">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 left-0 w-[2px]",
                      alert.severity === "critical"
                        ? "bg-accent-rose"
                        : alert.severity === "warning"
                          ? "bg-accent-amber"
                          : "bg-neutral-500",
                    )}
                  />
                  <CardContent className="px-4 py-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div
                          className={cn(
                            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                            alert.severity === "critical"
                              ? "border-accent-rose/35 bg-accent-rose/10 text-[#FDA4AF]"
                              : alert.severity === "warning"
                                ? "border-accent-amber/35 bg-accent-amber/10 text-[#FCD34D]"
                                : "border-hairline bg-graphite text-ink-faint",
                          )}
                        >
                          {alert.severity === "critical" ? (
                            <ShieldAlert className="size-3.5" />
                          ) : alert.severity === "warning" ? (
                            <AlertTriangle className="size-3.5" />
                          ) : (
                            <CircleDot className="size-3.5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12.5px] font-medium text-ink">{alert.title}</span>
                            <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                            <Badge variant="outline">{alert.type.replaceAll("_", " ")}</Badge>
                            <Badge variant={alert.status === "open" ? "warn" : alert.status === "acknowledged" ? "default" : "good"}>
                              {alert.status}
                            </Badge>
                          </div>
                          <p className="mt-1 max-w-3xl text-[11.5px] leading-relaxed text-ink-faint">{alert.body}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-faint">
                            <span>{relativeTime(alert.createdAt)}</span>
                            <span className="text-ink-faint/50">·</span>
                            <span>
                              metric {Number(alert.metricValue ?? 0).toFixed(2)} / threshold{" "}
                              {Number(alert.threshold ?? 0).toFixed(2)}
                            </span>
                            {alert.acknowledgedBy ? (
                              <>
                                <span className="text-ink-faint/50">·</span>
                                <span>acknowledged by {alert.acknowledgedBy}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      {canAck ? (
                        <div className="flex items-center gap-1.5">
                          {alert.status === "open" ? (
                            <form action={alertDecisionAction}>
                              <input type="hidden" name="alertId" value={alert.id} />
                              <input type="hidden" name="intent" value="acknowledge" />
                              <Button type="submit" variant="secondary" size="sm" className="h-7">
                                <CheckCheck className="size-3" />
                                Acknowledge
                              </Button>
                            </form>
                          ) : null}
                          {alert.status !== "resolved" ? (
                            <form action={alertDecisionAction}>
                              <input type="hidden" name="alertId" value={alert.id} />
                              <input type="hidden" name="intent" value="resolve" />
                              <Button type="submit" variant="ghost" size="sm" className="h-7">
                                Resolve
                              </Button>
                            </form>
                          ) : (
                            <form action={alertDecisionAction}>
                              <input type="hidden" name="alertId" value={alert.id} />
                              <input type="hidden" name="intent" value="reopen" />
                              <Button type="submit" variant="ghost" size="sm" className="h-7">
                                <RotateCcw className="size-3" />
                                Reopen
                              </Button>
                            </form>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              title={`No ${status === "all" ? "" : status} alerts`}
              description="Alerts are created when budget thresholds, daily spend, cost spikes or error rates cross their configured limits."
              icon={<BellRing className="size-4" />}
            />
          )}
        </>
      ) : null}

      {tab === "rules" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader title="Alert rules" hint="Evaluated at ingest, throttled to one run per 30s per org" />
            {canRules ? (
              <DialogForm
                trigger={
                  <Button size="sm">
                    <Plus className="size-3.5" />
                    New rule
                  </Button>
                }
                title="Create an alert rule"
                description="Rules run against the event store. Budget alerts are configured on the budget itself."
                action={createAlertRuleAction}
                submitLabel="Create rule"
              >
                <Field label="Name">
                  <Input name="name" placeholder="Errors above 5%" maxLength={60} required />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Type">
                    <select
                      name="type"
                      defaultValue="daily_spend"
                      className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
                    >
                      <option value="daily_spend">Daily spend</option>
                      <option value="cost_spike">Cost spike vs 14d</option>
                      <option value="error_rate">Error rate</option>
                    </select>
                  </Field>
                  <Field label="Severity">
                    <select
                      name="severity"
                      defaultValue="warning"
                      className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
                    >
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Scope">
                    <select
                      name="scope"
                      defaultValue="organization"
                      className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
                    >
                      <option value="organization">Organization</option>
                      <option value="project">Project</option>
                      <option value="feature">Feature</option>
                    </select>
                  </Field>
                  <Field label="Project" hint="if scoped">
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
                </div>
                <Field label="Feature" hint="if scoped">
                  <Input name="feature" list="alert-feature-options" placeholder="chat-completion" />
                  <datalist id="alert-feature-options">
                    {featureRows.rows.map((f) => (
                      <option key={f.feature} value={f.feature} />
                    ))}
                  </datalist>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Threshold" hint="USD, ratio or %">
                    <Input name="threshold" type="number" step="0.01" min="0.01" placeholder="5" required />
                  </Field>
                  <Field label="Window">
                    <select
                      name="windowHours"
                      defaultValue="24"
                      className="h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12px] text-ink-muted focus:border-[#6B6B6B] focus:outline-none"
                    >
                      <option value="1">1 hour</option>
                      <option value="6">6 hours</option>
                      <option value="12">12 hours</option>
                      <option value="24">24 hours</option>
                      <option value="72">72 hours</option>
                    </select>
                  </Field>
                </div>
              </DialogForm>
            ) : null}
          </div>

          <Card>
            <CardTopBar>
              <div className="text-[12.5px] font-medium text-ink">Configured rules</div>
              <span className="font-mono text-[10px] text-ink-faint">{ruleRows.length}</span>
            </CardTopBar>
            {ruleRows.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="pr-5 text-right">State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ruleRows.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="pl-5 text-[12px] text-ink-muted">{rule.name}</TableCell>
                      <TableCell className="font-mono text-[10.5px] text-ink-faint">
                        {rule.type.replaceAll("_", " ")}
                      </TableCell>
                      <TableCell className="font-mono text-[10.5px] text-ink-faint">
                        {rule.scope}
                        {rule.projectId ? ` · ${projectName.get(rule.projectId) ?? ""}` : ""}
                        {rule.feature ? ` · ${rule.feature}` : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-muted">
                        {Number(rule.threshold).toFixed(2)}
                        {rule.type === "error_rate" ? "%" : rule.type === "cost_spike" ? "x" : ""}
                      </TableCell>
                      <TableCell className="font-mono text-[10.5px] text-ink-faint">{rule.windowHours}h</TableCell>
                      <TableCell>
                        <Badge variant={severityVariant(rule.severity)}>{rule.severity}</Badge>
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        {canRules ? (
                          <form action={toggleAlertRuleAction} className="inline">
                            <input type="hidden" name="ruleId" value={rule.id} />
                            <Button type="submit" variant="ghost" size="sm" className="h-7">
                              {rule.enabled ? "Pause" : "Enable"}
                            </Button>
                          </form>
                        ) : (
                          <Badge variant={rule.enabled ? "good" : "outline"}>{rule.enabled ? "on" : "off"}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-5">
                <EmptyState title="No alert rules" description="Create a rule to detect spend spikes or provider errors." />
              </div>
            )}
          </Card>
        </>
      ) : null}

      {tab === "reports" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader title="Reports" hint="Snapshots of measured periods" />
            <form action={generateReportAction}>
              <Button type="submit" variant="secondary" size="sm">
                <Rss className="size-3.5" />
                Generate weekly report
              </Button>
            </form>
          </div>
          {reportRows.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {reportRows.map((r) => {
                const s = r.summary as {
                  totalCostUsd?: number;
                  requests?: number;
                  topFeature?: string | null;
                  topFeatureCostUsd?: number;
                  projectedMonthlyUsd?: number;
                };
                return (
                  <Card key={r.id}>
                    <CardTopBar>
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-medium text-ink">{r.title}</div>
                        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                          {formatDate(r.periodStart)} → {formatDate(r.periodEnd)}
                        </div>
                      </div>
                      <span className="flex items-center gap-1.5">
                        <ProvenanceBadge kind="projected" />
                        <Badge variant="outline">{r.type}</Badge>
                      </span>
                    </CardTopBar>
                    <CardContent className="pt-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="kicker">Spend</div>
                          <div className="mt-1 font-num text-[18px] tabular text-ink">
                            {formatUSD(s.totalCostUsd ?? 0)}
                          </div>
                        </div>
                        <div>
                          <div className="kicker">Requests</div>
                          <div className="mt-1 font-num text-[18px] tabular text-ink">
                            {formatInt(s.requests ?? 0)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-hairline-faint pt-2 text-[10.5px] leading-relaxed text-ink-faint">
                        Top feature{" "}
                        <span className="font-mono text-ink-muted">{s.topFeature ?? "—"}</span> at{" "}
                        {formatUSD(s.topFeatureCostUsd ?? 0)} · projected monthly{" "}
                        {formatUSD(s.projectedMonthlyUsd ?? 0)}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No reports yet"
              description="Generate a weekly report to snapshot spend, requests and the top feature for the last 7 days."
              icon={<FileText className="size-4" />}
            />
          )}
        </>
      ) : null}

      <DataNote>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Deduplication</span>
        <span>
          Alerts carry a fingerprint unique per organization, budget/rule and period. Re-evaluation updates nothing and
          never floods the inbox; a resolved alert can be reopened manually.
        </span>
      </DataNote>
    </div>
  );
}
