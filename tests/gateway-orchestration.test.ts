import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, createOrg, createProject, createTestApiKey, addPricing, testCtx } from "./helpers/db";
import type { AppDb } from "@/lib/db/client";
import { budgets, gatewayRequests, providers, routingPolicies, usageEvents } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import type { ApiKeyContext } from "@/lib/auth";
import { circuitSnapshot, resetCircuits } from "@/lib/gateway/circuit";
import { executeGatewayRequest, GatewayError } from "@/lib/gateway/orchestrate";
import type { GatewayChatRequest } from "@/lib/gateway/types";

function mockResponse(
  model: string,
  options: { usage?: { input: number; output: number } | null; content?: string } = {},
): Response {
  const usage = options.usage === undefined ? { input: 100, output: 20 } : options.usage;
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: options.content ?? "Hello from the mock provider." },
          finish_reason: "stop",
        },
      ],
      ...(usage
        ? {
            usage: {
              prompt_tokens: usage.input,
              completion_tokens: usage.output,
              total_tokens: usage.input + usage.output,
            },
          }
        : {}),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

type FetchCall = { url: string; body: Record<string, unknown> };

function mockFetch(handler: (body: Record<string, unknown>, call: FetchCall) => Response): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const call = { url: String(input), body };
    calls.push(call);
    return handler(body, call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function request(overrides: Partial<GatewayChatRequest> = {}): GatewayChatRequest {
  return {
    model: "openai/gpt-4.1",
    messages: [{ role: "user", content: "Hello there" }],
    ...overrides,
  };
}

describe("gateway orchestration", () => {
  let db: AppDb;
  let close: () => Promise<void>;
  let seq = 0;

  const setup = async (settings: Parameters<typeof createOrg>[1] = {}) => {
    const orgId = await createOrg(db, { hardLimitsEnabled: false, ...settings });
    const projectId = await createProject(db, orgId);
    const apiKeyId = await createTestApiKey(db, orgId, projectId);
    const ctx: ApiKeyContext = testCtx(orgId, projectId, { apiKeyId });
    return { orgId, projectId, apiKeyId, ctx };
  };

  const connectProvider = async (orgId: string, provider: string) => {
    await db.insert(providers).values({
      orgId,
      provider,
      status: "connected",
      credentialsEnc: encryptSecret(`${provider}-test-key-${seq++}`),
    });
  };

  const addPolicy = async (
    orgId: string,
    projectId: string,
    overrides: Partial<typeof routingPolicies.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(routingPolicies)
      .values({
        orgId,
        projectId,
        name: `Policy ${seq++}`,
        status: "active",
        mode: "automatic",
        strategy: "lowest_cost",
        primaryModel: "openai/gpt-4.1",
        fallbackModel: "openai/gpt-4.1-mini",
        candidates: ["openai/gpt-4.1", "openai/gpt-4.1-mini"],
        environment: "production",
        ...overrides,
      })
      .returning();
    return row!;
  };

  before(async () => {
    resetCircuits();
    const created = await createTestDb();
    db = created.db;
    close = created.close;
    await addPricing(db, { provider: "openai", model: "gpt-4.1", inputPerM: 2, outputPerM: 8 });
    await addPricing(db, { provider: "openai", model: "gpt-4.1-mini", inputPerM: 0.4, outputPerM: 1.6 });
    await addPricing(db, { provider: "groq", model: "llama-3.1-8b-instant", inputPerM: 0.05, outputPerM: 0.08 });
  });

  after(async () => {
    await close();
  });

  it("manual mode calls the requested model and records provider-reported usage", async () => {
    const { orgId, ctx } = await setup();
    await connectProvider(orgId, "openai");
    const { fetchImpl, calls } = mockFetch(() => mockResponse("gpt-4.1"));

    const result = await executeGatewayRequest(db, ctx, request({ tokenburn: { feature: "support" } }), {
      fetchImpl,
    });
    assert.equal(result.kind, "response");
    if (result.kind !== "response") return;

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body.model, "gpt-4.1");
    assert.equal(calls[0]!.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(result.body.object, "chat.completion");
    const meta = result.body.tokenburn as Record<string, unknown>;
    assert.equal(meta.selectedModel, "openai/gpt-4.1");
    assert.equal(meta.usageSource, "provider_reported");
    assert.equal(result.summary.inputTokens, 100);
    assert.equal(result.summary.outputTokens, 20);
    assert.ok((result.summary.costUsd ?? 0) > 0);
    assert.equal(result.headers["x-tokenburn-model"], "openai/gpt-4.1");
    assert.equal(result.headers["x-tokenburn-fallback"], "false");

    const [row] = await db.select().from(gatewayRequests).where(eq(gatewayRequests.id, result.gatewayRequestId));
    assert.equal(row!.status, "success");
    assert.equal(row!.mode, "manual");
    assert.equal(row!.usageSource, "provider_reported");
    assert.equal(row!.inputTokens, 100);
    assert.equal(row!.fallbackUsed, false);
    assert.ok(Number(row!.costUsd) > 0);

    const events = await db.select().from(usageEvents).where(eq(usageEvents.orgId, orgId));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.idempotencyKey, `gateway:${result.gatewayRequestId}`);
    assert.equal(events[0]!.endpoint, "/v1/chat/completions");
    assert.equal(events[0]!.inputTokens, 100);
  });

  it("automatic mode requires an approved automatic policy", async () => {
    const bare = await setup();
    await connectProvider(bare.orgId, "openai");
    const auto = request({ model: "auto", tokenburn: { mode: "automatic" } });

    await assert.rejects(
      executeGatewayRequest(db, bare.ctx, auto, { fetchImpl: mockFetch(() => mockResponse("x")).fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "policy_required");
        return true;
      },
    );

    const manualPolicyOrg = await setup();
    await connectProvider(manualPolicyOrg.orgId, "openai");
    await addPolicy(manualPolicyOrg.orgId, manualPolicyOrg.projectId, { mode: "manual" });
    await assert.rejects(
      executeGatewayRequest(db, manualPolicyOrg.ctx, auto, {
        fetchImpl: mockFetch(() => mockResponse("x")).fetchImpl,
      }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "policy_not_automatic");
        return true;
      },
    );
  });

  it("automatic mode routes to the cheapest permitted candidate and only realizes savings from provider usage", async () => {
    const { orgId, projectId, ctx } = await setup();
    await connectProvider(orgId, "openai");
    const policy = await addPolicy(orgId, projectId);
    const { fetchImpl } = mockFetch((body) => mockResponse(String(body.model)));

    const result = await executeGatewayRequest(
      db,
      ctx,
      request({ model: "auto", tokenburn: { mode: "automatic", feature: "chat" } }),
      { fetchImpl },
    );
    assert.equal(result.kind, "response");
    if (result.kind !== "response") return;

    assert.equal(result.selection.selected?.key, "openai/gpt-4.1-mini");
    assert.equal(result.selection.policyId, policy.id);
    const meta = result.body.tokenburn as Record<string, unknown>;
    assert.equal(meta.selectedModel, "openai/gpt-4.1-mini");
    assert.equal(meta.baselineModel, "openai/gpt-4.1");
    assert.ok((result.summary.realizedSavingsUsd ?? 0) > 0);
    assert.ok((result.summary.baselineCostUsd ?? 0) > (result.summary.costUsd ?? 0));

    const [row] = await db.select().from(gatewayRequests).where(eq(gatewayRequests.id, result.gatewayRequestId));
    assert.equal(row!.mode, "automatic");
    assert.equal(row!.baselineModel, "openai/gpt-4.1");
    assert.ok(Number(row!.realizedSavingsUsd) > 0);

    // Financial reconciliation: the billed usage event matches the gateway record to the decimal,
    // and realized savings are exactly baseline minus actual provider-priced cost.
    const [event] = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.idempotencyKey, `gateway:${result.gatewayRequestId}`));
    assert.ok(event);
    assert.equal(Number(event.costUsd), Number(row!.costUsd));
    assert.ok(event.pricingId, "usage event must reference the pricing row it was billed with");
    assert.equal(
      (event.costBreakdown as Record<string, unknown> | null)?.pricingVersion,
      row!.pricingVersion,
    );
    assert.ok(
      Math.abs(Number(row!.realizedSavingsUsd) - (Number(row!.baselineCostUsd) - Number(row!.costUsd))) < 1e-9,
    );

    // A provider that reports no usage yields an estimated cost but no realized savings.
    const estimated = mockFetch(() => mockResponse("gpt-4.1-mini", { usage: null }));
    const estimatedResult = await executeGatewayRequest(
      db,
      ctx,
      request({ model: "auto", tokenburn: { mode: "automatic", feature: "chat" } }),
      { fetchImpl: estimated.fetchImpl },
    );
    assert.equal(estimatedResult.kind, "response");
    if (estimatedResult.kind !== "response") return;
    assert.equal(estimatedResult.summary.usageSource, "estimated");
    assert.equal(estimatedResult.summary.realizedSavingsUsd, null);
    const estimatedMeta = estimatedResult.body.tokenburn as Record<string, unknown>;
    assert.equal(estimatedMeta.realizedSavingsUsd, null);
    assert.ok(estimatedResult.body.tokenburnEstimatedUsage);
    assert.equal(
      (estimatedResult.body.tokenburnEstimatedUsage as Record<string, unknown>).input_tokens,
      estimatedResult.selection.estimate.inputTokens,
    );
  });

  it("falls back to a permitted model when the provider rejects the request", async () => {
    const { orgId, ctx } = await setup();
    await connectProvider(orgId, "openai");
    const { fetchImpl, calls } = mockFetch((body) =>
      body.model === "gpt-4.1"
        ? new Response(JSON.stringify({ error: { message: "bad key" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          })
        : mockResponse(String(body.model)),
    );

    const result = await executeGatewayRequest(db, ctx, request(), { fetchImpl });
    assert.equal(result.kind, "response");
    if (result.kind !== "response") return;

    assert.deepEqual(
      calls.map((call) => call.body.model),
      ["gpt-4.1", "gpt-4.1-mini"],
    );
    assert.equal(result.selection.selected?.key, "openai/gpt-4.1");
    const meta = result.body.tokenburn as Record<string, unknown>;
    assert.equal(meta.selectedModel, "openai/gpt-4.1-mini");
    assert.equal(meta.fallbackUsed, true);
    assert.equal(result.headers["x-tokenburn-fallback"], "true");

    const [row] = await db.select().from(gatewayRequests).where(eq(gatewayRequests.id, result.gatewayRequestId));
    assert.equal(row!.status, "success");
    assert.equal(row!.selectedModel, "gpt-4.1-mini");
    assert.equal(row!.fallbackUsed, true);
    assert.deepEqual(row!.attemptedModels, ["openai/gpt-4.1", "openai/gpt-4.1-mini"]);
    assert.match(row!.fallbackReason ?? "", /Authentication failed/);
  });

  it("recommendations never call a provider or write usage", async () => {
    const { orgId, ctx } = await setup();
    await connectProvider(orgId, "openai");
    const { fetchImpl, calls } = mockFetch(() => mockResponse("unused"));

    const result = await executeGatewayRequest(db, ctx, request({ model: "recommend" }), { fetchImpl });
    assert.equal(result.kind, "recommendation");
    if (result.kind !== "recommendation") return;

    assert.equal(calls.length, 0);
    assert.equal(result.body.object, "tokenburn.recommendation");
    assert.match(String(result.body.note), /No provider call/);
    assert.ok(result.selection.selected);
    const rows = await db.select().from(gatewayRequests).where(eq(gatewayRequests.orgId, orgId));
    assert.equal(rows.length, 0);
    const events = await db.select().from(usageEvents).where(eq(usageEvents.orgId, orgId));
    assert.equal(events.length, 0);
  });

  it("blocks organization-restricted models before any provider call", async () => {
    const { orgId, ctx } = await setup({ blockedModels: ["gpt-4.1"] });
    await connectProvider(orgId, "openai");
    const { fetchImpl, calls } = mockFetch(() => mockResponse("x"));

    await assert.rejects(
      executeGatewayRequest(db, ctx, request(), { fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.status, 403);
        assert.equal(error.code, "model_blocked");
        return true;
      },
    );
    assert.equal(calls.length, 0);

    const rows = await db.select().from(gatewayRequests).where(eq(gatewayRequests.orgId, orgId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "error");
    assert.equal(rows[0]!.errorCode, "model_blocked");
  });

  it("streams OpenAI-compatible chunks and records usage after finalize", async () => {
    const { orgId, ctx } = await setup();
    await connectProvider(orgId, "openai");
    const sse = [
      `data: ${JSON.stringify({
        id: "chatcmpl-stream",
        object: "chat.completion.chunk",
        model: "gpt-4.1",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }],
      })}`,
      "",
      `data: ${JSON.stringify({
        id: "chatcmpl-stream",
        object: "chat.completion.chunk",
        model: "gpt-4.1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      })}`,
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    const { fetchImpl } = mockFetch(
      () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const result = await executeGatewayRequest(db, ctx, request(), { stream: true, fetchImpl });
    assert.equal(result.kind, "stream");
    if (result.kind !== "stream") return;

    const text = await new Response(result.stream).text();
    assert.match(text, /chat\.completion\.chunk/);
    assert.match(text, /\[DONE\]/);
    assert.equal(result.headers["x-tokenburn-streamed"], "true");

    await result.finalize();
    const [row] = await db.select().from(gatewayRequests).where(eq(gatewayRequests.id, result.gatewayRequestId));
    assert.equal(row!.status, "success");
    assert.equal(row!.streamed, true);
    assert.equal(row!.usageSource, "provider_reported");
    assert.equal(row!.inputTokens, 12);
    assert.equal(row!.outputTokens, 3);

    const events = await db.select().from(usageEvents).where(eq(usageEvents.orgId, orgId));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.inputTokens, 12);
    assert.equal(events[0]!.endpoint, "/v1/chat/completions");
  });

  it("opens the circuit after repeated availability failures and short-circuits the provider", async () => {
    resetCircuits();
    const { orgId, ctx } = await setup();
    await connectProvider(orgId, "openai");
    const { fetchImpl, calls } = mockFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "upstream down" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );

    // Each request exhausts both permitted models, so two requests reach the threshold.
    await assert.rejects(executeGatewayRequest(db, ctx, request(), { fetchImpl }));
    await assert.rejects(executeGatewayRequest(db, ctx, request(), { fetchImpl }));
    assert.equal(circuitSnapshot(`${orgId}:openai`)?.open, false, "circuit opens on the next failure");

    await assert.rejects(
      executeGatewayRequest(db, ctx, request(), { fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.code, "provider_circuit_open");
        assert.equal(error.status, 503);
        return true;
      },
    );
    assert.equal(circuitSnapshot(`${orgId}:openai`)?.open, true);

    const callsBefore = calls.length;
    await assert.rejects(
      executeGatewayRequest(db, ctx, request(), { fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.code, "provider_circuit_open");
        return true;
      },
    );
    assert.equal(calls.length, callsBefore, "an open circuit must not call the provider");
  });

  it("never falls back to a model outside the organization allow-list", async () => {
    resetCircuits();
    const { orgId, ctx } = await setup({ allowedModels: ["openai/gpt-4.1"] });
    await connectProvider(orgId, "openai");
    const { fetchImpl, calls } = mockFetch((body) =>
      body.model === "gpt-4.1"
        ? new Response(JSON.stringify({ error: { message: "bad key" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          })
        : mockResponse(String(body.model)),
    );

    await assert.rejects(
      executeGatewayRequest(db, ctx, request(), { fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.code, "invalid_credentials");
        return true;
      },
    );
    assert.deepEqual(
      calls.map((call) => call.body.model),
      ["gpt-4.1"],
      "the unapproved fallback model must never be called",
    );
  });

  it("checks hard budgets before every attempt, including fallbacks", async () => {
    resetCircuits();
    const { orgId, projectId, ctx } = await setup({ hardLimitsEnabled: true });
    await connectProvider(orgId, "openai");
    await db.insert(budgets).values({
      orgId,
      name: "Nearly exhausted cap",
      scope: "project",
      period: "monthly",
      projectId,
      limitUsd: "1.00",
      hardLimit: true,
    });
    await db.insert(usageEvents).values({
      orgId,
      projectId,
      feature: "chat",
      provider: "openai",
      model: "gpt-4.1",
      dedupeHash: "gov-gateway-limit-1",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: "0.999999",
      occurredAt: new Date(),
    });
    const { fetchImpl, calls } = mockFetch(() => mockResponse("x"));

    await assert.rejects(
      executeGatewayRequest(db, ctx, request({ max_tokens: 1000 }), { fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.code, "budget_exceeded");
        assert.equal(error.status, 422);
        return true;
      },
    );
    assert.equal(calls.length, 0, "governance must deny before any provider call");
  });
});
