import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import { createOrg, createProject } from "./helpers/db";
import { refreshRecommendations } from "@/lib/coach";
import { usageEvents, recommendations } from "@/lib/db/schema";

// The coach reads aggregates through rawQuery, which shares the app's connection.
// Point the app at an isolated on-disk PGlite directory so those queries and the
// injected Drizzle handle see the same data.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-coach-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.TOKENBURN_SKIP_AUTOSEED = "1";

type AppDb = Awaited<ReturnType<typeof getDb>>;

const STRUCTURED_KEYS = [
  "problem",
  "action",
  "savingsBasis",
  "benchmarkRequired",
  "qualityImpact",
  "latencyImpact",
  "validationProcedure",
  "implementationSteps",
] as const;

describe("coach recommendation portfolio", () => {
  let db: AppDb;
  let orgId: string;
  let projectId: string;
  const dayMs = 86_400_000;

  before(async () => {
    db = await getDb();
    orgId = await createOrg(db);
    projectId = await createProject(db, orgId, "Coach Project");
    // getDb() backfills the active pricing catalog, so gpt-4.1 pricing already exists.

    const now = Date.now();
    let seq = 0;
    const push = async (occurredAt: Date, inputTokens: number) => {
      const outputTokens = 300;
      const inputUsd = (inputTokens / 1e6) * 2;
      const outputUsd = (outputTokens / 1e6) * 8;
      await db.insert(usageEvents).values({
        orgId,
        projectId,
        feature: "chat",
        provider: "openai",
        model: "gpt-4.1",
        dedupeHash: `coach-${seq++}`,
        promptHash: `prompt-${seq % 12}`,
        inputTokens,
        outputTokens,
        costUsd: (inputUsd + outputUsd).toFixed(6),
        costBreakdown: {
          inputUsd,
          outputUsd,
          cachedInputUsd: 0,
          cacheWriteUsd: 0,
          reasoningUsd: 0,
          discountApplied: 0,
          pricingVersion: 1,
        },
        occurredAt,
        usageSource: "provider_reported",
      });
    };

    // 20 days of steady traffic with a modest day-to-day variance so the token
    // baseline has a non-zero standard deviation.
    for (let day = 20; day >= 1; day--) {
      const at = new Date(now - day * dayMs);
      const input = day % 2 === 0 ? 20_000 : 21_500;
      for (let i = 0; i < 30; i++) {
        await push(new Date(at.getTime() + i * 60_000), input);
      }
    }
    // A token spike inside the last three days: same request count, 3x context.
    const spikeDay = new Date(now - 2 * dayMs);
    for (let i = 0; i < 30; i++) {
      await push(new Date(spikeDay.getTime() + i * 60_000), 65_000);
    }
  });

  after(async () => {
    // Release the shared app connection first; otherwise the test process never
    // exits when DATABASE_URL points at PostgreSQL.
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("emits the full evidence contract on every recommendation", async () => {
    await refreshRecommendations(db, orgId, true);
    const rows = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
    assert.ok(rows.length > 0, "expected recommendations");

    for (const row of rows) {
      const ev = row.evidence as Record<string, unknown>;
      for (const key of STRUCTURED_KEYS) {
        assert.ok(key in ev, `${row.kind} ${row.fingerprint} is missing ${key}`);
      }
      assert.equal(typeof ev.problem, "string");
      assert.equal(typeof ev.action, "string");
      assert.equal(typeof ev.savingsBasis, "string");
      assert.equal(typeof ev.benchmarkRequired, "boolean");
      assert.ok(Array.isArray(ev.validationProcedure) && ev.validationProcedure.length >= 3);
      assert.ok(Array.isArray(ev.implementationSteps) && ev.implementationSteps.length >= 3);
      const quality = ev.qualityImpact as { level?: string; detail?: string };
      const latency = ev.latencyImpact as { direction?: string; detail?: string };
      assert.ok(["none", "low", "medium", "high"].includes(quality.level ?? ""), `${row.kind} quality level`);
      assert.ok(["decrease", "increase", "neutral", "unknown"].includes(latency.direction ?? ""), `${row.kind} latency`);
      assert.ok((quality.detail ?? "").length > 10, `${row.kind} quality detail`);
      assert.ok((latency.detail ?? "").length > 10, `${row.kind} latency detail`);
      assert.ok(row.measurement === "measured" || row.measurement === "estimated");
    }
  });

  it("detects an input-token spike separately from spend", async () => {
    const rows = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
    const tokenAnomaly = rows.find((r) => r.kind === "token_anomaly");
    assert.ok(tokenAnomaly, "expected a token anomaly");
    const ev = tokenAnomaly!.evidence as {
      zScore?: number;
      avgInputTokens?: number;
      baselineAvgInputTokens?: number;
      excessTokens?: number;
    };
    assert.ok((ev.zScore ?? 0) >= 2.5);
    assert.ok((ev.avgInputTokens ?? 0) > (ev.baselineAvgInputTokens ?? 0) * 1.4);
    assert.ok((ev.excessTokens ?? 0) > 0);
    assert.equal(tokenAnomaly!.measurement, "measured");
  });

  it("keeps one counted lever per feature and lists overlaps as uncounted", async () => {
    const rows = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
    const primaries = rows.filter((r) => r.kind !== "anomaly" && r.kind !== "token_anomaly");
    const forFeature = primaries.filter((r) => r.feature === "chat");
    assert.equal(forFeature.length, 1, "expected exactly one counted lever for the feature");

    const ev = forFeature[0]!.evidence as {
      companionOpportunities?: Array<{ counted?: boolean; estimatedMonthlySavingsUsd?: number }>;
    };
    assert.ok((ev.companionOpportunities ?? []).length > 0, "expected companion opportunities");
    for (const companion of ev.companionOpportunities ?? []) {
      assert.equal(companion.counted, false);
      assert.ok((companion.estimatedMonthlySavingsUsd ?? 0) > 0);
    }
  });

  it("rewrites stale evidence on rows created before the structured contract", async () => {
    const [existing] = await db
      .select()
      .from(recommendations)
      .where(eq(recommendations.orgId, orgId))
      .limit(1);
    assert.ok(existing);
    await db
      .update(recommendations)
      .set({ evidence: { requests: 1 }, status: "new" })
      .where(eq(recommendations.id, existing!.id));
    await refreshRecommendations(db, orgId, true);
    const [updated] = await db.select().from(recommendations).where(eq(recommendations.id, existing!.id));
    const ev = updated!.evidence as Record<string, unknown>;
    assert.equal(typeof ev.problem, "string");
    assert.ok("implementationSteps" in ev);
  });

  it("retires stale open findings but keeps decided history", async () => {
    await db.insert(recommendations).values({
      orgId,
      fingerprint: "stale:no-longer-detected",
      kind: "context_compression",
      scope: "feature",
      projectId,
      feature: "chat",
      title: "Stale finding",
      summary: "No longer supported by the current analysis.",
      rationale: "Test fixture.",
      evidence: {},
      estimatedMonthlySavingsUsd: "999.00",
      confidence: "high",
      measurement: "estimated",
      status: "new",
    });
    await db.insert(recommendations).values({
      orgId,
      fingerprint: "stale:accepted-decision",
      kind: "caching",
      scope: "feature",
      projectId,
      feature: "chat",
      title: "Accepted finding",
      summary: "Decision history should survive refreshes.",
      rationale: "Test fixture.",
      evidence: {},
      estimatedMonthlySavingsUsd: "10.00",
      confidence: "medium",
      measurement: "estimated",
      status: "accepted",
    });

    await refreshRecommendations(db, orgId, true);

    const rows = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
    assert.equal(rows.some((r) => r.fingerprint === "stale:no-longer-detected"), false);
    assert.equal(rows.some((r) => r.fingerprint === "stale:accepted-decision"), true);
    assert.equal(rows.filter((r) => r.status === "new" && r.feature === "chat" && r.kind !== "anomaly" && r.kind !== "token_anomaly").length, 1);
  });

  it("refreshing again updates rather than duplicating findings", async () => {
    const before = await db.select({ id: recommendations.id }).from(recommendations).where(eq(recommendations.orgId, orgId));
    await refreshRecommendations(db, orgId, true);
    const after = await db.select({ id: recommendations.id }).from(recommendations).where(eq(recommendations.orgId, orgId));
    assert.equal(after.length, before.length);
  });
});
