import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import {
  budgets,
  organizations,
  providers,
  routingHolds,
  routingPolicies,
  type OrgSettings,
} from "@/lib/db/schema";
import { budgetSpend } from "@/lib/governance";
import { getActiveCatalog, type PricingRecord } from "@/lib/pricing-db";
import { decryptSecret } from "@/lib/crypto";
import { withEnvProviderKeys } from "@/lib/providers/env-keys";
import type { ApiKeyContext } from "@/lib/auth";

export type ActivePolicy = typeof routingPolicies.$inferSelect;

export type GatewayContext = {
  settings: OrgSettings;
  catalog: PricingRecord[];
  policy: ActivePolicy | null;
  credentials: Map<string, string>;
  availableProviders: string[];
  budgetRemainingUsd: number | null;
  feature: string | null;
  environment: string;
};

export function sanitizeFeature(value: string | null | undefined): string | null {
  const cleaned = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || null;
}

function budgetApplies(
  budget: { scope: string; projectId: string | null; feature: string | null },
  projectId: string,
  feature: string | null,
): boolean {
  if (budget.scope === "organization") return true;
  if (budget.projectId !== projectId) return false;
  if (budget.scope === "project") return true;
  return budget.scope === "feature" && !!feature && budget.feature === feature;
}

/**
 * Remaining hard-budget headroom shared across applicable budgets. Returns null when the
 * organization has hard limits switched off or no hard budget applies to this feature.
 */
export async function hardBudgetHeadroom(
  db: AppDb,
  orgId: string,
  projectId: string,
  feature: string | null,
  settings: OrgSettings,
): Promise<number | null> {
  if (settings.hardLimitsEnabled === false) return null;
  const rows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.orgId, orgId), eq(budgets.isActive, true), eq(budgets.hardLimit, true)));
  const now = new Date();
  let remaining: number | null = null;
  for (const budget of rows) {
    const limitUsd = Number(budget.limitUsd);
    if (limitUsd <= 0) continue;
    if (!budgetApplies(budget, projectId, feature)) continue;
    const spentUsd = await budgetSpend(
      db,
      orgId,
      { scope: budget.scope, projectId: budget.projectId, feature: budget.feature, period: budget.period },
      now,
    );
    const held = await db
      .select({ total: sql<string>`coalesce(sum(${routingHolds.estimateUsd}), 0)` })
      .from(routingHolds)
      .where(and(eq(routingHolds.budgetId, budget.id), gt(routingHolds.expiresAt, now)));
    const headroom = limitUsd - spentUsd - Number(held[0]?.total ?? 0);
    remaining = remaining === null ? headroom : Math.min(remaining, headroom);
  }
  return remaining === null ? null : Math.round(remaining * 1_000_000) / 1_000_000;
}

export async function loadGatewayContext(
  db: AppDb,
  ctx: ApiKeyContext,
  opts: { feature?: string | null; environment?: string | null } = {},
): Promise<GatewayContext> {
  const feature = sanitizeFeature(opts.feature);
  const environment = (opts.environment ?? ctx.environment ?? "production").slice(0, 40);

  const orgRows = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, ctx.orgId))
    .limit(1);
  const settings = (orgRows[0]?.settings ?? {}) as OrgSettings;

  const policies = await db
    .select()
    .from(routingPolicies)
    .where(
      and(
        eq(routingPolicies.orgId, ctx.orgId),
        eq(routingPolicies.projectId, ctx.projectId),
        eq(routingPolicies.status, "active"),
        feature
          ? or(eq(routingPolicies.feature, feature), isNull(routingPolicies.feature))
          : isNull(routingPolicies.feature),
        or(eq(routingPolicies.environment, environment), eq(routingPolicies.environment, "production")),
      ),
    )
    .orderBy(desc(routingPolicies.updatedAt))
    .limit(1);
  const policy = policies[0] ?? null;

  const providerRows = await db
    .select({ provider: providers.provider, credentialsEnc: providers.credentialsEnc })
    .from(providers)
    .where(eq(providers.orgId, ctx.orgId));
  const credentials = new Map<string, string>();
  for (const row of providerRows) {
    if (!row.credentialsEnc) continue;
    try {
      credentials.set(row.provider, decryptSecret(row.credentialsEnc));
    } catch {
      // A credential that cannot be decrypted is treated as unavailable rather than failing
      // every request: the operator can re-save it from Settings.
    }
  }
  withEnvProviderKeys(credentials);

  const catalog = await getActiveCatalog(db);
  const budgetRemainingUsd = await hardBudgetHeadroom(db, ctx.orgId, ctx.projectId, feature, settings);

  return {
    settings,
    catalog,
    policy,
    credentials,
    availableProviders: [...credentials.keys()],
    budgetRemainingUsd,
    feature,
    environment,
  };
}
