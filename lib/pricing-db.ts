import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import { modelPricing } from "@/lib/db/schema";
import type { PricingLike } from "@/lib/pricing";
import { getAdapter } from "@/lib/providers";
import { PRICING_CATALOG, type CatalogSeed } from "@/lib/pricing";

export type PricingRecord = PricingLike & {
  id: string;
  version: number;
  effectiveFrom: Date;
  source: string;
};

function numeric(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number(value);
}

export function toPricingRecord(row: typeof modelPricing.$inferSelect): PricingRecord {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    displayName: row.displayName,
    inputPerM: numeric(row.inputPerM),
    cachedInputPerM: numeric(row.cachedInputPerM),
    outputPerM: numeric(row.outputPerM),
    cacheWritePerM: row.cacheWritePerM === null ? null : numeric(row.cacheWritePerM),
    category: row.category,
    qualityScore: row.qualityScore,
    typicalLatencyMs: row.typicalLatencyMs,
    contextWindow: row.contextWindow,
    maxOutput: row.maxOutput,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    source: row.source,
  };
}

export async function resolvePricing(
  db: AppDb,
  provider: string,
  rawModel: string,
  at: Date,
): Promise<PricingRecord | null> {
  const adapter = getAdapter(provider);
  const candidates = new Set<string>([rawModel]);
  if (adapter) candidates.add(adapter.normalizeModel(rawModel));

  for (const model of candidates) {
    const rows = await db
      .select()
      .from(modelPricing)
      .where(
        and(
          eq(modelPricing.provider, provider),
          eq(modelPricing.model, model),
          lte(modelPricing.effectiveFrom, at),
          or(isNull(modelPricing.supersededAt), gt(modelPricing.supersededAt, at)),
        ),
      )
      .orderBy(desc(modelPricing.effectiveFrom), desc(modelPricing.version))
      .limit(1);
    if (rows[0]) return toPricingRecord(rows[0]);
  }
  return null;
}

export async function getActiveCatalog(db: AppDb, at = new Date()): Promise<PricingRecord[]> {
  const rows = await db
    .select()
    .from(modelPricing)
    .where(
      and(
        lte(modelPricing.effectiveFrom, at),
        or(isNull(modelPricing.supersededAt), gt(modelPricing.supersededAt, at)),
        eq(modelPricing.isActive, true),
      ),
    )
    .orderBy(asc(modelPricing.provider), desc(modelPricing.qualityScore));
  return rows.map(toPricingRecord);
}

export async function getPricingHistory(db: AppDb, provider?: string, model?: string) {
  const conditions = [];
  if (provider) conditions.push(eq(modelPricing.provider, provider));
  if (model) conditions.push(eq(modelPricing.model, model));
  return db
    .select()
    .from(modelPricing)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(modelPricing.effectiveFrom), asc(modelPricing.provider), asc(modelPricing.model));
}

/**
 * Backfills catalog entries that are missing from an already-seeded database (for example newly
 * supported providers). Existing rows are never updated, so historical pricing stays immutable.
 */
export async function ensureCatalogRows(db: AppDb, at = new Date()): Promise<number> {
  const existing = await db.select({ provider: modelPricing.provider, model: modelPricing.model }).from(modelPricing);
  const have = new Set(existing.map((row) => `${row.provider}/${row.model}`));
  const missing = PRICING_CATALOG.filter((seed) => !have.has(`${seed.provider}/${seed.model}`));
  if (missing.length === 0) return 0;
  await db
    .insert(modelPricing)
    .values(missing.map((seed) => catalogSeedToRow(seed, 1, at)))
    .onConflictDoNothing();
  return missing.length;
}

export function catalogSeedToRow(seed: CatalogSeed, version: number, effectiveFrom: Date) {
  return {
    provider: seed.provider,
    model: seed.model,
    displayName: seed.displayName,
    family: seed.family,
    category: seed.category,
    inputPerM: seed.inputPerM.toFixed(4),
    cachedInputPerM: seed.cachedInputPerM.toFixed(4),
    outputPerM: seed.outputPerM.toFixed(4),
    cacheWritePerM: seed.cacheWritePerM === null ? null : seed.cacheWritePerM.toFixed(4),
    contextWindow: seed.contextWindow,
    maxOutput: seed.maxOutput,
    qualityScore: seed.qualityScore,
    typicalLatencyMs: seed.typicalLatencyMs,
    version,
    effectiveFrom,
    source: "seed-catalog",
    notes: seed.notes ?? null,
    isActive: true,
  };
}
