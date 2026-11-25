import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { computeCost, type PricingLike } from "@/lib/pricing";
import type { AppDb } from "@/lib/db/client";
import type { ApiKeyContext } from "@/lib/auth";
import { modelPricing, usageEvents } from "@/lib/db/schema";
import { resolvePricing } from "@/lib/pricing-db";
import { addPricing, createOrg, createProject, createTestApiKey, createTestDb, testCtx } from "./helpers/db";
import { ingestEvent } from "@/lib/ingest";

const gpt41: PricingLike = {
  provider: "openai",
  model: "gpt-4.1",
  displayName: "GPT-4.1",
  inputPerM: 2,
  cachedInputPerM: 0.5,
  outputPerM: 8,
  cacheWritePerM: null,
  category: "frontier",
  qualityScore: 92,
  typicalLatencyMs: 1400,
  contextWindow: 1_047_576,
  maxOutput: 32_768,
};

describe("computeCost", () => {
  it("bills uncached input, cached input and output separately", () => {
    const { costUsd, breakdown } = computeCost(gpt41, {
      inputTokens: 1_000_000,
      cachedInputTokens: 250_000,
      outputTokens: 100_000,
    });
    assert.equal(breakdown.inputUsd, 1.5);
    assert.equal(breakdown.cachedInputUsd, 0.125);
    assert.equal(breakdown.outputUsd, 0.8);
    assert.equal(breakdown.discountApplied, 0.375);
    assert.equal(costUsd, 2.425);
  });

  it("bills cache writes at 1.25x input when no explicit rate exists", () => {
    const { breakdown, costUsd } = computeCost(gpt41, {
      inputTokens: 0,
      cacheWriteTokens: 100_000,
      outputTokens: 0,
    });
    assert.equal(breakdown.cacheWriteUsd, 0.25);
    assert.equal(costUsd, 0.25);
  });

  it("prefers an explicit cache-write rate", () => {
    const anthropic: PricingLike = { ...gpt41, provider: "anthropic", cacheWritePerM: 3.75 };
    const { breakdown } = computeCost(anthropic, {
      inputTokens: 0,
      cacheWriteTokens: 1_000_000,
      outputTokens: 0,
    });
    assert.equal(breakdown.cacheWriteUsd, 3.75);
  });

  it("bills reasoning tokens at the output rate", () => {
    const { costUsd, breakdown } = computeCost(gpt41, {
      inputTokens: 0,
      outputTokens: 1_000_000,
      reasoningTokens: 1_000_000,
    });
    assert.equal(breakdown.outputUsd, 8);
    assert.equal(breakdown.reasoningUsd, 8);
    assert.equal(costUsd, 16);
  });

  it("clamps cached tokens to the total prompt tokens", () => {
    const { costUsd, breakdown } = computeCost(gpt41, {
      inputTokens: 1_000_000,
      cachedInputTokens: 5_000_000,
      outputTokens: 0,
    });
    assert.equal(breakdown.inputUsd, 0);
    assert.equal(breakdown.cachedInputUsd, 0.5);
    assert.equal(costUsd, 0.5);
  });

  it("clamps negative and missing token counts to zero", () => {
    const { costUsd } = computeCost(gpt41, {
      inputTokens: -10,
      cachedInputTokens: -4,
      outputTokens: 0,
      reasoningTokens: -1,
    });
    assert.equal(costUsd, 0);
  });

  it("rounds to six decimal places", () => {
    const odd: PricingLike = { ...gpt41, inputPerM: 3.3333, cachedInputPerM: 0 };
    const { costUsd } = computeCost(odd, { inputTokens: 1, outputTokens: 0 });
    assert.equal(costUsd, 0.000003);
  });
});

