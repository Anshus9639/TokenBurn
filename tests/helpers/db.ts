import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { AppDb } from "@/lib/db/client";
import {
  apiKeys,
  modelPricing,
  organizations,
  projects,
  type OrgSettings,
} from "@/lib/db/schema";
import type { ApiKeyContext } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";

export const DEFAULT_SETTINGS: OrgSettings = {
  timezone: "UTC",
  dataMode: "synthetic",
  allowedModels: [],
  blockedModels: [],
  requireApprovalForRouting: true,
  hardLimitsEnabled: true,
  fallbackModel: "openai/gpt-4.1-mini",
  webhookUrl: "",
};

export async function createTestDb() {
  const pglite = new PGlite();
  await pglite.waitReady;
  const db = drizzle(pglite, {}) as unknown as AppDb;
  await migrate(db as unknown as Parameters<typeof migrate>[0], {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  return { db, close: () => pglite.close() };
}

export async function createOrg(db: AppDb, settings: Partial<OrgSettings> = {}) {
  const [org] = await db
    .insert(organizations)
    .values({
      name: "Test Org",
      slug: `test-${crypto.randomUUID().slice(0, 8)}`,
      settings: { ...DEFAULT_SETTINGS, ...settings },
    })
    .returning({ id: organizations.id });
  return org!.id;
}

export async function createProject(db: AppDb, orgId: string, name = "Test Project") {
  const [project] = await db
    .insert(projects)
    .values({ orgId, name, slug: `proj-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: projects.id });
  return project!.id;
}

export async function createTestApiKey(db: AppDb, orgId: string, projectId: string, name = "Test key") {
  const [row] = await db
    .insert(apiKeys)
    .values({
      orgId,
      projectId,
      name,
      prefix: "tb_test_",
      lastFour: "0000",
      hash: sha256(`tb_test_${crypto.randomUUID()}`),
    })
    .returning({ id: apiKeys.id });
  return row!.id;
}

export async function addPricing(
  db: AppDb,
  input: {
    provider: string;
    model: string;
    inputPerM: number;
    cachedInputPerM?: number;
    outputPerM: number;
    cacheWritePerM?: number | null;
    version?: number;
    effectiveFrom?: Date;
    supersededAt?: Date | null;
    isActive?: boolean;
    displayName?: string;
  },
) {
  const [row] = await db
    .insert(modelPricing)
    .values({
      provider: input.provider,
      model: input.model,
      displayName: input.displayName ?? input.model,
      category: "mid",
      inputPerM: input.inputPerM.toFixed(4),
      cachedInputPerM: (input.cachedInputPerM ?? input.inputPerM).toFixed(4),
      outputPerM: input.outputPerM.toFixed(4),
      cacheWritePerM:
        input.cacheWritePerM === undefined || input.cacheWritePerM === null
          ? null
          : input.cacheWritePerM.toFixed(4),
      contextWindow: 128_000,
      maxOutput: 16_384,
      version: input.version ?? 1,
      effectiveFrom: input.effectiveFrom ?? new Date("2026-01-01T00:00:00Z"),
      supersededAt: input.supersededAt ?? null,
      isActive: input.isActive ?? true,
    })
    .returning({ id: modelPricing.id });
  return row!.id;
}

export function testCtx(orgId: string, projectId: string, overrides: Partial<ApiKeyContext> = {}): ApiKeyContext {
  return {
    orgId,
    projectId,
    projectSlug: "test-project",
    projectName: "Test Project",
    environment: "production",
    apiKeyId: `key-${orgId.slice(0, 8)}`,
    apiKeyName: "Test key",
    rateLimit: { ok: true, remaining: 299, resetAt: Date.now() + 60_000 },
    ...overrides,
  };
}
