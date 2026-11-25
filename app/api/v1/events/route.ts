import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { authenticateApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { ingestEvent, IngestionError } from "@/lib/ingest";
import { handleApiError, jsonError, rateHeaders } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ctx = await authenticateApiKey(request);
    const db = await getDb();
    const raw = await request.json().catch(() => null);
    if (raw === null || typeof raw !== "object") {
      return jsonError(400, "invalid_json", "Request body must be a JSON object or { events: [...] }");
    }

    const isBatch = Array.isArray(raw) || Array.isArray((raw as { events?: unknown }).events);
    const items: unknown[] = Array.isArray(raw) ? raw : isBatch ? ((raw as { events: unknown[] }).events ?? []) : [];
    if (isBatch) {
      if (!items.length) return jsonError(422, "empty_batch", "events array must contain at least one event");
      if (items.length > 100) return jsonError(422, "batch_too_large", "Maximum 100 events per request");

      const results = [] as Array<Record<string, unknown>>;
      let accepted = 0;
      let duplicates = 0;
      let rejected = 0;
      for (const [index, item] of items.entries()) {
        try {
          const result = await ingestEvent(db, ctx, item);
          accepted++;
          if (result.duplicate) duplicates++;
          results.push({ index, ok: true, ...result });
        } catch (error) {
          rejected++;
          if (error instanceof IngestionError) {
            results.push({
              index,
              ok: false,
              error: { code: error.code, message: error.message, details: error.details },
            });
          } else {
            throw error;
          }
        }
      }
      return NextResponse.json(
        { data: results, accepted, duplicates, rejected },
        { status: rejected === items.length ? 422 : 200, headers: rateHeaders(ctx.rateLimit) },
      );
    }

    const result = await ingestEvent(db, ctx, raw);
    return NextResponse.json(
      { data: result },
      { status: result.duplicate ? 200 : 201, headers: rateHeaders(ctx.rateLimit) },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await authenticateApiKey(request);
    const db = await getDb();
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);
    const rows = await db
      .select({
        id: usageEvents.id,
        feature: usageEvents.feature,
        environment: usageEvents.environment,
        provider: usageEvents.provider,
        model: usageEvents.model,
        inputTokens: usageEvents.inputTokens,
        cachedInputTokens: usageEvents.cachedInputTokens,
        outputTokens: usageEvents.outputTokens,
        latencyMs: usageEvents.latencyMs,
        statusCode: usageEvents.statusCode,
        costUsd: usageEvents.costUsd,
        occurredAt: usageEvents.occurredAt,
      })
      .from(usageEvents)
      .where(and(eq(usageEvents.orgId, ctx.orgId), eq(usageEvents.projectId, ctx.projectId)))
      .orderBy(desc(usageEvents.occurredAt))
      .limit(limit);

    return NextResponse.json(
      {
        data: rows.map((r) => ({ ...r, costUsd: Number(r.costUsd) })),
        project: { id: ctx.projectId, name: ctx.projectName, slug: ctx.projectSlug },
      },
      { headers: rateHeaders(ctx.rateLimit) },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
