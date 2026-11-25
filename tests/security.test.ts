import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import { apiKeys, usageEvents } from "@/lib/db/schema";
import { authenticateApiKey, can, AuthError } from "@/lib/auth";
import { getProjectDetail, getUsageData } from "@/lib/analytics";
import {
  encryptSecret,
  decryptSecret,
  generateApiKey,
  hashApiKey,
  hashPassword,
  sha256,
  verifyPassword,
} from "@/lib/crypto";
import { createOrg, createProject } from "./helpers/db";

// Analytics aggregates run through rawQuery, which shares the app's connection,
// so use an isolated on-disk PGlite directory just like the coach tests.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-security-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.TOKENBURN_SKIP_AUTOSEED = "1";

type AppDb = Awaited<ReturnType<typeof getDb>>;

const costBreakdown = {
  inputUsd: 0.002,
  outputUsd: 0.001,
  cachedInputUsd: 0,
  cacheWriteUsd: 0,
  reasoningUsd: 0,
  discountApplied: 0,
  pricingVersion: 1,
};

function usageRow(orgId: string, projectId: string, seq: number, occurredAt: Date, latencyMs: number) {
  return {
    orgId,
    projectId,
    feature: "chat",
    provider: "openai",
    model: "gpt-4.1",
    dedupeHash: `sec-${projectId}-${seq}`,
    promptHash: `prompt-${seq}`,
    inputTokens: 1_000,
    outputTokens: 200,
    latencyMs,
    costUsd: "0.003000",
    costBreakdown,
    occurredAt,
  };
}

