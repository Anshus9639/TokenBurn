import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, ChevronRight, KeyRound, Plus, Server, Tag } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { requireSession } from "@/lib/auth";
import { getProjectDetail } from "@/lib/analytics";
import { apiKeys, environments } from "@/lib/db/schema";
import { createFeatureAction, revokeApiKeyAction } from "@/lib/actions/projects";
import { PageHeader, SectionHeader, EmptyState, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { DialogForm } from "@/components/dialog-form";
import { ConfirmForm } from "@/components/confirm-form";
import { ApiKeyForm } from "@/components/api-key-form";
import { MetricCard } from "@/components/kpi";
import { CategoryBars, ChartContainer, CostTrendChart } from "@/components/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { providerForModel } from "@/lib/brand/providers";
import { accentForName } from "@/lib/chart-colors";
import {
  cn,
  formatDateTimeUTC,
  formatInt,
  formatMs,
  formatPercent,
  formatUSD,
  pct,
  relativeTime,
  startOfMonthUTC,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "features", label: "Features" },
  { key: "keys", label: "API keys" },
] as const;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = (TABS.find((t) => t.key === tabParam)?.key ?? "overview") as (typeof TABS)[number]["key"];
  const session = await requireSession();
  const db = await getDb();
  const since = startOfMonthUTC(new Date());
  const detail = await getProjectDetail(db, session.org.id, id, since);
  if (!detail) notFound();

  const envRows = await db
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, id), eq(environments.orgId, session.org.id)));
  const envName = new Map(envRows.map((e) => [e.id, e.name]));

  const keyRows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, id), eq(apiKeys.orgId, session.org.id)))
    .orderBy(desc(apiKeys.createdAt));

  const totalCost = detail.usageByFeature.reduce((s, f) => s + f.costUsd, 0);
  const totalRequests = detail.usageByFeature.reduce((s, f) => s + f.requests, 0);
  const registered = new Set(detail.features.map((f) => f.name));
  const unregistered = detail.usageByFeature.filter((f) => !registered.has(f.feature));
  const featureCost = new Map(detail.usageByFeature.map((f) => [f.feature, f]));
  const accent = accentForName(detail.project.slug);
  const seriesCost = detail.series.reduce((s, p) => s + p.costUsd, 0);

  return (
    <div className="space-y-5">
      <div
        aria-hidden
        className="h-px w-24"
        style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.35), transparent 80%)" }}
      />
      <PageHeader
        kicker={`Projects · ${detail.project.slug}`}
        title={detail.project.name}
        description={detail.project.description ?? "No description for this project."}
      >
        <span
          className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em]"
          style={{
            borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`,
            background: `color-mix(in srgb, ${accent} 10%, transparent)`,
            color: accent,
          }}
        >
          <span className="size-1.5 rounded-full" style={{ background: accent }} />
          project accent
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/projects">
            <ArrowLeft className="size-3.5" />
            All projects
          </Link>
        </Button>
        <DialogForm
          trigger={
            <Button size="sm">
              <Plus className="size-3.5" />
              Add feature
            </Button>
          }
          title="Register a feature"
          description="Features name the product surface a request belongs to. Events are attributed by the feature slug."
          action={createFeatureAction}
          submitLabel="Register feature"
        >
          <input type="hidden" name="projectId" value={id} />
          <Field label="Feature name" hint="normalized to a slug">
            <Input name="name" placeholder="chat-completion" maxLength={60} required />
          </Field>
          <Field label="Description" hint="optional">
            <Textarea name="description" rows={2} maxLength={200} />
          </Field>
        </DialogForm>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/projects/${id}?tab=${t.key}`}
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

      {tab === "overview" ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard
              label="MTD spend"
              value={formatUSD(totalCost)}
              hint="Attributed to this project"
              accent="emerald"
              trend={detail.series.slice(-14).map((p) => p.costUsd)}
            />
            <MetricCard
              label="Requests"
              value={formatInt(totalRequests)}
              hint="Month-to-date"
              accent="blue"
              trend={detail.series.slice(-14).map((p) => p.requests)}
            />
            <MetricCard
              label="Features active"
              value={formatInt(detail.usageByFeature.length)}
              hint={`${detail.features.length} registered`}
              accent="violet"
            />
            <MetricCard
              label="Environments"
              value={formatInt(envRows.length)}
              hint={envRows.map((e) => e.name).join(" · ") || "No environments"}
              accent="cyan"
            />
          </div>

          <ChartContainer
            title="Spend · last 30 days"
            description="Daily normalized cost for this project"
            action={<span className="font-mono text-[11px] tabular text-ink-muted">{formatUSD(seriesCost)}</span>}
          >
            <CostTrendChart data={detail.series} height={240} color={accent} />
          </ChartContainer>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartContainer title="Spend by feature" description="Top features · MTD">
              {detail.usageByFeature.length ? (
                <CategoryBars
                  data={detail.usageByFeature.map((f) => ({ key: f.feature, costUsd: f.costUsd }))}
                  height={220}
                  maxItems={8}
                  colorMode="accent"
                />
              ) : (
                <EmptyState title="No usage yet" description="Send events for this project to populate the chart." className="border-0 py-10" />
              )}
            </ChartContainer>
            <Card>
              <CardTopBar>
                <div className="text-[12.5px] font-medium text-ink">Models used</div>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">MTD</span>
              </CardTopBar>
              <CardContent className="pt-2">
                {detail.models.map((m) => {
                  const brand = providerForModel(m.key);
                  return (
                    <div key={m.key} className="flex items-center gap-3 border-b border-hairline-faint py-2.5 last:border-0">
                      <ProviderLogo provider={brand.id} size={13} decorative />
                      <span className="truncate font-mono text-[11px] text-ink-muted">{m.key}</span>
                      <span className="ml-auto font-mono text-[11px] tabular text-ink">{formatUSD(m.costUsd)}</span>
                      <span className="w-16 text-right font-mono text-[10px] text-ink-faint">
                        {formatInt(m.requests)} req
                      </span>
                    </div>
                  );
                })}
                {detail.models.length === 0 ? (
                  <div className="py-6 text-center text-[11.5px] text-ink-faint">No models used yet.</div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {envRows.map((e) => (
                    <Badge key={e.id} variant={e.name === "production" ? "good" : "outline"}>
                      <Server className="size-2.5" />
                      {e.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {tab === "features" ? (
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <Tag className="size-3.5 text-ink-faint" />
              Feature attribution
            </div>
            <span className="font-mono text-[10px] text-ink-faint">
              {detail.features.length} registered · {unregistered.length} seen only in events
            </span>
          </CardTopBar>
          {detail.features.length || unregistered.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Feature</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Avg latency</TableHead>
                  <TableHead className="pr-5 text-right">MTD spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ...detail.features.map((f) => ({
                    name: f.name,
                    description: f.description,
                    registered: true,
                  })),
                  ...unregistered.map((f) => ({
                    name: f.feature,
                    description: null as string | null,
                    registered: false,
                  })),
                ].map((f) => {
                  const usage = featureCost.get(f.name);
                  return (
                    <TableRow key={f.name}>
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: accentForName(f.name) }}
                          />
                          <div>
                            <div className="font-mono text-[11.5px] text-ink-muted">{f.name}</div>
                            {f.description ? (
                              <div className="mt-0.5 text-[10.5px] text-ink-faint">{f.description}</div>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={f.registered ? "good" : "warn"}>
                          {f.registered ? "registered" : "event-only"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink-faint">
                        {formatInt(usage?.requests ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink-faint">
                        {formatInt(usage?.inputTokens ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink-faint">
                        {formatInt(usage?.outputTokens ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular text-ink-faint">
                        {usage ? formatMs(usage.avgLatency) : "—"}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <div className="font-mono text-[11px] tabular text-ink">{formatUSD(usage?.costUsd ?? 0)}</div>
                        {usage && totalCost > 0 ? (
                          <div className="font-mono text-[9px] text-ink-faint">
                            {formatPercent(pct(usage.costUsd, totalCost), 0)} of project
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState
                title="No features yet"
                description="Register features here, or send events with a feature name and they will appear automatically."
              />
            </div>
          )}
        </Card>
      ) : null}

      {tab === "keys" ? (
        <div className="space-y-4">
          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                <KeyRound className="size-3.5 text-ink-faint" />
                Issue a new key
              </div>
              <Badge variant="outline">member+</Badge>
            </CardTopBar>
            <CardContent className="pt-4">
              <ApiKeyForm projectId={id} environments={envRows.map((e) => ({ id: e.id, name: e.name }))} />
            </CardContent>
          </Card>

          <Card>
            <CardTopBar>
              <div className="text-[12.5px] font-medium text-ink">Keys</div>
              <span className="font-mono text-[10px] text-ink-faint">{keyRows.length} issued</span>
            </CardTopBar>
            {keyRows.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="pr-5 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keyRows.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="pl-5 text-[12px] text-ink-muted">{k.name}</TableCell>
                      <TableCell className="font-mono text-[10.5px] text-ink-faint">
                        {k.prefix}…{k.lastFour}
                      </TableCell>
                      <TableCell className="font-mono text-[10.5px] text-ink-faint">
                        {(k.environmentId && envName.get(k.environmentId)) ?? "any"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-faint">
                        {formatInt(k.requestCount)}
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-ink-faint">
                        {k.lastUsedAt ? relativeTime(k.lastUsedAt) : "never"}
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-ink-faint">
                        {formatDateTimeUTC(k.createdAt).split(",")[0]}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        {k.revokedAt ? (
                          <Badge variant="bad">revoked</Badge>
                        ) : (
                          <ConfirmForm
                            action={revokeApiKeyAction}
                            message={`Revoke key "${k.name}"? Requests using it will be rejected immediately.`}
                            className="inline"
                          >
                            <input type="hidden" name="keyId" value={k.id} />
                            <input type="hidden" name="projectId" value={id} />
                            <Button type="submit" variant="ghost" size="sm" className="h-7 text-[#FDA4AF] hover:text-[#FECDD3]">
                              Revoke
                            </Button>
                          </ConfirmForm>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-5">
                <EmptyState title="No API keys yet" description="Create a key to start ingesting usage for this project." />
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/analytics?project=${id}`}>
            View requests for this project
            <ChevronRight className="size-3.5" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/coach?project=${id}`}>Coach recommendations</Link>
        </Button>
      </div>

      <SectionHeader title="Attribution notes" />
      <DataNote>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Registered vs observed</span>
        <span>
          Features seen only in events are still attributed and billed. Registering a feature documents ownership and
          enables feature-scoped budgets and alert rules.
        </span>
      </DataNote>
    </div>
  );
}