describe("versioned pricing and ingestion", () => {
  let db: AppDb;
  let close: () => Promise<void>;
  let orgId: string;
  let projectId: string;
  let ctx: ApiKeyContext;
  const t1 = new Date("2026-02-01T00:00:00Z");
  const t2 = new Date("2026-06-01T00:00:00Z");

  before(async () => {
    const setup = await createTestDb();
    db = setup.db;
    close = setup.close;
    orgId = await createOrg(db);
    projectId = await createProject(db, orgId);
    const apiKeyId = await createTestApiKey(db, orgId, projectId);
    ctx = testCtx(orgId, projectId, { apiKeyId });
    await addPricing(db, {
      provider: "openai",
      model: "gpt-4.1",
      inputPerM: 2,
      cachedInputPerM: 0.5,
      outputPerM: 8,
      version: 1,
      effectiveFrom: t1,
      supersededAt: t2,
      isActive: false,
    });
    await addPricing(db, {
      provider: "openai",
      model: "gpt-4.1",
      inputPerM: 3,
      cachedInputPerM: 0.75,
      outputPerM: 12,
      version: 2,
      effectiveFrom: t2,
      isActive: true,
    });
    await addPricing(db, {
      provider: "mistral",
      model: "mistral-small-latest",
      inputPerM: 0.1,
      cachedInputPerM: 0.1,
      outputPerM: 0.3,
      version: 1,
    });
  });

  after(async () => {
    await close();
  });

  it("resolves the price effective at the event time, not the current catalog", async () => {
    const old = await resolvePricing(db, "openai", "gpt-4.1", new Date("2026-03-01T00:00:00Z"));
    const current = await resolvePricing(db, "openai", "gpt-4.1", new Date("2026-07-01T00:00:00Z"));
    assert.equal(old?.version, 1);
    assert.equal(old?.inputPerM, 2);
    assert.equal(current?.version, 2);
    assert.equal(current?.inputPerM, 3);
  });

  it("keeps a historical event's stored cost unchanged after a new price version", async () => {
    const occurredAt = "2026-03-15T12:00:00.000Z";
    const first = await ingestEvent(db, ctx, {
      provider: "openai",
      model: "gpt-4.1",
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 10_000,
      occurredAt,
      idempotencyKey: "historical-1",
    });
    // 800k * 2 + 200k * 0.5 + 10k * 8 = 1.6 + 0.1 + 0.08
    assert.equal(first.costUsd, 1.78);
    assert.equal(first.pricingVersion, 1);

    const rows = await db.select().from(usageEvents).where(eq(usageEvents.id, first.id));
    assert.equal(rows[0]?.costUsd, "1.780000");
    assert.equal((rows[0]?.costBreakdown as { pricingVersion: number }).pricingVersion, 1);

    const recost = await computeCost(
      (await resolvePricing(db, "openai", "gpt-4.1", new Date(occurredAt)))!,
      { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 10_000 },
    );
    assert.equal(recost.costUsd, 1.78);
  });

  it("deduplicates retries by idempotency key within an organization", async () => {
    const payload = {
      provider: "openai",
      model: "gpt-4.1",
      inputTokens: 1000,
      outputTokens: 100,
      occurredAt: "2026-04-01T10:00:00.000Z",
      idempotencyKey: "retry-abc",
    };
    const first = await ingestEvent(db, ctx, payload);
    const second = await ingestEvent(db, ctx, payload);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.id, first.id);
    assert.equal(second.costUsd, first.costUsd);
  });

  it("does not let the same idempotency key collide across organizations", async () => {
    const otherOrg = await createOrg(db);
    const otherProject = await createProject(db, otherOrg);
    const otherKey = await createTestApiKey(db, otherOrg, otherProject);
    const payload = {
      provider: "openai",
      model: "gpt-4.1",
      inputTokens: 1000,
      outputTokens: 100,
      occurredAt: "2026-04-02T10:00:00.000Z",
      idempotencyKey: "retry-abc",
    };
    await ingestEvent(db, ctx, payload);
    const result = await ingestEvent(db, testCtx(otherOrg, otherProject, { apiKeyId: otherKey }), payload);
    assert.equal(result.duplicate, false);
  });

  it("rejects events without an effective price instead of guessing", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    await assert.rejects(
      ingestEvent(db, ctx, {
        provider: "anthropic",
        model: "claude-sonnet-4",
        inputTokens: 10,
        occurredAt: future,
      }),
      (error: { code?: string }) => error.code === "future_timestamp" || error.code === "pricing_missing",
    );
    await assert.rejects(
      ingestEvent(db, ctx, {
        provider: "openai",
        model: "gpt-4.1-nano",
        inputTokens: 10,
        occurredAt: "2026-04-03T10:00:00.000Z",
      }),
      (error: { code?: string }) => error.code === "pricing_missing",
    );
  });

  it("clamps cached input and records provenance", async () => {
    const result = await ingestEvent(db, ctx, {
      provider: "openai",
      model: "gpt-4.1",
      inputTokens: 1000,
      cachedInputTokens: 5000,
      outputTokens: 0,
      occurredAt: "2026-04-04T10:00:00.000Z",
      idempotencyKey: "clamp-1",
      usageSource: "estimated",
    });
    const rows = await db.select().from(usageEvents).where(eq(usageEvents.id, result.id));
    assert.equal(rows[0]?.cachedInputTokens, 1000);
    assert.equal(rows[0]?.usageSource, "estimated");
    assert.equal(rows[0]?.isSynthetic, false);
  });

  it("flags synthetic ingestion rows explicitly", async () => {
    const result = await ingestEvent(db, ctx, {
      provider: "openai",
      model: "gpt-4.1",
      inputTokens: 10,
      outputTokens: 1,
      occurredAt: "2026-04-05T10:00:00.000Z",
      idempotencyKey: "synthetic-1",
      usageSource: "synthetic",
    });
    const rows = await db.select().from(usageEvents).where(eq(usageEvents.id, result.id));
    assert.equal(rows[0]?.isSynthetic, true);
  });

  it("accepts Mistral events against the synced catalog model", async () => {
    const result = await ingestEvent(db, ctx, {
      provider: "mistral",
      model: "mistral-small-latest",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      occurredAt: "2026-04-06T10:00:00.000Z",
      idempotencyKey: "mistral-1",
    });
    assert.equal(result.provider, "mistral");
    assert.equal(result.costUsd, 0.4);
    const rows = await db.select().from(modelPricing).where(eq(modelPricing.provider, "mistral"));
    assert.equal(rows.length, 1);
  });
});
