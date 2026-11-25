import { logEvent } from "./log";

export type EnvIssue = { key: string; message: string };

export type EnvValidation = {
  production: boolean;
  errors: EnvIssue[];
  warnings: EnvIssue[];
};

function encryptionKeyBytes(raw: string): number {
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? 32 : 0;
}

/** Pure validation so it can be unit-tested without touching the real process env. */
export function validateEnv(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv: string = env.NODE_ENV ?? "development",
): EnvValidation {
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];
  const production = nodeEnv === "production";

  const authSecret = env.AUTH_SECRET?.trim();
  const encryptionKey = env.ENCRYPTION_KEY?.trim();

  if (production) {
    if (!authSecret || authSecret.length < 32) {
      errors.push({ key: "AUTH_SECRET", message: "AUTH_SECRET must be at least 32 characters in production." });
    }
    if (!encryptionKey) {
      errors.push({ key: "ENCRYPTION_KEY", message: "ENCRYPTION_KEY is required in production to encrypt provider credentials." });
    } else if (!encryptionKeyBytes(encryptionKey)) {
      errors.push({ key: "ENCRYPTION_KEY", message: "ENCRYPTION_KEY must be a base64-encoded 32-byte key." });
    }
  } else {
    if (!authSecret) warnings.push({ key: "AUTH_SECRET", message: "AUTH_SECRET is unset; a development-only fallback is used." });
    if (!encryptionKey) warnings.push({ key: "ENCRYPTION_KEY", message: "ENCRYPTION_KEY is unset; a development-only fallback is used." });
  }

  if (env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
    errors.push({ key: "DATABASE_URL", message: "DATABASE_URL must start with postgres:// or postgresql://." });
  }

  const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (Boolean(redisUrl) !== Boolean(redisToken)) {
    errors.push({ key: "UPSTASH_REDIS_REST", message: "Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither." });
  }
  if (redisUrl && !redisUrl.startsWith("https://")) {
    errors.push({ key: "UPSTASH_REDIS_REST_URL", message: "UPSTASH_REDIS_REST_URL must use https." });
  }

  const trust = env.TRUST_PROXY?.toLowerCase();
  if (trust && !["0", "1", "true", "false"].includes(trust)) {
    errors.push({ key: "TRUST_PROXY", message: "TRUST_PROXY must be one of 0, 1, true or false." });
  }

  return { production, errors, warnings };
}

/** Fails fast at server boot when production secrets are missing or malformed. */
export function assertEnv(env: NodeJS.ProcessEnv = process.env): EnvValidation {
  const result = validateEnv(env);
  for (const warning of result.warnings) {
    logEvent("warn", "env.warning", { key: warning.key, message: warning.message });
  }
  if (result.errors.length) {
    const summary = result.errors.map((issue) => `${issue.key}: ${issue.message}`).join("; ");
    logEvent("error", "env.invalid", { issues: result.errors });
    throw new Error(`Invalid environment configuration. ${summary}`);
  }
  logEvent("info", "env.validated", { production: result.production, issues: result.errors.length });
  return result;
}

export function trustProxyHeaders(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.TRUST_PROXY?.toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return Boolean(env.VERCEL);
}
