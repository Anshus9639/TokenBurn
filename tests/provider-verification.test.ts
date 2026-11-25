import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { closeDb, getDb } from "@/lib/db/client";
import { verifyProviderCompletion } from "@/lib/gateway/verification";
import { envProviderKey, withEnvProviderKeys } from "@/lib/providers/env-keys";

function completionResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-verify-test",
      object: "chat.completion",
      model: "gpt-4.1-mini",
      choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
        prompt_tokens_details: { cached_tokens: 0 },
      },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

before(async () => {
  await getDb();
});

after(async () => {
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  // The shared app connection must be released or the test process never exits
  // when DATABASE_URL points at PostgreSQL.
  await closeDb();
});

test("environment provider keys only fill gaps left by stored credentials", () => {
  process.env.OPENAI_API_KEY = "sk-env-openai-test-123456";
  process.env.ANTHROPIC_API_KEY = "sk-ant-env-anthropic-123456";

  const stored = new Map<string, string>([["openai", "sk-stored-openai-123456"]]);
  withEnvProviderKeys(stored);

  assert.equal(stored.get("openai"), "sk-stored-openai-123456", "stored credential must win");
  assert.equal(stored.get("anthropic"), "sk-ant-env-anthropic-123456");
  assert.equal(stored.get("groq"), undefined);
  assert.equal(envProviderKey("openai"), "sk-env-openai-test-123456");
  assert.equal(envProviderKey("unknown"), null);
});

test("verification records provider-reported usage and a catalog-priced cost", async () => {
  const db = await getDb();
  const calls: string[] = [];
  const result = await verifyProviderCompletion(db, "openai", "sk-test-key-123456", {
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      calls.push(body.model ?? "");
      return completionResponse();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, "gpt-4.1-mini");
  assert.deepEqual(calls, ["gpt-4.1-mini"]);
  assert.equal(result.usage?.inputTokens, 1000);
  assert.equal(result.usage?.outputTokens, 200);
  // 1000 input × $0.40/M + 200 output × $1.60/M
  assert.ok(Math.abs((result.costUsd ?? 0) - 0.00072) < 1e-9);
  assert.ok(result.pricingId, "cost must reference a pricing row");
  assert.equal(result.pricingVersion, 1);
  assert.ok(result.message.includes("pricing v1"));
  assert.ok(!result.message.includes("sk-test-key"));
});

test("verification advances past a retired model and stops on authentication failure", async () => {
  const db = await getDb();
  const attempted: string[] = [];
  const result = await verifyProviderCompletion(db, "openai", "sk-test-key-123456", {
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(body.model ?? "");
      if (attempted.length === 1) {
        return new Response(JSON.stringify({ error: { message: "model has been retired" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return completionResponse({ model: "gpt-4o-mini" });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, "gpt-4o-mini");
  assert.deepEqual(attempted, ["gpt-4.1-mini", "gpt-4o-mini"]);
  assert.deepEqual(result.attempts.map((a) => a.code), ["model_not_found", null]);

  let authCalls = 0;
  const failed = await verifyProviderCompletion(db, "openai", "sk-test-key-123456", {
    fetchImpl: async () => {
      authCalls += 1;
      return new Response(JSON.stringify({ error: { message: "Incorrect API key provided: sk-test-key-123456" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(failed.ok, false);
  assert.equal(authCalls, 1, "authentication failures must not retry other models");
  assert.equal(failed.attempts[0].code, "invalid_credentials");
  assert.ok(!failed.message.includes("sk-test-key-123456"), "provider error text must be redacted");
});

test("a completion without usage metadata is not treated as verified", async () => {
  const db = await getDb();
  const result = await verifyProviderCompletion(db, "anthropic", "sk-ant-test-key-123456", {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: "msg_no_usage",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "pong" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /no token usage/i);
});
