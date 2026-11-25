import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();

export type OrgSettings = {
  timezone: string;
  dataMode: "synthetic" | "live" | "hybrid";
  allowedModels: string[];
  blockedModels: string[];
  requireApprovalForRouting: boolean;
  hardLimitsEnabled: boolean;
  fallbackModel: string;
  webhookUrl?: string;
};

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    jobTitle: text("job_title"),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    plan: text("plan").notNull().default("scale"),
    settings: jsonb("settings").$type<OrgSettings>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("organizations_slug_idx").on(t.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activeOrgId: text("active_org_id").references(() => organizations.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("projects_org_slug_uq").on(t.orgId, t.slug)],
);

export const environments = pgTable(
  "environments",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("environments_project_slug_uq").on(t.projectId, t.slug)],
);

export const features = pgTable(
  "features",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("features_project_name_uq").on(t.projectId, t.name)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    environmentId: text("environment_id").references(() => environments.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    lastFour: text("last_four").notNull(),
    hash: text("hash").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    requestCount: integer("request_count").notNull().default(0),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.hash), index("api_keys_org_idx").on(t.orgId)],
);

export const providers = pgTable(
  "providers",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("disconnected"),
    credentialsEnc: text("credentials_enc"),
    keyLast4: text("key_last4"),
    label: text("label"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("providers_org_provider_uq").on(t.orgId, t.provider)],
);