describe("tenant isolation and security boundaries", () => {
  let db: AppDb;
  let orgA: string;
  let orgB: string;
  let projectA: string;
  let projectB: string;
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const to = new Date(now.getTime() + 60_000);

  before(async () => {
    db = await getDb();
    orgA = await createOrg(db, {});
    orgB = await createOrg(db, {});
    projectA = await createProject(db, orgA, "Alpha");
    projectB = await createProject(db, orgB, "Bravo");

    const rows = [];
    // 130 events in org A (100 exactly 5s apart), 5 in org B at the same feature name.
    for (let i = 0; i < 130; i++) {
      rows.push(usageRow(orgA, projectA, i, new Date(from.getTime() + i * 5_000), 100 * (i + 1)));
    }
    for (let i = 0; i < 5; i++) {
      rows.push(usageRow(orgB, projectB, i, new Date(from.getTime() + i * 5_000), 999));
    }
    // One event with no reported latency: it must not drag the percentiles to zero.
    rows.push(usageRow(orgA, projectA, 999, new Date(from.getTime() + 1), 0));
    await db.insert(usageEvents).values(rows);
  });

  after(async () => {
    // Release the shared app connection first; otherwise the test process never
    // exits when DATABASE_URL points at PostgreSQL.
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("never returns another organization's usage from the analytics query", async () => {
    const data = await getUsageData(db, orgA, { from, to, pageSize: 25, page: 1 });
    assert.equal(data.totalEvents, 131);
    assert.ok(data.events.every((e) => e.projectName === "Alpha"));
    assert.deepEqual(
      data.options.projects.map((p) => p.name),
      ["Alpha"],
    );
  });

  it("caps page size, paginates deterministically and keeps totals org-wide", async () => {
    const first = await getUsageData(db, orgA, { from, to, pageSize: 500, page: 1 });
    assert.equal(first.pageSize, 100);
    assert.equal(first.events.length, 100);
    assert.equal(first.totalEvents, 131);

    const second = await getUsageData(db, orgA, { from, to, pageSize: 100, page: 2 });
    assert.equal(second.events.length, 31);

    const ids = new Set([...first.events, ...second.events].map((e) => e.id));
    assert.equal(ids.size, 131, "pages must not overlap");
    for (let i = 1; i < first.events.length; i++) {
      assert.ok(
        first.events[i - 1]!.occurredAt >= first.events[i]!.occurredAt,
        "events must be newest first",
      );
    }
  });

  it("computes latency percentiles in SQL and ignores unreported latency", async () => {
    const data = await getUsageData(db, orgA, { from, to });
    // Latencies are exactly 100, 200, ... 13000 ms plus one 0 that is excluded.
    // percentile_cont interpolates, so the median of 130 evenly spaced values is 6550.
    assert.ok(Math.abs(data.totals.p50Latency - 6_550) < 1, `p50 was ${data.totals.p50Latency}`);
    assert.ok(data.totals.p95Latency > 12_000, `p95 was ${data.totals.p95Latency}`);
  });

  it("does not leak cross-org projects through a project filter", async () => {
    const data = await getUsageData(db, orgA, { from, to, projectId: projectB });
    assert.equal(data.totalEvents, 0);
    assert.equal(data.events.length, 0);
    assert.equal(data.totals.costUsd, 0);
  });

  it("refuses to load a project detail page for another org", async () => {
    const own = await getProjectDetail(db, orgA, projectA, from);
    assert.ok(own, "owner org can load its project");
    assert.equal(own!.project.id, projectA);

    const cross = await getProjectDetail(db, orgA, projectB, from);
    assert.equal(cross, null);
  });

  it("enforces the RBAC matrix for each role", () => {
    assert.equal(can("viewer", "view"), true);
    for (const action of ["ingest", "create_policy", "manage_keys", "ack_alerts", "manage_budgets", "approve", "manage_org"]) {
      assert.equal(can("viewer", action), false, `viewer must not ${action}`);
    }
    for (const action of ["ingest", "create_policy", "manage_keys", "ack_alerts", "view"]) {
      assert.equal(can("member", action), true, `member should ${action}`);
    }
    for (const action of ["manage_budgets", "manage_rules", "manage_providers", "manage_members", "approve"]) {
      assert.equal(can("member", action), false, `member must not ${action}`);
    }
    for (const action of ["manage_budgets", "manage_rules", "manage_providers", "manage_members", "approve"]) {
      assert.equal(can("admin", action), true, `admin should ${action}`);
    }
    assert.equal(can("admin", "manage_org"), false, "admin must not change the organization");
    assert.equal(can("owner", "manage_org"), true);
    assert.equal(can("owner", "not_an_action"), false);
  });

  it("rejects an API key whose project belongs to another organization", async () => {
    const { plaintext, hash } = generateApiKey("test");
    await db.insert(apiKeys).values({
      orgId: orgA,
      projectId: projectB,
      name: "Cross-org key",
      prefix: plaintext.slice(0, 11),
      lastFour: plaintext.slice(-4),
      hash,
    });
    await assert.rejects(
      authenticateApiKey(
        new Request("http://localhost/api/v1/route", { headers: { authorization: `Bearer ${plaintext}` } }),
      ),
      (error: unknown) => error instanceof AuthError && error.code === "invalid_project",
    );
  });

  it("authenticates a valid key to its own project and rejects revoked keys", async () => {
    const { plaintext, hash } = generateApiKey("live");
    const [row] = await db
      .insert(apiKeys)
      .values({
        orgId: orgA,
        projectId: projectA,
        name: "Valid key",
        prefix: plaintext.slice(0, 11),
        lastFour: plaintext.slice(-4),
        hash,
      })
      .returning({ id: apiKeys.id });

    const ctx = await authenticateApiKey(
      new Request("http://localhost/api/v1/route", { headers: { authorization: `Bearer ${plaintext}` } }),
    );
    assert.equal(ctx.orgId, orgA);
    assert.equal(ctx.projectId, projectA);
    assert.equal(ctx.projectName, "Alpha");

    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, row!.id));
    await assert.rejects(
      authenticateApiKey(
        new Request("http://localhost/api/v1/route", { headers: { authorization: `Bearer ${plaintext}` } }),
      ),
      (error: unknown) => error instanceof AuthError && error.code === "invalid_key",
    );
  });

  it("stores credentials decryptable but never in a recognizable form", () => {
    const secret = "sk-test-abcdef1234567890";
    const sealed = encryptSecret(secret);
    assert.ok(!sealed.includes(secret));
    assert.ok(!sealed.includes("abcdef1234567890"));
    assert.equal(decryptSecret(sealed), secret);
    assert.notEqual(encryptSecret(secret), sealed, "each encryption must use a fresh IV");
  });

  it("hashes passwords with scrypt and rejects the wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.match(stored, /^scrypt\$\d+\$/);
    assert.ok(!stored.includes("correct horse"));
    assert.equal(verifyPassword("correct horse battery staple", stored), true);
    assert.equal(verifyPassword("wrong password", stored), false);
    assert.equal(verifyPassword("anything", "garbage"), false);
  });

  it("stores API keys only as hashes", () => {
    const { plaintext, hash } = generateApiKey("live");
    assert.equal(hash, sha256(plaintext));
    assert.equal(hashApiKey(plaintext), hash);
    assert.equal(hashApiKey(` ${plaintext} `), hash, "surrounding whitespace is ignored");
    assert.notEqual(hash, plaintext);
    assert.ok(plaintext.startsWith("tb_live_"));
  });

  it("scopes API key usage to the key's own organization in the database", async () => {
    const rows = await db
      .select({ orgId: apiKeys.orgId, projectId: apiKeys.projectId })
      .from(apiKeys)
      .where(and(eq(apiKeys.orgId, orgA), eq(apiKeys.projectId, projectA)));
    assert.equal(rows.length, 1);
    const foreign = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.orgId, orgB), eq(apiKeys.projectId, projectA)));
    assert.equal(foreign.length, 0);
  });
});
