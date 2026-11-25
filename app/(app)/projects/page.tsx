import Link from "next/link";
import { ArrowRight, Boxes, Layers, Plus, TerminalSquare } from "lucide-react";
import { getDb, rawQuery } from "@/lib/db/client";
import { requireSession } from "@/lib/auth";
import { getProjectSummaries } from "@/lib/analytics";
import { createProjectAction } from "@/lib/actions/projects";
import { PageHeader, SectionHeader, EmptyState, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { DialogForm } from "@/components/dialog-form";
import { MetricCard } from "@/components/kpi";
import { CategoryBars, ChartContainer } from "@/components/charts";
import { StatusBadge } from "@/components/ui/status-badge";
import { accentForName } from "@/lib/chart-colors";
import { formatInt, formatUSD, relativeTime, startOfMonthUTC } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await requireSession();
  const db = await getDb();
  const since = startOfMonthUTC(new Date());
  const projects = await getProjectSummaries(db, session.org.id, since);

  const keys = await rawQuery<{ project_id: string; active: string; revoked: string }>(
    `select project_id, count(*) filter (where revoked_at is null)::int as active,
            count(*) filter (where revoked_at is not null)::int as revoked
       from api_keys where org_id = $1 group by project_id`,
    [session.org.id],
  );
  const keyMap = new Map(keys.rows.map((r) => [r.project_id, r]));
  const totalSpend = projects.reduce((s, p) => s + p.costUsd, 0);
  const totalFeatures = projects.reduce((s, p) => s + p.featureCount, 0);
  const activeKeys = keys.rows.reduce((s, r) => s + Number(r.active), 0);
  const totalRequests = projects.reduce((s, p) => s + p.requests, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Manage · Attribution boundary"
        title="Projects & Features"
        description="Projects isolate API keys, environments and governance. Features name the product surface each request belongs to."
      >
        <DialogForm
          trigger={
            <Button size="sm">
              <Plus className="size-3.5" />
              New project
            </Button>
          }
          title="Create a project"
          description="A project groups environments, keys and feature attribution. Three environments are created automatically."
          action={createProjectAction}
          submitLabel="Create project"
        >
          <Field label="Name">
            <Input name="name" placeholder="Atlas API" maxLength={60} required />
          </Field>
          <Field label="Description" hint="optional">
            <Textarea name="description" rows={3} placeholder="Customer-facing support assistant" maxLength={240} />
          </Field>
        </DialogForm>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Projects" value={formatInt(projects.length)} hint="Each with isolated keys" accent="blue" icon={Boxes} />
        <MetricCard label="Monthly spend" value={formatUSD(totalSpend)} hint="Sum of project MTD spend" accent="emerald" />
        <MetricCard label="Features tracked" value={formatInt(totalFeatures)} hint="Feature-level attribution" accent="violet" />
        <MetricCard
          label="Active API keys"
          value={formatInt(activeKeys)}
          hint={`Hashed at rest · ${formatInt(totalRequests)} requests MTD`}
          accent="cyan"
        />
      </div>

      {projects.length > 1 && totalSpend > 0 ? (
        <ChartContainer
          title="Project comparison"
          description="Month-to-date normalized spend · every project keeps the same accent everywhere"
          action={
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {formatUSD(totalSpend)} MTD
            </span>
          }
        >
          <CategoryBars
            data={projects.map((p) => ({ key: p.name, costUsd: p.costUsd, color: accentForName(p.slug) }))}
            height={Math.min(280, 56 + projects.length * 36)}
            maxItems={8}
          />
        </ChartContainer>
      ) : null}

      <SectionHeader title="All projects" hint={`${projects.length} total · month-to-date attribution`} />

      {projects.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const k = keyMap.get(p.id);
            const accent = accentForName(p.slug);
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="group block">
                <Card className="panel relative h-full overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-lift">
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-0 h-px opacity-80"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
                  />
                  <CardTopBar>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        className="flex size-8 items-center justify-center rounded-[7px] border font-mono text-[11px] text-ink"
                        style={{
                          borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
                          background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 22%, transparent), color-mix(in srgb, ${accent} 6%, transparent))`,
                        }}
                      >
                        {p.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-ink">{p.name}</div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">{p.slug}</div>
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                  </CardTopBar>
                  <CardContent className="pt-4">
                    <p className="line-clamp-2 min-h-[32px] text-[11.5px] leading-relaxed text-ink-faint">
                      {p.description ?? "No description."}
                    </p>
                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        <div className="kicker">MTD spend</div>
                        <div className="mt-1 font-num text-[20px] tabular text-ink">{formatUSD(p.costUsd)}</div>
                      </div>
                      <span
                        className="flex size-7 items-center justify-center rounded-full border border-hairline text-ink-faint transition-colors group-hover:text-ink"
                        style={{ background: `color-mix(in srgb, ${accent} 10%, transparent)` }}
                      >
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-hairline-faint pt-3">
                      <div>
                        <div className="font-mono text-[10.5px] tabular text-ink-muted">{formatInt(p.requests)}</div>
                        <div className="kicker mt-0.5 text-[8.5px]">requests</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10.5px] tabular text-ink-muted">{formatInt(p.featureCount)}</div>
                        <div className="kicker mt-0.5 text-[8.5px]">features</div>
                      </div>
                      <div>
                        <div className="font-mono text-[10.5px] tabular text-ink-muted">
                          {formatInt(Number(k?.active ?? 0))}
                        </div>
                        <div className="kicker mt-0.5 text-[8.5px]">keys</div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between font-mono text-[9.5px] text-ink-faint">
                      <span>Last event {p.lastEventAt ? relativeTime(p.lastEventAt) : "never"}</span>
                      <span className="tabular">{formatUSD(p.costUsd / Math.max(p.requests, 1), true)}/req</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No projects yet"
          description="Create your first project to issue an API key and start ingesting normalized usage events."
          icon={<Boxes className="size-4" />}
          action={
            <DialogForm
              trigger={<Button size="sm">Create project</Button>}
              title="Create a project"
              action={createProjectAction}
              submitLabel="Create project"
            >
              <Field label="Name">
                <Input name="name" placeholder="Atlas API" required />
              </Field>
              <Field label="Description" hint="optional">
                <Textarea name="description" rows={3} />
              </Field>
            </DialogForm>
          }
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <Layers className="size-3.5 text-ink-faint" />
              Attribution model
            </div>
          </CardTopBar>
          <CardContent className="pt-3 text-[11.5px] leading-relaxed text-ink-faint">
            <p>
              Each event is attributed to{" "}
              <span className="font-mono text-[10.5px] text-ink-muted">project → environment → feature</span>. The API
              key determines the project and optional default environment; the payload can override environment and must
              name the feature. Unknown feature strings are normalized to a safe slug at ingest.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="accent">org</Badge>
              <span className="text-ink-faint">→</span>
              <Badge variant="info">project</Badge>
              <span className="text-ink-faint">→</span>
              <Badge variant="warn">environment</Badge>
              <span className="text-ink-faint">→</span>
              <Badge variant="good">feature</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <TerminalSquare className="size-3.5 text-ink-faint" />
              SDK-less ingestion
            </div>
          </CardTopBar>
          <CardContent className="pt-3">
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              Any language can POST normalized usage to the ingestion API. Provider adapters are optional helpers —
              normalized events are the contract.
            </p>
            <Button asChild variant="secondary" size="sm" className="mt-3">
              <Link href="/explorer">
                Open API explorer
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <DataNote>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Keys</span>
        <span>
          Project keys are stored as salted SHA-256 hashes and shown in plaintext exactly once at creation. Revoking a
          key is immediate; historical events keep their attribution but new requests are rejected.
        </span>
      </DataNote>
    </div>
  );
}
