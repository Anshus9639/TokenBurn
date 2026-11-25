import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { getActiveCatalog } from "@/lib/pricing-db";
import { handleApiError, rateHeaders } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await authenticateApiKey(request);
    const db = await getDb();
    const catalog = await getActiveCatalog(db);
    return NextResponse.json(
      {
        data: catalog.map((p) => ({
          provider: p.provider,
          model: p.model,
          key: `${p.provider}/${p.model}`,
          displayName: p.displayName,
          category: p.category,
          pricingPerMillion: {
            input: p.inputPerM,
            cachedInput: p.cachedInputPerM,
            output: p.outputPerM,
            cacheWrite: p.cacheWritePerM,
          },
          contextWindow: p.contextWindow,
          maxOutput: p.maxOutput,
          qualityScore: p.qualityScore,
          typicalLatencyMs: p.typicalLatencyMs,
          pricingVersion: p.version,
          effectiveFrom: p.effectiveFrom.toISOString(),
        })),
        count: catalog.length,
      },
      { headers: rateHeaders(ctx.rateLimit) },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
