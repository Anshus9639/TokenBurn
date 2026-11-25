import { and, desc, eq, notInArray } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import { rawQuery } from "@/lib/db/client";
import { projects, recommendations } from "@/lib/db/schema";
import { getActiveCatalog, type PricingRecord } from "@/lib/pricing-db";
import { computeCost } from "@/lib/pricing";
import { cached, invalidateCache } from "@/lib/cache";
import { formatUSD, formatInt, formatPercent, startOfDayUTC, addDays } from "@/lib/utils";

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const REFRESH_TTL = 5 * 60_000;

type ImpactLevel = "none" | "low" | "medium" | "high";
type LatencyDirection = "decrease" | "increase" | "neutral" | "unknown";

type Evidence = {
  // Every recommendation carries the full decision record, not just a savings estimate.
  problem: string;
  action: string;
  savingsBasis: string;
  benchmarkRequired: boolean;
  qualityImpact: { level: ImpactLevel; detail: string };
  latencyImpact: { direction: LatencyDirection; detail: string };
  validationProcedure: string[];
  implementationSteps: string[];
  companionOpportunities?: Array<{
    kind: string;
    title: string;
    estimatedMonthlySavingsUsd: number;
    counted: false;
    note: string;
  }>;
  [key: string]: unknown;
};

type Candidate = {
  fingerprint: string;
  kind: string;
  scope: string;
  projectId: string | null;
  feature: string | null;
  model: string | null;
  title: string;
  summary: string;
  rationale: string;
  evidence: Evidence;
  savings: number;
  confidence: "low" | "medium" | "high";
  measurement: "estimated" | "measured";
};

function cacheDiscountRatio(p?: PricingRecord): number {
  if (!p || p.inputPerM <= 0) return 0.5;
  return Math.max(0, Math.min(0.9, 1 - p.cachedInputPerM / p.inputPerM));
}

