import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { trustProxyHeaders, validateEnv } from "@/lib/env";
import { logEvent } from "@/lib/log";
import {
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_MS,
  circuitFailure,
  circuitGate,
  circuitSnapshot,
  circuitSuccess,
  isAvailabilityFailure,
  resetCircuits,
} from "@/lib/gateway/circuit";

const VALID_KEY = Buffer.alloc(32, 7).toString("base64");

function capture(method: "log" | "warn" | "error", fn: () => void): string[] {
  const lines: string[] = [];
  const original = console[method];
  console[method] = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    fn();
  } finally {
    console[method] = original;
  }
  return lines;
}

describe("environment validation", () => {
  it("rejects production without strong auth and encryption secrets", () => {
    const result = validateEnv({ NODE_ENV: "production" });
    assert.equal(result.production, true);
    assert.deepEqual(
      result.errors.map((issue) => issue.key).sort(),
      ["AUTH_SECRET", "ENCRYPTION_KEY"],
    );
  });

  it("accepts a fully configured production environment", () => {
    const result = validateEnv({
      NODE_ENV: "production",
      AUTH_SECRET: "x".repeat(40),
      ENCRYPTION_KEY: VALID_KEY,
      DATABASE_URL: "postgres://user:pass@localhost:5432/tokenburn",
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
      TRUST_PROXY: "true",
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it("flags malformed secrets, database URLs and half-configured Redis", () => {
    const result = validateEnv({
      NODE_ENV: "production",
      AUTH_SECRET: "too-short",
      ENCRYPTION_KEY: "not-base64",
      DATABASE_URL: "mysql://localhost/tokenburn",
      UPSTASH_REDIS_REST_URL: "http://insecure.upstash.io",
      TRUST_PROXY: "yes",
    });
    const keys = result.errors.map((issue) => issue.key);
    for (const key of [
      "AUTH_SECRET",
      "ENCRYPTION_KEY",
      "DATABASE_URL",
      "UPSTASH_REDIS_REST",
      "UPSTASH_REDIS_REST_URL",
      "TRUST_PROXY",
    ]) {
      assert.ok(keys.includes(key), `expected an error for ${key}, got ${keys.join(",")}`);
    }
  });

  it("warns instead of failing on development defaults", () => {
    const result = validateEnv({ NODE_ENV: "development" });
    assert.equal(result.production, false);
    assert.deepEqual(result.errors, []);
    assert.equal(result.warnings.length, 2);
  });

  it("only trusts forwarded headers when explicitly enabled or on Vercel", () => {
    const env = (values: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...values });
    assert.equal(trustProxyHeaders(env({})), false);
    assert.equal(trustProxyHeaders(env({ TRUST_PROXY: "true" })), true);
    assert.equal(trustProxyHeaders(env({ TRUST_PROXY: "1" })), true);
    assert.equal(trustProxyHeaders(env({ TRUST_PROXY: "0" })), false);
    assert.equal(trustProxyHeaders(env({ VERCEL: "1" })), true);
    assert.equal(trustProxyHeaders(env({ VERCEL: "1", TRUST_PROXY: "false" })), false);
  });
});

describe("structured logging", () => {
  it("emits one JSON line and redacts secrets by field and by shape", () => {
    const lines = capture("log", () => {
      logEvent("info", "gateway.request_finalized", {
        orgId: "org_1",
        apiKey: "sk-ant-abcdefgh12345678",
        message: "upstream rejected Bearer abcdefgh1234",
        nested: { password: "hunter2", provider: "openai" },
        error: new Error("failed with sk-abcdefgh12345678"),
      });
    });
    assert.equal(lines.length, 1);
    const raw = lines[0]!;
    assert.doesNotMatch(raw, /sk-ant-abcdefgh|hunter2|sk-abcdefgh12345678/);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.event, "gateway.request_finalized");
    assert.equal(parsed.level, "info");
    assert.equal(parsed.orgId, "org_1");
    assert.equal(parsed.apiKey, "[redacted]");
    assert.match(String(parsed.message), /upstream rejected \[redacted\]/);
    const nested = parsed.nested as Record<string, unknown>;
    assert.equal(nested.password, "[redacted]");
    assert.equal(nested.provider, "openai");
    assert.deepEqual(parsed.error, { name: "Error", message: "failed with [redacted]" });
    assert.ok(typeof parsed.ts === "string");
  });

  it("routes warn and error levels to their own streams", () => {
    const warns = capture("warn", () => logEvent("warn", "provider.circuit_open", { provider: "openai" }));
    const errors = capture("error", () => logEvent("error", "gateway.provider_failed", { code: "provider_timeout" }));
    assert.equal(JSON.parse(warns[0]!).level, "warn");
    assert.equal(JSON.parse(errors[0]!).level, "error");
  });
});

describe("provider circuit breaker", () => {
  beforeEach(() => resetCircuits());

  it("opens at the failure threshold, half-opens once after cooldown, and closes on success", () => {
    const key = "org_a:openai";
    const t0 = Date.now();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD - 1; i++) {
      circuitFailure(key, t0);
      assert.equal(circuitGate(key, t0), "allow");
    }
    assert.equal(circuitSnapshot(key)?.open, false);

    circuitFailure(key, t0);
    assert.equal(circuitSnapshot(key)?.open, true);
    assert.equal(circuitGate(key, t0 + CIRCUIT_OPEN_MS - 1), "open");

    const probeAt = t0 + CIRCUIT_OPEN_MS;
    assert.equal(circuitGate(key, probeAt), "probe");
    // Only one half-open request may probe the provider at a time.
    assert.equal(circuitGate(key, probeAt + 1), "open");

    circuitSuccess(key);
    assert.equal(circuitGate(key, probeAt + 1), "allow");
    assert.equal(circuitSnapshot(key), null);
  });

  it("restarts the cooldown when a half-open probe fails", () => {
    const key = "org_a:openai";
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) circuitFailure(key, 1_000);
    assert.equal(circuitGate(key, 1_000 + CIRCUIT_OPEN_MS), "probe");

    circuitFailure(key, 2_000);
    assert.equal(circuitGate(key, 1_000 + CIRCUIT_OPEN_MS), "open");
    assert.equal(circuitGate(key, 2_000 + CIRCUIT_OPEN_MS - 1), "open");
    assert.equal(circuitGate(key, 2_000 + CIRCUIT_OPEN_MS), "probe");
  });

  it("isolates tenants from each other's provider outages", () => {
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) circuitFailure("org_a:openai", 1_000);
    assert.equal(circuitGate("org_a:openai", 1_000), "open");
    assert.equal(circuitGate("org_b:openai", 1_000), "allow");
    assert.equal(circuitSnapshot("org_b:openai"), null);
  });

  it("counts only availability failures", () => {
    for (const code of [
      "provider_timeout",
      "provider_network_error",
      "provider_unavailable",
      "provider_rate_limited",
      "provider_stream_error",
    ]) {
      assert.equal(isAvailabilityFailure(code), true, `${code} should count as availability failure`);
    }
    for (const code of [
      "invalid_credentials",
      "model_not_found",
      "provider_invalid_request",
      "client_cancelled",
      "provider_not_configured",
    ]) {
      assert.equal(isAvailabilityFailure(code), false, `${code} should not count as availability failure`);
    }
  });
});
