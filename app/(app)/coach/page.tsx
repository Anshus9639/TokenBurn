import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  FileCode2,
  Gauge,
  Layers,
  Scissors,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { getDb } from "@/lib/db/client";
import { requireSession, can } from "@/lib/auth";
import { listRecommendations } from "@/lib/coach";
import { projects, recommendations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader, EmptyState, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/kpi";
import { CoachAsk, RecommendationActions, RefreshCoachButton } from "@/components/coach-panel";
import { cn, formatDateTimeUTC, formatInt, formatMs, formatPercent, formatUSD } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Rec = typeof recommendations.$inferSelect;
type Filter = "open" | "accepted" | "dismissed" | "all";

const KIND_META: Record<
  string,
  { label: string; icon: React.ElementType; color: string; tint: string; category: string }
> = {
  context_compression: {
    label: "Context compression",
    icon: Scissors,
    color: "#10B981",
    tint: "rgba(16,185,129,0.10)",
    category: "cost",
  },
  caching: {
    label: "Prompt caching",
    icon: Database,
    color: "#10B981",
    tint: "rgba(16,185,129,0.10)",
    category: "cost",
  },
  output_cap: {
    label: "Output control",
    icon: Gauge,
    color: "#10B981",
    tint: "rgba(16,185,129,0.10)",
    category: "cost",
  },
  model_downgrade: {
    label: "Model routing",
    icon: ArrowDownRight,
    color: "#3B82F6",
    tint: "rgba(59,130,246,0.10)",
    category: "performance",
  },
  repeated_prompts: {
    label: "Duplicate prompts",
    icon: Copy,
    color: "#8B5CF6",
    tint: "rgba(139,92,246,0.10)",
    category: "token",
  },
  token_anomaly: {
    label: "Token anomaly",
    icon: Activity,
    color: "#8B5CF6",
    tint: "rgba(139,92,246,0.10)",
    category: "token",
  },
  anomaly: {
    label: "Spend anomaly",
    icon: AlertTriangle,
    color: "#F43F5E",
    tint: "rgba(244,63,94,0.10)",
    category: "critical",
  },
};

const LABELS: Record<string, string> = {
  requests: "Requests (30d)",
  avgInputTokens: "Avg input tokens",
  avgOutputTokens: "Avg output tokens",
  p95InputTokens: "p95 input tokens",
  last30dInputUsd: "Input spend (30d)",
  assumedReduction: "Assumed reduction",
  cachedRatio: "Cached share",
  discountRate: "Cache discount",
  assumedCacheableShare: "Assumed cacheable",
  providerCachingDocs: "Provider docs",
  currentModel: "Current model",
  currentQuality: "Current quality",
  alternativeModel: "Alternative model",
  alternativeQuality: "Alternative quality",
  qualityDelta: "Quality delta",
  currentLatencyMs: "Current latency",
  alternativeLatencyMs: "Alternative latency",
  last30dCostUsd: "Current spend (30d)",
  repricedCostUsd: "Repriced spend (30d)",
  p50OutputTokens: "p50 output tokens",
  p95OutputTokens: "p95 output tokens",
  last30dOutputUsd: "Output spend (30d)",
  promptHash: "Prompt hash",
  repeatShare: "Repeat share",
  project: "Project",
  day: "Day",
  zScore: "Z-score",
  baselineAvgInputTokens: "Baseline avg input",
  excessTokens: "Excess tokens",
  dayCostUsd: "Day spend",
  baselineDailyUsd: "Baseline / day",
  oneTimeExcessUsd: "One-time excess",
  topContributors: "Top contributors",
  seeded: "Seed record",
  note: "Note",
};

const RATIO_KEYS = new Set(["assumedReduction", "cachedRatio", "discountRate", "assumedCacheableShare", "repeatShare"]);

function labelFor(key: string): string {
  return LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function isAnomalyKind(kind: string): boolean {
  return kind === "anomaly" || kind === "token_anomaly";
}

function EvidenceValue({ k, v }: { k: string; v: unknown }) {
  if (k === "topContributors" && Array.isArray(v)) {
    return (
      <div className="space-y-1">
        {(v as Array<{ feature: string; project: string; costUsd: number; avgInputTokens: number }>).map((c, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <span className="truncate text-ink-muted">{c.feature}</span>
            <span className="font-mono text-[10.5px] tabular text-ink-faint">
              {formatUSD(c.costUsd)} · {formatInt(c.avgInputTokens)} tok
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (k === "providerCachingDocs" && typeof v === "string") {
    return (
      <a href={v} target="_blank" rel="noreferrer" className="text-ink underline decoration-hairline-strong underline-offset-2 hover:decoration-white">
        Prompt caching guide <ArrowUpRight className="inline size-3" />
      </a>
    );
  }
  if (k === "promptHash" && typeof v === "string") {
    return <span className="font-mono text-[10.5px] text-ink-muted">{v.slice(0, 22)}…</span>;
  }
  if (typeof v === "boolean") return <span>{v ? "Yes" : "No"}</span>;
  if (typeof v === "number") {
    if (RATIO_KEYS.has(k)) return <span className="tabular">{formatPercent(v)}</span>;
    if (k.endsWith("Usd")) return <span className="tabular">{formatUSD(v, v < 1)}</span>;
    if (k.endsWith("Ms")) return <span className="tabular">{formatMs(v)}</span>;
    if (/tokens/i.test(k)) return <span className="tabular">{formatInt(v)}</span>;
    if (k === "qualityDelta") return <span className="tabular">{v > 0 ? `+${v}` : v}</span>;
    if (k === "zScore") return <span className="tabular">{v.toFixed(2)}σ</span>;
    return <span className="tabular">{Number.isInteger(v) ? formatInt(v) : v.toFixed(2)}</span>;
  }
  return <span>{String(v)}</span>;
}

const STRUCTURED_KEYS = new Set([
  "problem",
  "action",
  "savingsBasis",
  "benchmarkRequired",
  "qualityImpact",
  "latencyImpact",
  "validationProcedure",
  "implementationSteps",
  "companionOpportunities",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function impactVariant(level: string): "good" | "outline" | "warn" | "bad" {
  if (level === "none") return "good";
  if (level === "low") return "outline";
  if (level === "medium") return "warn";
  return "bad";
}

function Evidence({ evidence }: { evidence: unknown }) {
  if (!evidence || typeof evidence !== "object") return null;
  const entries = Object.entries(evidence as Record<string, unknown>).filter(
    ([k, v]) => v !== undefined && v !== null && !STRUCTURED_KEYS.has(k),
  );
  if (!entries.length) return null;
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-2 rounded-md border border-hairline-faint bg-surface-sunken/60 px-3.5 py-3">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">{labelFor(k)}</div>
          <div className="mt-0.5 break-words text-[11.5px] text-ink-muted">
            <EvidenceValue k={k} v={v} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MeasurementBadge({ measurement }: { measurement: string }) {
  return measurement === "measured" ? (
    <Badge variant="good">
      <CheckCircle2 className="size-2.5" /> Measured
    </Badge>
  ) : (
    <Badge variant="warn">Estimated</Badge>
  );
}

function RecommendationCard({
  rec,
  projectName,
  canManage,
}: {
  rec: Rec;
  projectName?: string;
  canManage: boolean;
}) {
  const meta = KIND_META[rec.kind] ?? {
    label: rec.kind,
    icon: Target,
    color: "#94A3B8",
    tint: "rgba(148,163,184,0.10)",
    category: "other",
  };
  const Icon = meta.icon;
  const savings = Number(rec.estimatedMonthlySavingsUsd);
  const isAnomaly = rec.kind === "anomaly";
  const ev = asRecord(rec.evidence);
  const problem = typeof ev.problem === "string" ? ev.problem : null;
  const action = typeof ev.action === "string" ? ev.action : null;
  const savingsBasis = typeof ev.savingsBasis === "string" ? ev.savingsBasis : null;
  const quality = asRecord(ev.qualityImpact);
  const latency = asRecord(ev.latencyImpact);
  const qualityLevel = typeof quality.level === "string" ? quality.level : null;
  const qualityDetail = typeof quality.detail === "string" ? quality.detail : null;
  const latencyDirection = typeof latency.direction === "string" ? latency.direction : null;
  const latencyDetail = typeof latency.detail === "string" ? latency.detail : null;
  const validation = stringList(ev.validationProcedure);
  const steps = stringList(ev.implementationSteps);
  const benchmarkRequired = ev.benchmarkRequired === true;
  const companions = Array.isArray(ev.companionOpportunities)
    ? (ev.companionOpportunities as Array<{
        kind: string;
        title: string;
        estimatedMonthlySavingsUsd: number;
        counted: boolean;
        note: string;
      }>)
    : [];
  const hasPlaybook = validation.length > 0 || steps.length > 0;

  return (
    <Card
      className={cn(
        "relative animate-fade-up overflow-hidden",
        rec.status === "accepted" && "border-accent-emerald/30",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{ background: `linear-gradient(180deg, ${meta.color}, transparent 85%)` }}
      />
      <div className="flex items-start gap-3.5 px-5 pt-4">
        <div
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[7px] border"
          style={{
            color: meta.color,
            borderColor: `color-mix(in srgb, ${meta.color} 35%, transparent)`,
            background: `linear-gradient(180deg, ${meta.tint}, transparent)`,
          }}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em]" style={{ color: meta.color }}>
              {meta.label}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em]"
              style={{ background: meta.tint, color: meta.color }}
            >
              {meta.category}
            </span>
            <MeasurementBadge measurement={rec.measurement} />
            <Badge variant="outline">{rec.confidence} confidence</Badge>
            {rec.status === "accepted" ? <Badge variant="good">Accepted</Badge> : null}
            {rec.status === "dismissed" ? <Badge variant="outline">Dismissed</Badge> : null}
          </div>
          <h3 className="mt-1.5 text-[14px] font-medium leading-snug tracking-tight text-ink">{rec.title}</h3>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="font-num text-[18px] leading-none tabular"
            style={{ color: isAnomaly ? "#FB7185" : "#6EE7B7" }}
          >
            {formatUSD(savings)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.08em] text-ink-faint">
            {isAnomaly ? "one-time excess" : "est. / month"}
          </div>
        </div>
      </div>

      <CardContent className="mt-3.5 space-y-3">
        <p className="text-[12.5px] leading-relaxed text-ink-muted">{rec.summary}</p>
        {problem || action ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {problem ? (
              <div className="rounded-md border border-hairline-faint bg-white/[0.015] px-3 py-2">
                <div className="kicker">Problem</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{problem}</p>
              </div>
            ) : null}
            {action ? (
              <div className="rounded-md border border-hairline-faint bg-white/[0.015] px-3 py-2">
                <div className="kicker">Action</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{action}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="border-l border-hairline-strong pl-3 text-[11.5px] leading-relaxed text-ink-faint">
          {rec.rationale}
        </div>
        {qualityLevel || latencyDirection ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-hairline-faint bg-black/20 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="kicker">Quality impact</span>
                {qualityLevel ? <Badge variant={impactVariant(qualityLevel)}>{qualityLevel}</Badge> : null}
              </div>
              {qualityDetail ? (
                <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{qualityDetail}</p>
              ) : null}
            </div>
            <div className="rounded-md border border-hairline-faint bg-black/20 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="kicker">Latency impact</span>
                {latencyDirection ? (
                  <Badge
                    variant={
                      latencyDirection === "decrease" ? "good" : latencyDirection === "increase" ? "warn" : "outline"
                    }
                  >
                    {latencyDirection}
                  </Badge>
                ) : null}
              </div>
              {latencyDetail ? (
                <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{latencyDetail}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {benchmarkRequired ? (
          <p className="rounded-md border border-accent-amber/30 bg-accent-amber/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-[#FCD34D]">
            Benchmark required. Catalog quality and latency figures are static metadata, not evidence that this change
            preserves quality on your workload.
          </p>
        ) : null}
        <Evidence evidence={rec.evidence} />
        {companions.length ? (
          <div className="rounded-md border border-hairline-faint bg-white/[0.015] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="kicker">Also found for this feature</span>
              <Badge variant="outline">not counted</Badge>
            </div>
            <ul className="mt-1.5 space-y-1">
              {companions.map((companion) => (
                <li key={`${companion.kind}-${companion.title}`} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="min-w-0 truncate text-ink-muted">{companion.title}</span>
                  <span className="shrink-0 font-mono text-[10.5px] tabular text-ink-faint">
                    {formatUSD(companion.estimatedMonthlySavingsUsd)}/mo
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">{companions[0]?.note}</p>
          </div>
        ) : null}
        {hasPlaybook ? (
          <details className="group rounded-md border border-hairline-faint bg-white/[0.015] px-3.5 py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] text-ink-muted [&::-webkit-details-marker]:hidden">
              <span>Validation procedure & implementation</span>
              <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
              {validation.length ? (
                <div>
                  <div className="kicker">Validate first</div>
                  <ol className="mt-1 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-ink-faint">
                    {validation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {steps.length ? (
                <div>
                  <div className="kicker">Implementation</div>
                  <ol className="mt-1 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-ink-faint">
                    {steps.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
            {savingsBasis ? (
              <p className="mt-2.5 border-t border-hairline-faint pt-2 text-[10px] leading-relaxed text-ink-faint">
                Savings basis: {savingsBasis}
              </p>
            ) : null}
          </details>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-faint">
            <span className="flex items-center gap-1">
              <Layers className="size-3" /> {projectName ?? "Organization"}
              {rec.feature ? ` · ${rec.feature}` : ""}
            </span>
            {rec.model ? <span className="font-mono text-[10px] text-ink-faint">{rec.model}</span> : null}
            <span>Generated {formatDateTimeUTC(rec.generatedAt)}</span>
          </div>
          {rec.status === "new" && canManage ? <RecommendationActions id={rec.id} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: Filter = (["open", "accepted", "dismissed", "all"] as const).includes(status as Filter)
    ? (status as Filter)
    : "open";
  const session = await requireSession();
  const db = await getDb();
  const canManage = can(session.role, "manage_budgets");

  const [recs, projectRows] = await Promise.all([
    listRecommendations(db, session.org.id),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, session.org.id)),
  ]);
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));

  const open = recs.filter((r) => r.status === "new");
  const accepted = recs.filter((r) => r.status === "accepted");
  const dismissed = recs.filter((r) => r.status === "dismissed");
  const openLevers = open.filter((r) => !isAnomalyKind(r.kind));
  const anomalies = open.filter((r) => isAnomalyKind(r.kind));
  const openSavings = openLevers.reduce((s, r) => s + Number(r.estimatedMonthlySavingsUsd), 0);
  const acceptedSavings = accepted.reduce((s, r) => s + Number(r.estimatedMonthlySavingsUsd), 0);
  const measuredCount = open.filter((r) => r.measurement === "measured").length;

  const filtered = filter === "open" ? open : filter === "accepted" ? accepted : filter === "dismissed" ? dismissed : recs;
  const sorted = [...filtered].sort((a, b) => {
    if (isAnomalyKind(a.kind) && !isAnomalyKind(b.kind)) return -1;
    if (isAnomalyKind(b.kind) && !isAnomalyKind(a.kind)) return 1;
    return Number(b.estimatedMonthlySavingsUsd) - Number(a.estimatedMonthlySavingsUsd);
  });

  const tabs: Array<{ key: Filter; label: string; count: number }> = [
    { key: "open", label: "Open findings", count: open.length },
    { key: "accepted", label: "Accepted", count: accepted.length },
    { key: "dismissed", label: "Dismissed", count: dismissed.length },
    { key: "all", label: "All", count: recs.length },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Intelligence · Evidence before savings"
        title="AI Usage Coach"
        description="Findings derived from normalized usage events and versioned pricing. Every number is labeled measured or estimated — reductions are assumptions until you validate them."
      >
        <Badge variant="outline">{open.length} open findings</Badge>
        {canManage ? <RefreshCoachButton /> : null}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Open savings · estimated"
          value={formatUSD(openSavings)}
          hint="Recurring levers only; anomalies excluded from projections"
          tone="good"
          accent="emerald"
          provenance="estimated"
        />
        <MetricCard
          label="Accepted levers"
          value={String(accepted.length)}
          hint={`${formatUSD(acceptedSavings)} estimated / month in progress`}
          accent="blue"
          provenance="projected"
        />
        <MetricCard
          label="Measured findings"
          value={String(measuredCount)}
          hint="Directly observed in your events, not projected"
          accent="cyan"
          provenance="measured"
        />
        <MetricCard
          label="Spend anomalies"
          value={String(anomalies.length)}
          hint="One-time excess above the 30-day baseline"
          tone={anomalies.length ? "warn" : "default"}
          accent="rose"
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {tabs.map((t) => (
                <Link
                  key={t.key}
                  href={`/coach?status=${t.key}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    filter === t.key
                      ? "border-hairline-strong bg-[#222222] text-ink"
                      : "border-transparent text-ink-faint hover:text-ink-muted",
                  )}
                >
                  {t.label}
                  <span className="font-mono text-[10px] tabular text-ink-faint">{t.count}</span>
                </Link>
              ))}
            </div>
            <span className="text-[10.5px] text-ink-faint">One primary lever per feature to avoid double-counting</span>
          </div>

          {sorted.length ? (
            <div className="space-y-3.5">
              {sorted.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  projectName={rec.projectId ? projectName.get(rec.projectId) : undefined}
                  canManage={canManage}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Sparkles className="size-4" />}
              title={filter === "open" ? "No open findings" : "Nothing in this view"}
              description={
                filter === "open"
                  ? "Run the analysis to recompute levers from the latest 30 days of usage. Findings need at least 25 requests per feature/model."
                  : "Switch filters to see other findings."
              }
              action={filter === "open" && canManage ? <RefreshCoachButton label="Run analysis" /> : null}
            />
          )}

          <DataNote>
            Savings labeled <span className="text-ink-muted">estimated</span> apply an assumed reduction to measured spend;
            they are not guaranteed outcomes. <span className="text-ink-muted">Measured</span> findings report observed
            variance only. Quality and latency trade-offs of model routing are catalog approximations until validated with
            evals. Refreshing the analysis requires the <span className="text-ink-muted">admin</span> role.
          </DataNote>
        </div>

        <aside className="space-y-3.5 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <Sparkles className="size-3.5 text-ink-muted" /> Ask the coach
              </div>
              <Badge variant="outline">Grounded</Badge>
            </CardTopBar>
            <CardContent className="pt-4">
              <CoachAsk />
            </CardContent>
          </Card>

          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <Calculator className="size-3.5 text-ink-faint" /> Method
              </div>
            </CardTopBar>
            <CardContent className="space-y-2.5 pt-4 text-[11.5px] leading-relaxed text-ink-faint">
              <div className="flex gap-2">
                <span className="mt-[6px] size-1 shrink-0 rounded-full bg-chrome/50" />
                <span>Per-feature/model aggregates over 30 days, minimum 25 requests.</span>
              </div>
              <div className="flex gap-2">
                <span className="mt-[6px] size-1 shrink-0 rounded-full bg-chrome/50" />
                <span>Costs from the authoritative engine using event-time pricing versions.</span>
              </div>
              <div className="flex gap-2">
                <span className="mt-[6px] size-1 shrink-0 rounded-full bg-chrome/50" />
                <span>Anomalies compare the last 7 days against a 30-day baseline (z ≥ 1.8).</span>
              </div>
              <div className="flex gap-2">
                <span className="mt-[6px] size-1 shrink-0 rounded-full bg-chrome/50" />
                <span>One lever per feature keeps estimates from stacking on the same spend.</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardTopBar>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <FileCode2 className="size-3.5 text-ink-faint" /> Validate before shipping
              </div>
            </CardTopBar>
            <CardContent className="space-y-2.5 pt-4 text-[11.5px] leading-relaxed text-ink-faint">
              <p>Model swaps and output caps need eval coverage. Use the Studio to reprice real prompts, then route through an approval.</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Link href="/studio" className="text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline">
                  Optimization Studio
                </Link>
                <span className="text-ink-faint">·</span>
                <Link href="/router" className="text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline">
                  Model Router
                </Link>
                <span className="text-ink-faint">·</span>
                <Link href="/governance" className="text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline">
                  Approvals
                </Link>
              </div>
            </CardContent>
          </Card>

          <div className="panel px-4 py-3.5">
            <div className="flex items-center gap-2 text-[11px] text-ink-faint">
              <ShieldCheck className="size-3.5" /> Recommendation decisions are written to the audit trail.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
