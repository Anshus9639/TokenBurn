import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, createOrg, createProject, createTestApiKey, addPricing, testCtx } from "./helpers/db";
import type { AppDb } from "@/lib/db/client";
import {
  auditLogs,
  evaluationResults,
  gatewayRequests,
  modelEvaluations,
  providers,
  rolloutShadowSamples,
  routingPolicies,
  routingRollouts,
  usageEvents,
} from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import type { ApiKeyContext } from "@/lib/auth";
import { executeGatewayRequest } from "@/lib/gateway/orchestrate";
import { runEvaluation } from "@/lib/gateway/evaluate";

function mockResponse(model: string, content: string): Response {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function mockFetch(handler: (body: Record<string, unknown>) => Response): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return handler(body);
  }) as typeof fetch;
}

describe("rollout and evaluation engines", () => {
  let db: AppDb;
  let close: () => Promise<void>;

  const setup = async () => {
    const orgId = await createOrg(db, { hardLimitsEnabled: false });
    const projectId = await createProject(db, orgId);
    const apiKeyId = await createTestApiKey(db, orgId, projectId);
    const ctx: ApiKeyContext = testCtx(orgId, projectId, { apiKeyId });
    await db.insert(providers).values([
      {
        orgId,
        provider: "openai",
        status: "connected",
        credentialsEnc: encryptSecret(`openai-${crypto.randomUUID()}`),
      },
    ]);
    const [policy] = await db
      .insert(routingPolicies)
      .values({
        orgId,
        projectId,
        name: "Production router",
        status: "active",
        mode: "automatic",
        strategy: "lowest_cost",
        primaryModel: "openai/gpt-4.1",
        fallbackModel: "openai/gpt-4.1-mini",
        candidates: ["openai/gpt-4.1", "openai/gpt-4.1-mini"],
        environment: "production",
      })
      .returning();
    return { orgId, projectId, ctx, policy: policy! };
  };

  before(async () => {
    const created = await createTestDb();
    db = created.db;
    close = created.close;
    await addPricing(db, { provider: "openai", model: "gpt-4.1", inputPerM: 2, outputPerM: 8 });
    await addPricing(db, { provider: "openai", model: "gpt-4.1-mini", inputPerM: 0.4, outputPerM: 1.6 });
  });

  after(async () => {
    await close();
  });

  it("shadow mode serves the baseline and records a candidate observation without billing it", async () => {
    const { orgId, projectId, ctx, policy } = await setup();
    const [rollout] = await db
      .insert(routingRollouts)
      .values({
        orgId,
        policyId: policy.id,
        projectId,
        mode: "shadow",
        status: "running",
        baselineModel: "openai/gpt-4.1",
        candidateModel: "openai/gpt-4.1-mini",
        trafficPercent: 0,
        thresholds: { minSamples: 5, maxErrorRatePct: 5, maxP95LatencyMs: 4_000, minAverageQuality: 70 },
        startedAt: new Date(),
        approvedBy: "admin@tokenburn.dev",
        approvedAt: new Date(),
      })
      .returning();

    const result = await executeGatewayRequest(
      db,
      ctx,
      { model: "auto", messages: [{ role: "user", content: "Hello" }], tokenburn: { mode: "automatic" } },
      { fetchImpl: mockFetch((body) => mockResponse(String(body.model), `answer from ${body.model}`)) },
    );
    assert.equal(result.kind, "response");
    if (result.kind !== "response") return;
    await result.background;

    assert.equal(result.selection.selected?.key, "openai/gpt-4.1");
    const [row] = await db.select().from(gatewayRequests).where(eq(gatewayRequests.id, result.gatewayRequestId));
    assert.equal(row!.selectedModel, "gpt-4.1");
    assert.equal(row!.rolloutId, rollout!.id);
    assert.equal(row!.status, "success");

    const samples = await db
      .select()
      .from(rolloutShadowSamples)
      .where(eq(rolloutShadowSamples.rolloutId, rollout!.id));
    assert.equal(samples.length, 1);
    assert.equal(samples[0]!.model, "openai/gpt-4.1-mini");
    assert.equal(samples[0]!.status, "success");
    assert.equal(samples[0]!.inputTokens, 80);
    assert.ok(Number(samples[0]!.costUsd) > 0);

    // Only the served request bills the customer: shadow traffic stays out of usage events.
    const events = await db.select().from(usageEvents).where(eq(usageEvents.orgId, orgId));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.model, "gpt-4.1");
  });

  it("automatically rolls back a canary that exceeds its error-rate guardrail", async () => {
    const { orgId, projectId, ctx, policy } = await setup();
    const [rollout] = await db
      .insert(routingRollouts)
      .values({
        orgId,
        policyId: policy.id,
        projectId,
        mode: "canary",
        status: "running",
        baselineModel: "openai/gpt-4.1",
        candidateModel: "openai/gpt-4.1-mini",
        trafficPercent: 100,
        thresholds: { minSamples: 1, maxErrorRatePct: 0, maxP95LatencyMs: 10_000, minAverageQuality: 0 },
        startedAt: new Date(),
        approvedBy: "admin@tokenburn.dev",
        approvedAt: new Date(),
      })
      .returning();

    await assert.rejects(
      executeGatewayRequest(
        db,
        ctx,
        { model: "auto", messages: [{ role: "user", content: "Hello" }], tokenburn: { mode: "automatic" } },
        {
          fetchImpl: mockFetch(
            () =>
              new Response(JSON.stringify({ error: { message: "revoked key" } }), {
                status: 401,
                headers: { "content-type": "application/json" },
              }),
          ),
        },
      ),
    );

    const [updated] = await db.select().from(routingRollouts).where(eq(routingRollouts.id, rollout!.id));
    assert.equal(updated!.status, "rolled_back");
    assert.match(updated!.outcomeReason ?? "", /Automatic rollback/);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.orgId, orgId));
    assert.ok(audits.some((row) => row.action === "rollout.auto_rolled_back"));
  });

  it("runs provider-backed evaluations and records per-model outcomes", async () => {
    const { orgId, projectId } = await setup();
    const fetchImpl = mockFetch((body) => {
      const model = String(body.model);
      if (model === "gpt-4.1") {
        return new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      const messages = body.messages as Array<{ role: string; content: string }>;
      const prompt = messages[messages.length - 1]?.content ?? "";
      return mockResponse(model, prompt.includes("JSON") ? '{"ok":true}' : "Hello there, friend.");
    });

    const result = await runEvaluation(db, {
      orgId,
      projectId,
      name: "Support workload comparison",
      baselineModel: "openai/gpt-4.1",
      candidateModels: ["openai/gpt-4.1-mini"],
      dataset: [
        {
          id: "greeting",
          prompt: "Say hello to the customer.",
          expectedKeywords: ["hello"],
          referenceAnswer: "Hello there, friend.",
          maxLatencyMs: 5_000,
        },
        {
          id: "json",
          prompt: "Return JSON with ok true.",
          mustBeJson: true,
          expectedKeywords: ["ok"],
        },
      ],
      credentials: new Map([["openai", "test-key"]]),
      createdBy: "dev@tokenburn.dev",
      fetchImpl,
    });

    assert.equal(result.status, "completed");
    assert.ok(result.summary);
    const baseline = result.summary!.models.find((model) => model.model === "openai/gpt-4.1");
    const candidate = result.summary!.models.find((model) => model.model === "openai/gpt-4.1-mini");
    assert.ok(baseline && candidate);
    assert.equal(baseline!.failures, 2);
    assert.equal(baseline!.taskSuccessRate, 0);
    assert.equal(baseline!.costPerSuccessUsd, null);
    assert.equal(candidate!.passed, 2);
    assert.equal(candidate!.taskSuccessRate, 1);
    assert.ok((candidate!.averageQuality ?? 0) >= 70);
    assert.ok((candidate!.totalCostUsd ?? 0) > 0);
    assert.ok((candidate!.costPerSuccessUsd ?? 0) > 0);
    assert.equal(candidate!.inputTokens, 160);

    const evaluation = await db
      .select()
      .from(modelEvaluations)
      .where(eq(modelEvaluations.id, result.id))
      .limit(1);
    assert.equal(evaluation[0]!.status, "completed");
    const rows = await db
      .select()
      .from(evaluationResults)
      .where(eq(evaluationResults.evaluationId, result.id));
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((row) => row.status === "error").length, 2);
    assert.equal(rows.filter((row) => row.usageSource === "provider_reported").length, 2);
  });

  it("skips models whose provider has no credential instead of inventing results", async () => {
    const { orgId, projectId } = await setup();
    const result = await runEvaluation(db, {
      orgId,
      projectId,
      name: "No credentials",
      baselineModel: null,
      candidateModels: ["openai/gpt-4.1-mini"],
      dataset: [{ id: "one", prompt: "Hello", expectedKeywords: ["hello"] }],
      credentials: new Map(),
    });
    assert.equal(result.status, "completed");
    const summary = result.summary!.models[0]!;
    assert.equal(summary.successes, 0);
    assert.equal(summary.taskSuccessRate, 0);
    assert.equal(summary.totalCostUsd, 0);
    const rows = await db
      .select()
      .from(evaluationResults)
      .where(eq(evaluationResults.evaluationId, result.id));
    assert.equal(rows[0]!.status, "skipped");
    assert.equal(rows[0]!.errorCode, "provider_not_configured");
    assert.equal(rows[0]!.usageSource, "unavailable");
  });
});
