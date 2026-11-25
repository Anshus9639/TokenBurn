import Link from "next/link";
import {
  Building2,
  Database,
  ExternalLink,
  KeyRound,
  Layers,
  Lock,
  PlugZap,
  Plus,
  ShieldCheck,
  Tags,
  Trash2,
  Users,
} from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { requireSession, can } from "@/lib/auth";
import {
  apiKeys,
  environments,
  memberships,
  organizations,
  projects,
  providers,
  users,
} from "@/lib/db/schema";
import { getActiveCatalog } from "@/lib/pricing-db";
import { hasEnvProviderKey } from "@/lib/providers/env-keys";
import {
  addMemberAction,
  disconnectProviderAction,
  removeMemberAction,
  saveProviderAction,
  updateOrgProfileAction,
  verifyProviderConnectionAction,
} from "@/lib/actions/settings";
import { PageHeader, SectionHeader, DataNote } from "@/components/page";
import { MetricCard } from "@/components/kpi";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { providerBrand } from "@/lib/brand/providers";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { DialogForm } from "@/components/dialog-form";
import { ActionForm } from "@/components/action-form";
import { ConfirmForm } from "@/components/confirm-form";
import { MemberRoleControl } from "@/components/member-role-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatDate, formatInt, formatMs, formatUSD } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "profile", label: "Organization" },
  { key: "members", label: "Members & roles" },
  { key: "providers", label: "Providers" },
  { key: "keys", label: "API keys" },
  { key: "pricing", label: "Pricing catalog" },
] as const;

const selectClass =
  "h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12.5px] text-ink focus-visible:border-[#6B6B6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/[0.06]";

const PROVIDER_META: Record<string, { name: string; hint: string; docs: string }> = {
  openai: { name: "OpenAI", hint: "sk-…", docs: "https://platform.openai.com/api-keys" },
  anthropic: { name: "Anthropic", hint: "sk-ant-…", docs: "https://console.anthropic.com/settings/keys" },
  gemini: { name: "Google Gemini", hint: "AIza…", docs: "https://aistudio.google.com/app/apikey" },
  groq: { name: "Groq", hint: "gsk_…", docs: "https://console.groq.com/keys" },
  mistral: { name: "Mistral AI", hint: "from console.mistral.ai", docs: "https://console.mistral.ai/api-keys" },
};

const PROVIDER_ORDER = ["openai", "anthropic", "gemini", "groq", "mistral"] as const;

const ROLE_MATRIX: Array<{ role: string; capabilities: string }> = [
  { role: "owner", capabilities: "Everything, including organization profile and granting owner" },
  { role: "admin", capabilities: "Budgets, approvals, routing, providers, keys, members" },
  { role: "member", capabilities: "Ingest, projects, features, keys, draft routing, acknowledge alerts" },
  { role: "viewer", capabilities: "Read-only dashboards, analytics and coach questions" },
];

function providerBadge(status: string, envKey = false) {
  if (status === "verified") return <Badge variant="good">Verified</Badge>;
  if (status === "error") return <Badge variant="bad">Check failed</Badge>;
  if (status === "connected" || status === "configured") return <Badge variant="warn">Stored · unverified</Badge>;
  if (envKey) return <Badge variant="warn">Environment · unverified</Badge>;
  return <Badge variant="outline">Disconnected</Badge>;
}

