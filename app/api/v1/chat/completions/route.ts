import { after, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { handleApiError, jsonError } from "@/lib/api-response";
import { executeGatewayRequest, GatewayError, withGatewayHeaders } from "@/lib/gateway/orchestrate";
import { gatewayRequestSchema } from "@/lib/gateway/schema";
import type { GatewayChatRequest } from "@/lib/gateway/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function gatewayErrorResponse(error: GatewayError) {
  const headers: Record<string, string> = {};
  if (error.requestId) headers["x-tokenburn-request-id"] = error.requestId;
  return NextResponse.json(
    {
      error: {
        message: error.message,
        type: error.status === 429 ? "rate_limit_error" : error.status >= 500 ? "provider_error" : "invalid_request_error",
        code: error.code,
        param: null,
        details: error.details ?? null,
        request_id: error.requestId ?? null,
      },
    },
    { status: error.status, headers },
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await authenticateApiKey(request);
    const db = await getDb();
    const raw: unknown = await request.json().catch(() => null);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return jsonError(400, "invalid_json", "Request body must be a JSON object.");
    }
    const parsed = gatewayRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(422, "validation_error", "Invalid chat completion request", parsed.error.flatten());
    }

    const body = withGatewayHeaders(parsed.data as GatewayChatRequest, request.headers);
    const streamed = body.stream === true;
    const result = await executeGatewayRequest(db, ctx, body, { stream: streamed });

    if (result.kind === "recommendation") {
      return NextResponse.json(result.body, { headers: result.headers });
    }
    if (result.kind === "stream") {
      // Finalize after the response is handed to the client so usage ingestion and the
      // gateway record are updated even if the consumer disconnects mid-stream.
      after(async () => {
        await result.finalize();
        if (result.background) await result.background;
      });
      return new Response(result.stream, { headers: result.headers });
    }
    if (result.background) {
      after(async () => {
        await result.background;
      });
    }
    return NextResponse.json(result.body, { headers: result.headers });
  } catch (error) {
    if (error instanceof GatewayError) return gatewayErrorResponse(error);
    return handleApiError(error);
  }
}
