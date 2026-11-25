import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, getDb, type AppDb } from "@/lib/db/client";
import { apiKeys, budgets, organizations, projects, type OrgSettings } from "@/lib/db/schema";
import { checkRoutingAllowance } from "@/lib/governance";
import { ingestEvent } from "@/lib/ingest";
import type { ApiKeyContext } from "@/lib/auth";

/**
 * Exercises hard-budget reservations against a real PostgreSQL instance: the
 * advisory-lock transaction, held headroom and spend accounting are otherwise
 * only covered by tests that run on PGlite.
 *
 * usage: DATABASE_URL=postgres://... npx tsx scripts/pg-check-governance.ts
 */

const settings = (): OrgSettings => ({
  timezone: "UTC",
  dataMode: "synthetic",
  allowedModels: [],
  blockedModels: [],
  requireApprovalForRouting: true,
  hardLimitsEnabled: true,
  fallbackModel: "openai/gpt-4.1-mini",
  webhookUrl: "",
});

type Fixture = { orgId: string; projectId: string; ctx: ApiKeyContext };

async function seed(db: AppDb, limitUsd: string): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organizations)
    .values({ name: `PG governance ${suffix}`, slug: `pg-governance-${suffix}`, settings: settings() })
    .returning({ id: organizations.id });
  const [project] = await db
    .insert(projects)
    .values({ orgId: org!.id, name: "PG governance", slug: "pg-governance" })
    .returning({ id: projects.id });
  // usage_events.api_key_id is a foreign key, so the context needs a real key row.
  const keyId = `key-${suffix}`;
  await db.insert(apiKeys).values({
    id: keyId,
    orgId: org!.id,
    projectId: project!.id,
    name: "PG governance check",
    prefix: "tb_pg",
    lastFour: "0000",
    hash: `pg-governance-${suffix}`,
  });
  await db.insert(budgets).values({
    orgId: org!.id,
    name: "Hard daily",
    scope: "project",
    projectId: project!.id,
    period: "daily",
    limitUsd,
    hardLimit: true,
    isActive: true,
  });
  return {
    orgId: org!.id,
    projectId: project!.id,
    ctx: {
      orgId: org!.id,
      projectId: project!.id,
      projectSlug: "pg-governance",
      projectName: "PG governance",
      environment: "production",
      apiKeyId: `key-${suffix}`,
      apiKeyName: "pg-check",
      rateLimit: { ok: true, remaining: 1, resetAt: Date.now() + 60_000 },
    },
  };
}

const check = (db: AppDb, fixture: Fixture, estimatedCostUsd: number, reserve = true) =>
  checkRoutingAllowance(db, fixture.orgId, fixture.projectId, "gpt-4.1-mini", "openai", {
    estimatedCostUsd,
    reserve,
  });

async function main() {
  const db = await getDb();
  const created: string[] = [];
  try {
    // 1. Held headroom: reservations reduce the amount a second preflight can see.
    const reserved = await seed(db, "1.00");
    created.push(reserved.orgId);
    assert.equal((await check(db, reserved, 0.6)).allowed, true, "first 0.60 request should pass");
    assert.equal((await check(db, reserved, 0.6)).allowed, false, "second 0.60 request must be denied");
    assert.equal((await check(db, reserved, 0.3)).allowed, true, "0.30 fits in the remaining 0.40");
    assert.equal((await check(db, reserved, 0.2)).allowed, false, "0.20 no longer fits");
    console.log(JSON.stringify({ case: "reservation_headroom", ok: true }));

    // 2. Concurrent preflights are serialized by the advisory lock: only one wins.
    const concurrent = await seed(db, "1.00");
    created.push(concurrent.orgId);
    const [a, b] = await Promise.all([check(db, concurrent, 0.6), check(db, concurrent, 0.6)]);
    assert.equal([a.allowed, b.allowed].filter(Boolean).length, 1, "exactly one concurrent preflight should pass");
    console.log(JSON.stringify({ case: "advisory_lock", ok: true, decisions: [a.allowed, b.allowed] }));

    // 3. Recorded spend counts against the budget for later requests.
    const spent = await seed(db, "0.01");
    created.push(spent.orgId);
    const ingested = await ingestEvent(db, spent.ctx, {
      provider: "openai",
      model: "gpt-4.1-mini",
      inputTokens: 5000,
      outputTokens: 1000,
      feature: "pg-governance",
    });
    assert.equal(ingested.costUsd.toFixed(6), "0.003600", "5000 in x $0.40/M + 1000 out x $1.60/M");
    // Reserving checks consider recorded spend plus the new estimate. A
    // non-reserving peek only asks whether the budget is already exhausted.
    const denied = await check(db, spent, 0.008);
    assert.equal(denied.allowed, false, "spent 0.0036 + estimate 0.008 exceeds the 0.01 budget");
    assert.ok(denied.budget && Math.abs(denied.budget.spentUsd - 0.0036) < 1e-9, "decision reports recorded spend");
    const allowed = await check(db, spent, 0.005);
    assert.equal(allowed.allowed, true, "0.0036 + 0.005 fits");
    assert.ok(allowed.reservation && allowed.reservation.holdIds.length === 1, "a hold is placed for the fitting request");
    console.log(JSON.stringify({ case: "spend_accounting", ok: true, spentUsd: denied.budget?.spentUsd }));
  } finally {
    for (const orgId of created) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await closeDb();
  }
  console.log(JSON.stringify({ step: "governance.pg", ok: true }));
}

main().catch((error) => {
  console.error("[pg-governance] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