export async function refreshRecommendations(
  db: AppDb,
  orgId: string,
  force = false,
): Promise<typeof recommendations.$inferSelect[]> {
  if (!force) {
    const throttleKey = `recs:${orgId}`;
    const recent = await cached(throttleKey, REFRESH_TTL, async () => {
      const rows = await db
        .select({ generatedAt: recommendations.generatedAt })
        .from(recommendations)
        .where(eq(recommendations.orgId, orgId))
        .orderBy(desc(recommendations.generatedAt))
        .limit(1);
      return rows[0]?.generatedAt ?? null;
    });
    if (recent && Date.now() - new Date(recent).getTime() < REFRESH_TTL) {
      return listRecommendations(db, orgId);
    }
  }

  const since = addDays(new Date(), -30);
  const catalog = await getActiveCatalog(db);
  const pricingByModel = new Map(catalog.map((p) => [`${p.provider}/${p.model}`, p]));
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId));
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));

  const candidates: Candidate[] = [];

  const featureRows = await rawQuery<{
    project_id: string;
    feature: string;
    provider: string;
    model: string;
    requests: string;
    input_tokens: string;
    output_tokens: string;
    cached_tokens: string;
    cost: string;
    input_usd: string;
    output_usd: string;
    cached_usd: string;
    avg_input: string;
    avg_output: string;
    p95_input: string;
    p95_output: string;
    p50_output: string;
  }>(
    `select project_id, feature, provider, model,
            count(*)::int as requests,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens,
            coalesce(sum(cached_input_tokens), 0)::int as cached_tokens,
            coalesce(sum(cost_usd), 0)::float8 as cost,
            coalesce(sum((cost_breakdown->>'inputUsd')::float8), 0)::float8 as input_usd,
            coalesce(sum((cost_breakdown->>'outputUsd')::float8), 0)::float8 as output_usd,
            coalesce(sum((cost_breakdown->>'cachedInputUsd')::float8), 0)::float8 as cached_usd,
            coalesce(avg(input_tokens), 0)::float8 as avg_input,
            coalesce(avg(output_tokens), 0)::float8 as avg_output,
            coalesce(percentile_cont(0.95) within group (order by input_tokens), 0)::float8 as p95_input,
            coalesce(percentile_cont(0.95) within group (order by output_tokens), 0)::float8 as p95_output,
            coalesce(percentile_cont(0.5) within group (order by output_tokens), 0)::float8 as p50_output
       from usage_events
      where org_id = $1 and occurred_at >= $2
      group by project_id, feature, provider, model
      having count(*) >= 25
      order by cost desc`,
    [orgId, since],
  );

  for (const row of featureRows.rows) {
    const pricing = pricingByModel.get(`${row.provider}/${row.model}`);
    const requests = num(row.requests);
    const inputUsd = num(row.input_usd);
    const outputUsd = num(row.output_usd);
    const cost = num(row.cost);
    const inputTokens = num(row.input_tokens);
    const cachedTokens = num(row.cached_tokens);
    const avgInput = num(row.avg_input);
    const avgOutput = num(row.avg_output);
    const p95Output = num(row.p95_output);
    const p50Output = num(row.p50_output);
    const cachedRatio = inputTokens > 0 ? cachedTokens / inputTokens : 0;

    if (!pricing) continue;

    // 1) Oversized context vs small output → prompt compression.
    if (avgInput >= 14_000 && avgOutput <= 900 && inputUsd >= 5) {
      const savings = inputUsd * 0.25;
      candidates.push({
        fingerprint: `compression:${row.project_id}:${row.feature}:${row.model}`,
        kind: "context_compression",
        scope: "feature",
        projectId: row.project_id,
        feature: row.feature,
        model: row.model,
        title: `Compress context for ${row.feature}`,
        summary: `${row.feature} averages ${formatInt(avgInput)} input tokens per request but only ${formatInt(avgOutput)} output tokens. Retrieval and system context dominate spend.`,
        rationale:
          "Estimated by applying a conservative 25% input-token reduction to the last 30 days of measured input spend. Reduction is an assumption, not a measured result.",
        evidence: {
          problem: `Input context dominates spend: ${formatInt(avgInput)} average input tokens per request versus ${formatInt(avgOutput)} output tokens.`,
          action:
            "Deduplicate system instructions, trim retrieved chunks to what the task needs, and summarize older conversation turns before each call.",
          savingsBasis:
            "Applies an assumed 25% input-token reduction to measured input spend from the last 30 days. The reduction itself has not been measured.",
          benchmarkRequired: true,
          qualityImpact: {
            level: "medium",
            detail: "Removing context can drop facts the answer depends on. Replay sampled requests against your eval set before rollout.",
          },
          latencyImpact: {
            direction: "decrease",
            detail: "Fewer input tokens usually reduce prefill time; confirm with provider-reported latency.",
          },
          validationProcedure: [
            "Sample 50 recent requests and record current answers.",
            "Replay the same requests with compressed context.",
            "Score both outputs with your acceptance or eval checks.",
            "Confirm the input-token reduction in provider usage before rolling out.",
          ],
          implementationSteps: [
            "Identify the largest static and retrieved sections in the prompt.",
            "Remove duplicated instructions and cap retrieved chunks per request.",
            "Add conversation summarization beyond a fixed number of turns.",
            "Ship behind a feature flag and compare token usage and answer quality.",
          ],
          requests,
          avgInputTokens: Math.round(avgInput),
          avgOutputTokens: Math.round(avgOutput),
          p95InputTokens: Math.round(num(row.p95_input)),
          last30dInputUsd: Number(inputUsd.toFixed(2)),
          assumedReduction: 0.25,
        },
        savings: savings,
        confidence: savings >= 30 ? "high" : "medium",
        measurement: "estimated",
      });
    }

    // 2) Cache opportunity on large, uncached prompts.
    const discount = cacheDiscountRatio(pricing);
    if (inputUsd >= 8 && cachedRatio < 0.12 && avgInput >= 2_500 && discount > 0.2) {
      const stableShare = 0.4;
      const savings = inputUsd * stableShare * discount;
      candidates.push({
        fingerprint: `cache:${row.project_id}:${row.feature}:${row.model}`,
        kind: "caching",
        scope: "feature",
        projectId: row.project_id,
        feature: row.feature,
        model: row.model,
        title: `Enable prompt caching for ${row.feature}`,
        summary: `Only ${formatPercent(cachedRatio)} of ${row.feature} input tokens were served from cache over 30 days. ${pricing.displayName} discounts cached input by ${formatPercent(discount)}.`,
        rationale:
          "Assumes a stable 40% prefix (system prompt, schema or document preamble) becomes cacheable. This is an estimate from token volume, not a cache experiment.",
        evidence: {
          problem: `Only ${formatPercent(cachedRatio)} of input tokens were served from cache, so a stable prefix is being re-billed at full input rates.`,
          action:
            "Place the stable prefix first (system prompt, schema, static documents) and enable the provider's prompt cache with an appropriate TTL.",
          savingsBasis: `Assumes ${formatPercent(stableShare)} of input becomes cacheable at the catalog's ${formatPercent(discount)} cached-input discount. This is an estimate, not a cache experiment.`,
          benchmarkRequired: false,
          qualityImpact: {
            level: "none",
            detail: "A cached prefix produces the same computation; answers should be unchanged.",
          },
          latencyImpact: {
            direction: "decrease",
            detail: "Cache reads typically reduce prefill latency; verify in provider metrics.",
          },
          validationProcedure: [
            "Confirm the prefix is byte-stable across requests.",
            "Enable caching in staging.",
            "Check cache read and write token counts in the next usage report.",
            "Compare cost per request before and after.",
          ],
          implementationSteps: [
            "Move system prompt, schema and static documents to the front.",
            "Remove timestamps or request IDs from the cached prefix.",
            "Enable caching in the provider SDK or gateway.",
            "Monitor cache hit rate and invalidation events.",
          ],
          requests,
          cachedRatio: Number(cachedRatio.toFixed(4)),
          discountRate: Number(discount.toFixed(4)),
          last30dInputUsd: Number(inputUsd.toFixed(2)),
          assumedCacheableShare: stableShare,
          providerCachingDocs: pricing.provider === "openai" ? "https://platform.openai.com/docs/guides/prompt-caching" : undefined,
        },
        savings,
        confidence: "medium",
        measurement: "estimated",
      });
    }

    // 3) Cheaper sibling model for low-output workloads.
    if (avgOutput <= 700 && cost >= 12 && pricing.qualityScore >= 80) {
      const siblings = catalog
        .filter(
          (p) =>
            p.model !== pricing.model &&
            p.category !== "embedding" &&
            p.qualityScore >= pricing.qualityScore - 12 &&
            p.outputPerM + p.inputPerM < pricing.outputPerM + pricing.inputPerM,
        )
        .sort(
          (a, b) =>
            computeCost(a, {
              inputTokens,
              cachedInputTokens: cachedTokens,
              outputTokens: num(row.output_tokens),
            }).costUsd -
            computeCost(b, {
              inputTokens,
              cachedInputTokens: cachedTokens,
              outputTokens: num(row.output_tokens),
            }).costUsd,
        );
      const alt = siblings[0];
      if (alt) {
        const altCost = computeCost(alt, {
          inputTokens,
          cachedInputTokens: Math.min(cachedTokens, cachedTokens),
          outputTokens: num(row.output_tokens),
        }).costUsd;
        const savings = cost - altCost;
        if (savings >= 8 && savings / Math.max(cost, 0.01) >= 0.2) {
          candidates.push({
            fingerprint: `downgrade:${row.project_id}:${row.feature}:${row.model}:${alt.model}`,
            kind: "model_downgrade",
            scope: "feature",
            projectId: row.project_id,
            feature: row.feature,
            model: row.model,
            title: `Route ${row.feature} to ${alt.displayName}`,
            summary: `${row.feature} averages ${formatInt(avgOutput)} output tokens on ${pricing.displayName}. ${alt.displayName} would have cost ${formatUSD(altCost)} instead of ${formatUSD(cost)} for the same measured tokens.`,
            rationale:
              `Repriced the last 30 days of observed tokens (${formatInt(inputTokens)} input, ${formatInt(num(row.output_tokens))} output) at ${alt.displayName} rates. Recurring savings are an estimate; quality and latency differences are not measured.`,
            evidence: {
              problem: `${pricing.displayName} handles a low-output workload (${formatInt(avgOutput)} average output tokens) where ${alt.displayName} prices the same measured tokens materially lower.`,
              action: `Pilot ${alt.displayName} on a sampled traffic slice behind an approval-gated routing policy, with ${pricing.displayName} as fallback.`,
              savingsBasis:
                "Re-priced the same measured 30-day input and output tokens at the alternative model's catalog list price. No quality or latency equivalence is implied.",
              benchmarkRequired: true,
              qualityImpact: {
                level: alt.qualityScore >= pricing.qualityScore - 4 ? "low" : "high",
                detail: `Catalog quality scores are ${pricing.qualityScore} (current) and ${alt.qualityScore} (alternative). These are static scores, not a benchmark of your workload; do not treat the models as equivalent without evals.`,
              },
              latencyImpact: {
                direction:
                  alt.typicalLatencyMs < pricing.typicalLatencyMs * 0.85
                    ? "decrease"
                    : alt.typicalLatencyMs > pricing.typicalLatencyMs * 1.15
                      ? "increase"
                      : "unknown",
                detail: `Catalog typical latency is ${formatInt(pricing.typicalLatencyMs)}ms versus ${formatInt(alt.typicalLatencyMs)}ms. Catalog values are not measured on your prompts.`,
              },
              validationProcedure: [
                "Build a blind eval from 100 sampled prompts.",
                "Run both models and compare task success and answer quality.",
                "Canary 10% of traffic through a routing policy.",
                "Review error rate, latency and acceptance for seven days before full rollout.",
              ],
              implementationSteps: [
                "Create a draft routing policy with the alternative as primary and the current model as fallback.",
                "Request approval from an admin.",
                "Enable the policy for a small traffic percentage.",
                "Compare quality and cost, then widen or roll back.",
              ],
              currentModel: `${pricing.provider}/${pricing.model}`,
              currentQuality: pricing.qualityScore,
              alternativeModel: `${alt.provider}/${alt.model}`,
              alternativeQuality: alt.qualityScore,
              qualityDelta: alt.qualityScore - pricing.qualityScore,
              currentLatencyMs: pricing.typicalLatencyMs,
              alternativeLatencyMs: alt.typicalLatencyMs,
              last30dCostUsd: Number(cost.toFixed(2)),
              repricedCostUsd: Number(altCost.toFixed(2)),
              requests,
            },
            savings,
            confidence: "medium",
            measurement: "estimated",
          });
        }
      }
    }

    // 4) Output bloat / max_tokens cap.
    if (p95Output >= 1_800 && p95Output > p50Output * 2.2 && outputUsd >= 6) {
      const savings = outputUsd * 0.12;
      candidates.push({
        fingerprint: `outputcap:${row.project_id}:${row.feature}`,
        kind: "output_cap",
        scope: "feature",
        projectId: row.project_id,
        feature: row.feature,
        model: row.model,
        title: `Cap output tokens for ${row.feature}`,
        summary: `p50 output is ${formatInt(p50Output)} tokens while p95 is ${formatInt(p95Output)}. A max_tokens ceiling would contain long-tail generations without affecting most requests.`,
        rationale:
          "Applies a 12% reduction assumption to measured output spend. Validate against acceptance tests before enforcement; truncation can affect answer completeness.",
        evidence: {
          problem: `Output length has a heavy tail: p50 is ${formatInt(p50Output)} tokens while p95 is ${formatInt(p95Output)}.`,
          action:
            "Set max_tokens near the p95 you can accept and handle truncation explicitly, rather than letting long-tail generations run unbounded.",
          savingsBasis:
            "Applies an assumed 12% reduction to measured output spend. Truncation behavior and answer completeness have not been measured.",
          benchmarkRequired: true,
          qualityImpact: {
            level: "medium",
            detail: "A hard cap can cut off answers. Check completion and accepted-output rates before enforcing it.",
          },
          latencyImpact: {
            direction: "decrease",
            detail: "Shorter generations usually finish sooner; measure end-to-end latency.",
          },
          validationProcedure: [
            "Enable the cap in staging with production-like prompts.",
            "Measure truncation and incomplete-answer rates.",
            "Compare against acceptance tests or reviewer scores.",
            "Roll out gradually while watching p95 latency and completion rate.",
          ],
          implementationSteps: [
            "Inspect the longest outputs to confirm they are not legitimately long.",
            "Set max_tokens just above the accepted p95.",
            "Add explicit handling for finish_reason = length.",
            "Monitor truncation and user feedback after rollout.",
          ],
          p50OutputTokens: Math.round(p50Output),
          p95OutputTokens: Math.round(p95Output),
          last30dOutputUsd: Number(outputUsd.toFixed(2)),
          requests,
        },
        savings,
        confidence: "low",
        measurement: "estimated",
      });
    }
  }

  // 5) Repeated prompts (exact or near-identical hashes).
  const repeatRows = await rawQuery<{
    project_id: string;
    feature: string;
    prompt_hash: string;
    requests: string;
    model: string;
    provider: string;
    input_tokens: string;
    cost: string;
    input_usd: string;
  }>(
    `select project_id, feature, prompt_hash, (array_agg(provider))[1] as provider, (array_agg(model))[1] as model,
            count(*)::int as requests,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(cost_usd), 0)::float8 as cost,
            coalesce(sum((cost_breakdown->>'inputUsd')::float8), 0)::float8 as input_usd
       from usage_events
      where org_id = $1 and occurred_at >= $2 and prompt_hash is not null
      group by project_id, feature, prompt_hash
      having count(*) >= 8
      order by input_usd desc limit 6`,
    [orgId, since],
  );

  for (const row of repeatRows.rows) {
    const pricing = pricingByModel.get(`${row.provider}/${row.model}`);
    const discount = cacheDiscountRatio(pricing);
    const requests = num(row.requests);
    const inputUsd = num(row.input_usd);
    const repeatShare = (requests - 1) / requests;
    const savings = inputUsd * repeatShare * discount;
    if (savings < 2) continue;
    candidates.push({
      fingerprint: `repeat:${row.project_id}:${row.feature}:${row.prompt_hash.slice(0, 16)}`,
      kind: "repeated_prompts",
      scope: "feature",
      projectId: row.project_id,
      feature: row.feature,
      model: row.model,
      title: `Duplicate prompt cluster in ${row.feature}`,
      summary: `${requests} requests in the last 30 days share one prompt fingerprint (${row.prompt_hash.slice(0, 22)}…), consuming ${formatInt(num(row.input_tokens))} input tokens.`,
      rationale:
        `Estimated by treating all but the first occurrence as cacheable at the ${formatPercent(discount)} cached-input discount. Duplicate detection uses a prompt hash; semantically similar but differently worded prompts are not included.`,
      evidence: {
        problem: `${requests} requests share one exact prompt fingerprint, so identical work is billed repeatedly.`,
        action: "Add a response cache keyed by prompt hash where reusing an identical answer is acceptable.",
        savingsBasis:
          "Treats all but the first occurrence as cacheable at the catalog cached-input discount. Exact hash matches only; semantically similar prompts are not included.",
        benchmarkRequired: false,
        qualityImpact: {
          level: "low",
          detail: "Identical prompts reuse identical responses. The risk is staleness if underlying data changes.",
        },
        latencyImpact: {
          direction: "decrease",
          detail: "Cache hits skip model inference entirely.",
        },
        validationProcedure: [
          "Confirm the hashes represent truly identical prompts and parameters.",
          "Check how often the underlying data changes.",
          "Enable the cache with a short TTL in staging.",
          "Compare hit rate and user-visible freshness.",
        ],
        implementationSteps: [
          "Derive a stable hash from prompt, model and generation parameters.",
          "Store responses with an explicit TTL.",
          "Serve cache hits before calling the provider.",
          "Invalidate entries when data or prompt templates change.",
        ],
        promptHash: row.prompt_hash,
        requests,
        repeatShare: Number(repeatShare.toFixed(3)),
        last30dInputUsd: Number(inputUsd.toFixed(2)),
        discountRate: Number(discount.toFixed(4)),
        project: projectName.get(row.project_id) ?? "project",
      },
      savings,
      confidence: requests >= 20 ? "high" : "medium",
      measurement: "estimated",
    });
  }

  // 6) Spend anomalies in the last 7 days vs 30-day baseline.
  const dailyRows = await rawQuery<{ day: string; cost: string; requests: string }>(
    `select (occurred_at at time zone 'UTC')::date::text as day,
            coalesce(sum(cost_usd), 0)::float8 as cost,
            count(*)::int as requests
       from usage_events
      where org_id = $1 and occurred_at >= $2
      group by 1 order by 1`,
    [orgId, addDays(startOfDayUTC(new Date()), -30)],
  );
  const daily = dailyRows.rows.map((r) => ({ day: r.day, cost: num(r.cost), requests: num(r.requests) }));
  const baseline = daily.slice(0, -7);
  const mean = baseline.length ? baseline.reduce((a, b) => a + b.cost, 0) / baseline.length : 0;
  const variance = baseline.length
    ? baseline.reduce((a, b) => a + (b.cost - mean) ** 2, 0) / baseline.length
    : 0;
  const std = Math.sqrt(variance);
  for (const d of daily.slice(-7)) {
    if (std <= 0) break;
    const z = (d.cost - mean) / std;
    if (z < 1.8 || d.cost <= 0) continue;

    const contributors = await rawQuery<{
      feature: string;
      project_name: string;
      cost: string;
      requests: string;
      avg_input: string;
    }>(
      `select ue.feature, p.name as project_name, coalesce(sum(ue.cost_usd), 0)::float8 as cost, count(*)::int as requests,
              coalesce(avg(ue.input_tokens), 0)::float8 as avg_input
         from usage_events ue join projects p on p.id = ue.project_id
        where ue.org_id = $1 and (ue.occurred_at at time zone 'UTC')::date::text = $2
        group by ue.feature, p.name order by cost desc limit 3`,
      [orgId, d.day],
    );
    const top = contributors.rows[0];
    const excess = d.cost - mean;
    candidates.push({
      fingerprint: `anomaly:${orgId}:${d.day}`,
      kind: "anomaly",
      scope: "organization",
      projectId: null,
      feature: top?.feature ?? null,
      model: null,
      title: `Spend anomaly on ${d.day}: ${z.toFixed(1)}σ above baseline`,
      summary: `Spend reached ${formatUSD(d.cost)} versus a 30-day baseline of ${formatUSD(mean)}/day. Largest contributor: ${top ? `${top.feature} (${top.project_name}) with ${formatInt(num(top.avg_input))} avg input tokens` : "n/a"}.`,
      rationale:
        `Excess versus baseline is ${formatUSD(excess)}. This is a one-time measured variance, not a recurring monthly saving. Contributor attribution uses the actual events on the anomalous day (${formatInt(d.requests)} requests).`,
      evidence: {
        problem: `Measured daily spend on ${d.day} was ${z.toFixed(1)}σ above the trailing baseline.`,
        action: "Investigate that day's top contributors for a deploy, batch job or traffic change before changing routing.",
        savingsBasis:
          "One-time measured excess versus baseline. It is reported as a finding and is not counted as recurring monthly savings.",
        benchmarkRequired: false,
        qualityImpact: {
          level: "none",
          detail: "Investigation alone does not change model behavior.",
        },
        latencyImpact: {
          direction: "neutral",
          detail: "No routing change is proposed.",
        },
        validationProcedure: [
          "Inspect the top contributor requests for that day.",
          "Compare deploy and batch schedules against the prior week.",
          "Confirm whether the excess repeats on later days.",
          "Add a budget or alert rule only if the pattern recurs.",
        ],
        implementationSteps: [
          "Open Usage Analytics filtered to the anomaly day.",
          "Compare feature and model mix against the trailing week.",
          "Identify the triggering change or batch job.",
          "Mitigate or add a guardrail if the pattern recurs.",
        ],
        day: d.day,
        zScore: Number(z.toFixed(2)),
        dayCostUsd: Number(d.cost.toFixed(2)),
        baselineDailyUsd: Number(mean.toFixed(2)),
        oneTimeExcessUsd: Number(excess.toFixed(2)),
        topContributors: contributors.rows.map((c) => ({
          feature: c.feature,
          project: c.project_name,
          costUsd: Number(num(c.cost).toFixed(2)),
          requests: num(c.requests),
          avgInputTokens: Math.round(num(c.avg_input)),
        })),
      },
      savings: Math.max(0, excess),
      confidence: "high",
      measurement: "measured",
    });
  }

  // 7) Token-volume anomalies per feature: average input tokens per request jumping
  // far above its own trailing baseline. This is separate from spend anomalies — a
  // prompt or retrieval change can bloat tokens without a proportional cost spike.
  const tokenRows = await rawQuery<{
    project_id: string;
    feature: string;
    day: string;
    avg_input: string;
    requests: string;
    input_usd: string;
  }>(
    `select project_id, feature,
            (occurred_at at time zone 'UTC')::date::text as day,
            coalesce(avg(input_tokens), 0)::float8 as avg_input,
            count(*)::int as requests,
            coalesce(sum((cost_breakdown->>'inputUsd')::float8), 0)::float8 as input_usd
       from usage_events
      where org_id = $1 and occurred_at >= $2
      group by project_id, feature, 3
      having count(*) >= 5
      order by 3`,
    [orgId, addDays(startOfDayUTC(new Date()), -30)],
  );
  const tokenSeries = new Map<string, Array<{ day: string; avgInput: number; requests: number; inputUsd: number }>>();
  for (const row of tokenRows.rows) {
    const key = `${row.project_id}::${row.feature}`;
    const list = tokenSeries.get(key) ?? [];
    list.push({
      day: row.day,
      avgInput: num(row.avg_input),
      requests: num(row.requests),
      inputUsd: num(row.input_usd),
    });
    tokenSeries.set(key, list);
  }
  const tokenAnomalies: Candidate[] = [];
  for (const [key, days] of tokenSeries) {
    const baselineDays = days.slice(0, -3);
    if (baselineDays.length < 6) continue;
    const meanInput = baselineDays.reduce((a, b) => a + b.avgInput, 0) / baselineDays.length;
    if (meanInput <= 0) continue;
    const varianceInput = baselineDays.reduce((a, b) => a + (b.avgInput - meanInput) ** 2, 0) / baselineDays.length;
    const stdInput = Math.sqrt(varianceInput);
    if (stdInput <= 0) continue;
    const [projectId, feature] = key.split("::") as [string, string];
    for (const d of days.slice(-3)) {
      const z = (d.avgInput - meanInput) / stdInput;
      if (z < 2.5 || d.avgInput < meanInput * 1.4 || d.inputUsd < 1) continue;
      const excessTokens = Math.round((d.avgInput - meanInput) * d.requests);
      const excessUsd = d.inputUsd * (1 - meanInput / d.avgInput);
      tokenAnomalies.push({
        fingerprint: `token_anomaly:${projectId}:${feature}:${d.day}`,
        kind: "token_anomaly",
        scope: "feature",
        projectId,
        feature,
        model: null,
        title: `Input tokens spiked for ${feature} on ${d.day}`,
        summary: `Average input per request reached ${formatInt(d.avgInput)} versus a trailing baseline of ${formatInt(meanInput)} (${z.toFixed(1)}σ). About ${formatInt(excessTokens)} extra input tokens were billed that day.`,
        rationale:
          `Measured from provider-reported input token counts for that feature-day (${formatInt(d.requests)} requests). Excess spend versus baseline was ${formatUSD(Math.max(0, excessUsd))}; this is a one-time variance, not a recurring monthly saving.`,
        evidence: {
          problem: `Average input tokens per request were ${z.toFixed(1)}σ above this feature's trailing baseline.`,
          action:
            "Compare that day's prompt or retrieval changes. Look for unpruned conversation history, larger retrieved chunks or a document-inlining change.",
          savingsBasis:
            "One-time measured excess input tokens versus this feature's baseline, priced with the stored per-event cost breakdown. Not counted as recurring savings.",
          benchmarkRequired: false,
          qualityImpact: {
            level: "none",
            detail: "Investigation only. Any context reduction you decide to make should be validated separately.",
          },
          latencyImpact: {
            direction: "neutral",
            detail: "No routing change is proposed by this finding.",
          },
          validationProcedure: [
            "Open Usage Analytics filtered to this feature and day.",
            "Inspect request sizes and prompt versions around the spike.",
            "Compare with deploys, backfills or batch jobs that ran that day.",
            "Confirm whether token volume returned to baseline.",
          ],
          implementationSteps: [
            "Diff prompt templates and retrieval settings against the prior week.",
            "Check for unexpectedly large documents or duplicated context.",
            "Add an input-token alert threshold for this feature.",
            "Re-run the analysis after the next full day of traffic.",
          ],
          day: d.day,
          feature,
          project: projectName.get(projectId) ?? "project",
          zScore: Number(z.toFixed(2)),
          avgInputTokens: Math.round(d.avgInput),
          baselineAvgInputTokens: Math.round(meanInput),
          excessTokens,
          requests: d.requests,
          oneTimeExcessUsd: Number(Math.max(0, excessUsd).toFixed(2)),
        },
        savings: Math.max(0, excessUsd),
        confidence: z >= 3 ? "high" : "medium",
        measurement: "measured",
      });
    }
  }
  candidates.push(...tokenAnomalies.sort((a, b) => b.savings - a.savings).slice(0, 3));

  // One primary lever per feature is counted in the headline savings. Other levers that
  // touch the same measured spend are attached as companions and explicitly not counted,
  // so the portfolio total never double-counts overlapping tokens.
  const byFeature = new Map<string, Candidate[]>();
  const anomalies: Candidate[] = [];
  for (const c of candidates.sort((a, b) => b.savings - a.savings)) {
    if (c.kind === "anomaly" || c.kind === "token_anomaly") {
      anomalies.push(c);
      continue;
    }
    const key = `${c.projectId ?? "none"}:${c.feature ?? "none"}`;
    const group = byFeature.get(key) ?? [];
    group.push(c);
    byFeature.set(key, group);
  }

  const primaries: Candidate[] = [];
  for (const group of byFeature.values()) {
    group.sort((a, b) => b.savings - a.savings);
    const primary = group[0]!;
    const companions = group.slice(1).map((c) => ({
      kind: c.kind,
      title: c.title,
      estimatedMonthlySavingsUsd: Number(c.savings.toFixed(2)),
      counted: false as const,
      note: "Overlaps the same measured spend as the primary lever, so it is not added to the headline total.",
    }));
    if (companions.length) {
      primary.evidence = { ...primary.evidence, companionOpportunities: companions };
    }
    primaries.push(primary);
  }

  const deduped = new Map<string, Candidate>();
  for (const c of [...primaries, ...anomalies]) {
    if (!deduped.has(c.fingerprint)) deduped.set(c.fingerprint, c);
  }

  for (const c of deduped.values()) {
    await db
      .insert(recommendations)
      .values({
        orgId,
        fingerprint: c.fingerprint,
        kind: c.kind,
        scope: c.scope,
        projectId: c.projectId,
        feature: c.feature,
        model: c.model,
        title: c.title,
        summary: c.summary,
        rationale: c.rationale,
        evidence: c.evidence,
        estimatedMonthlySavingsUsd: c.savings.toFixed(2),
        confidence: c.confidence,
        measurement: c.measurement,
        status: "new",
      })
      .onConflictDoUpdate({
        target: [recommendations.orgId, recommendations.fingerprint],
        set: {
          summary: c.summary,
          rationale: c.rationale,
          evidence: c.evidence,
          estimatedMonthlySavingsUsd: c.savings.toFixed(2),
          updatedAt: new Date(),
        },
        setWhere: eq(recommendations.status, "new"),
      });
  }

  // Retire open findings the current analysis no longer supports. Without this,
  // findings that stopped being the counted lever for their feature linger with
  // stale evidence and inflate the open-savings total. Accepted and dismissed
  // decisions are kept as history.
  const keepFingerprints = [...deduped.keys()];
  const staleOpen = and(eq(recommendations.orgId, orgId), eq(recommendations.status, "new"));
  await db
    .delete(recommendations)
    .where(keepFingerprints.length ? and(staleOpen, notInArray(recommendations.fingerprint, keepFingerprints)) : staleOpen);

  invalidateCache(`recs:${orgId}`);
  return listRecommendations(db, orgId);
}

