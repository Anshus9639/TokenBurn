import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  FlaskConical,
  GitBranch,
  Lock,
  PauseCircle,
  Rocket,
  Route,
  Send,
  ShieldCheck,
  Split,
  Workflow,
} from "lucide-react";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, rawQuery } from "@/lib/db/client";
import { requireSession, can } from "@/lib/auth";
import {
  approvalRequests,
  gatewayRequests,
  modelEvaluations,
  organizations,
  projects,
  routingPolicies,
  routingRollouts,
} from "@/lib/db/schema";
import { getActiveCatalog, type PricingRecord } from "@/lib/pricing-db";
import { computeCost } from "@/lib/pricing";
import { createPolicyAction, createRolloutAction, runEvaluationAction } from "@/lib/actions/router";
import { getRolloutReport } from "@/lib/gateway/rollout";
import { PageHeader, EmptyState, DataNote } from "@/components/page";
import { Card, CardContent, CardTopBar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { DialogForm } from "@/components/dialog-form";
import { MetricCard } from "@/components/kpi";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { ChartContainer, ChartLegend, CostQualityScatter } from "@/components/charts";
import { PausePolicyButton, RolloutControls, SubmitPolicyButton } from "@/components/router-actions";
import { providerBrand, providerForModel } from "@/lib/brand/providers";
import { addDays, cn, formatDate, formatInt, formatMs, formatUSD } from "@/lib/utils";

export const dynamic = "force-dynamic";

type UsageRow = {
  project_id: string;
  feature: string;
  environment: string;
  provider: string;
  model: string;
  requests: string;
  input_tokens: string;
  cached_tokens: string;
  output_tokens: string;
  cost: string;
};

const STATUS_META: Record<string, { label: string; variant: "good" | "warn" | "outline" | "bad" }> = {
  active: { label: "Active", variant: "good" },
  draft: { label: "Draft", variant: "outline" },
  paused: { label: "Paused", variant: "warn" },
  pending: { label: "Awaiting approval", variant: "warn" },
};

const STRATEGY_LABEL: Record<string, string> = {
  cost_optimized: "Cost optimized",
  quality_first: "Quality first",
  balanced: "Balanced",
  fallback_only: "Fallback only",
};

const ROLLOUT_STATUS: Record<string, { label: string; variant: "good" | "warn" | "outline" | "bad" }> = {
  pending_approval: { label: "Awaiting approval", variant: "warn" },
  running: { label: "Running", variant: "good" },
  completed: { label: "Promoted", variant: "good" },
  rolled_back: { label: "Rolled back", variant: "bad" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

const EVAL_STATUS: Record<string, { label: string; variant: "good" | "warn" | "outline" | "bad" }> = {
  completed: { label: "Completed", variant: "good" },
  running: { label: "Running", variant: "warn" },
  failed: { label: "Failed", variant: "bad" },
  draft: { label: "Draft", variant: "outline" },
};

const selectClass =
  "h-9 w-full rounded-md border border-hairline-strong bg-[#0D0D0D] px-2.5 text-[12.5px] text-ink shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] transition-colors focus-visible:border-[#6B6B6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/[0.06]";

const LIFECYCLE = [
  { key: "shadow", label: "Shadow", color: "#94A3B8" },
  { key: "canary", label: "Canary", color: "#60A5FA" },
  { key: "ramp", label: "Ramp", color: "#FBBF24" },
  { key: "production", label: "Production", color: "#34D399" },
] as const;

function RolloutLifecycle({
  mode,
  status,
  trafficPercent,
}: {
  mode: string;
  status: string;
  trafficPercent: number;
}) {
  const failed = status === "rolled_back";
  const promoted = status === "completed";
  const running = status === "running";
  const index = mode === "shadow" ? 0 : trafficPercent >= 100 ? 3 : trafficPercent >= 25 ? 2 : 1;
  return (
    <div className="mt-3 rounded-md border border-hairline-faint bg-black/20 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">Rollout lifecycle</span>
        <span className="font-mono text-[9.5px] tabular text-ink-faint">
          {mode === "shadow" ? "mirror · 0% served" : `${trafficPercent}% traffic`}
        </span>
      </div>
      <div className="flex items-center">
        {LIFECYCLE.map((stage, i) => {
          const state = failed
            ? i === index
              ? "failed"
              : i < index
                ? "done"
                : "pending"
            : promoted
              ? "done"
              : i < index
                ? "done"
                : i === index
                  ? running
                    ? "active"
                    : "pending"
                  : "pending";
          const color =
            state === "failed" ? "#FB7185" : state === "pending" ? "#6B6B6B" : stage.color;
          return (
            <div key={stage.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <span
                  className={cn("size-2 rounded-full", state === "active" && "animate-pulse-dot")}
                  style={{
                    background: color,
                    boxShadow: state === "pending" ? undefined : `0 0 8px ${color}66`,
                  }}
                />
                <span
                  className={cn(
                    "font-mono text-[8.5px] uppercase tracking-[0.08em]",
                    state === "pending" ? "text-ink-faint/60" : "text-ink-faint",
                  )}
                >
                  {stage.label}
                </span>
              </div>
              {i < LIFECYCLE.length - 1 ? (
                <span
                  className="mx-1.5 mb-4 h-px flex-1"
                  style={{ background: i < index || promoted ? `${LIFECYCLE[i + 1].color}80` : "#3A3A3A" }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {failed ? (
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[#FDA4AF]">
          Rolled back at {(LIFECYCLE[index] ?? LIFECYCLE[0]).label.toLowerCase()}
        </p>
      ) : null}
    </div>
  );
}

function ModelOptions({ catalog, selected }: { catalog: PricingRecord[]; selected?: string }) {
  const groups = new Map<string, PricingRecord[]>();
  for (const p of catalog) {
    if (p.category === "embedding") continue;
    const list = groups.get(p.provider) ?? [];
    list.push(p);
    groups.set(p.provider, list);
  }
  return (
    <>
      {[...groups.entries()].map(([provider, items]) => (
        <optgroup key={provider} label={provider}>
          {items.map((p) => {
            const key = `${p.provider}/${p.model}`;
            return (
              <option key={key} value={key} selected={selected === key ? true : undefined}>
                {p.displayName}
              </option>
            );
          })}
        </optgroup>
      ))}
    </>
  );
}

export default async function RouterPage() {
  const session = await requireSession();
  const db = await getDb();
  const canCreate = can(session.role, "create_policy");
  const canApprove = can(session.role, "approve");
  const since = addDays(new Date(), -30);

  const [policies, pendingApprovals, projectRows, catalog, orgRows, usageRows, gatewayRows, rolloutRows, evaluationRows] =
    await Promise.all([
      db
        .select()
        .from(routingPolicies)
        .where(eq(routingPolicies.orgId, session.org.id))
        .orderBy(desc(routingPolicies.updatedAt)),
      db
        .select({
          id: approvalRequests.id,
          targetId: approvalRequests.targetId,
          targetType: approvalRequests.targetType,
          title: approvalRequests.title,
        })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.orgId, session.org.id), eq(approvalRequests.status, "pending"))),
      db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, session.org.id)),
      getActiveCatalog(db),
      db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, session.org.id))
        .limit(1),
      rawQuery<UsageRow>(
        `select project_id, feature, environment, provider, model, count(*)::int as requests,
                coalesce(sum(input_tokens), 0)::int as input_tokens,
                coalesce(sum(cached_input_tokens), 0)::int as cached_tokens,
                coalesce(sum(output_tokens), 0)::int as output_tokens,
                coalesce(sum(cost_usd), 0)::float8 as cost
           from usage_events
          where org_id = $1 and occurred_at >= $2
          group by project_id, feature, environment, provider, model`,
        [session.org.id, since],
      ),
      db
        .select({
          mode: gatewayRequests.mode,
          strategy: gatewayRequests.strategy,
          status: gatewayRequests.status,
          provider: gatewayRequests.provider,
          selectedModel: gatewayRequests.selectedModel,
          fallbackUsed: gatewayRequests.fallbackUsed,
          inputTokens: gatewayRequests.inputTokens,
          outputTokens: gatewayRequests.outputTokens,
          usageSource: gatewayRequests.usageSource,
          latencyMs: gatewayRequests.latencyMs,
          costUsd: gatewayRequests.costUsd,
          realizedSavingsUsd: gatewayRequests.realizedSavingsUsd,
          qualityScore: gatewayRequests.qualityScore,
          errorCode: gatewayRequests.errorCode,
          decision: gatewayRequests.decision,
          createdAt: gatewayRequests.createdAt,
        })
        .from(gatewayRequests)
        .where(and(eq(gatewayRequests.orgId, session.org.id), gte(gatewayRequests.createdAt, since)))
        .orderBy(desc(gatewayRequests.createdAt))
        .limit(10_000),
      db
        .select()
        .from(routingRollouts)
        .where(eq(routingRollouts.orgId, session.org.id))
        .orderBy(desc(routingRollouts.createdAt))
        .limit(12),
      db
        .select({
          id: modelEvaluations.id,
          name: modelEvaluations.name,
          status: modelEvaluations.status,
          baselineModel: modelEvaluations.baselineModel,
          candidateModels: modelEvaluations.candidateModels,
          summary: modelEvaluations.summary,
          error: modelEvaluations.error,
          createdAt: modelEvaluations.createdAt,
          completedAt: modelEvaluations.completedAt,
        })
        .from(modelEvaluations)
        .where(eq(modelEvaluations.orgId, session.org.id))
        .orderBy(desc(modelEvaluations.createdAt))
        .limit(8),
    ]);

  const settings = orgRows[0]?.settings;
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const pricingByKey = new Map(catalog.map((p) => [`${p.provider}/${p.model}`, p]));
  const pendingByTarget = new Map(pendingApprovals.map((a) => [a.targetId ?? "", a]));

  const usage = usageRows.rows.map((r) => ({
    projectId: r.project_id,
    feature: r.feature,
    environment: r.environment,
    requests: Number(r.requests),
    inputTokens: Number(r.input_tokens),
    cachedTokens: Number(r.cached_tokens),
    outputTokens: Number(r.output_tokens),
    costUsd: Number(r.cost),
  }));

  const simulation = policies.map((p) => {
    const matched = usage.filter(
      (u) =>
        u.projectId === p.projectId &&
        u.environment === p.environment &&
        (!p.feature || u.feature === p.feature),
    );
    const tokens = matched.reduce(
      (acc, u) => ({
        requests: acc.requests + u.requests,
        inputTokens: acc.inputTokens + u.inputTokens,
        cachedTokens: acc.cachedTokens + u.cachedTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        costUsd: acc.costUsd + u.costUsd,
      }),
      { requests: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 },
    );
    const primary = pricingByKey.get(p.primaryModel);
    const fallback = pricingByKey.get(p.fallbackModel);
    const reprice = (model?: PricingRecord) =>
      model && tokens.requests > 0
        ? computeCost(model, {
            inputTokens: tokens.inputTokens,
            cachedInputTokens: tokens.cachedTokens,
            outputTokens: tokens.outputTokens,
          }).costUsd
        : null;
    return {
      policy: p,
      tokens,
      primaryCost: reprice(primary),
      fallbackCost: reprice(fallback),
      primary,
      fallback,
    };
  });

  const active = policies.filter((p) => p.status === "active");
  const drafts = policies.filter((p) => p.status === "draft");
  const projectsCovered = new Set(active.map((p) => p.projectId)).size;
  const measuredUnderPolicies = simulation
    .filter((s) => s.policy.status === "active")
    .reduce((sum, s) => sum + s.tokens.costUsd, 0);

  const gateway = gatewayRows.map((row) => {
    const baselineEstimate = row.decision?.baselineEstimateUsd ?? null;
    const estimatedCost = row.decision?.estimatedCostUsd ?? null;
    return {
      ...row,
      key: row.selectedModel ? `${row.provider ?? "unknown"}/${row.selectedModel}` : "unattributed",
      cost: row.costUsd === null ? null : Number(row.costUsd),
      realized: row.realizedSavingsUsd === null ? null : Number(row.realizedSavingsUsd),
      estimatedSavings:
        baselineEstimate !== null && estimatedCost !== null ? baselineEstimate - estimatedCost : null,
    };
  });
  const pricedGateway = gateway.filter((row) => row.cost !== null && row.cost > 0);
  const gatewayCostTotal = pricedGateway.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const avgCostPerRequest = pricedGateway.length ? gatewayCostTotal / pricedGateway.length : 0;
  const realizedSavingsTotal = gateway.reduce((sum, row) => sum + (row.realized ?? 0), 0);
  const estimatedSavingsTotal = gateway.reduce((sum, row) => sum + (row.estimatedSavings ?? 0), 0);
  const fallbackCount = gateway.filter((row) => row.fallbackUsed).length;
  const fallbackRate = gateway.length ? fallbackCount / gateway.length : 0;
  const gatewayFailures = gateway.filter((row) => row.status === "error");

  const modelStats = [...gateway.reduce((map, row) => {
    const stat = map.get(row.key) ?? {
      key: row.key,
      provider: row.provider ?? "unknown",
      requests: 0,
      errors: 0,
      latencySum: 0,
      latencyCount: 0,
      qualitySum: 0,
      qualityCount: 0,
      cost: 0,
      fallbacks: 0,
    };
    stat.requests += 1;
    if (row.status === "error") stat.errors += 1;
    if (row.latencyMs > 0) {
      stat.latencySum += row.latencyMs;
      stat.latencyCount += 1;
    }
    if (row.qualityScore !== null) {
      stat.qualitySum += row.qualityScore;
      stat.qualityCount += 1;
    }
    stat.cost += row.cost ?? 0;
    if (row.fallbackUsed) stat.fallbacks += 1;
    map.set(row.key, stat);
    return map;
  }, new Map<string, {
    key: string;
    provider: string;
    requests: number;
    errors: number;
    latencySum: number;
    latencyCount: number;
    qualitySum: number;
    qualityCount: number;
    cost: number;
    fallbacks: number;
  }>()).values()]
    .map((stat) => ({
      ...stat,
      averageLatencyMs: stat.latencyCount ? Math.round(stat.latencySum / stat.latencyCount) : null,
      averageQuality: stat.qualityCount ? Math.round(stat.qualitySum / stat.qualityCount) : null,
    }))
    .sort((a, b) => b.requests - a.requests);
  const maxModelRequests = modelStats[0]?.requests ?? 1;

  const qualityPoints = modelStats
    .filter((stat) => stat.averageQuality !== null && stat.requests > 0 && stat.cost > 0)
    .map((stat) => ({
      model: stat.key,
      provider: stat.provider,
      costUsd: stat.cost / stat.requests,
      qualityScore: stat.averageQuality as number,
      requests: stat.requests,
      averageLatencyMs: stat.averageLatencyMs,
    }));
  const qualityProviders = [...new Set(modelStats.filter((stat) => stat.averageQuality !== null).map((stat) => stat.provider))];

  const modeCounts = gateway.reduce<Record<string, number>>((acc, row) => {
    acc[row.mode] = (acc[row.mode] ?? 0) + 1;
    return acc;
  }, {});
  const failureCodes = [...gatewayFailures.reduce((map, row) => {
    const code = row.errorCode ?? "unknown";
    map.set(code, (map.get(code) ?? 0) + 1);
    return map;
  }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const rolloutReports = new Map<string, NonNullable<Awaited<ReturnType<typeof getRolloutReport>>>>();
  for (const rollout of rolloutRows.filter((row) => row.status === "running")) {
    const report = await getRolloutReport(db, rollout.id);
    if (report) rolloutReports.set(rollout.id, report);
  }
  const policyNameById = new Map(policies.map((policy) => [policy.id, policy.name]));
  const pendingRolloutTargets = new Set(
    pendingApprovals.filter((approval) => approval.targetType === "routing_rollout").map((approval) => approval.targetId ?? ""),
  );
  const rampSteps = [10, 25, 50, 100];
  const activePolicies = policies.filter((policy) => policy.status === "active");
  const sampleDataset = JSON.stringify(
    [
      {
        id: "summary",
        prompt: "Summarize this support ticket in two sentences.",
        expectedKeywords: ["refund"],
        maxLatencyMs: 5000,
      },
      { id: "json", prompt: "Return JSON with the ticket priority.", mustBeJson: true, expectedKeywords: ["priority"] },
    ],
    null,
    2,
  );

  const order = (s: (typeof simulation)[number]) =>
    s.policy.status === "active" ? 0 : pendingByTarget.has(s.policy.id) ? 1 : s.policy.status === "paused" ? 3 : 2;
  const sorted = [...simulation].sort((a, b) => order(a) - order(b));

  const catalogDefault = catalog.find((p) => p.category !== "embedding");
  const catalogFallback = catalog.filter((p) => p.category !== "embedding")[1] ?? catalogDefault;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Route · Cost-aware model selection"
        title="Model Router"
        description="Policies resolve which model serves each project, feature and environment. Production activation requires an explicit approval; every change hits the audit trail."
      >
        <Badge variant={settings?.requireApprovalForRouting ? "warn" : "outline"}>
          Approval {settings?.requireApprovalForRouting ? "required" : "optional (production always gated)"}
        </Badge>
        {canCreate ? (
          <DialogForm
            trigger={
              <Button size="sm">
                <GitBranch /> New routing policy
              </Button>
            }
            title="New routing policy"
            description="Drafts do not affect traffic. Activation of production policies requires approval."
            action={createPolicyAction}
            submitLabel="Create draft"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Project">
                <select name="projectId" required className={selectClass} defaultValue={projectRows[0]?.id}>
                  {projectRows.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Environment">
                <select name="environment" className={selectClass} defaultValue="production">
                  <option value="production">production</option>
                  <option value="staging">staging</option>
                  <option value="development">development</option>
                </select>
              </Field>
            </div>
            <Field label="Policy name">
              <Input name="name" required minLength={3} placeholder="Atlas intents · cost first" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Feature" hint="blank = all features">
                <Input name="feature" placeholder="answer-generation" />
              </Field>
              <Field label="Strategy">
                <select name="strategy" className={selectClass} defaultValue="cost_optimized">
                  <option value="cost_optimized">Cost optimized</option>
                  <option value="quality_first">Quality first</option>
                  <option value="balanced">Balanced</option>
                  <option value="fallback_only">Fallback only</option>
                </select>
              </Field>
            </div>
            <Field label="Routing mode" hint="applied after approval">
              <select name="mode" className={selectClass} defaultValue="manual">
                <option value="manual">Manual · use primary</option>
                <option value="recommendation">Recommendation · suggest only</option>
                <option value="automatic">Automatic · pick per request</option>
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Candidates" hint="comma-separated · blank = primary + fallback">
                <Input name="candidates" placeholder="openai/gpt-4.1-mini, groq/llama-3.1-8b-instant" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min quality" hint="0–100">
                  <Input name="minQualityScore" type="number" min={0} max={100} placeholder="optional" className="font-mono tabular" />
                </Field>
                <Field label="Max latency" hint="ms">
                  <Input name="maxLatencyMs" type="number" min={100} placeholder="optional" className="font-mono tabular" />
                </Field>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Primary model">
                <select name="primaryModel" required className={selectClass} defaultValue={catalogDefault ? `${catalogDefault.provider}/${catalogDefault.model}` : undefined}>
                  <ModelOptions catalog={catalog} />
                </select>
              </Field>
              <Field label="Fallback model">
                <select name="fallbackModel" required className={selectClass} defaultValue={catalogFallback ? `${catalogFallback.provider}/${catalogFallback.model}` : undefined}>
                  <ModelOptions catalog={catalog} />
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Max output tokens" hint="optional">
                <Input name="maxOutputTokens" type="number" min={1} placeholder="e.g. 2048" className="font-mono tabular" />
              </Field>
              <label className="flex cursor-pointer items-end gap-2 pb-2 text-[11.5px] text-ink-faint">
                <input type="checkbox" name="cacheEnabled" className="size-3.5 accent-[#D4D4D8]" />
                Enable prompt caching for routed calls
              </label>
            </div>
            <Field label="Notes" hint="optional">
              <Textarea name="notes" placeholder="Why this split, eval references, owners…" className="min-h-[64px]" />
            </Field>
            <p className="text-[10.5px] leading-relaxed text-ink-faint">
              Models and candidates are validated against the active pricing catalog and governance allow/block lists.
              Automatic policies are applied by <span className="font-mono">/api/v1/chat/completions</span> when{" "}
              <span className="font-mono">model</span> is <span className="font-mono">&quot;auto&quot;</span>; manual mode
              never substitutes a model.
            </p>
          </DialogForm>
        ) : (
          <Badge variant="outline">Viewer · read only</Badge>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Active policies"
          value={String(active.length)}
          hint={`${drafts.length} drafts waiting`}
          accent="blue"
          icon={GitBranch}
        />
        <MetricCard
          label="Pending approvals"
          value={String(pendingApprovals.length)}
          hint="Production changes gate here"
          tone={pendingApprovals.length ? "warn" : "default"}
          accent="amber"
          href="/governance?tab=approvals"
          icon={Lock}
        />
        <MetricCard
          label="Projects covered"
          value={String(projectsCovered)}
          hint={`of ${projectRows.length} projects`}
          accent="violet"
        />
        <MetricCard
          label="Measured spend under policies · 30d"
          value={formatUSD(measuredUnderPolicies)}
          hint="Observed traffic matching active scopes"
          accent="emerald"
          provenance="measured"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Requests routed · 30d"
          value={formatInt(gateway.length)}
          hint="Through /api/v1/chat/completions"
          accent="cyan"
          icon={Send}
        />
        <MetricCard
          label="Avg cost / request"
          value={formatUSD(avgCostPerRequest, true)}
          hint={`${formatInt(pricedGateway.length)} priced requests`}
          accent="teal"
        />
        <MetricCard
          label="Realized savings · 30d"
          value={formatUSD(realizedSavingsTotal)}
          hint="Only provider-reported usage"
          tone={realizedSavingsTotal > 0 ? "good" : "default"}
          accent="emerald"
          provenance="verified"
          hintTone="good"
          icon={ShieldCheck}
        />
        <MetricCard
          label="Estimated savings · 30d"
          value={formatUSD(estimatedSavingsTotal)}
          hint="Pre-execution estimate · not realized"
          accent="purple"
          provenance="projected"
        />
        <MetricCard
          label="Fallback rate"
          value={`${(fallbackRate * 100).toFixed(1)}%`}
          hint={`${formatInt(fallbackCount)} of ${formatInt(gateway.length)} requests`}
          tone={fallbackRate > 0.05 ? "warn" : "default"}
          accent="orange"
          icon={ArrowRight}
        />
        <MetricCard
          label="Routing failures"
          value={formatInt(gatewayFailures.length)}
          hint="Provider or governance errors"
          tone={gatewayFailures.length ? "bad" : "default"}
          accent="rose"
          icon={AlertTriangle}
        />
      </div>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            <BarChart3 className="size-3.5 text-ink-faint" /> Routing analytics · 30d
          </div>
          <Badge variant="outline">Live gateway telemetry</Badge>
        </CardTopBar>
        <CardContent className="grid gap-6 pt-4 lg:grid-cols-2">
          <div>
            <div className="kicker mb-2.5">Model distribution</div>
            {modelStats.length ? (
              <div className="space-y-2.5">
                {modelStats.slice(0, 6).map((stat) => {
                  const brand = providerForModel(stat.key);
                  return (
                    <div key={stat.key}>
                      <div className="flex items-baseline justify-between gap-3 text-[11px]">
                        <span className="flex min-w-0 items-center gap-1.5 font-mono text-ink-muted">
                          <ProviderLogo provider={brand.id} size={12} decorative />
                          <span className="truncate">{stat.key}</span>
                        </span>
                        <span className="shrink-0 font-mono tabular text-ink-faint">
                          {formatInt(stat.requests)} · {formatUSD(stat.cost, true)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(4, (stat.requests / maxModelRequests) * 100)}%`,
                            background: `linear-gradient(90deg, color-mix(in srgb, ${brand.color} 55%, #222222), ${brand.color})`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-ink-faint">
                No gateway traffic yet. Send a request to <span className="font-mono">/api/v1/chat/completions</span> to
                populate routing analytics.
              </p>
            )}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {(
                [
                  ["Manual", modeCounts.manual ?? 0],
                  ["Recommendation", modeCounts.recommendation ?? 0],
                  ["Automatic", modeCounts.automatic ?? 0],
                ] as const
              ).map(([label, count]) => (
                <div key={label} className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                  <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">{label}</div>
                  <div className="mt-0.5 font-mono text-[11.5px] tabular text-ink-muted">{formatInt(count)}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="kicker mb-2.5">Quality and latency by selected model</div>
            {modelStats.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-hairline-faint text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                      <th className="pb-1.5 pr-2 font-medium">Model</th>
                      <th className="pb-1.5 pr-2 text-right font-medium">Req</th>
                      <th className="pb-1.5 pr-2 text-right font-medium">Avg Q</th>
                      <th className="pb-1.5 pr-2 text-right font-medium">Avg latency</th>
                      <th className="pb-1.5 text-right font-medium">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelStats.slice(0, 6).map((stat) => (
                      <tr key={stat.key} className="border-b border-hairline-faint last:border-0">
                        <td className="max-w-[150px] py-1.5 pr-2 font-mono text-ink-muted">
                          <span className="flex items-center gap-1.5">
                            <ProviderLogo provider={providerForModel(stat.key).id} size={11} decorative />
                            <span className="truncate">{stat.key}</span>
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular text-ink-faint">{formatInt(stat.requests)}</td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular text-ink-faint">
                          {stat.averageQuality === null ? "—" : stat.averageQuality}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular text-ink-faint">
                          {stat.averageLatencyMs === null ? "—" : formatMs(stat.averageLatencyMs)}
                        </td>
                        <td className={cn("py-1.5 text-right font-mono tabular", stat.errors ? "text-[#FDA4AF]" : "text-ink-faint")}>
                          {formatInt(stat.errors)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="mt-2 text-[10px] leading-relaxed text-ink-faint">
              Quality is populated only when evaluation tooling scores a request; unlabeled traffic shows “—”.
            </div>

            <div className="kicker mb-2 mt-4">Routing failures</div>
            {failureCodes.length ? (
              <div className="space-y-1.5">
                {failureCodes.map(([code, count]) => (
                  <div key={code} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5 text-ink-muted">
                      <AlertTriangle className="size-3 shrink-0 text-[#FDA4AF]" />
                      <span className="truncate font-mono">{code}</span>
                    </span>
                    <span className="font-mono tabular text-ink-faint">{formatInt(count)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-ink-faint">No failed gateway requests in the last 30 days.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartContainer
          title="Model cost vs quality"
          description="Average cost per routed request against scored response quality · last 30 days"
          empty={!qualityPoints.length}
          emptyDescription="Quality scores appear once evaluation tooling labels gateway traffic."
          legend={
            <ChartLegend
              items={qualityProviders.map((provider) => ({
                label: providerBrand(provider).short,
                provider: providerBrand(provider).id,
              }))}
              columns={2}
            />
          }
        >
          <CostQualityScatter data={qualityPoints} height={260} />
        </ChartContainer>
        <Card>
          <CardTopBar>
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <BarChart3 className="size-3.5 text-ink-faint" /> Reading the scatter
            </div>
          </CardTopBar>
          <CardContent className="space-y-2.5 pt-3 text-[11.5px] leading-relaxed text-ink-faint">
            <p>
              Each point is a model that served routed traffic. The horizontal axis is the measured average cost per
              request; the vertical axis is the average quality score recorded on{" "}
              <span className="font-mono text-ink-muted">gateway_requests</span>.
            </p>
            <p>Bubble size is request volume. Color follows the provider brand, matching every other chart.</p>
            <p>
              Cheaper-but-equal models sit lower-left of a model at the same height. Quality is only averaged over
              evaluated requests — unscored traffic leaves the point out rather than guessing a score.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            <Rocket className="size-3.5 text-ink-faint" /> Safe rollouts
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Approval-gated</Badge>
            {canCreate && activePolicies.length ? (
              <DialogForm
                trigger={
                  <Button size="sm" variant="outline">
                    <Rocket /> New rollout
                  </Button>
                }
                title="Start a controlled rollout"
                description="Shadow mirrors traffic without serving the candidate; canary serves a slice. Both require an admin approval before traffic changes."
                action={createRolloutAction}
                submitLabel="Request rollout"
              >
                <Field label="Policy">
                  <select name="policyId" required className={selectClass} defaultValue={activePolicies[0]?.id}>
                    {activePolicies.map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.name} · {policy.primaryModel}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Mode">
                    <select name="mode" className={selectClass} defaultValue="canary">
                      <option value="shadow">Shadow · mirror only</option>
                      <option value="canary">Canary · serve a slice</option>
                    </select>
                  </Field>
                  <Field label="Initial traffic %" hint="canary only · max 50">
                    <Input name="trafficPercent" type="number" min={1} max={50} defaultValue={10} className="font-mono tabular" />
                  </Field>
                </div>
                <Field label="Candidate model">
                  <select name="candidateModel" required className={selectClass}>
                    <ModelOptions catalog={catalog} />
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Min samples" hint="guardrails armed after this">
                    <Input name="minSamples" type="number" min={5} defaultValue={20} className="font-mono tabular" />
                  </Field>
                  <Field label="Max error rate %">
                    <Input name="maxErrorRatePct" type="number" min={0} max={100} defaultValue={5} className="font-mono tabular" />
                  </Field>
                  <Field label="Max P95 latency (ms)">
                    <Input name="maxP95LatencyMs" type="number" min={500} defaultValue={4000} className="font-mono tabular" />
                  </Field>
                  <Field label="Min average quality">
                    <Input name="minAverageQuality" type="number" min={0} max={100} defaultValue={70} className="font-mono tabular" />
                  </Field>
                </div>
              </DialogForm>
            ) : null}
          </div>
        </CardTopBar>
        <CardContent className="space-y-3 pt-4">
          {rolloutRows.length ? (
            rolloutRows.map((rollout) => {
              const report = rolloutReports.get(rollout.id);
              const metrics = report?.metrics;
              const guardrails = report?.guardrails;
              const meta = ROLLOUT_STATUS[rollout.status] ?? ROLLOUT_STATUS.cancelled;
              const pending = pendingRolloutTargets.has(rollout.id);
              const canary = rollout.mode === "canary";
              const nextPercent = canary
                ? (rampSteps.find((step) => step > rollout.trafficPercent) ?? null)
                : null;
              const canPromote =
                canApprove &&
                rollout.status === "running" &&
                canary &&
                !!guardrails &&
                !guardrails.insufficientSamples &&
                guardrails.ok;
              return (
                <div key={rollout.id} className="rounded-lg border border-hairline-faint bg-black/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={canary ? "outline" : "default"}>{rollout.mode}</Badge>
                      <span className="font-mono text-[11.5px] text-ink-muted">{rollout.baselineModel}</span>
                      <ArrowRight className="size-3 text-ink-faint" />
                      <span className="font-mono text-[11.5px] text-ink">{rollout.candidateModel}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <span className="text-[10px] text-ink-faint">
                      {policyNameById.get(rollout.policyId) ?? rollout.policyId.slice(0, 8)}
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ink-faint">
                    <span>
                      {canary ? `${rollout.trafficPercent}% of policy traffic` : "Mirror only · 0% served"}
                    </span>
                    {rollout.approvedBy ? <span>approved by {rollout.approvedBy}</span> : null}
                    <span>{formatDate(rollout.createdAt)}</span>
                  </div>

                  <RolloutLifecycle
                    mode={rollout.mode}
                    status={rollout.status}
                    trafficPercent={rollout.trafficPercent}
                  />

                  {metrics ? (
                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {rollout.mode === "shadow" ? (
                        <>
                          <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Shadow samples</div>
                            <div className="mt-0.5 font-mono text-[11px] tabular text-ink-muted">
                              {formatInt(metrics.shadow.samples)} / {rollout.thresholds.minSamples}
                            </div>
                          </div>
                          <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Error rate</div>
                            <div className="mt-0.5 font-mono text-[11px] tabular text-ink-muted">
                              {metrics.shadow.errorRatePct.toFixed(1)}%
                            </div>
                          </div>
                          <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Avg latency</div>
                            <div className="mt-0.5 font-mono text-[11px] tabular text-ink-muted">
                              {formatMs(metrics.shadow.averageLatencyMs)}
                            </div>
                          </div>
                          <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Avg quality</div>
                            <div className="mt-0.5 font-mono text-[11px] tabular text-ink-muted">
                              {metrics.shadow.averageQuality === null ? "—" : metrics.shadow.averageQuality}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Canary samples</div>
                            <div className="mt-0.5 font-mono text-[11px] tabular text-ink-muted">
                              {formatInt(metrics.canary.samples)} / {rollout.thresholds.minSamples}
                            </div>
                          </div>
                          <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Error rate</div>
                            <div className="mt-0.5 font-mono text-[11px] tabular text-ink-muted">
                              {metrics.canary.errorRatePct.toFixed(1)}%
                            </div>
                          </div>
                          <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">P95 latency</div>
                            <div className="mt-0.5 font-mono text-[11px] tabular text-ink-muted">
                              {formatMs(metrics.canary.p95LatencyMs)}
                            </div>
                          </div>
                          <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Avg quality</div>
                            <div className="mt-0.5 font-mono text-[11px] tabular text-ink-muted">
                              {metrics.canary.averageQuality === null ? "—" : metrics.canary.averageQuality}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}

                  {guardrails?.reasons.length ? (
                    <p className="mt-2 text-[10.5px] leading-relaxed text-[#FDA4AF]">
                      Guardrail breach: {guardrails.reasons.join(" ")}
                    </p>
                  ) : rollout.mode === "shadow" ? (
                    <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
                      Mirror only: the candidate never serves traffic or bills as production usage
                      {metrics && metrics.shadow.samples > 0
                        ? `. ${formatInt(metrics.shadow.samples)} mirrored samples so far.`
                        : "."}
                    </p>
                  ) : guardrails?.notes.length ? (
                    <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">{guardrails.notes[0]}</p>
                  ) : null}

                  {rollout.outcomeReason ? (
                    <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">{rollout.outcomeReason}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-hairline-faint pt-2.5">
                    {pending ? (
                      <Link href="/governance?tab=approvals" className="text-[10.5px] text-[#FCD34D] hover:underline">
                        Awaiting approval <ArrowRight className="inline size-3" />
                      </Link>
                    ) : (
                      <span className="text-[10px] text-ink-faint">
                        {canary
                          ? `Auto-rollback armed after ${rollout.thresholds.minSamples} canary samples`
                          : "Shadow never serves traffic · compare samples before requesting a canary"}
                      </span>
                    )}
                    {canApprove && rollout.status === "running" ? (
                      <RolloutControls
                        id={rollout.id}
                        nextPercent={nextPercent}
                        canPromote={canPromote}
                        canRollback
                      />
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              No rollouts yet. Create a shadow rollout to compare a candidate against production without serving it, or a
              canary to serve an approved traffic slice.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            <FlaskConical className="size-3.5 text-ink-faint" /> Model evaluations
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Deterministic scoring</Badge>
            {canCreate ? (
              <DialogForm
                trigger={
                  <Button size="sm" variant="outline">
                    <FlaskConical /> Run evaluation
                  </Button>
                }
                title="Run a model evaluation"
                description="Executes real provider calls with stored credentials: cases × models requests. Results never change production traffic."
                action={runEvaluationAction}
                submitLabel="Run evaluation"
              >
                <Field label="Name">
                  <Input name="name" required minLength={3} placeholder="Support workload · weekly" />
                </Field>
                <Field label="Project">
                  <select name="projectId" required className={selectClass} defaultValue={projectRows[0]?.id}>
                    {projectRows.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Baseline model">
                    <select name="baselineModel" className={selectClass}>
                      <option value="">No baseline</option>
                      <ModelOptions catalog={catalog} />
                    </select>
                  </Field>
                  <Field label="Candidate models" hint="comma-separated provider/model keys">
                    <Input
                      name="candidateModels"
                      required
                      placeholder="openai/gpt-4.1-mini, anthropic/claude-3-5-haiku"
                    />
                  </Field>
                </div>
                <Field label="Dataset" hint="JSON array · max 20 cases">
                  <Textarea name="dataset" required defaultValue={sampleDataset} className="min-h-[150px] font-mono text-[10.5px]" />
                </Field>
              </DialogForm>
            ) : null}
          </div>
        </CardTopBar>
        <CardContent className="space-y-3 pt-4">
          {evaluationRows.length ? (
            evaluationRows.map((evaluation) => {
              const meta = EVAL_STATUS[evaluation.status] ?? EVAL_STATUS.draft;
              return (
                <div key={evaluation.id} className="rounded-lg border border-hairline-faint bg-black/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-medium text-ink">{evaluation.name}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <span className="text-[10px] text-ink-faint">{formatDate(evaluation.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-[10.5px] text-ink-faint">
                    Baseline {evaluation.baselineModel ?? "none"} · candidates {evaluation.candidateModels.join(", ") || "none"}
                  </div>
                  {evaluation.summary?.models.length ? (
                    <div className="mt-2.5 overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="border-b border-hairline-faint text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                            <th className="pb-1.5 pr-2 font-medium">Model</th>
                            <th className="pb-1.5 pr-2 text-right font-medium">Passed</th>
                            <th className="pb-1.5 pr-2 text-right font-medium">Quality</th>
                            <th className="pb-1.5 pr-2 text-right font-medium">P95</th>
                            <th className="pb-1.5 pr-2 text-right font-medium">Cost / success</th>
                            <th className="pb-1.5 text-right font-medium">Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evaluation.summary.models.map((model) => (
                            <tr key={model.model} className="border-b border-hairline-faint last:border-0">
                              <td className="max-w-[180px] py-1.5 pr-2 font-mono text-ink-muted">
                                <span className="flex items-center gap-1.5">
                                  <ProviderLogo provider={providerForModel(model.model).id} size={11} decorative />
                                  <span className="truncate">{model.model}</span>
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-right font-mono tabular text-ink-faint">
                                {model.passed}/{model.cases}
                              </td>
                              <td className="py-1.5 pr-2 text-right font-mono tabular text-ink-faint">
                                {model.averageQuality ?? "—"}
                              </td>
                              <td className="py-1.5 pr-2 text-right font-mono tabular text-ink-faint">
                                {formatMs(model.p95LatencyMs)}
                              </td>
                              <td className="py-1.5 pr-2 text-right font-mono tabular text-ink-faint">
                                {model.costPerSuccessUsd === null ? "—" : formatUSD(model.costPerSuccessUsd, true)}
                              </td>
                              <td className="py-1.5 text-right font-mono tabular text-ink-faint">
                                {formatUSD(model.totalCostUsd, true)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {evaluation.error ? (
                    <p className="mt-2 text-[10.5px] leading-relaxed text-[#FDA4AF]">{evaluation.error}</p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              No evaluations yet. Compare candidate models on representative cases before requesting a rollout.
            </p>
          )}
        </CardContent>
      </Card>

      {pendingApprovals.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-amber/30 bg-accent-amber/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-[#FCD34D]" />
            <div className="text-[11.5px] leading-relaxed text-[#FCD34D]">
              {pendingApprovals.length} routing change{pendingApprovals.length === 1 ? "" : "s"} awaiting an admin decision.
              Traffic keeps using the last approved configuration until then.
            </div>
          </div>
          <Link href="/governance?tab=approvals" className="text-[11px] text-[#FDE68A] underline-offset-2 hover:underline">
            Review in Governance <ArrowRight className="inline size-3" />
          </Link>
        </div>
      ) : null}

      <Card>
        <CardTopBar>
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            <Send className="size-3.5 text-ink-faint" /> Request-time resolution
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">POST /api/v1/chat/completions</Badge>
            <Badge variant="outline">POST /api/v1/route</Badge>
          </div>
        </CardTopBar>
        <CardContent className="grid gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              Your service asks TokenBurn which model to use. The router picks the most recently updated active policy for
              the project, feature and environment, then applies governance: allowed/blocked models and hard budget limits.
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
              Send <span className="font-mono">model: &quot;auto&quot;</span> to{" "}
              <span className="font-mono">/api/v1/chat/completions</span> to have the gateway execute this decision and stream
              the provider response back.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-hairline-faint bg-black/40 p-3 font-mono text-[10.5px] leading-relaxed text-ink-muted">
{`curl -s https://your-host/api/v1/route \\
  -H "Authorization: Bearer $TOKENBURN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"feature":"answer-generation","environment":"production",
       "inputTokens":6000,"outputTokens":400}'`}
            </pre>
          </div>
          <div className="space-y-2 rounded-md border border-hairline-faint bg-white/[0.015] p-3 text-[11px] leading-relaxed text-ink-faint">
            <div className="flex items-center gap-1.5 text-ink-muted">
              <ShieldCheck className="size-3.5" /> Enforcement order
            </div>
            <div>1 · Active policy by project/feature/environment</div>
            <div>2 · Allowed and blocked model lists</div>
            <div>3 · Hard budget limits (deny on exhaustion)</div>
            <div>4 · Cost estimate for the resolved model</div>
          </div>
        </CardContent>
      </Card>

      {sorted.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {sorted.map(({ policy: p, tokens, primaryCost, fallbackCost, primary, fallback }) => {
            const pending = pendingByTarget.get(p.id);
            const displayStatus = pending && p.status !== "active" ? "pending" : p.status;
            const meta = STATUS_META[displayStatus] ?? STATUS_META.draft;
            const delta = primaryCost !== null ? tokens.costUsd - primaryCost : null;
            const canSubmit = canCreate && (p.status === "draft" || p.status === "paused") && !pending;
            return (
              <Card key={p.id} className="flex flex-col">
                <CardTopBar>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-ink">{p.name}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ink-faint">
                      <span className="flex items-center gap-1">
                        <Workflow className="size-3" /> {projectName.get(p.projectId) ?? "project"}
                      </span>
                      <span>·</span>
                      <span>{p.environment}</span>
                      <span>·</span>
                      <span>{p.feature ?? "all features"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={p.mode === "automatic" ? "good" : "outline"}>{p.mode}</Badge>
                    <Badge variant="outline">{STRATEGY_LABEL[p.strategy] ?? p.strategy}</Badge>
                  </div>
                </CardTopBar>

                <CardContent className="flex flex-1 flex-col gap-3.5 pt-4">
                  <div className="flex items-center gap-2 rounded-md border border-hairline-faint bg-black/25 px-3 py-2.5 text-[11.5px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">Primary</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <ProviderLogo provider={providerForModel(p.primaryModel).id} size={12} decorative />
                        <span className="truncate text-ink">{primary?.displayName ?? p.primaryModel}</span>
                        {primary ? (
                          <span className="font-mono text-[9.5px] text-ink-faint">
                            Q{primary.qualityScore} · {formatMs(primary.typicalLatencyMs)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <ArrowRight className="size-3.5 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">Fallback</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <ProviderLogo provider={providerForModel(p.fallbackModel).id} size={12} decorative />
                        <span className="truncate text-ink-muted">{fallback?.displayName ?? p.fallbackModel}</span>
                        {fallback ? (
                          <span className="font-mono text-[9.5px] text-ink-faint">
                            Q{fallback.qualityScore} · {formatMs(fallback.typicalLatencyMs)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                      <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Matched · 30d</div>
                      <div className="mt-0.5 font-mono text-[11.5px] tabular text-ink-muted">{formatInt(tokens.requests)}</div>
                    </div>
                    <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                      <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Measured</div>
                      <div className="mt-0.5 font-mono text-[11.5px] tabular text-ink-muted">{formatUSD(tokens.costUsd)}</div>
                    </div>
                    <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                      <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Replay · primary</div>
                      <div className="mt-0.5 font-mono text-[11.5px] tabular text-ink">
                        {primaryCost === null ? "—" : formatUSD(primaryCost)}
                      </div>
                    </div>
                    <div className="rounded-md border border-hairline-faint bg-black/25 px-2.5 py-2">
                      <div className="text-[9px] uppercase tracking-[0.1em] text-ink-faint">Replay · fallback</div>
                      <div className="mt-0.5 font-mono text-[11.5px] tabular text-ink-muted">
                        {fallbackCost === null ? "—" : formatUSD(fallbackCost)}
                      </div>
                    </div>
                  </div>

                  {delta !== null && Math.abs(delta) > 0.5 ? (
                    <div className="flex items-center justify-between gap-2 text-[10.5px]">
                      <span className="text-ink-faint">Replaying measured tokens at primary rates</span>
                      <span className={cn("font-mono tabular", delta > 0 ? "text-[#6EE7B7]" : "text-[#FDA4AF]")}>
                        {delta > 0 ? "−" : "+"}
                        {formatUSD(Math.abs(delta))} / 30d
                      </span>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-faint">
                    {p.maxOutputTokens ? <span>max_tokens {formatInt(p.maxOutputTokens)}</span> : null}
                    <span>cache {p.cacheEnabled ? "on" : "off"}</span>
                    {p.approvedBy ? <span>approved by {p.approvedBy}</span> : null}
                    {pending ? <span className="text-[#FCD34D]">approval pending</span> : null}
                  </div>

                  {p.notes ? <p className="text-[11px] leading-relaxed text-ink-faint">{p.notes}</p> : null}

                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline-faint pt-2.5">
                    <span className="flex items-center gap-1 text-[10px] text-ink-faint">
                      <Split className="size-3" />
                      {p.feature ? "Feature-scoped" : "Project-wide"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {pending ? (
                        <Link href="/governance?tab=approvals" className="text-[10.5px] text-[#FCD34D] hover:underline">
                          Awaiting decision <ArrowRight className="inline size-3" />
                        </Link>
                      ) : null}
                      {p.status === "active" && canApprove ? <PausePolicyButton id={p.id} /> : null}
                      {canSubmit ? (
                        <SubmitPolicyButton
                          id={p.id}
                          label={p.environment === "production" ? "Request activation" : "Activate"}
                        />
                      ) : null}
                      {!canCreate ? (
                        <span className="flex items-center gap-1 text-[10px] text-ink-faint">
                          <Lock className="size-3" /> Read only
                        </span>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Route className="size-4" />}
          title="No routing policies yet"
          description="Create a draft to describe which model should serve a project, feature and environment. Production activation needs an approval."
          action={
            canCreate ? (
              <DialogForm
                trigger={<Button size="sm">New routing policy</Button>}
                title="New routing policy"
                description="Drafts do not affect traffic. Activation of production policies requires approval."
                action={createPolicyAction}
                submitLabel="Create draft"
              >
                <Field label="Policy name">
                  <Input name="name" required minLength={3} />
                </Field>
                <Field label="Project">
                  <select name="projectId" required className={selectClass} defaultValue={projectRows[0]?.id}>
                    {projectRows.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Primary model">
                  <select name="primaryModel" required className={selectClass}>
                    <ModelOptions catalog={catalog} />
                  </select>
                </Field>
                <Field label="Fallback model">
                  <select name="fallbackModel" required className={selectClass}>
                    <ModelOptions catalog={catalog} />
                  </select>
                </Field>
              </DialogForm>
            ) : null
          }
        />
      )}

      <DataNote>
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-hairline-strong">
          <PauseCircle className="size-2.5" />
        </span>
        <span>
          Replay figures reprice <span className="text-ink-muted">observed 30-day tokens</span> at the policy&apos;s models
          using the authoritative cost engine; they exclude quality and latency risk. Automatic policies are enforced by{" "}
          <span className="font-mono text-ink-muted">/api/v1/chat/completions</span>;{" "}
          <span className="font-mono text-ink-muted">/api/v1/route</span> only returns a decision. Production activation
          always creates an approval request, regardless of the organization setting. Pausing an active policy is an admin
          action and is audited.
        </span>
      </DataNote>
    </div>
  );
}