export const modelPricing = pgTable(
  "model_pricing",
  {
    id: id(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    displayName: text("display_name").notNull(),
    family: text("family"),
    category: text("category").notNull().default("mid"),
    inputPerM: numeric("input_per_m", { precision: 12, scale: 4 }).notNull(),
    cachedInputPerM: numeric("cached_input_per_m", { precision: 12, scale: 4 }).notNull(),
    outputPerM: numeric("output_per_m", { precision: 12, scale: 4 }).notNull(),
    cacheWritePerM: numeric("cache_write_per_m", { precision: 12, scale: 4 }),
    contextWindow: integer("context_window").notNull(),
    maxOutput: integer("max_output").notNull(),
    qualityScore: integer("quality_score").notNull().default(70),
    typicalLatencyMs: integer("typical_latency_ms").notNull().default(900),
    version: integer("version").notNull().default(1),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
    source: text("source").notNull().default("internal-catalog"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("model_pricing_provider_model_version_uq").on(t.provider, t.model, t.version),
    index("model_pricing_lookup_idx").on(t.provider, t.model, t.effectiveFrom),
  ],
);

export type CostBreakdown = {
  inputUsd: number;
  cachedInputUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  reasoningUsd: number;
  discountApplied: number;
  pricingVersion: number;
};

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    environment: text("environment").notNull().default("production"),
    feature: text("feature").notNull().default("unnamed"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    pricingId: text("pricing_id").references(() => modelPricing.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    requestId: text("request_id"),
    idempotencyKey: text("idempotency_key"),
    dedupeHash: text("dedupe_hash").notNull(),
    promptHash: text("prompt_hash"),
    endpoint: text("endpoint"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    statusCode: integer("status_code").notNull().default(200),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull(),
    costBreakdown: jsonb("cost_breakdown").$type<CostBreakdown>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    ingestedAt: createdAt(),
    usageSource: text("usage_source").notNull().default("provider_reported"),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    tags: jsonb("tags").$type<Record<string, string>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("usage_events_org_dedupe_uq").on(t.orgId, t.dedupeHash),
    index("usage_events_org_time_idx").on(t.orgId, t.occurredAt),
    index("usage_events_project_time_idx").on(t.orgId, t.projectId, t.occurredAt),
    index("usage_events_feature_idx").on(t.orgId, t.feature),
    index("usage_events_feature_time_idx").on(t.orgId, t.feature, t.occurredAt),
    index("usage_events_prompt_idx").on(t.orgId, t.promptHash),
    index("usage_events_model_idx").on(t.orgId, t.model),
    index("usage_events_provider_model_time_idx").on(t.orgId, t.provider, t.model, t.occurredAt),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: text("scope").notNull().default("project"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    feature: text("feature"),
    period: text("period").notNull().default("monthly"),
    limitUsd: numeric("limit_usd", { precision: 12, scale: 2 }).notNull(),
    hardLimit: boolean("hard_limit").notNull().default(false),
    thresholds: jsonb("thresholds").$type<number[]>().notNull().default([50, 75, 90, 100]),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("budgets_org_idx").on(t.orgId)],
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    scope: text("scope").notNull().default("organization"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    feature: text("feature"),
    threshold: numeric("threshold", { precision: 12, scale: 4 }).notNull(),
    windowHours: integer("window_hours").notNull().default(24),
    severity: text("severity").notNull().default("warning"),
    channel: text("channel").notNull().default("in_app"),
    webhookUrl: text("webhook_url"),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("alert_rules_org_idx").on(t.orgId)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
    budgetId: text("budget_id").references(() => budgets.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("warning"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    metricValue: numeric("metric_value", { precision: 14, scale: 4 }),
    threshold: numeric("threshold", { precision: 14, scale: 4 }),
    status: text("status").notNull().default("open"),
    fingerprint: text("fingerprint").notNull(),
    createdAt: createdAt(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "date" }),
    acknowledgedBy: text("acknowledged_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("alerts_org_status_idx").on(t.orgId, t.status),
    uniqueIndex("alerts_org_fingerprint_uq").on(t.orgId, t.fingerprint),
  ],
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    scope: text("scope").notNull().default("feature"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    feature: text("feature"),
    model: text("model"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    rationale: text("rationale").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    estimatedMonthlySavingsUsd: numeric("estimated_monthly_savings_usd", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    confidence: text("confidence").notNull().default("medium"),
    measurement: text("measurement").notNull().default("estimated"),
    status: text("status").notNull().default("new"),
    generatedAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("recommendations_org_fingerprint_uq").on(t.orgId, t.fingerprint),
    index("recommendations_org_status_idx").on(t.orgId, t.status),
  ],
);

export const routingPolicies = pgTable(
  "routing_policies",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    feature: text("feature"),
    environment: text("environment").notNull().default("production"),
    name: text("name").notNull(),
    strategy: text("strategy").notNull().default("cost_optimized"),
    mode: text("mode").notNull().default("manual"),
    primaryModel: text("primary_model").notNull(),
    fallbackModel: text("fallback_model").notNull(),
    candidates: jsonb("candidates").$type<string[]>(),
    minQualityScore: integer("min_quality_score"),
    maxLatencyMs: integer("max_latency_ms"),
    status: text("status").notNull().default("draft"),
    maxOutputTokens: integer("max_output_tokens"),
    cacheEnabled: boolean("cache_enabled").notNull().default(false),
    notes: text("notes"),
    createdBy: text("created_by"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("routing_policies_org_idx").on(t.orgId)],
);

export type GatewayRoutingDecision = {
  classifier: string;
  strategy: string;
  mode: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  candidates: Array<{
    key: string;
    costUsd: number;
    qualityScore: number;
    typicalLatencyMs: number;
    score: number;
    reason: string;
  }>;
  excluded: Array<{ key: string; reason: string }>;
  baselineModel: string | null;
  baselineEstimateUsd: number | null;
};

export const gatewayRequests = pgTable(
  "gateway_requests",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    environment: text("environment").notNull().default("production"),
    feature: text("feature").notNull().default("unnamed"),
    mode: text("mode").notNull().default("manual"),
    strategy: text("strategy"),
    policyId: text("policy_id").references(() => routingPolicies.id, { onDelete: "set null" }),
    rolloutId: text("rollout_id"),
    requestedModel: text("requested_model"),
    baselineModel: text("baseline_model"),
    selectedModel: text("selected_model"),
    provider: text("provider"),
    status: text("status").notNull().default("success"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    fallbackReason: text("fallback_reason"),
    attemptedModels: jsonb("attempted_models").$type<string[]>(),
    streamed: boolean("streamed").notNull().default(false),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    usageSource: text("usage_source").notNull().default("provider_reported"),
    latencyMs: integer("latency_ms").notNull().default(0),
    statusCode: integer("status_code").notNull().default(200),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
    baselineCostUsd: numeric("baseline_cost_usd", { precision: 14, scale: 6 }),
    realizedSavingsUsd: numeric("realized_savings_usd", { precision: 14, scale: 6 }),
    pricingVersion: integer("pricing_version"),
    qualityScore: integer("quality_score"),
    baselineQualityScore: integer("baseline_quality_score"),
    similarityScore: integer("similarity_score"),
    providerRequestId: text("provider_request_id"),
    requestId: text("request_id"),
    decision: jsonb("decision").$type<GatewayRoutingDecision>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("gateway_requests_org_time_idx").on(t.orgId, t.createdAt),
    index("gateway_requests_org_project_time_idx").on(t.orgId, t.projectId, t.createdAt),
    index("gateway_requests_org_model_time_idx").on(t.orgId, t.selectedModel, t.createdAt),
    index("gateway_requests_org_status_time_idx").on(t.orgId, t.status, t.createdAt),
  ],
);

export type EvaluationCase = {
  id: string;
  prompt: string;
  system?: string;
  expectedKeywords?: string[];
  mustBeJson?: boolean;
  referenceAnswer?: string;
  maxLatencyMs?: number;
};

export type EvaluationModelSummary = {
  model: string;
  cases: number;
  successes: number;
  failures: number;
  passed: number;
  taskSuccessRate: number;
  averageQuality: number | null;
  p95LatencyMs: number;
  totalCostUsd: number;
  costPerSuccessUsd: number | null;
  inputTokens: number;
  outputTokens: number;
};

export const modelEvaluations = pgTable(
  "model_evaluations",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    baselineModel: text("baseline_model"),
    candidateModels: jsonb("candidate_models").$type<string[]>().notNull(),
    dataset: jsonb("dataset").$type<EvaluationCase[]>().notNull(),
    summary: jsonb("summary").$type<{ models: EvaluationModelSummary[] }>(),
    error: text("error"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("model_evaluations_org_time_idx").on(t.orgId, t.createdAt)],
);

export const evaluationResults = pgTable(
  "evaluation_results",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    evaluationId: text("evaluation_id").notNull().references(() => modelEvaluations.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    caseId: text("case_id").notNull(),
    status: text("status").notNull(),
    passed: boolean("passed").notNull().default(false),
    qualityScore: integer("quality_score"),
    latencyMs: integer("latency_ms").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
    usageSource: text("usage_source").notNull().default("provider_reported"),
    finishReason: text("finish_reason"),
    outputExcerpt: text("output_excerpt"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (t) => [index("evaluation_results_eval_idx").on(t.evaluationId, t.model)],
);

export type RolloutThresholds = {
  minSamples: number;
  maxErrorRatePct: number;
  maxP95LatencyMs: number;
  minAverageQuality: number;
};

export const routingRollouts = pgTable(
  "routing_rollouts",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    policyId: text("policy_id").notNull().references(() => routingPolicies.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("canary"),
    status: text("status").notNull().default("pending_approval"),
    baselineModel: text("baseline_model").notNull(),
    candidateModel: text("candidate_model").notNull(),
    trafficPercent: integer("traffic_percent").notNull().default(10),
    thresholds: jsonb("thresholds").$type<RolloutThresholds>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    outcomeReason: text("outcome_reason"),
    createdBy: text("created_by"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("routing_rollouts_org_status_idx").on(t.orgId, t.status),
    index("routing_rollouts_policy_status_idx").on(t.policyId, t.status),
  ],
);

/** Candidate-model observations captured while a rollout is in shadow mode. */
export const rolloutShadowSamples = pgTable(
  "rollout_shadow_samples",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    rolloutId: text("rollout_id").notNull().references(() => routingRollouts.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    status: text("status").notNull().default("success"),
    latencyMs: integer("latency_ms").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
    qualityScore: integer("quality_score"),
    errorCode: text("error_code"),
    outputExcerpt: text("output_excerpt"),
    createdAt: createdAt(),
  },
  (t) => [
    index("rollout_shadow_samples_rollout_idx").on(t.rolloutId, t.createdAt),
    index("rollout_shadow_samples_org_idx").on(t.orgId, t.createdAt),
  ],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by"),
    requestedByEmail: text("requested_by_email").notNull(),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("approvals_org_status_idx").on(t.orgId, t.status),
    uniqueIndex("approvals_pending_target_uq")
      .on(t.orgId, t.targetId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const routingHolds = pgTable(
  "routing_holds",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    budgetId: text("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
    estimateUsd: numeric("estimate_usd", { precision: 14, scale: 6 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("routing_holds_budget_expiry_idx").on(t.budgetId, t.expiresAt), index("routing_holds_org_idx").on(t.orgId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    actorEmail: text("actor_email").notNull(),
    actorType: text("actor_type").notNull().default("user"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_time_idx").on(t.orgId, t.createdAt)],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("weekly"),
    title: text("title").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true, mode: "date" }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }).notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("reports_org_idx").on(t.orgId)],
);

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});
