// Fixed-window limiter. Redis (Upstash / Vercel KV) = enforced across all serverless instances.
// No Redis or Redis down = per-instance memory (weak on Vercel: attackers spread across instances).
// Env (optional): UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL + KV_REST_API_TOKEN.

import { logger } from "@/lib/logger";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** End of the current window (epoch ms). */
  resetAt: number;
  /** Seconds until retry (>= 1). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

export interface RedisRestConfig {
  url: string;
  token: string;
}

export interface RateLimiterOptions {
  name: string;
  limit: number;
  windowSeconds: number;
  redis?: RedisRestConfig | null;
  now?: () => number;
  fetchImpl?: typeof fetch;
  onFallback?: (error: unknown) => void;
  maxMemoryKeys?: number;
}

const REDIS_TIMEOUT_MS = 1_200;
const BREAKER_MS = 30_000; // after a Redis failure, skip Redis this long (no 1.2s penalty per request)
const MAX_KEY_LEN = 128;
const DEFAULT_MAX_MEMORY_KEYS = 5_000;

const breaker = new Map<string, number>();

export function getRedisConfigFromEnv(): RedisRestConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

/** Vercel overwrites these headers, so they are trustworthy there. ⚠️ Spoofable on other hosts. */
export function getClientIp(h: Pick<Headers, "get">): string {
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function incrementInRedis(
  redis: RedisRestConfig,
  fetchImpl: typeof fetch,
  redisKey: string,
  ttlSeconds: number,
  now: () => number
): Promise<number> {
  const base = redis.url.replace(/\/+$/, "");
  if ((breaker.get(base) ?? 0) > now()) throw new Error("Redis circuit open");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${base}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${redis.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", redisKey], ["EXPIRE", redisKey, String(ttlSeconds)]]),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);

    const results: unknown = await response.json();
    const first = Array.isArray(results)
      ? (results[0] as { result?: unknown; error?: unknown } | undefined)
      : undefined;
    if (!first || first.error !== undefined || typeof first.result !== "number") {
      throw new Error("Unexpected Redis response");
    }
    return first.result;
  } catch (error) {
    breaker.set(base, now() + BREAKER_MS);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const {
    name,
    limit,
    windowSeconds,
    redis = null,
    now = Date.now,
    fetchImpl = fetch,
    onFallback,
    maxMemoryKeys = DEFAULT_MAX_MEMORY_KEYS,
  } = options;

  const windowMs = windowSeconds * 1_000;
  const memory = new Map<string, { windowIndex: number; count: number }>();

  const toResult = (count: number, windowIndex: number, current: number): RateLimitResult => {
    const resetAt = (windowIndex + 1) * windowMs;
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - current) / 1_000)),
    };
  };

  // Batch eviction down to 90% so the O(n) pass is amortised, never per request.
  const prune = (windowIndex: number): void => {
    if (memory.size <= maxMemoryKeys) return;
    for (const [k, e] of memory) if (e.windowIndex !== windowIndex) memory.delete(k);
    const target = Math.floor(maxMemoryKeys * 0.9);
    for (const k of memory.keys()) {
      if (memory.size <= target) break;
      memory.delete(k);
    }
  };

  const countInMemory = (key: string, windowIndex: number): number => {
    const existing = memory.get(key);
    const entry = existing && existing.windowIndex === windowIndex ? existing : { windowIndex, count: 0 };
    entry.count += 1;
    memory.set(key, entry);
    prune(windowIndex);
    return entry.count;
  };

  return {
    async check(rawKey: string): Promise<RateLimitResult> {
      const current = now();
      const windowIndex = Math.floor(current / windowMs);
      const key = `${name}:${rawKey.replace(/[^\w.:@-]/g, "_").slice(0, MAX_KEY_LEN)}`;

      if (redis) {
        try {
          const count = await incrementInRedis(redis, fetchImpl, `rl:${key}:${windowIndex}`, windowSeconds * 2, now);
          return toResult(count, windowIndex, current);
        } catch (error) {
          onFallback?.(error); // outage never disables protection or the feature
        }
      }
      return toResult(countInMemory(key, windowIndex), windowIndex, current);
    },
  };
}

/* Process-wide registry. Without it, a new limiter (empty memory) per request enforces nothing. */
const g = globalThis as typeof globalThis & { __mhaLimiters?: Map<string, RateLimiter> };

export function rateLimit(name: string, limit: number, windowSeconds: number): RateLimiter {
  const store = (g.__mhaLimiters ??= new Map());
  const id = `${name}|${limit}|${windowSeconds}`;
  let limiter = store.get(id);
  if (!limiter) {
    limiter = createRateLimiter({
      name,
      limit,
      windowSeconds,
      redis: getRedisConfigFromEnv(),
      onFallback: (e) =>
        logger.warn("rate-limit redis fallback", { reason: e instanceof Error ? e.message : "unknown" }),
    });
    store.set(id, limiter);
  }
  return limiter;
}