import { eq } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import {
  alertRules,
  alerts,
  apiKeys,
  approvalRequests,
  auditLogs,
  budgets,
  environments,
  evaluationResults,
  features,
  gatewayRequests,
  memberships,
  modelEvaluations,
  modelPricing,
  organizations,
  projects,
  providers,
  recommendations,
  reports,
  rolloutShadowSamples,
  routingPolicies,
  routingRollouts,
  usageEvents,
  users,
  type EvaluationCase,
  type EvaluationModelSummary,
  type GatewayRoutingDecision,
  type OrgSettings,
} from "@/lib/db/schema";
import { PRICING_CATALOG, computeCost } from "@/lib/pricing";
import { catalogSeedToRow, getActiveCatalog } from "@/lib/pricing-db";
import { encryptSecret, generateApiKey, hashApiKey, hashPassword, sha256 } from "@/lib/crypto";
import { addDays, dayKey, startOfDayUTC, startOfMonthUTC } from "@/lib/utils";
import { evaluateGovernance } from "@/lib/governance";

const DAYS = 55;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "tokenburn-demo";
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@tokenburn.dev";
export const DEMO_API_KEY = "tb_live_8f4c2a91d7e5b3604e2c9a11";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261120);

function pickWeighted<T>(weights: Array<[T, number]>): T {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of weights) {
    r -= w;
    if (r <= 0) return value;
  }
  return weights[weights.length - 1]![0];
}

type Workload = {
  project: string;
  feature: string;
  description: string;
  models: Array<[string, number]>;
  baseDaily: number;
  inputMean: number;
  outputMean: number;
  outputTail?: number;
  cacheRatio: number;
  promptPool?: number;
  errorRate?: number;
  endpoint: string;
  anomaly?: "context" | "volume";
};

const WORKLOADS: Workload[] = [
  {
    project: "atlas",
    feature: "answer-generation",
    description: "RAG answer synthesis for the Atlas support copilot.",
    models: [
      ["openai/gpt-4.1", 65],
      ["openai/gpt-4.1-mini", 30],
      ["openai/gpt-4o", 5],
    ],
    baseDaily: 30,
    inputMean: 52_000,
    outputMean: 950,
    outputTail: 1.6,
    cacheRatio: 0,
    promptPool: 60,
    endpoint: "/v1/responses",
    anomaly: "context",
  },
  {
    project: "atlas",
    feature: "intent-classifier",
    description: "Cheap intent tags for routing support conversations.",
    models: [["groq/llama-3.1-8b-instant", 100]],
    baseDaily: 70,
    inputMean: 340,
    outputMean: 14,
    cacheRatio: 0,
    promptPool: 24,
    endpoint: "/openai/v1/chat/completions",
  },
  {
    project: "atlas",
    feature: "doc-retrieval",
    description: "Embedding calls for the knowledge base index.",
    models: [["openai/text-embedding-3-small", 100]],
    baseDaily: 22,
    inputMean: 1_800,
    outputMean: 0,
    cacheRatio: 0,
    promptPool: 30,
    endpoint: "/v1/embeddings",
  },
  {
    project: "atlas",
    feature: "conversation-summary",
    description: "Rolling customer conversation summaries.",
    models: [["openai/gpt-4o-mini", 100]],
    baseDaily: 34,
    inputMean: 30_000,
    outputMean: 620,
    outputTail: 2.2,
    cacheRatio: 0.06,
    promptPool: 10,
    endpoint: "/v1/responses",
  },
  {
    project: "atlas",
    feature: "escalation-triage",
    description: "Triage escalations into queues with SLAs.",
    models: [["gemini/gemini-2.5-flash", 100]],
    baseDaily: 20,
    inputMean: 6_000,
    outputMean: 170,
    cacheRatio: 0.35,
    promptPool: 18,
    endpoint: ":generateContent",
  },
  {
    project: "orbit",
    feature: "sql-generation",
    description: "Natural language to SQL over warehouse schemas.",
    models: [
      ["openai/gpt-4.1-mini", 80],
      ["openai/gpt-4.1", 20],
    ],
    baseDaily: 52,
    inputMean: 19_000,
    outputMean: 850,
    outputTail: 1.9,
    cacheRatio: 0.04,
    promptPool: 70,
    errorRate: 0.025,
    endpoint: "/v1/responses",
  },
  {
    project: "orbit",
    feature: "chart-explainer",
    description: "Explains generated charts and outliers to analysts.",
    models: [["openai/gpt-4o", 100]],
    baseDaily: 24,
    inputMean: 26_000,
    outputMean: 880,
    outputTail: 2.4,
    cacheRatio: 0.02,
    promptPool: 44,
    errorRate: 0.012,
    endpoint: "/v1/chat/completions",
  },
  {
    project: "orbit",
    feature: "schema-summarizer",
    description: "Summarizes warehouse schema slices for the SQL planner.",
    models: [["anthropic/claude-sonnet-4", 100]],
    baseDaily: 16,
    inputMean: 118_000,
    outputMean: 1_450,
    outputTail: 3.1,
    cacheRatio: 0,
    promptPool: 6,
    endpoint: "/v1/messages",
  },
  {
    project: "orbit",
    feature: "semantic-search",
    description: "Embedding lookups for dashboard search.",
    models: [["openai/text-embedding-3-small", 100]],
    baseDaily: 18,
    inputMean: 1_200,
    outputMean: 0,
    cacheRatio: 0,
    promptPool: 30,
    endpoint: "/v1/embeddings",
  },
  {
    project: "ledger",
    feature: "invoice-extraction",
    description: "Extracts line items from invoices into structured JSON.",
    models: [["openai/gpt-4.1", 100]],
    baseDaily: 25,
    inputMean: 76_000,
    outputMean: 1_500,
    outputTail: 2.6,
    cacheRatio: 0,
    promptPool: 50,
    errorRate: 0.006,
    endpoint: "/v1/responses",
    anomaly: "volume",
  },
  {
    project: "ledger",
    feature: "reconciliation-notes",
    description: "Explains reconciliation mismatches to finance ops.",
    models: [["openai/gpt-4o-mini", 100]],
    baseDaily: 19,
    inputMean: 30_000,
    outputMean: 1_250,
    outputTail: 2.3,
    cacheRatio: 0.03,
    promptPool: 15,
    endpoint: "/v1/responses",
  },
  {
    project: "ledger",
    feature: "anomaly-narrative",
    description: "Writes finance anomaly narratives for month-end close.",
    models: [["openai/o4-mini", 100]],
    baseDaily: 13,
    inputMean: 15_000,
    outputMean: 1_150,
    outputTail: 2.0,
    cacheRatio: 0,
    promptPool: 28,
    endpoint: "/v1/responses",
  },
];

