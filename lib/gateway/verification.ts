import type { AppDb } from "@/lib/db/client";
import { computeCost } from "@/lib/pricing";
import { resolvePricing } from "@/lib/pricing-db";
import { getAdapter } from "@/lib/providers";
import type { NormalizedUsage, ProviderId } from "@/lib/providers/types";
import { completeChat, GatewayTransportError } from "./transport";

/** Cheapest first; every candidate exists in the seeded pricing catalog. */
const VERIFY_MODELS: Record<ProviderId, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"],
  anthropic: ["claude-3-5-haiku", "claude-sonnet-4"],
  gemini: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  groq: ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"],
  mistral: ["mistral-small-latest", "mistral-large-latest"],
};

export type VerificationAttempt = {
  model: string;
  status: number;
  code: string | null;
};

export type ProviderVerification = {
  ok: boolean;
  provider: ProviderId;
  model: string | null;
  status: number;
  latencyMs: number;
  usage: NormalizedUsage | null;
  costUsd: number | null;
  pricingId: string | null;
  pricingVersion: number | null;
  attempts: VerificationAttempt[];
  message: string;
  requestId: string | null;
};

/**
 * Runs one minimal real completion per candidate model until the provider accepts one.
 * Model-level rejections (retired ids) advance to the next candidate; authentication,
 * rate-limit, availability and network failures stop immediately because another model
 * cannot fix them. No credential value is read back into the result.
 */
export async function verifyProviderCompletion(
  db: AppDb,
  provider: ProviderId,
  apiKey: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: Date } = {},
): Promise<ProviderVerification> {
  const adapter = getAdapter(provider);
  const attempts: VerificationAttempt[] = [];
  const models = VERIFY_MODELS[provider] ?? [];

  for (const model of models) {
    try {
      const completion = await completeChat({
        provider,
        model,
        apiKey,
        request: { messages: [{ role: "user", content: "Reply with the single word: pong" }], max_tokens: 16 },
        maxOutputTokens: 16,
        timeoutMs: options.timeoutMs ?? 30_000,
        maxAttempts: 1,
        fetchImpl: options.fetchImpl,
      });
      attempts.push({ model, status: completion.status, code: null });

      if (!completion.usage || completion.usage.inputTokens + completion.usage.outputTokens <= 0) {
        return {
          ok: false,
          provider,
          model,
          status: completion.status,
          latencyMs: completion.latencyMs,
          usage: completion.usage,
          costUsd: null,
          pricingId: null,
          pricingVersion: null,
          attempts,
          message: `${adapter?.label ?? provider} accepted the request but reported no token usage, so it cannot be verified for billing.`,
          requestId: completion.providerRequestId,
        };
      }

      const usage = { ...completion.usage, model };
      const pricing = await resolvePricing(db, provider, model, options.now ?? new Date());
      const cost = pricing ? computeCost(pricing, usage) : null;

      return {
        ok: true,
        provider,
        model,
        status: completion.status,
        latencyMs: completion.latencyMs,
        usage,
        costUsd: cost?.costUsd ?? null,
        pricingId: pricing?.id ?? null,
        pricingVersion: pricing?.version ?? null,
        attempts,
        message: pricing
          ? `${adapter?.label ?? provider} verified with a real completion: ${usage.inputTokens} in / ${usage.outputTokens} out tokens in ${completion.latencyMs}ms, $${cost!.costUsd.toFixed(6)} at pricing v${pricing.version}.`
          : `${adapter?.label ?? provider} verified with a real completion, but ${model} has no active catalog price, so no server cost could be computed.`,
        requestId: completion.providerRequestId,
      };
    } catch (error) {
      if (!(error instanceof GatewayTransportError)) throw error;
      attempts.push({ model, status: error.status, code: error.info.code });
      const modelRejected = error.info.code === "model_not_found" || error.info.code === "provider_invalid_request";
      if (modelRejected && model !== models[models.length - 1]) continue;

      return {
        ok: false,
        provider,
        model,
        status: error.status,
        latencyMs: 0,
        usage: null,
        costUsd: null,
        pricingId: null,
        pricingVersion: null,
        attempts,
        message: error.info.message.slice(0, 300),
        requestId: error.providerRequestId,
      };
    }
  }

  return {
    ok: false,
    provider,
    model: null,
    status: 0,
    latencyMs: 0,
    usage: null,
    costUsd: null,
    pricingId: null,
    pricingVersion: null,
    attempts,
    message: `No verification model is configured for ${provider}.`,
    requestId: null,
  };
}
