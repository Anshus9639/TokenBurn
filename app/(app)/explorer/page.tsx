import Link from "next/link";
import { ArrowRight, KeyRound, Lock, ShieldCheck, TerminalSquare, Zap } from "lucide-react";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { requireSession } from "@/lib/auth";
import { apiKeys, projects } from "@/lib/db/schema";
import { PageHeader, SectionHeader, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiConsole } from "@/components/api-console";
import { JsonCode } from "@/components/json-code";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInt } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/v1/events",
    summary: "Ingest one event or a batch of up to 100 normalized usage events.",
    auth: "Project API key",
    scope: "write",
  },
  {
    method: "GET",
    path: "/api/v1/events",
    summary: "List the most recent events for the key's project.",
    auth: "Project API key",
    scope: "read",
  },
  {
    method: "GET",
    path: "/api/v1/usage",
    summary: "Aggregated spend, tokens and requests grouped by day, feature, model or environment.",
    auth: "Project API key",
    scope: "read",
  },
  {
    method: "GET",
    path: "/api/v1/models",
    summary: "Active pricing catalog with per-million rates, quality and latency metadata.",
    auth: "Project API key",
    scope: "read",
  },
  {
    method: "POST",
    path: "/api/v1/route",
    summary: "Pre-flight cost estimate plus governance decision before you call a provider.",
    auth: "Project API key",
    scope: "read",
  },
  {
    method: "GET",
    path: "/api/v1/health",
    summary: "Service and database health with ingestion recency.",
    auth: "Public",
    scope: "meta",
  },
];

const CURL = `curl -X POST https://your-deploy/api/v1/events \\
  -H "Authorization: Bearer $TOKENBURN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "feature": "chat-completion",
    "environment": "production",
    "inputTokens": 1200,
    "cachedInputTokens": 800,
    "outputTokens": 240,
    "latencyMs": 842,
    "statusCode": 200,
    "requestId": "req_01HT...",
    "idempotencyKey": "chat-01HT..."
  }'`;

const RESPONSE = `{
  "data": {
    "id": "0f0c4a0e-…",
    "duplicate": false,
    "costUsd": 0.000612,
    "pricingVersion": 1,
    "model": "gpt-4.1-mini",
    "provider": "openai",
    "occurredAt": "2026-11-20T10:14:02.000Z",
    "breakdown": {
      "inputUsd": 0.00016,
      "cachedInputUsd": 0.00008,
      "cacheWriteUsd": 0,
      "outputUsd": 0.000384,
      "reasoningUsd": 0,
      "discountApplied": 0.00024,
      "pricingVersion": 1
    }
  }
}`;

const ROUTE_RESPONSE = `{
  "allowed": false,
  "reason": "Hard limit reached for Orbit monthly budget…",
  "requested": { "provider": "anthropic", "model": "claude-sonnet-4" },
  "policy": { "name": "Orbit schema summaries", "strategy": "balanced" },
  "estimate": { "costUsd": 0.087, "pricingVersion": 1 },
  "alternatives": [
    { "key": "openai/gpt-4.1-mini", "savingsPct": 0.94, "qualityScore": 82 }
  ]
}`;