const PROJECTS = [
  {
    slug: "atlas",
    name: "Atlas Assistant",
    description: "Customer support copilot with retrieval, summarization and triage.",
    environments: ["production", "staging", "development"],
  },
  {
    slug: "orbit",
    name: "Orbit Insights",
    description: "Analytics copilot that writes and explains warehouse SQL.",
    environments: ["production", "staging"],
  },
  {
    slug: "ledger",
    name: "Ledger Agents",
    description: "Finance document extraction and close automation agents.",
    environments: ["production", "staging"],
  },
];

function sampleTokens(mean: number, tail = 1): number {
  const spread = 0.45 + Math.pow(rand(), 1.7) * 1.3;
  return Math.max(1, Math.round(mean * spread * tail));
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

export async function seedDatabase(db: AppDb) {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log("[seed] database already seeded");
    return;
  }

  const now = new Date();
  console.log("[seed] inserting pricing catalog");
  const historyRows: Array<typeof modelPricing.$inferInsert> = [];
  for (const seed of PRICING_CATALOG) {
    if (seed.model === "gpt-4o") {
      historyRows.push({
        ...catalogSeedToRow(seed, 1, addDays(now, -400)),
        inputPerM: "5.0000",
        outputPerM: "15.0000",
        cachedInputPerM: "2.5000",
        supersededAt: addDays(now, -90),
        isActive: false,
        source: "historical-list-price",
        notes: "Superseded gpt-4o pricing retained for historical event re-costing.",
      });
      historyRows.push(catalogSeedToRow(seed, 2, addDays(now, -90)));
    } else {
      historyRows.push(catalogSeedToRow(seed, 1, addDays(now, -120)));
    }
  }
  await db.insert(modelPricing).values(historyRows);
  const activeCatalog = await getActiveCatalog(db, now);
  const pricingByKey = new Map(activeCatalog.map((p) => [`${p.provider}/${p.model}`, p]));

  console.log("[seed] inserting organization and users");
  const [owner] = await db
    .insert(users)
    .values([
      {
        email: DEMO_EMAIL,
        name: "Jordan Reyes",
        jobTitle: "Head of Platform",
        passwordHash: hashPassword(DEMO_PASSWORD),
        lastLoginAt: now,
      },
      {
        email: "marcus@northwind.dev",
        name: "Marcus Vale",
        jobTitle: "Staff Engineer, AI",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
      {
        email: "sofia@northwind.dev",
        name: "Sofia Lindqvist",
        jobTitle: "Product Lead, Atlas",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
      {
        email: "dev@northwind.dev",
        name: "Dev Patel",
        jobTitle: "Finance Partner",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
    ])
    .returning({ id: users.id });

  if (!owner) throw new Error("seed: owner insert failed");

  const settings: OrgSettings = {
    timezone: "UTC",
    dataMode: "synthetic",
    allowedModels: activeCatalog
      .filter((p) => p.model !== "claude-opus-4")
      .map((p) => `${p.provider}/${p.model}`),
    blockedModels: ["anthropic/claude-opus-4"],
    requireApprovalForRouting: true,
    hardLimitsEnabled: true,
    fallbackModel: "openai/gpt-4.1-mini",
    webhookUrl: "",
  };

  const [org] = await db
    .insert(organizations)
    .values({ name: "Northwind Labs", slug: "northwind", plan: "scale", settings })
    .returning({ id: organizations.id });
  if (!org) throw new Error("seed: org insert failed");

  const memberRows = await db
    .select({ id: users.id, email: users.email })
    .from(users);
  const byEmail = new Map(memberRows.map((u) => [u.email, u.id]));

  await db.insert(memberships).values([
    { orgId: org.id, userId: byEmail.get(DEMO_EMAIL)!, role: "owner" },
    { orgId: org.id, userId: byEmail.get("marcus@northwind.dev")!, role: "admin" },
    { orgId: org.id, userId: byEmail.get("sofia@northwind.dev")!, role: "member" },
    { orgId: org.id, userId: byEmail.get("dev@northwind.dev")!, role: "viewer" },
  ]);

  console.log("[seed] inserting providers");
  await db.insert(providers).values([
    {
      orgId: org.id,
      provider: "openai",
      status: "configured",
      label: "OpenAI usage + responses",
      credentialsEnc: encryptSecret("sk-demo-openai-not-a-real-key"),
      keyLast4: "QR2A",
      lastSyncedAt: new Date(now.getTime() - 2 * 3_600_000),
    },
    {
      orgId: org.id,
      provider: "anthropic",
      status: "configured",
      label: "Anthropic messages",
      credentialsEnc: encryptSecret("sk-ant-demo-not-a-real-key"),
      keyLast4: "8LKP",
      lastSyncedAt: new Date(now.getTime() - 3 * 3_600_000),
    },
    {
      orgId: org.id,
      provider: "gemini",
      status: "configured",
      label: "Gemini API",
      credentialsEnc: encryptSecret("AIza-demo-not-a-real-key"),
      keyLast4: "M4VZ",
      lastSyncedAt: new Date(now.getTime() - 5 * 3_600_000),
    },
    {
      orgId: org.id,
      provider: "groq",
      status: "configured",
      label: "Groq inference",
      credentialsEnc: encryptSecret("gsk_demo_not_a_real_key"),
      keyLast4: "K91D",
      lastSyncedAt: new Date(now.getTime() - 90 * 60_000),
    },
    {
      orgId: org.id,
      provider: "mistral",
      status: "configured",
      label: "Mistral chat (demo key, unverified)",
      credentialsEnc: encryptSecret("demo-not-a-real-mistral-key0000"),
      keyLast4: "P7QN",
      lastSyncedAt: null,
    },
  ]);

  console.log("[seed] inserting projects, environments, features, keys");
  const projectIds = new Map<string, string>();
  const envIds = new Map<string, string>();

  for (const p of PROJECTS) {
    const [row] = await db
      .insert(projects)
      .values({ orgId: org.id, name: p.name, slug: p.slug, description: p.description })
      .returning({ id: projects.id });
    if (!row) throw new Error("seed: project insert failed");
    projectIds.set(p.slug, row.id);
    for (const env of p.environments) {
      const [envRow] = await db
        .insert(environments)
        .values({ orgId: org.id, projectId: row.id, name: env, slug: env })
        .returning({ id: environments.id });
      if (envRow) envIds.set(`${p.slug}:${env}`, envRow.id);
    }
  }

  await db.insert(features).values(
    WORKLOADS.map((w) => ({
      orgId: org.id,
      projectId: projectIds.get(w.project)!,
      name: w.feature,
      description: w.description,
    })),
  );

  const demoKey = generateApiKey("live");
  await db.insert(apiKeys).values([
    {
      orgId: org.id,
      projectId: projectIds.get("atlas")!,
      environmentId: envIds.get("atlas:production") ?? null,
      name: "Atlas · production ingest",
      prefix: demoKey.prefix,
      lastFour: DEMO_API_KEY.slice(-4),
      hash: hashApiKey(DEMO_API_KEY),
      createdBy: DEMO_EMAIL,
      lastUsedAt: new Date(now.getTime() - 12 * 60_000),
      requestCount: 18_432,
    },
    {
      orgId: org.id,
      projectId: projectIds.get("atlas")!,
      environmentId: envIds.get("atlas:staging") ?? null,
      name: "Atlas · staging ingest",
      prefix: "tb_live_stg",
      lastFour: "7C3F",
      hash: sha256("tb_live_staging_seed_key_do_not_use"),
      createdBy: "marcus@northwind.dev",
      lastUsedAt: new Date(now.getTime() - 26 * 3_600_000),
      requestCount: 1_204,
    },
    {
      orgId: org.id,
      projectId: projectIds.get("orbit")!,
      environmentId: envIds.get("orbit:production") ?? null,
      name: "Orbit · production ingest",
      prefix: "tb_live_orb",
      lastFour: "P2X8",
      hash: sha256("tb_live_orbit_seed_key_do_not_use"),
      createdBy: DEMO_EMAIL,
      lastUsedAt: new Date(now.getTime() - 3 * 3_600_000),
      requestCount: 9_884,
    },
  ]);

  console.log("[seed] generating usage events");
  type EventRow = typeof usageEvents.$inferInsert;
  const events: EventRow[] = [];
  const today = startOfDayUTC(now);

  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStart = addDays(today, -d);
    const weekday = dayStart.getUTCDay();
    const weekdayFactor = weekday === 0 || weekday === 6 ? 0.7 : weekday === 1 ? 1.06 : weekday === 3 ? 1.12 : 1;
    const ramp = 0.8 + 0.36 * (1 - d / DAYS);

    for (const workload of WORKLOADS) {
      let volumeFactor = weekdayFactor * ramp * (0.88 + rand() * 0.24);
      let inputMultiplier = 1;

      if (d === 0 && workload.anomaly) {
        volumeFactor *= workload.anomaly === "volume" ? 2.2 : 1.15;
        if (workload.anomaly === "context") inputMultiplier = 2.6;
      }
      if (d === 9 && workload.project === "orbit") {
        inputMultiplier = 1.7;
        volumeFactor *= 1.25;
      }
      if (d >= 21 && d <= 23 && workload.feature === "schema-summarizer") {
        volumeFactor *= 1.3;
      }

      const count = Math.max(0, Math.round(workload.baseDaily * volumeFactor));
      for (let i = 0; i < count; i++) {
        const modelKey = pickWeighted(workload.models);
        const pricing = pricingByKey.get(modelKey);
        if (!pricing) continue;

        const hoursMax = d === 0 ? Math.max(1, now.getUTCHours()) : 23;
        const hour = 6 + Math.floor(rand() * Math.max(1, hoursMax - 6 + 1));
        const minute = Math.floor(rand() * 60);
        const second = Math.floor(rand() * 60);
        const occurredAt = new Date(
          Date.UTC(
            dayStart.getUTCFullYear(),
            dayStart.getUTCMonth(),
            dayStart.getUTCDate(),
            Math.min(hour, hoursMax),
            minute,
            second,
          ),
        );
        const safeOccurredAt = occurredAt.getTime() > now.getTime() ? new Date(now.getTime() - i * 1000) : occurredAt;

        const inputTokens = sampleTokens(workload.inputMean * inputMultiplier);
        const cachedInputTokens = Math.round(
          inputTokens * workload.cacheRatio * (0.55 + rand() * 0.5),
        );
        const outputTokens =
          workload.outputMean === 0
            ? 0
            : sampleTokens(workload.outputMean, (workload.outputTail ?? 1) * (0.6 + rand() * 0.9));
        const errorRoll = rand();
        const statusCode = errorRoll < (workload.errorRate ?? 0.002) ? (rand() < 0.5 ? 429 : 500) : 200;
        const latencyMs = Math.round(
          pricing.typicalLatencyMs * (0.6 + rand() * 0.9) * (inputMultiplier > 2 ? 1.5 : 1),
        );
        const promptHash =
          workload.promptPool && rand() < 0.85
            ? `sha256:${sha256(`${workload.feature}:prompt:${Math.floor(rand() * workload.promptPool)}`)}`
            : `sha256:${sha256(`${workload.feature}:unique:${d}:${i}:${rand()}`)}`;

        const { costUsd, breakdown } = computeCost(pricing, {
          inputTokens,
          cachedInputTokens,
          outputTokens,
        });

        events.push({
          orgId: org.id,
          projectId: projectIds.get(workload.project)!,
          environment: d >= 2 && rand() < 0.06 ? "staging" : "production",
          feature: workload.feature,
          provider: pricing.provider,
          model: pricing.model,
          pricingId: pricing.id,
          requestId: `req_seed_${workload.project}_${d}_${i}`,
          dedupeHash: `seed:${sha256(`${workload.feature}:${d}:${i}`)}`,
          promptHash,
          endpoint: workload.endpoint,
          inputTokens,
          cachedInputTokens,
          cacheWriteTokens: 0,
          outputTokens,
          reasoningTokens: 0,
          latencyMs,
          statusCode,
          costUsd: costUsd.toFixed(6),
          costBreakdown: { ...breakdown, pricingVersion: pricing.version },
          occurredAt: safeOccurredAt,
          usageSource: "synthetic",
          isSynthetic: true,
          tags: { source: "synthetic-seed", project: workload.project },
          metadata: { seed: true, promptChars: Math.round(inputTokens * 4.1) },
        });
      }
    }
  }

  for (let i = 0; i < events.length; i += 400) {
    await db.insert(usageEvents).values(events.slice(i, i + 400)).onConflictDoNothing();
  }
  console.log(`[seed] inserted ${events.length} usage events`);

  const monthStart = startOfMonthUTC(now);
  const mtdEvents = events.filter((e) => (e.occurredAt as Date) >= monthStart);
  const sumBy = (predicate: (e: EventRow) => boolean) =>
    mtdEvents.filter(predicate).reduce((s, e) => s + Number(e.costUsd), 0);
  const atlasId = projectIds.get("atlas")!;
  const orbitId = projectIds.get("orbit")!;
  const ledgerId = projectIds.get("ledger")!;
  const orgMtd = sumBy(() => true);
  const atlasMtd = sumBy((e) => e.projectId === atlasId);
  const orbitMtd = sumBy((e) => e.projectId === orbitId);
  const ledgerMtd = sumBy((e) => e.projectId === ledgerId);
  const schemaMtd = sumBy((e) => e.feature === "schema-summarizer");

  const last7 = events.filter((e) => (e.occurredAt as Date) >= new Date(now.getTime() - 7 * 86_400_000));
  const dailyAvg = last7.reduce((s, e) => s + Number(e.costUsd), 0) / 7;

  console.log("[seed] inserting budgets, alert rules, alerts");
  const budgetRows = await db
    .insert(budgets)
    .values([
      {
        orgId: org.id,
        name: "Organization monthly budget",
        scope: "organization",
        period: "monthly",
        limitUsd: roundTo(Math.max(orgMtd, 1) / 0.82, 10).toFixed(2),
        hardLimit: false,
        thresholds: [50, 75, 90, 100],
        createdBy: DEMO_EMAIL,
      },
      {
        orgId: org.id,
        name: "Organization daily guardrail",
        scope: "organization",
        period: "daily",
        limitUsd: roundTo(dailyAvg * 1.35, 5).toFixed(2),
        hardLimit: false,
        thresholds: [75, 100],
        createdBy: DEMO_EMAIL,
      },
      {
        orgId: org.id,
        name: "Atlas Assistant monthly",
        scope: "project",
        projectId: atlasId,
        period: "monthly",
        limitUsd: roundTo(Math.max(atlasMtd, 1) / 0.63, 10).toFixed(2),
        hardLimit: false,
        thresholds: [50, 75, 90, 100],
        createdBy: DEMO_EMAIL,
      },
      {
        orgId: org.id,
        name: "Orbit Insights monthly (hard)",
        scope: "project",
        projectId: orbitId,
        period: "monthly",
        limitUsd: Math.max(5, Math.floor(Math.max(orbitMtd, 1) / 5) * 5).toFixed(2),
        hardLimit: true,
        thresholds: [50, 75, 90, 100],
        createdBy: "marcus@northwind.dev",
      },
      {
        orgId: org.id,
        name: "Ledger Agents monthly",
        scope: "project",
        projectId: ledgerId,
        period: "monthly",
        limitUsd: roundTo(Math.max(ledgerMtd, 1) / 0.58, 10).toFixed(2),
        hardLimit: false,
        thresholds: [50, 75, 100],
        createdBy: DEMO_EMAIL,
      },
      {
        orgId: org.id,
        name: "schema-summarizer feature cap",
        scope: "feature",
        projectId: orbitId,
        feature: "schema-summarizer",
        period: "monthly",
        limitUsd: roundTo(Math.max(schemaMtd, 1) / 0.94, 10).toFixed(2),
        hardLimit: false,
        thresholds: [75, 90, 100],
        createdBy: "marcus@northwind.dev",
      },
    ])
    .returning({ id: budgets.id, name: budgets.name });
  const budgetByName = new Map(budgetRows.map((b) => [b.name, b.id]));

  await db
    .insert(alertRules)
    .values([
      {
        orgId: org.id,
        name: "Daily spend above guardrail",
        type: "daily_spend",
        scope: "organization",
        threshold: roundTo(dailyAvg * 1.3, 5).toFixed(4),
        windowHours: 24,
        severity: "warning",
        channel: "in_app",
        createdBy: DEMO_EMAIL,
      },
      {
        orgId: org.id,
        name: "Cost spike vs 14-day baseline",
        type: "cost_spike",
        scope: "organization",
        threshold: "1.9",
        windowHours: 24,
        severity: "critical",
        channel: "in_app",
        webhookUrl: "https://hooks.example.com/tokenburn/synthetic",
        createdBy: DEMO_EMAIL,
      },
      {
        orgId: org.id,
        name: "Provider error rate",
        type: "error_rate",
        scope: "organization",
        threshold: "4",
        windowHours: 6,
        severity: "warning",
        channel: "in_app",
        createdBy: "marcus@northwind.dev",
      },
      {
        orgId: org.id,
        name: "Orbit daily ceiling",
        type: "daily_spend",
        scope: "project",
        projectId: orbitId,
        threshold: roundTo(dailyAvg * 0.8, 5).toFixed(4),
        windowHours: 24,
        severity: "warning",
        channel: "in_app",
        createdBy: DEMO_EMAIL,
      },
    ])
    .returning({ id: alertRules.id, type: alertRules.type });

  console.log("[seed] evaluating governance");
  await evaluateGovernance(db, org.id, true);

  const openAlerts = await db
    .select({ id: alerts.id, fingerprint: alerts.fingerprint })
    .from(alerts)
    .where(eq(alerts.orgId, org.id))
    .orderBy(alerts.createdAt);
  if (openAlerts[0]) {
    await db
      .update(alerts)
      .set({ status: "acknowledged", acknowledgedAt: new Date(now.getTime() - 4 * 3_600_000), acknowledgedBy: "marcus@northwind.dev" })
      .where(eq(alerts.id, openAlerts[0].id));
  }

  console.log("[seed] inserting routing policies and approvals");
  const policyRows = await db
    .insert(routingPolicies)
    .values([
      {
        orgId: org.id,
        projectId: atlasId,
        feature: "answer-generation",
        environment: "production",
        name: "Atlas answers · quality first",
        strategy: "quality_first",
        mode: "automatic",
        primaryModel: "openai/gpt-4.1",
        fallbackModel: "openai/gpt-4o-mini",
        candidates: ["openai/gpt-4.1", "openai/gpt-4.1-mini", "anthropic/claude-sonnet-4"],
        minQualityScore: 80,
        status: "active",
        maxOutputTokens: 2_048,
        cacheEnabled: false,
        notes: "Legacy policy. Answers use the full knowledge-base context window.",
        createdBy: DEMO_EMAIL,
        approvedBy: DEMO_EMAIL,
        approvedAt: addDays(now, -40),
      },
      {
        orgId: org.id,
        projectId: atlasId,
        feature: "intent-classifier",
        environment: "production",
        name: "Atlas intents · cost first",
        strategy: "cost_optimized",
        mode: "automatic",
        primaryModel: "groq/llama-3.1-8b-instant",
        fallbackModel: "openai/gpt-4.1-nano",
        candidates: ["groq/llama-3.1-8b-instant", "openai/gpt-4.1-nano", "gemini/gemini-2.5-flash-lite"],
        maxLatencyMs: 1_800,
        status: "active",
        maxOutputTokens: 32,
        cacheEnabled: true,
        createdBy: "marcus@northwind.dev",
        approvedBy: DEMO_EMAIL,
        approvedAt: addDays(now, -33),
      },
      {
        orgId: org.id,
        projectId: orbitId,
        feature: "schema-summarizer",
        environment: "production",
        name: "Orbit schema summaries",
        strategy: "balanced",
        mode: "automatic",
        primaryModel: "anthropic/claude-sonnet-4",
        fallbackModel: "openai/gpt-4.1",
        candidates: ["anthropic/claude-sonnet-4", "gemini/gemini-2.5-pro", "openai/gpt-4.1"],
        minQualityScore: 75,
        status: "active",
        maxOutputTokens: 4_096,
        cacheEnabled: false,
        createdBy: "marcus@northwind.dev",
        approvedBy: DEMO_EMAIL,
        approvedAt: addDays(now, -21),
      },
      {
        orgId: org.id,
        projectId: orbitId,
        feature: "sql-generation",
        environment: "staging",
        name: "Orbit SQL · cost first (staging)",
        strategy: "cost_optimized",
        primaryModel: "openai/gpt-4.1-mini",
        fallbackModel: "gemini/gemini-2.5-flash",
        status: "draft",
        maxOutputTokens: 2_048,
        cacheEnabled: true,
        createdBy: "sofia@northwind.dev",
      },
    ])
    .returning({ id: routingPolicies.id, name: routingPolicies.name });

  const schemaPolicy = policyRows.find((p) => p.name === "Orbit schema summaries");
  await db.insert(approvalRequests).values({
    orgId: org.id,
    type: "routing_change",
    title: "Production routing change · schema-summarizer",
    description:
      "Switch Orbit schema-summarizer (production) from Claude Sonnet 4 to Gemini 2.5 Pro, enable prompt caching, and cap output at 3,072 tokens. Estimated saving is based on the last 30 days of measured tokens.",
    payload: {
      policyId: schemaPolicy?.id,
      primaryModel: "gemini/gemini-2.5-pro",
      fallbackModel: "openai/gpt-4.1",
      strategy: "cost_optimized",
      maxOutputTokens: 3_072,
      cacheEnabled: true,
      requesterNote:
        "Repriced 118k-token average requests. Quality delta +1 in the internal catalog; validate the schema recall eval before approval.",
    },
    targetType: "routing_policy",
    targetId: schemaPolicy?.id ?? null,
    status: "pending",
    requestedBy: owner.id,
    requestedByEmail: DEMO_EMAIL,
  });

  console.log("[seed] generating gateway telemetry, rollouts and evaluations");
  const policyIdByName = new Map(policyRows.map((p) => [p.name, p.id]));
  const answersPolicyId = policyIdByName.get("Atlas answers · quality first")!;
  const intentsPolicyId = policyIdByName.get("Atlas intents · cost first")!;
  const schemaPolicyId = schemaPolicy!.id;
  const orgFallbackKey = "openai/gpt-4.1";

  const thresholds = { minSamples: 5, maxErrorRatePct: 5, maxP95LatencyMs: 4_000, minAverageQuality: 70 };
  const rolloutRows = await db
    .insert(routingRollouts)
    .values([
      {
        orgId: org.id,
        policyId: schemaPolicyId,
        projectId: orbitId,
        mode: "canary",
        status: "running",
        baselineModel: "anthropic/claude-sonnet-4",
        candidateModel: "gemini/gemini-2.5-pro",
        trafficPercent: 25,
        thresholds: { ...thresholds, minSamples: 4 },
        startedAt: addDays(now, -5),
        createdBy: "marcus@northwind.dev",
        approvedBy: DEMO_EMAIL,
        approvedAt: addDays(now, -6),
        createdAt: addDays(now, -7),
      },
      {
        orgId: org.id,
        policyId: answersPolicyId,
        projectId: atlasId,
        mode: "shadow",
        status: "running",
        baselineModel: "openai/gpt-4.1",
        candidateModel: "anthropic/claude-sonnet-4",
        trafficPercent: 0,
        thresholds: { ...thresholds, minSamples: 8 },
        startedAt: addDays(now, -3),
        createdBy: DEMO_EMAIL,
        approvedBy: DEMO_EMAIL,
        approvedAt: addDays(now, -3),
        createdAt: addDays(now, -4),
      },
      {
        orgId: org.id,
        policyId: intentsPolicyId,
        projectId: atlasId,
        mode: "canary",
        status: "pending_approval",
        baselineModel: "groq/llama-3.1-8b-instant",
        candidateModel: "openai/gpt-4.1-nano",
        trafficPercent: 10,
        thresholds: { ...thresholds, minSamples: 20 },
        createdBy: "sofia@northwind.dev",
        createdAt: addDays(now, -1),
      },
    ])
    .returning({ id: routingRollouts.id, mode: routingRollouts.mode, status: routingRollouts.status });

  const canaryRollout = rolloutRows.find((r) => r.mode === "canary" && r.status === "running")!;
  const shadowRollout = rolloutRows.find((r) => r.mode === "shadow")!;
  const pendingRollout = rolloutRows.find((r) => r.status === "pending_approval")!;

  await db.insert(approvalRequests).values({
    orgId: org.id,
    type: "routing_rollout",
    title: "Canary rollout · Atlas intents to GPT-4.1 nano",
    description:
      "Serve 10% of Atlas intent-classifier traffic on GPT-4.1 nano instead of Llama 3.1 8B Instant. Auto-rollback arms after 20 canary samples; promotes only with an admin decision.",
    payload: { rolloutId: pendingRollout.id, mode: "canary", trafficPercent: 10 },
    targetType: "routing_rollout",
    targetId: pendingRollout.id,
    status: "pending",
    requestedBy: owner.id,
    requestedByEmail: "sofia@northwind.dev",
  });

  await db.insert(rolloutShadowSamples).values(
    Array.from({ length: 14 }, (_, i) => {
      const pricing = pricingByKey.get("anthropic/claude-sonnet-4")!;
      const inputTokens = Math.round(8_000 + rand() * 5_000);
      const outputTokens = Math.round(280 + rand() * 260);
      const { costUsd } = computeCost(pricing, { inputTokens, cachedInputTokens: 0, outputTokens });
      return {
        orgId: org.id,
        projectId: atlasId,
        rolloutId: shadowRollout.id,
        model: "anthropic/claude-sonnet-4",
        status: "success",
        latencyMs: Math.round(pricing.typicalLatencyMs * (0.7 + rand() * 0.5)),
        inputTokens,
        outputTokens,
        costUsd: costUsd.toFixed(6),
        qualityScore: Math.round(86 + rand() * 8),
        outputExcerpt: "Mirrored candidate response captured by the shadow runner.",
        createdAt: new Date(now.getTime() - (i + 1) * 3.5 * 3_600_000),
      };
    }),
  );

  type GatewaySeedRow = typeof gatewayRequests.$inferInsert;
  const gatewaySeed: GatewaySeedRow[] = [];

  const addGatewayRow = (args: {
    projectId: string;
    feature: string;
    policyId: string | null;
    mode: "automatic" | "manual";
    strategy: string;
    classifier?: string;
    baselineKey: string;
    selectedKey: string;
    daysAgo: number;
    slot: number;
    inputTokens: number;
    outputTokens: number;
    quality?: number;
    errorCode?: string;
    fallbackFrom?: string;
    rolloutId?: string;
    streamed?: boolean;
  }) => {
    const selectedPricing = pricingByKey.get(args.selectedKey)!;
    const baselinePricing = pricingByKey.get(args.baselineKey)!;
    const failed = !!args.errorCode;
    const inputTokens = failed ? 0 : args.inputTokens;
    const outputTokens = failed ? 0 : args.outputTokens;
    const { costUsd } = computeCost(selectedPricing, { inputTokens, cachedInputTokens: 0, outputTokens });
    const baseline = computeCost(baselinePricing, { inputTokens, cachedInputTokens: 0, outputTokens }).costUsd;
    const substituted = args.selectedKey !== args.baselineKey;
    const selectedBare = args.selectedKey.slice(args.selectedKey.indexOf("/") + 1);
    const decision: GatewayRoutingDecision = {
      classifier: args.classifier ?? "chat",
      strategy: args.strategy,
      mode: args.mode,
      estimatedInputTokens: Math.round(inputTokens * 1.08),
      estimatedOutputTokens: Math.round(outputTokens * 1.12),
      estimatedCostUsd: Number(costUsd.toFixed(6)),
      candidates: failed
        ? []
        : [
            {
              key: args.selectedKey,
              costUsd: Number(costUsd.toFixed(6)),
              qualityScore: selectedPricing.qualityScore,
              typicalLatencyMs: selectedPricing.typicalLatencyMs,
              score: 0.9,
              reason: "synthetic seed candidate",
            },
          ],
      excluded: [],
      baselineModel: args.baselineKey,
      baselineEstimateUsd: Number(baseline.toFixed(6)),
    };
    const statusCode = !failed
      ? 200
      : args.errorCode === "rate_limit_exceeded"
        ? 429
        : args.errorCode === "server_error"
          ? 502
          : 504;
    gatewaySeed.push({
      orgId: org.id,
      projectId: args.projectId,
      environment: "production",
      feature: args.feature,
      mode: args.mode,
      strategy: args.strategy,
      policyId: args.policyId,
      rolloutId: args.rolloutId ?? null,
      requestedModel: args.mode === "automatic" ? "auto" : args.selectedKey,
      baselineModel: args.baselineKey,
      selectedModel: failed ? null : selectedBare,
      provider: failed ? null : selectedPricing.provider,
      status: failed ? "error" : "success",
      errorCode: args.errorCode ?? null,
      errorMessage: failed ? "Synthetic provider failure recorded by the demo seed." : null,
      fallbackUsed: !!args.fallbackFrom,
      fallbackReason: args.fallbackFrom ? "provider_rate_limited" : null,
      attemptedModels: args.fallbackFrom ? [args.fallbackFrom, args.selectedKey] : [args.selectedKey],
      streamed: args.streamed ?? false,
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
      usageSource: failed ? "unavailable" : "provider_reported",
      latencyMs: failed ? Math.round(800 + rand() * 1_200) : Math.round(selectedPricing.typicalLatencyMs * (0.75 + rand() * 0.55)),
      statusCode,
      costUsd: failed ? "0.000000" : costUsd.toFixed(6),
      baselineCostUsd: failed ? null : baseline.toFixed(6),
      realizedSavingsUsd: !failed && substituted ? Math.max(0, baseline - costUsd).toFixed(6) : "0.000000",
      pricingVersion: selectedPricing.version,
      qualityScore: failed ? null : (args.quality ?? null),
      similarityScore: null,
      providerRequestId: failed ? null : `seed_pr_${sha256(`${args.feature}:${args.daysAgo}:${args.slot}`).slice(0, 12)}`,
      requestId: `gw_seed_${args.feature}_${args.daysAgo}_${args.slot}`,
      decision,
      createdAt: new Date(
        now.getTime() - args.daysAgo * 86_400_000 - ((args.slot * 47 + 90) % 1_200) * 60_000,
      ),
    });
  };

  for (let d = 13; d >= 0; d--) {
    const answers = d === 0 ? 3 : 8;
    for (let i = 0; i < answers; i++) {
      const mini = rand() < 0.45;
      addGatewayRow({
        projectId: atlasId,
        feature: "answer-generation",
        policyId: answersPolicyId,
        mode: "automatic",
        strategy: "quality_first",
        classifier: "chat",
        baselineKey: "openai/gpt-4.1",
        selectedKey: mini ? "openai/gpt-4.1-mini" : "openai/gpt-4.1",
        rolloutId: d <= 3 ? shadowRollout.id : undefined,
        daysAgo: d,
        slot: i,
        inputTokens: Math.round(8_500 + rand() * 7_500),
        outputTokens: Math.round(300 + rand() * 260),
        quality: rand() < 0.65 ? Math.round(84 + rand() * 10) : undefined,
        streamed: true,
      });
    }

    const intents = d === 0 ? 2 : 6;
    for (let i = 0; i < intents; i++) {
      const roll = rand();
      const failed = roll < 0.015;
      const fallback = !failed && roll < 0.1;
      addGatewayRow({
        projectId: atlasId,
        feature: "intent-classifier",
        policyId: intentsPolicyId,
        mode: "automatic",
        strategy: "cost_optimized",
        classifier: "classification",
        baselineKey: "openai/gpt-4.1-mini",
        selectedKey: fallback ? "openai/gpt-4.1-nano" : "groq/llama-3.1-8b-instant",
        fallbackFrom: fallback ? "groq/llama-3.1-8b-instant" : undefined,
        errorCode: failed ? "rate_limit_exceeded" : undefined,
        daysAgo: d,
        slot: i,
        inputTokens: Math.round(600 + rand() * 500),
        outputTokens: Math.round(12 + rand() * 30),
        quality: rand() < 0.4 ? Math.round(76 + rand() * 12) : undefined,
      });
    }

    const schema = d === 0 ? 2 : 4;
    for (let i = 0; i < schema; i++) {
      const onCanary = d <= 5 && rand() < 0.25;
      addGatewayRow({
        projectId: orbitId,
        feature: "schema-summarizer",
        policyId: schemaPolicyId,
        mode: "automatic",
        strategy: "balanced",
        classifier: "summarization",
        baselineKey: "anthropic/claude-sonnet-4",
        selectedKey: onCanary ? "gemini/gemini-2.5-pro" : "anthropic/claude-sonnet-4",
        rolloutId: d <= 5 ? canaryRollout.id : undefined,
        daysAgo: d,
        slot: i,
        inputTokens: Math.round(22_000 + rand() * 18_000),
        outputTokens: Math.round(160 + rand() * 140),
        quality: rand() < 0.5 ? Math.round(86 + rand() * 8) : undefined,
      });
    }
  }

  for (let i = 0; i < 10; i++) {
    addGatewayRow({
      projectId: atlasId,
      feature: "support-console",
      policyId: null,
      mode: "manual",
      strategy: "balanced",
      classifier: "chat",
      baselineKey: orgFallbackKey,
      selectedKey: "openai/gpt-4o",
      daysAgo: i % 9,
      slot: 40 + i,
      inputTokens: Math.round(3_000 + rand() * 2_500),
      outputTokens: Math.round(180 + rand() * 160),
      quality: rand() < 0.3 ? Math.round(88 + rand() * 6) : undefined,
    });
  }

  for (let i = 0; i < gatewaySeed.length; i += 300) {
    await db.insert(gatewayRequests).values(gatewaySeed.slice(i, i + 300));
  }
  console.log(`[seed] inserted ${gatewaySeed.length} gateway requests`);

  const evaluationRows = await db
    .insert(modelEvaluations)
    .values([
      {
        orgId: org.id,
        projectId: atlasId,
        name: "Support reply · weekly eval",
        status: "completed",
        baselineModel: "openai/gpt-4.1",
        candidateModels: ["openai/gpt-4.1-mini", "anthropic/claude-3-5-haiku"],
        dataset: [
          {
            id: "summary",
            prompt: "Summarize this support ticket in two sentences.",
            expectedKeywords: ["refund"],
            maxLatencyMs: 5_000,
          },
          {
            id: "json",
            prompt: "Return JSON with the ticket priority.",
            mustBeJson: true,
            expectedKeywords: ["priority"],
          },
        ] satisfies EvaluationCase[],
        summary: {
          models: [
            {
              model: "openai/gpt-4.1-mini",
              cases: 2,
              successes: 2,
              failures: 0,
              passed: 2,
              taskSuccessRate: 1,
              averageQuality: 87,
              p95LatencyMs: 1_450,
              totalCostUsd: 0.0034,
              costPerSuccessUsd: 0.0017,
              inputTokens: 2_640,
              outputTokens: 316,
            },
            {
              model: "anthropic/claude-3-5-haiku",
              cases: 2,
              successes: 2,
              failures: 0,
              passed: 1,
              taskSuccessRate: 1,
              averageQuality: 79,
              p95LatencyMs: 1_180,
              totalCostUsd: 0.0021,
              costPerSuccessUsd: 0.00105,
              inputTokens: 2_640,
              outputTokens: 302,
            },
          ] satisfies EvaluationModelSummary[],
        },
        createdBy: DEMO_EMAIL,
        createdAt: addDays(now, -6),
        completedAt: addDays(now, -6),
      },
      {
        orgId: org.id,
        projectId: atlasId,
        name: "Intent classifier sweep",
        status: "completed",
        baselineModel: "openai/gpt-4.1-mini",
        candidateModels: ["groq/llama-3.1-8b-instant", "openai/gpt-4.1-nano"],
        dataset: [
          {
            id: "intent",
            prompt: "Classify the intent: 'I need a refund for my last invoice'.",
            expectedKeywords: ["refund"],
            maxLatencyMs: 1_500,
          },
          {
            id: "tone",
            prompt: "Classify the tone: 'This is the third time I have asked.'",
            expectedKeywords: ["frustrat"],
            maxLatencyMs: 1_500,
          },
        ] satisfies EvaluationCase[],
        summary: {
          models: [
            {
              model: "groq/llama-3.1-8b-instant",
              cases: 2,
              successes: 2,
              failures: 0,
              passed: 2,
              taskSuccessRate: 1,
              averageQuality: 84,
              p95LatencyMs: 340,
              totalCostUsd: 0.00009,
              costPerSuccessUsd: 0.000045,
              inputTokens: 1_880,
              outputTokens: 44,
            },
            {
              model: "openai/gpt-4.1-nano",
              cases: 2,
              successes: 2,
              failures: 0,
              passed: 2,
              taskSuccessRate: 1,
              averageQuality: 89,
              p95LatencyMs: 760,
              totalCostUsd: 0.0006,
              costPerSuccessUsd: 0.0003,
              inputTokens: 1_880,
              outputTokens: 48,
            },
          ] satisfies EvaluationModelSummary[],
        },
        createdBy: "marcus@northwind.dev",
        createdAt: addDays(now, -12),
        completedAt: addDays(now, -12),
      },
    ])
    .returning({ id: modelEvaluations.id, name: modelEvaluations.name });

  const supportEval = evaluationRows.find((e) => e.name === "Support reply · weekly eval")!;
  await db.insert(evaluationResults).values([
    {
      orgId: org.id,
      evaluationId: supportEval.id,
      model: "openai/gpt-4.1-mini",
      caseId: "summary",
      status: "success",
      passed: true,
      qualityScore: 88,
      latencyMs: 1_410,
      inputTokens: 1_180,
      outputTokens: 158,
      costUsd: "0.001700",
      usageSource: "provider_reported",
      finishReason: "stop",
      outputExcerpt: "The customer requests a refund for the duplicated charge on the last invoice.",
    },
    {
      orgId: org.id,
      evaluationId: supportEval.id,
      model: "openai/gpt-4.1-mini",
      caseId: "json",
      status: "success",
      passed: true,
      qualityScore: 86,
      latencyMs: 1_490,
      inputTokens: 1_460,
      outputTokens: 158,
      costUsd: "0.001700",
      usageSource: "provider_reported",
      finishReason: "stop",
      outputExcerpt: '{"priority":"high"}',
    },
    {
      orgId: org.id,
      evaluationId: supportEval.id,
      model: "anthropic/claude-3-5-haiku",
      caseId: "summary",
      status: "success",
      passed: true,
      qualityScore: 81,
      latencyMs: 1_120,
      inputTokens: 1_180,
      outputTokens: 151,
      costUsd: "0.001050",
      usageSource: "provider_reported",
      finishReason: "stop",
      outputExcerpt: "Customer asks for a refund of the duplicate invoice charge.",
    },
    {
      orgId: org.id,
      evaluationId: supportEval.id,
      model: "anthropic/claude-3-5-haiku",
      caseId: "json",
      status: "success",
      passed: false,
      qualityScore: 77,
      latencyMs: 1_240,
      inputTokens: 1_460,
      outputTokens: 151,
      costUsd: "0.001050",
      usageSource: "provider_reported",
      finishReason: "stop",
      outputExcerpt: "Priority: high",
    },
  ]);

  await db.insert(auditLogs).values([
    {
      orgId: org.id,
      actorEmail: "marcus@northwind.dev",
      actorType: "user",
      action: "router.rollout_requested",
      targetType: "routing_rollout",
      targetId: canaryRollout.id,
      summary: "Requested a 25% canary of Gemini 2.5 Pro on Orbit schema summaries.",
      metadata: { baseline: "anthropic/claude-sonnet-4", candidate: "gemini/gemini-2.5-pro" },
    },
    {
      orgId: org.id,
      actorEmail: DEMO_EMAIL,
      actorType: "user",
      action: "router.rollout_approved",
      targetType: "routing_rollout",
      targetId: canaryRollout.id,
      summary: "Approved the Gemini 2.5 Pro canary on Orbit schema summaries.",
    },
    {
      orgId: org.id,
      actorEmail: "sofia@northwind.dev",
      actorType: "user",
      action: "router.rollout_requested",
      targetType: "routing_rollout",
      targetId: pendingRollout.id,
      summary: "Requested a 10% canary of GPT-4.1 nano on Atlas intent classification.",
    },
    {
      orgId: org.id,
      actorEmail: DEMO_EMAIL,
      actorType: "user",
      action: "router.evaluation_run",
      targetType: "model_evaluation",
      targetId: supportEval.id,
      summary: "Ran weekly support-reply evaluation across two candidate models.",
    },
  ]);

  await db.insert(auditLogs).values([
    {
      orgId: org.id,
      actorEmail: DEMO_EMAIL,
      actorType: "user",
      action: "org.created",
      targetType: "organization",
      targetId: org.id,
      summary: "Created Northwind Labs workspace on the scale plan.",
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0 (synthetic seed)",
    },
    {
      orgId: org.id,
      actorEmail: DEMO_EMAIL,
      actorType: "user",
      action: "provider.connected",
      targetType: "provider",
      targetId: "openai",
      summary: "Connected OpenAI with encrypted credentials.",
      metadata: { keyLast4: "QR2A" },
    },
    {
      orgId: org.id,
      actorEmail: "marcus@northwind.dev",
      actorType: "user",
      action: "routing_policy.approved",
      targetType: "routing_policy",
      targetId: policyRows[2]?.id,
      summary: "Approved Orbit schema summaries routing policy for production.",
      metadata: { previousModel: "openai/gpt-4.1", newModel: "anthropic/claude-sonnet-4" },
    },
    {
      orgId: org.id,
      actorEmail: DEMO_EMAIL,
      actorType: "user",
      action: "budget.updated",
      targetType: "budget",
      targetId: budgetByName.get("Organization monthly budget"),
      summary: "Raised the monthly organization budget after the Q4 forecast review.",
      metadata: { oldLimitUsd: 900, newLimitUsd: Number(roundTo(Math.max(orgMtd, 1) / 0.82, 10).toFixed(2)) },
    },
    {
      orgId: org.id,
      actorEmail: "marcus@northwind.dev",
      actorType: "user",
      action: "model.restricted",
      targetType: "organization",
      targetId: org.id,
      summary: "Blocked anthropic/claude-opus-4 from production routing.",
      metadata: { blockedModel: "anthropic/claude-opus-4" },
    },
    {
      orgId: org.id,
      actorEmail: "system@tokenburn.dev",
      actorType: "system",
      action: "pricing.version_published",
      targetType: "pricing_catalog",
      targetId: "openai/gpt-4o",
      summary: "Published v2 pricing for gpt-4o and retained v1 for historical re-costing.",
      metadata: { version: 2, effectiveFrom: addDays(now, -90).toISOString() },
    },
    {
      orgId: org.id,
      actorEmail: DEMO_EMAIL,
      actorType: "api_key",
      action: "usage.ingested",
      targetType: "api_key",
      targetId: DEMO_API_KEY.slice(0, 11),
      summary: "Usage ingestion key used for Atlas production events.",
      metadata: { window: "last 24h", events: 1_431 },
    },
  ]);

  console.log("[seed] inserting reports and recommendations");
  const weeklyReports: Array<typeof reports.$inferInsert> = [];
  for (let w = 1; w <= 3; w++) {
    const end = new Date(now.getTime() - (w - 1) * 7 * 86_400_000);
    const start = new Date(end.getTime() - 7 * 86_400_000);
    const slice = events.filter((e) => {
      const t = (e.occurredAt as Date).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
    const total = slice.reduce((s, e) => s + Number(e.costUsd), 0);
    const requests = slice.length;
    const topFeature = Object.entries(
      slice.reduce<Record<string, number>>((acc, e) => {
        const feature = e.feature ?? "unnamed";
        acc[feature] = (acc[feature] ?? 0) + Number(e.costUsd);
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1])[0];
    weeklyReports.push({
      orgId: org.id,
      type: "weekly",
      title: `Weekly cost report · week of ${dayKey(start)}`,
      periodStart: start,
      periodEnd: end,
      createdBy: DEMO_EMAIL,
      summary: {
        totalCostUsd: Number(total.toFixed(2)),
        requests,
        topFeature: topFeature?.[0] ?? null,
        topFeatureCostUsd: Number((topFeature?.[1] ?? 0).toFixed(2)),
        projectedMonthlyUsd: Number((total * 4.345).toFixed(2)),
        synthetic: true,
        note: "Synthetic seed report. Generated from normalized usage events priced at event-time catalog versions.",
      },
    });
  }
  await db.insert(reports).values(weeklyReports);

  // A few starter recommendations; the coach engine refreshes these with full evidence.
  await db.insert(recommendations).values([
    {
      orgId: org.id,
      fingerprint: `downgrade:${orbitId}:schema-summarizer:anthropic/claude-sonnet-4:gemini/gemini-2.5-pro`,
      kind: "model_downgrade",
      scope: "feature",
      projectId: orbitId,
      feature: "schema-summarizer",
      model: "claude-sonnet-4",
      title: "Route schema-summarizer to Gemini 2.5 Pro",
      summary: "Schema summaries average ~118k input tokens on Claude Sonnet 4. Repricing observed tokens at Gemini 2.5 Pro rates is materially cheaper.",
      rationale:
        "Estimated by re-pricing the last 30 days of measured tokens. Quality differences must be validated with a schema-recall eval before production routing.",
      evidence: { seeded: true, note: "Refreshed by the coach engine on first analysis." },
      estimatedMonthlySavingsUsd: (schemaMtd * 0.62).toFixed(2),
      confidence: "medium",
      measurement: "estimated",
      status: "new",
    },
    {
      orgId: org.id,
      fingerprint: `cache:${atlasId}:answer-generation:openai/gpt-4.1`,
      kind: "caching",
      scope: "feature",
      projectId: atlasId,
      feature: "answer-generation",
      model: "gpt-4.1",
      title: "Enable prompt caching for answer-generation",
      summary: "Answer-generation sends large, mostly-stable system and retrieval context without cached-input billing.",
      rationale: "Estimate assumes a stable 40% prefix becomes cacheable at the provider's cached-input discount.",
      evidence: { seeded: true },
      estimatedMonthlySavingsUsd: (sumBy((e) => e.feature === "answer-generation") * 0.2).toFixed(2),
      confidence: "medium",
      measurement: "estimated",
      status: "new",
    },
  ]);

  console.log("[seed] done");
}
