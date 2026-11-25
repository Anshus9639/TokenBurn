type Bucket = { count: number; resetAt: number };
type CacheEntry = { value: unknown; expiresAt: number };

const globalCache = globalThis as unknown as {
  __tokenburnCache?: Map<string, CacheEntry>;
  __tokenburnLimiter?: Map<string, Bucket>;
};

const store = (globalCache.__tokenburnCache ??= new Map());
const buckets = (globalCache.__tokenburnLimiter ??= new Map());

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstash(command: unknown[]): Promise<unknown> {
  if (!redisUrl || !redisToken) return null;
  try {
    const res = await fetch(redisUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: unknown };
    return data.result ?? null;
  } catch {
    return null;
  }
}

export async function rateLimit(
  key: string,
  limit = 120,
  windowMs = 60_000,
): Promise<{ ok: boolean; remaining: number; resetAt: number; backend: "redis" | "memory" }> {
  const windowSec = Math.ceil(windowMs / 1000);
  if (redisUrl && redisToken) {
    const count = await upstash(["INCR", `rl:${key}:${Math.floor(Date.now() / windowMs)}`]);
    if (typeof count === "number") {
      if (count === 1) await upstash(["EXPIRE", `rl:${key}:${Math.floor(Date.now() / windowMs)}`, windowSec]);
      return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt: Date.now() + windowMs, backend: "redis" };
    }
  }
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs, backend: "memory" };
  }
  existing.count += 1;
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    backend: "memory",
  };
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
  }
  return value;
}

export function invalidateCache(prefix: string) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

export const cacheBackend = redisUrl && redisToken ? "redis" : "in-memory";