function ProviderField({ provider, existing }: { provider: string; existing?: { label: string | null; keyLast4: string | null } }) {
  const meta = PROVIDER_META[provider]!;
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant={existing?.keyLast4 ? "outline" : "secondary"}>
          <KeyRound /> {existing?.keyLast4 ? "Replace key" : "Configure"}
        </Button>
      }
      title={`${meta.name} credentials`}
      description="Stored encrypted with AES-256-GCM. The plaintext key is never returned to the browser."
      action={saveProviderAction}
      submitLabel="Encrypt & save"
    >
      <input type="hidden" name="provider" value={provider} />
      <Field label="API key" hint={meta.hint}>
        <Input name="apiKey" type="password" required minLength={12} autoComplete="off" placeholder={meta.hint} />
      </Field>
      <Field label="Label" hint="optional">
        <Input name="label" defaultValue={existing?.label ?? ""} maxLength={80} placeholder={`${meta.name} production`} />
      </Field>
      <p className="text-[10.5px] leading-relaxed text-ink-faint">
        Saving replaces any existing credential and marks it <span className="text-ink-muted">unverified</span>. Use{" "}
        <span className="text-ink-muted">Test completion</span> afterwards to send one minimal real request and record
        the provider-reported tokens, latency and server-side cost.
      </p>
    </DialogForm>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab = (TABS.find((t) => t.key === tabParam)?.key ?? "profile") as (typeof TABS)[number]["key"];
  const session = await requireSession();
  const db = await getDb();
  const orgId = session.org.id;

  const canManageOrg = can(session.role, "manage_org");
  const canManageMembers = can(session.role, "manage_members");
  const canManageProviders = can(session.role, "manage_providers");
  const canManageKeys = can(session.role, "manage_keys");

  const [memberRows, providerRows, keyRows, projectRows, catalog, orgRows] = await Promise.all([
    db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        joined: memberships.createdAt,
        name: users.name,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(memberships.createdAt),
    db.select().from(providers).where(eq(providers.orgId, orgId)),
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        lastFour: apiKeys.lastFour,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        requestCount: apiKeys.requestCount,
        projectId: apiKeys.projectId,
        projectName: projects.name,
        environment: environments.name,
      })
      .from(apiKeys)
      .innerJoin(projects, eq(projects.id, apiKeys.projectId))
      .leftJoin(environments, eq(environments.id, apiKeys.environmentId))
      .where(eq(apiKeys.orgId, orgId))
      .orderBy(desc(apiKeys.createdAt)),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)),
    getActiveCatalog(db),
    db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1),
  ]);

  const org = orgRows[0];
  const settings = org?.settings;
  const providerByKey = new Map(providerRows.map((p) => [p.provider, p]));
  const activeKeys = keyRows.filter((k) => !k.revokedAt);
  const configuredProviders = providerRows.filter((p) => p.status !== "disconnected");

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Workspace · Access and integrations"
        title="Settings & Integrations"
        description="Organization profile, membership roles, encrypted provider credentials and the versioned pricing catalog."
      >
        <Badge variant="outline">{org?.plan ?? "scale"} plan</Badge>
        <Badge variant={settings?.dataMode === "synthetic" ? "warn" : "good"}>
          {settings?.dataMode ?? "synthetic"} data
        </Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Members"
          value={String(memberRows.length)}
          hint={`${memberRows.filter((m) => m.role === "owner" || m.role === "admin").length} with admin access`}
          accent="blue"
          icon={Users}
        />
        <MetricCard
          label="Projects"
          value={String(projectRows.length)}
          hint="Keys are scoped to project environments"
          accent="violet"
          icon={Layers}
        />
        <MetricCard
          label="Active API keys"
          value={String(activeKeys.length)}
          hint={`${keyRows.length - activeKeys.length} revoked`}
          accent="cyan"
          icon={KeyRound}
        />
        <MetricCard
          label="Provider credentials"
          value={String(configuredProviders.length)}
          hint={`${providerRows.filter((p) => p.status === "verified").length} verified · encrypted at rest`}
          accent="emerald"
          icon={PlugZap}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
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

      {tab === "profile" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <Building2 className="size-3.5 text-ink-faint" /> Organization profile
              </div>
              <Badge variant="outline">{org?.slug}</Badge>
            </CardTopBar>
            <CardContent className="pt-4">
              {canManageOrg ? (
                <ActionForm action={updateOrgProfileAction} submitLabel="Save profile" className="space-y-3.5">
                  <Field label="Organization name">
                    <Input name="name" defaultValue={org?.name ?? ""} required minLength={2} maxLength={80} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Slug" hint="immutable">
                      <Input defaultValue={org?.slug ?? ""} disabled />
                    </Field>
                    <Field label="Plan" hint="billing handled off-platform">
                      <Input defaultValue={org?.plan ?? "scale"} disabled />
                    </Field>
                  </div>
                  <Field label="Data mode" hint="labels provenance; does not convert events">
                    <select name="dataMode" defaultValue={settings?.dataMode ?? "synthetic"} className={selectClass}>
                      <option value="synthetic">Synthetic — seeded demo data</option>
                      <option value="live">Live — real provider events</option>
                      <option value="hybrid">Hybrid — both present</option>
                    </select>
                  </Field>
                  <p className="text-[10.5px] leading-relaxed text-ink-faint">
                    The data mode drives badges and notices across the workspace. It never rewrites stored usage; each event
                    keeps its own <span className="font-mono text-ink-muted">is_synthetic</span> flag.
                  </p>
                </ActionForm>
              ) : (
                <div className="space-y-2 text-[12px] text-ink-muted">
                  <div className="flex justify-between gap-4">
                    <span className="text-ink-faint">Name</span>
                    <span>{org?.name}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-ink-faint">Slug</span>
                    <span className="font-mono text-[11px]">{org?.slug}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-ink-faint">Data mode</span>
                    <span>{settings?.dataMode}</span>
                  </div>
                  <DataNote className="mt-3">
                    <Lock className="mt-0.5 size-3 shrink-0" />
                    <span>Organization profile changes require the owner role.</span>
                  </DataNote>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardTopBar>
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                  <ShieldCheck className="size-3.5 text-ink-faint" /> Security posture
                </div>
              </CardTopBar>
              <CardContent className="space-y-2.5 pt-4 text-[11.5px] leading-relaxed text-ink-faint">
                <div className="flex gap-2">
                  <span className="mt-[6px] size-1 shrink-0 rounded-full bg-chrome/50" />
                  <span>Passwords use scrypt with per-user salts; sessions are HttpOnly, hashed tokens.</span>
                </div>
                <div className="flex gap-2">
                  <span className="mt-[6px] size-1 shrink-0 rounded-full bg-chrome/50" />
                  <span>Project API keys are stored as SHA-256 hashes; plaintext is shown once.</span>
                </div>
                <div className="flex gap-2">
                  <span className="mt-[6px] size-1 shrink-0 rounded-full bg-chrome/50" />
                  <span>Provider credentials use AES-256-GCM with an environment-held key.</span>
                </div>
                <div className="flex gap-2">
                  <span className="mt-[6px] size-1 shrink-0 rounded-full bg-chrome/50" />
                  <span>Role checks run server-side on every action and API route.</span>
                </div>
                <Link href="/governance?tab=audit" className="inline-flex items-center gap-1 pt-1 text-[11px] text-ink-muted hover:text-ink">
                  View audit trail <ExternalLink className="size-3" />
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardTopBar>
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                  <Database className="size-3.5 text-ink-faint" /> Data provenance
                </div>
              </CardTopBar>
              <CardContent className="space-y-2 pt-4 text-[11.5px] leading-relaxed text-ink-faint">
                <p>
                  {settings?.dataMode === "synthetic"
                    ? "This workspace is running on deterministic synthetic seed data. Dashboards, alerts and coach findings are computed from those events and labelled as such."
                    : settings?.dataMode === "live"
                      ? "This workspace expects live provider events through the ingestion API. Synthetic rows, if any, remain individually flagged."
                      : "This workspace mixes synthetic seed rows and live events. Filters and badges reflect both; each event keeps its provenance flag."}
                </p>
                <Link href="/explorer" className="inline-flex items-center gap-1 pt-1 text-[11px] text-ink-muted hover:text-ink">
                  Ingestion explorer <ExternalLink className="size-3" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "members" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader title="Members" hint={`${memberRows.length} people · ${canManageMembers ? "you can manage roles" : "read only"}`} />
            {canManageMembers ? (
              <DialogForm
                trigger={
                  <Button size="sm">
                    <Plus /> Add member
                  </Button>
                }
                title="Add a member"
                description="Adds an existing TokenBurn account to this organization. There is no email invite — the account must sign up first."
                action={addMemberAction}
                submitLabel="Add member"
              >
                <Field label="Account email">
                  <Input name="email" type="email" required placeholder="teammate@company.dev" />
                </Field>
                <Field label="Role">
                  <select name="role" className={selectClass} defaultValue="member">
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                    {session.role === "owner" ? <option value="owner">owner</option> : null}
                  </select>
                </Field>
              </DialogForm>
            ) : null}
          </div>

          <Card>
            <CardContent className="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberRows.map((m) => {
                    const isSelf = m.userId === session.user.id;
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <span className="font-medium text-ink">{m.name}</span>
                          {isSelf ? <span className="ml-1.5 text-[10px] text-ink-faint">(you)</span> : null}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-ink-muted">{m.email}</TableCell>
                        <TableCell>
                          <MemberRoleControl
                            memberId={m.id}
                            role={m.role}
                            canManage={canManageMembers}
                            canGrantOwner={session.role === "owner"}
                            isSelf={isSelf}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-[10.5px] text-ink-faint">{formatDate(m.joined)}</TableCell>
                        <TableCell className="text-right">
                          {canManageMembers && !isSelf && m.role !== "owner" ? (
                            <ConfirmForm
                              action={removeMemberAction}
                              message={`Remove ${m.email} from this organization?`}
                              className="inline"
                            >
                              <input type="hidden" name="memberId" value={m.id} />
                              <Button type="submit" size="sm" variant="ghost" aria-label={`Remove ${m.email}`}>
                                <Trash2 />
                              </Button>
                            </ConfirmForm>
                          ) : (
                            <span className="text-[10px] text-ink-faint">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <Users className="size-3.5 text-ink-faint" /> Role capabilities
              </div>
            </CardTopBar>
            <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
              {ROLE_MATRIX.map((r) => (
                <div key={r.role} className="rounded-md border border-hairline-faint bg-white/[0.015] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.role === "owner" ? "chrome" : "outline"}>{r.role}</Badge>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{r.capabilities}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "providers" ? (
        <div className="space-y-4">
          <SectionHeader
            title="Provider credentials"
            hint="Encrypted at rest · operator env keys as fallback"
          />
          <div className="grid gap-4 md:grid-cols-2">
            {PROVIDER_ORDER.map((key) => {
              const meta = PROVIDER_META[key]!;
              const row = providerByKey.get(key);
              const brand = providerBrand(key);
              const envKey = hasEnvProviderKey(key);
              return (
                <Card key={key} className="relative overflow-hidden">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-px"
                    style={{ background: `linear-gradient(90deg, transparent, ${brand.color}88, transparent)` }}
                  />
                  <CardTopBar>
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-hairline bg-white/[0.03]">
                        <ProviderLogo provider={key} size={16} decorative />
                      </span>
                      <div>
                        <span className="block text-[12.5px] font-medium text-ink">{meta.name}</span>
                        <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                          {key} · adapter
                        </span>
                      </div>
                    </div>
                    {providerBadge(row?.status ?? "disconnected", envKey)}
                  </CardTopBar>
                  <CardContent className="space-y-3 pt-4">
                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                      <div>
                        <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">Credential</div>
                        <div className="mt-0.5 font-mono text-[11px] text-ink-muted">
                          {row?.keyLast4
                            ? `•••• •••• ${row.keyLast4}`
                            : envKey
                              ? "operator env key"
                              : "not stored"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">Last verified</div>
                        <div className="mt-0.5 text-[11px] text-ink-muted">
                          {(row?.status === "verified" || row?.status === "error") && row.lastSyncedAt
                            ? formatDate(row.lastSyncedAt, true)
                            : "never"}
                        </div>
                      </div>
                    </div>
                    {row?.label ? <p className="text-[11px] text-ink-faint">{row.label}</p> : null}
                    {row?.status === "error" && row.lastError ? (
                      <p className="rounded-md border border-accent-rose/30 bg-accent-rose/[0.07] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-[#FDA4AF]">
                        {row.lastError}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 border-t border-hairline-faint pt-2.5">
                      {canManageProviders ? (
                        <>
                          <ProviderField provider={key} existing={row} />
                          {row?.credentialsEnc || envKey ? (
                            <ActionForm
                              action={verifyProviderConnectionAction}
                              submitLabel="Test completion"
                              pendingLabel="Testing…"
                              variant="outline"
                              size="sm"
                              className="inline-flex"
                              footer="inline"
                            >
                              <input type="hidden" name="provider" value={key} />
                            </ActionForm>
                          ) : null}
                          {row?.credentialsEnc ? (
                            <ConfirmForm
                              action={disconnectProviderAction}
                              message={`Remove the stored ${meta.name} credential? Ingestion via TokenBurn API keys is unaffected.`}
                              className="inline"
                            >
                              <input type="hidden" name="provider" value={key} />
                              <Button type="submit" size="sm" variant="ghost">
                                <Trash2 /> Remove
                              </Button>
                            </ConfirmForm>
                          ) : null}
                        </>
                      ) : (
                        <span className="flex items-center gap-1 text-[10.5px] text-ink-faint">
                          <Lock className="size-3" /> Admin access required
                        </span>
                      )}
                      <a
                        href={meta.docs}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-ink-faint hover:text-ink-muted"
                      >
                        Key console <ExternalLink className="size-3" />
                      </a>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <DataNote>
            <Lock className="mt-0.5 size-3 shrink-0" />
            <span>
              Credentials are encrypted with AES-256-GCM before insert; only the last four characters are stored in
              plaintext for identification. <span className="text-ink-muted">Test connection</span> decrypts the key
              server-side and performs a read-only request to the provider&apos;s model list — the outcome, latency and
              request ID are stored and audited, but the secret never reaches the browser or logs. Passing the test proves
              the credential is accepted; it does not import usage. Normalized usage still arrives through the ingestion
              API, so provider keys are optional today.
            </span>
          </DataNote>
        </div>
      ) : null}

      {tab === "keys" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader title="API keys" hint="SHA-256 hashes at rest · plaintext shown once" />
            <Button asChild size="sm" variant="outline">
              <Link href="/projects">
                <KeyRound /> Manage in projects
              </Link>
            </Button>
          </div>
          {keyRows.length ? (
            <Card>
              <CardContent className="px-0 pb-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Token</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keyRows.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell>
                          <Link
                            href={`/projects/${k.projectId}?tab=keys`}
                            className="text-ink underline-offset-2 hover:underline"
                          >
                            {k.name}
                          </Link>
                          <div className="mt-0.5 font-mono text-[10px] text-ink-faint">created {formatDate(k.createdAt)}</div>
                        </TableCell>
                        <TableCell className="text-[11.5px] text-ink-muted">{k.projectName}</TableCell>
                        <TableCell>
                          <span className="font-mono text-[10.5px] text-ink-faint">{k.environment ?? "—"}</span>
                        </TableCell>
                        <TableCell className="font-mono text-[10.5px] text-ink-muted">{k.prefix}…{k.lastFour}</TableCell>
                        <TableCell className="text-right font-mono text-[11px] tabular text-ink-muted">
                          {formatInt(k.requestCount)}
                        </TableCell>
                        <TableCell className="font-mono text-[10.5px] text-ink-faint">
                          {k.lastUsedAt ? formatDate(k.lastUsedAt, true) : "never"}
                        </TableCell>
                        <TableCell className="text-right">
                          {k.revokedAt ? <Badge variant="bad">Revoked</Badge> : <Badge variant="good">Active</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4 text-[11.5px] text-ink-faint">
                No API keys yet. Create one from a project&apos;s Keys tab.
              </CardContent>
            </Card>
          )}

          <DataNote>
            <KeyRound className="mt-0.5 size-3 shrink-0" />
            <span>
              Keys authenticate ingestion and routing calls, are scoped to a project, and are rate-limited per key. Revoking
              a key takes effect immediately for API requests. {canManageKeys ? "You can issue and revoke keys from Projects." : "Your role cannot issue keys."}
            </span>
          </DataNote>
        </div>
      ) : null}

      {tab === "pricing" ? (
        <div className="space-y-4">
          <SectionHeader title="Active pricing catalog" hint={`${catalog.length} rows · versioned · per 1M tokens`} />
          <Card>
            <CardContent className="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Cached</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">Cache write</TableHead>
                    <TableHead className="text-right">Context</TableHead>
                    <TableHead className="text-right">Quality</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Version</TableHead>
                    <TableHead>Effective</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...catalog]
                    .sort((a, b) => a.provider.localeCompare(b.provider) || a.displayName.localeCompare(b.displayName))
                    .map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ProviderLogo provider={p.provider} size={14} decorative />
                            <div>
                              <div className="font-medium text-ink">{p.displayName}</div>
                              <div className="mt-0.5 font-mono text-[9.5px] uppercase text-ink-faint">
                                {p.provider} · {p.category}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-muted">
                          {formatUSD(p.inputPerM, true)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-muted">
                          {formatUSD(p.cachedInputPerM, true)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-muted">
                          {formatUSD(p.outputPerM, true)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-faint">
                          {p.cacheWritePerM === null ? "1.25× in" : formatUSD(p.cacheWritePerM, true)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-faint">
                          {formatInt(p.contextWindow)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-muted">{p.qualityScore}</TableCell>
                        <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-faint">{formatMs(p.typicalLatencyMs)}</TableCell>
                        <TableCell className="text-right font-mono text-[10.5px] tabular text-ink-muted">v{p.version}</TableCell>
                        <TableCell className="font-mono text-[10px] text-ink-faint">{formatDate(p.effectiveFrom)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <DataNote>
            <Tags className="mt-0.5 size-3 shrink-0" />
            <span>
              Pricing is versioned by <span className="font-mono text-ink-muted">(provider, model, version)</span>. New rates
              supersede old rows rather than overwriting them, so historical events keep the price that applied when they
              occurred. All costs are computed server-side with the authoritative engine — six-decimal precision, cached
              input as a subset of total input.
            </span>
          </DataNote>
        </div>
      ) : null}
    </div>
  );
}
