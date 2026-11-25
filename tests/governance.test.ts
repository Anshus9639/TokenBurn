import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createTestDb, createOrg, createProject } from "./helpers/db";
import type { AppDb } from "@/lib/db/client";
import { budgets, routingHolds, usageEvents } from "@/lib/db/schema";
import { budgetSpend, checkRoutingAllowance } from "@/lib/governance";

describe("governance routing enforcement", () => {
  let db: AppDb;
  let close: () => Promise<void>;
  let seq = 0;

  const addBudget = async (
    orgId: string,
    projectId: string,
    input: {
      scope: "organization" | "project" | "feature";
      limitUsd: number;
      feature?: string | null;
      hardLimit?: boolean;
      projectId?: string | null;
    },
  ) => {
    const [row] = await db
      .insert(budgets)
      .values({
        orgId,
        name: `${input.scope}-${seq++}`,
        scope: input.scope,
        period: "monthly",
        projectId: input.scope === "organization" ? null : (input.projectId ?? projectId),
        feature: input.feature ?? null,
        limitUsd: input.limitUsd.toFixed(2),
        hardLimit: input.hardLimit ?? true,
        thresholds: [50, 75, 90, 100],
      })
      .returning({ id: budgets.id, name: budgets.name });
    return row!;
  };

  before(async () => {
    const ctx = await createTestDb();
    db = ctx.db;
    close = ctx.close;
  });

  after(async () => {
    await close();
  });

  it("denies models outside the allow-list and permits listed provider keys", async () => {
    const org = await createOrg(db, { allowedModels: ["openai/gpt-4.1"] });
    const project = await createProject(db, org);
    const blocked = await checkRoutingAllowance(db, org, project, "claude-sonnet-4", "anthropic");
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason ?? "", /approved model list/);
    const allowed = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai");
    assert.equal(allowed.allowed, true);
  });

  it("denies blocked models", async () => {
    const org = await createOrg(db, { blockedModels: ["gpt-4o"] });
    const project = await createProject(db, org);
    const decision = await checkRoutingAllowance(db, org, project, "gpt-4o", "openai");
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /blocked/);
  });

  it("enforces hard project budgets and reports remaining headroom", async () => {
    const org = await createOrg(db);
    const project = await createProject(db, org);
    await db.insert(budgets).values({
      orgId: org,
      name: "Project cap",
      scope: "project",
      period: "monthly",
      projectId: project,
      limitUsd: "10.00",
      hardLimit: true,
    });
    await db.insert(usageEvents).values({
      orgId: org,
      projectId: project,
      feature: "chat",
      provider: "openai",
      model: "gpt-4.1",
      dedupeHash: "gov-hard-1",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: "9.500000",
      occurredAt: new Date(),
    });

    const denied = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 1,
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.budget?.remainingUsd, 0.5);

    const allowed = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 0.4,
    });
    assert.equal(allowed.allowed, true);
    assert.ok(allowed.reservation?.holdIds.length);
  });

  it("reserves headroom so a second preflight cannot reuse it", async () => {
    const org = await createOrg(db);
    const project = await createProject(db, org);
    const budget = await addBudget(org, project, { scope: "project", limitUsd: 10, projectId: project });
    await db.insert(usageEvents).values({
      orgId: org,
      projectId: project,
      feature: "chat",
      provider: "openai",
      model: "gpt-4.1",
      dedupeHash: "gov-race-1",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: "9.000000",
      occurredAt: new Date(),
    });

    const first = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 0.6,
    });
    assert.equal(first.allowed, true);

    const second = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 0.6,
    });
    assert.equal(second.allowed, false);
    assert.match(second.reason ?? "", /Hard limit/);

    const holds = await db.select().from(routingHolds).where(eq(routingHolds.budgetId, budget.id));
    assert.equal(holds.length, 1);
    assert.equal(Number(holds[0]!.estimateUsd), 0.6);
  });

  it("serializes concurrent preflights so a reservation can only be spent once", async () => {
    const org = await createOrg(db);
    const project = await createProject(db, org);
    const budget = await addBudget(org, project, { scope: "project", limitUsd: 1, projectId: project });

    const [first, second] = await Promise.all([
      checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", { feature: "chat", estimatedCostUsd: 0.7 }),
      checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", { feature: "chat", estimatedCostUsd: 0.7 }),
    ]);
    assert.equal([first, second].filter((decision) => decision.allowed).length, 1);

    const holds = await db.select().from(routingHolds).where(eq(routingHolds.budgetId, budget.id));
    assert.equal(holds.length, 1);
    assert.equal(Number(holds[0]!.estimateUsd), 0.7);
  });

  it("ignores expired reservations", async () => {
    const org = await createOrg(db);
    const project = await createProject(db, org);
    const budget = await addBudget(org, project, { scope: "project", limitUsd: 5, projectId: project });
    await db.insert(routingHolds).values({
      orgId: org,
      projectId: project,
      budgetId: budget.id,
      estimateUsd: "4.000000",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const decision = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 2,
    });
    assert.equal(decision.allowed, true);
  });

  it("does not apply one feature's budget to another feature", async () => {
    const org = await createOrg(db);
    const project = await createProject(db, org);
    await addBudget(org, project, { scope: "feature", feature: "chat", limitUsd: 1, projectId: project });
    await db.insert(usageEvents).values({
      orgId: org,
      projectId: project,
      feature: "chat",
      provider: "openai",
      model: "gpt-4.1",
      dedupeHash: "gov-feature-1",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: "2.000000",
      occurredAt: new Date(),
    });

    const otherFeature = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", {
      feature: "search",
      estimatedCostUsd: 1,
    });
    assert.equal(otherFeature.allowed, true);

    const sameFeature = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 1,
    });
    assert.equal(sameFeature.allowed, false);
  });

  it("honors the organization hard-limit switch", async () => {
    const org = await createOrg(db, { hardLimitsEnabled: false });
    const project = await createProject(db, org);
    await addBudget(org, project, { scope: "project", limitUsd: 1, projectId: project });
    await db.insert(usageEvents).values({
      orgId: org,
      projectId: project,
      feature: "chat",
      provider: "openai",
      model: "gpt-4.1",
      dedupeHash: "gov-switch-1",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: "5.000000",
      occurredAt: new Date(),
    });
    const decision = await checkRoutingAllowance(db, org, project, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 1,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reservation, null);
  });

  it("never denies on soft budgets and keeps organizations isolated", async () => {
    const orgA = await createOrg(db);
    const projectA = await createProject(db, orgA);
    await addBudget(orgA, projectA, { scope: "project", limitUsd: 0.01, hardLimit: false, projectId: projectA });
    await db.insert(usageEvents).values({
      orgId: orgA,
      projectId: projectA,
      feature: "chat",
      provider: "openai",
      model: "gpt-4.1",
      dedupeHash: "gov-soft-1",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: "9.000000",
      occurredAt: new Date(),
    });
    const soft = await checkRoutingAllowance(db, orgA, projectA, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 1,
    });
    assert.equal(soft.allowed, true);

    const orgB = await createOrg(db);
    const projectB = await createProject(db, orgB);
    const isolated = await checkRoutingAllowance(db, orgB, projectB, "gpt-4.1", "openai", {
      feature: "chat",
      estimatedCostUsd: 100,
    });
    assert.equal(isolated.allowed, true);
  });

  it("counts only this budget's own spend in its period", async () => {
    const org = await createOrg(db);
    const project = await createProject(db, org);
    const budget = await addBudget(org, project, { scope: "project", limitUsd: 100, projectId: project });
    await db.insert(usageEvents).values({
      orgId: org,
      projectId: project,
      feature: "chat",
      provider: "openai",
      model: "gpt-4.1",
      dedupeHash: "gov-spend-1",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: "3.250000",
      occurredAt: new Date(),
    });
    const spent = await budgetSpend(db, org, { scope: "project", projectId: project, feature: null, period: "monthly" });
    assert.ok(Math.abs(spent - 3.25) < 1e-9);
    const rows = await db.select().from(budgets).where(and(eq(budgets.id, budget.id), eq(budgets.orgId, org)));
    assert.equal(rows.length, 1);
  });
});
