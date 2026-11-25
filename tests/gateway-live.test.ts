import test from "node:test";
import assert from "node:assert/strict";
import { completeChat, type GatewayTransportInput } from "@/lib/gateway/transport";
import type { ProviderId } from "@/lib/providers/types";
import type { GatewayChatRequest } from "@/lib/gateway/types";

/**
 * Real-provider smoke tests. They never run in CI: set TOKENBURN_LIVE_SMOKE=1 and provide
 * one or more provider keys to execute. Every other provider is skipped.
 */
const ENABLED = process.env.TOKENBURN_LIVE_SMOKE === "1";

const PROVIDERS: Array<{ provider: ProviderId; env: string; model: string }> = [
  { provider: "openai", env: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
  { provider: "anthropic", env: "ANTHROPIC_API_KEY", model: "claude-3-5-haiku" },
  { provider: "gemini", env: "GEMINI_API_KEY", model: "gemini-3.5-flash-lite" },
  { provider: "groq", env: "GROQ_API_KEY", model: "qwen/qwen3.8-27b" },
  { provider: "mistral", env: "MISTRAL_API_KEY", model: "mistral-small-latest" },
];

function smokeInput(provider: ProviderId, model: string, apiKey: string, overrides: Partial<GatewayTransportInput> = {}): GatewayTransportInput {
  const request: GatewayChatRequest = {
    messages: [{ role: "user", content: "Reply with the single word: pong" }],
    max_tokens: 16,
  };
  return {
    provider,
    model,
    apiKey,
    request,
    maxOutputTokens: 16,
    timeoutMs: 30_000,
    maxAttempts: 1,
    ...overrides,
  };
}

for (const entry of PROVIDERS) {
  const apiKey = process.env[entry.env];
  test(
    `live smoke · ${entry.provider} returns provider-reported usage`,
    { skip: !ENABLED || !apiKey ? `set TOKENBURN_LIVE_SMOKE=1 and ${entry.env} to run` : false },
    async () => {
      const completion = await completeChat(smokeInput(entry.provider, entry.model, apiKey!));
      assert.equal(completion.error, null, `provider error: ${completion.error?.message ?? ""}`);
      assert.equal(completion.status, 200);
      assert.ok(completion.content.trim().length > 0, "provider returned an empty completion");
      assert.ok(completion.usage, "provider did not return usage metadata");
      assert.ok(completion.usage.inputTokens > 0, "input tokens must be provider-reported");
      assert.ok(completion.usage.outputTokens > 0, "output tokens must be provider-reported");
    },
  );
}
