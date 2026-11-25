import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { IngestionError } from "@/lib/ingest";
import { logEvent } from "@/lib/log";

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export function handleApiError(error: unknown) {
  if (error instanceof AuthError) {
    const status = error.code === "forbidden" ? 403 : error.code === "rate_limited" ? 429 : 401;
    return jsonError(status, error.code, error.message);
  }
  if (error instanceof IngestionError) {
    return jsonError(error.status, error.code, error.message, error.details);
  }
  logEvent("error", "api.unhandled_error", { error });
  return jsonError(500, "internal_error", "Unexpected server error");
}

export function rateHeaders(limit?: { remaining: number; resetAt: number }) {
  if (!limit) return undefined;
  return {
    "x-ratelimit-remaining": String(limit.remaining),
    "x-ratelimit-reset": new Date(limit.resetAt).toISOString(),
  };
}
