import { NextResponse } from "next/server";
import { rawQuery } from "@/lib/db/client";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const result = await rawQuery<{ ok: number; events: string; last_event: string | null }>(
      `select 1 as ok,
              (select count(*)::text from usage_events) as events,
              (select max(occurred_at)::text from usage_events) as last_event`,
    );
    const row = result.rows[0];
    return NextResponse.json({
      status: "ok",
      service: "tokenburn",
      version: process.env.npm_package_version ?? "0.1.0",
      database: "reachable",
      usageEvents: Number(row?.events ?? 0),
      lastEventAt: row?.last_event ?? null,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logEvent("error", "health.database_check_failed", { error, latencyMs: Date.now() - started });
    return NextResponse.json(
      { status: "degraded", database: "unreachable", latencyMs: Date.now() - started },
      { status: 503 },
    );
  }
}