export async function listRecommendations(db: AppDb, orgId: string) {
  return db
    .select()
    .from(recommendations)
    .where(eq(recommendations.orgId, orgId))
    .orderBy(desc(recommendations.estimatedMonthlySavingsUsd));
}

export async function getOpenSavings(db: AppDb, orgId: string) {
  const rows = await db
    .select({
      savings: recommendations.estimatedMonthlySavingsUsd,
      status: recommendations.status,
    })
    .from(recommendations)
    .where(and(eq(recommendations.orgId, orgId), eq(recommendations.status, "new")));
  return rows.reduce((sum, r) => sum + num(r.savings), 0);
}

export type CoachAnswer = {
  answer: string;
  source: "rules" | "llm";
  citedRecommendationIds: string[];
  grounded: boolean;
};

export async function askCoach(db: AppDb, orgId: string, question: string): Promise<CoachAnswer> {
  const recs = await listRecommendations(db, orgId);
  const open = recs.filter((r) => r.status === "new");
  const now = new Date();
  const mtdRows = await rawQuery<{ cost: string; requests: string }>(
    `select coalesce(sum(cost_usd), 0)::float8 as cost, count(*)::int as requests
       from usage_events where org_id = $1 and occurred_at >= date_trunc('month', now())`,
    [orgId],
  );
  const mtdCost = num(mtdRows.rows[0]?.cost);
  const mtdRequests = num(mtdRows.rows[0]?.requests);
  const topFeatures = await rawQuery<{ feature: string; cost: string; requests: string; avg_input: string }>(
    `select feature, coalesce(sum(cost_usd), 0)::float8 as cost, count(*)::int as requests,
            coalesce(avg(input_tokens), 0)::float8 as avg_input
       from usage_events where org_id = $1 and occurred_at >= date_trunc('month', now())
      group by feature order by cost desc limit 5`,
    [orgId],
  );
  const q = question.toLowerCase();
  const lines: string[] = [];
  const cited: string[] = [];

  const topSavings = open.slice(0, 3);
  for (const r of topSavings) cited.push(r.id);

  const wantsAnomaly = /anomal|spike|jump|why.*(increase|higher|up)|涨|why did/i.test(question);
  const wantsCache = /cache|caching|repeat|duplicat/i.test(q);
  const wantsModel = /model|downgrade|route|switch|quality|latency/i.test(q);
  const wantsForecast = /forecast|project|end of month|next month|runway/i.test(q);

  lines.push(`**Grounded in your last 30 days of usage** (${formatInt(mtdRequests)} requests this month, ${formatUSD(mtdCost)} month-to-date).`);

  if (wantsForecast) {
    const dayOfMonth = now.getUTCDate();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const projected = (mtdCost / Math.max(1, dayOfMonth)) * daysInMonth;
    lines.push(
      `\nProjection: at the current daily run-rate of ${formatUSD(mtdCost / Math.max(1, dayOfMonth))}, month-end spend lands at **${formatUSD(projected)}**. Use Optimization Studio → Forecast to model growth and routing scenarios.`,
    );
  }

  if (wantsAnomaly) {
    const anomalies = recs.filter((r) => r.kind === "anomaly" || r.kind === "token_anomaly");
    if (anomalies.length) {
      for (const a of anomalies.slice(0, 2)) {
        if (a.kind === "token_anomaly") {
          const ev = a.evidence as {
            day?: string;
            zScore?: number;
            avgInputTokens?: number;
            baselineAvgInputTokens?: number;
            excessTokens?: number;
            project?: string;
          };
          lines.push(
            `\nToken anomaly on **${ev.day}** (${ev.project}): avg input ${formatInt(ev.avgInputTokens ?? 0)} tok/request vs baseline ${formatInt(ev.baselineAvgInputTokens ?? 0)} (z = ${(ev.zScore ?? 0).toFixed(1)}), about ${formatInt(ev.excessTokens ?? 0)} extra input tokens. Measured one-time variance.`,
          );
          cited.push(a.id);
          continue;
        }
        const ev = a.evidence as {
          day?: string;
          zScore?: number;
          dayCostUsd?: number;
          baselineDailyUsd?: number;
          topContributors?: Array<{ feature: string; project: string; costUsd: number; avgInputTokens: number }>;
        };
        const tops = (ev.topContributors ?? [])
          .map((c) => `${c.feature} (${c.project}) ${formatUSD(c.costUsd)} at ${formatInt(c.avgInputTokens)} avg input tokens`)
          .join("; ");
        lines.push(
          `\nAnomaly on **${ev.day}**: spend ${formatUSD(ev.dayCostUsd ?? 0)} vs baseline ${formatUSD(ev.baselineDailyUsd ?? 0)}/day (z = ${(ev.zScore ?? 0).toFixed(1)}). Contributors: ${tops}. This is a measured variance, not a forecast.`,
        );
        cited.push(a.id);
      }
    } else {
      lines.push("\nNo spend anomaly above 1.8σ was detected in the last 7 days.");
    }
  }

  if (wantsCache) {
    const cacheRecs = recs.filter((r) => r.kind === "caching" || r.kind === "repeated_prompts");
    if (cacheRecs.length) {
      const total = cacheRecs.filter((r) => r.status === "new").reduce((s, r) => s + Number(r.estimatedMonthlySavingsUsd), 0);
      lines.push(`\nCaching findings: ${cacheRecs.length} opportunities with an estimated ${formatUSD(total)}/month at stake.`);
      for (const r of cacheRecs.slice(0, 2)) {
        lines.push(`- **${r.title}** — ${r.summary} Estimated: ${formatUSD(Number(r.estimatedMonthlySavingsUsd))}/mo (${r.confidence} confidence).`);
        cited.push(r.id);
      }
    }
  }

  if (wantsModel) {
    const downgrades = recs.filter((r) => r.kind === "model_downgrade");
    if (downgrades.length) {
      for (const r of downgrades.slice(0, 2)) {
        const ev = r.evidence as { alternativeModel?: string; qualityDelta?: number; alternativeLatencyMs?: number };
        lines.push(
          `- **${r.title}** — repricing measured tokens at ${ev.alternativeModel} saves ${formatUSD(Number(r.estimatedMonthlySavingsUsd))}/mo. Quality delta in catalog: ${ev.qualityDelta ?? 0} points; typical latency ${ev.alternativeLatencyMs ?? "?"}ms. Treat quality as a risk until you run evals.`,
        );
        cited.push(r.id);
      }
    } else {
      lines.push("\nNo high-confidence model downgrade was found for workloads with measured quality headroom.");
    }
  }

  if (!wantsAnomaly && !wantsCache && !wantsModel && !wantsForecast) {
    lines.push("\n**Top opportunities**");
    if (topSavings.length) {
      for (const r of topSavings) {
        lines.push(
          `- **${r.title}** — ${r.summary} Estimated ${formatUSD(Number(r.estimatedMonthlySavingsUsd))}${r.kind === "anomaly" || r.kind === "token_anomaly" ? " one-time" : "/mo"}.`,
        );
      }
    } else {
      lines.push("- No open recommendations. Refresh the analysis after more usage accrues.");
    }
    const top = topFeatures.rows[0];
    if (top) {
      lines.push(
        `\nHighest-cost feature this month: **${top.feature}** at ${formatUSD(num(top.cost))} across ${formatInt(num(top.requests))} requests (${formatInt(num(top.avg_input))} avg input tokens).`,
      );
    }
  }

  let answer = lines.join("\n");
  let source: "rules" | "llm" = "rules";

  if (process.env.OPENAI_API_KEY) {
    try {
      const { generateText } = await import("ai");
      const { openai } = await import("@ai-sdk/openai");
      const evidence = JSON.stringify({
        monthToDateUsd: Number(mtdCost.toFixed(2)),
        requests: mtdRequests,
        topFeatures: topFeatures.rows,
        recommendations: open.slice(0, 6).map((r) => ({
          title: r.title,
          kind: r.kind,
          summary: r.summary,
          evidence: r.evidence,
          estimatedMonthlySavingsUsd: Number(r.estimatedMonthlySavingsUsd),
          confidence: r.confidence,
          measurement: r.measurement,
        })),
      });
      const result = await generateText({
        model: openai(process.env.OPENAI_COACH_MODEL ?? "gpt-4.1-mini"),
        system:
          "You are TokenBurn's AI cost coach. Use ONLY the JSON evidence provided. Never invent numbers, model prices or savings. Clearly separate measured values from estimates. Answer in concise markdown, maximum 220 words.",
        prompt: `Question: ${question}\n\nEvidence JSON:\n${evidence}`,
        maxOutputTokens: 500,
      });
      if (result.text.trim()) {
        answer = result.text.trim();
        source = "llm";
      }
    } catch {
      source = "rules";
    }
  }

  return { answer, source, citedRecommendationIds: [...new Set(cited)], grounded: true };
}

export async function markRecommendation(
  db: AppDb,
  orgId: string,
  id: string,
  status: "accepted" | "dismissed",
) {
  await db
    .update(recommendations)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(recommendations.orgId, orgId), eq(recommendations.id, id)));
}

export function recommendationReference(r: typeof recommendations.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    savings: Number(r.estimatedMonthlySavingsUsd),
    kind: r.kind,
    confidence: r.confidence,
    measurement: r.measurement,
  };
}

/** Used by the anomaly chip on the Command Center. */
export async function latestAnomaly(db: AppDb, orgId: string) {
  const rows = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.orgId, orgId), eq(recommendations.kind, "anomaly")))
    .orderBy(desc(recommendations.generatedAt))
    .limit(1);
  return rows[0] ?? null;
}
