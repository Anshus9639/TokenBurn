import type { ProviderId } from "./types";

/**
 * Operator-level provider keys. They are a fallback for single-tenant beta deployments:
 * unlike stored credentials they are not scoped to an organization, so every org served by
 * this process can use them. Stored (encrypted) credentials always take precedence.
 */
const ENV_KEYS: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

export function envKeyName(provider: string): string | null {
  return ENV_KEYS[provider as ProviderId] ?? null;
}

export function envProviderKey(provider: string): string | null {
  const name = envKeyName(provider);
  if (!name) return null;
  const value = process.env[name]?.trim();
  if (!value || value.length < 12) return null;
  return value;
}

/** Adds environment keys only for providers that have no stored credential. */
export function withEnvProviderKeys(credentials: Map<string, string>): Map<string, string> {
  for (const provider of Object.keys(ENV_KEYS) as ProviderId[]) {
    if (credentials.has(provider)) continue;
    const key = envProviderKey(provider);
    if (key) credentials.set(provider, key);
  }
  return credentials;
}

export function hasEnvProviderKey(provider: string): boolean {
  return envProviderKey(provider) !== null;
}