export default async function ExplorerPage() {
  const session = await requireSession();
  const db = await getDb();
  const projectRows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.orgId, session.org.id));
  const keyRows = await db
    .select({ projectId: apiKeys.projectId, count: sql<string>`count(*)` })
    .from(apiKeys)
    .where(and(eq(apiKeys.orgId, session.org.id), sql`${apiKeys.revokedAt} is null`))
    .groupBy(apiKeys.projectId);
  const keyCount = new Map(keyRows.map((r) => [r.projectId, Number(r.count)]));

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Manage · Developer surface"
        title="API Explorer"
        description="A small, explicit HTTP surface: normalize usage, price it server-side, query aggregates and pre-flight routes."
      >
        <Badge variant="outline">REST · JSON</Badge>
        <Button asChild variant="secondary" size="sm">
          <Link href="/projects">
            <KeyRound className="size-3.5" />
            Create a key
          </Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Endpoints", value: String(ENDPOINTS.length), hint: "Versioned under /api/v1" },
          { label: "Auth", value: "Bearer", hint: "Hashed project keys" },
          { label: "Batch limit", value: "100", hint: "Events per request" },
          { label: "Rate limit", value: "300/min", hint: "Per key, sliding window" },
        ].map((s) => (
          <div key={s.label} className="panel hairline-top px-4 py-3.5">
            <div className="kicker">{s.label}</div>
            <div className="mt-2 font-num text-[20px] tabular text-ink">{s.value}</div>
            <div className="mt-1 text-[10.5px] text-ink-faint">{s.hint}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
            <Zap className="size-3.5 text-ink-muted" />
            Live console
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            Requests hit this deployment
          </span>
        </CardTopBar>
        <CardContent className="pt-4">
          <ApiConsole />
        </CardContent>
      </Card>

      <SectionHeader title="Endpoint reference" hint="All responses are JSON; errors use { error: { code, message } }" />
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Method</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead className="pr-5 text-right">Scope</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ENDPOINTS.map((e) => (
              <TableRow key={`${e.method}${e.path}`}>
                <TableCell className="pl-5">
                  <span
                    className={`font-mono text-[10px] ${e.method === "GET" ? "text-[#6EE7B7]" : "text-[#FCD34D]"}`}
                  >
                    {e.method}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-[11px] text-ink-muted">{e.path}</TableCell>
                <TableCell className="text-[11.5px] text-ink-faint">{e.summary}</TableCell>
                <TableCell className="text-[11px] text-ink-faint">{e.auth}</TableCell>
                <TableCell className="pr-5 text-right">
                  <Badge variant="outline">{e.scope}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <TerminalSquare className="size-3.5 text-ink-faint" />
              Ingest with cURL
            </div>
            <Badge variant="outline">POST /api/v1/events</Badge>
          </CardTopBar>
          <CardContent className="pt-3">
            <pre className="overflow-x-auto rounded-md border border-hairline bg-[#0A0A0A] px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-ink-muted shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
              {CURL}
            </pre>
            <div className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Send <span className="font-mono">idempotencyKey</span> on retries. The unique{" "}
                <span className="font-mono">(org_id, dedupe_hash)</span> index makes ingestion exactly-once even under
                concurrent retries; duplicates return the original event with{" "}
                <span className="font-mono">duplicate: true</span>.
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardTopBar>
            <div className="text-[12.5px] font-medium text-ink">Normalized response</div>
            <Badge variant="good">201 Created</Badge>
          </CardTopBar>
          <CardContent className="pt-3">
            <JsonCode code={RESPONSE} />
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Cost is computed from the pricing row effective at <span className="font-mono">occurredAt</span>, not from
              the current catalog. The stored breakdown is immutable even if pricing is later superseded.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTopBar>
            <div className="text-[12.5px] font-medium text-ink">Provider normalization</div>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Adapters</span>
          </CardTopBar>
          <CardContent className="pt-2">
            {[
              ["openai", "OpenAI", "cached_tokens is a subset of prompt_tokens; reasoning billed as output"],
              ["anthropic", "Anthropic", "cache_read + cache_creation recombined into input; cache writes billed separately"],
              ["gemini", "Gemini", "cachedContentTokenCount mapped to cached input; thoughts tokens as reasoning"],
              ["groq", "Groq", "OpenAI-compatible usage fields, cached tokens counted when reported"],
              ["mistral", "Mistral", "OpenAI-compatible usage fields; cached input only when explicitly reported"],
            ].map(([id, provider, note]) => (
              <div key={id} className="flex items-start gap-2.5 border-b border-hairline-faint py-2.5 last:border-0">
                <ProviderLogo provider={id} size={15} decorative />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-ink-muted">{provider}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">adapter</span>
                  </div>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-faint">{note}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <Lock className="size-3.5 text-ink-faint" />
              Pre-flight routing decision
            </div>
            <Badge variant="warn">Governance-aware</Badge>
          </CardTopBar>
          <CardContent className="pt-3">
            <JsonCode code={ROUTE_RESPONSE} />
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              <span className="font-mono">/api/v1/route</span> resolves the active routing policy for the project and
              feature, checks model allowlists and hard budgets, prices the request at the effective version, and returns
              cheaper alternatives that stay within the quality drop tolerance.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              To execute routing, call <span className="font-mono">POST /api/v1/chat/completions</span> with an
              OpenAI-compatible body. Send <span className="font-mono">model: &quot;recommend&quot;</span> for a decision
              without a provider call, <span className="font-mono">model: &quot;auto&quot;</span> to execute through an
              approved automatic policy, or an explicit model for direct routing.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
            <KeyRound className="size-3.5 text-ink-faint" />
            Your projects
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/projects">Manage keys</Link>
          </Button>
        </CardTopBar>
        <CardContent className="pt-2">
          {projectRows.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b border-hairline-faint py-2.5 last:border-0">
              <span className="text-[12px] text-ink-muted">{p.name}</span>
              <span className="ml-auto font-mono text-[10px] text-ink-faint">
                {formatInt(keyCount.get(p.id) ?? 0)} active key{keyCount.get(p.id) === 1 ? "" : "s"}
              </span>
              <Button asChild variant="ghost" size="sm" className="h-7">
                <Link href={`/projects/${p.id}?tab=keys`}>
                  Keys
                  <ArrowRight className="size-3" />
                </Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <DataNote>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">Security</span>
        <span>
          Keys are shown once, stored as SHA-256 hashes, and scoped to a single project. All reads and writes are scoped
          by organization server-side — a key can never query another tenant. Provider credentials are encrypted at rest
          with AES-256-GCM using a server-only key.
        </span>
      </DataNote>
    </div>
  );
}
