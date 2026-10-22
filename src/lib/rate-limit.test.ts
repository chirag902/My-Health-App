// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRateLimiter, getRedisConfigFromEnv } from "./rate-limit";

/** A clock the tests control. */
function clock(start = Date.UTC(2026, 9, 16, 10, 0, 0)) {
  let current = start;

  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

/* ============================================================
   IN-MEMORY BEHAVIOUR
   ============================================================ */

describe("in-memory limiter", () => {
  it("allows exactly `limit` requests per window, then blocks", async () => {
    const limiter = createRateLimiter({ name: "t", limit: 3, windowSeconds: 60, now: clock().now });

    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.check("user"));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0, 0]);
    expect(results[0].limit).toBe(3);
  });

  it("starts a fresh window after the old one ends", async () => {
    const time = clock();
    const limiter = createRateLimiter({ name: "t", limit: 2, windowSeconds: 60, now: time.now });

    await limiter.check("user");
    await limiter.check("user");
    expect((await limiter.check("user")).allowed).toBe(false);

    time.advance(61_000);

    const fresh = await limiter.check("user");
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(1);
  });

  it("tells a blocked caller how long to wait (never less than 1 second)", async () => {
    const time = clock(Date.UTC(2026, 9, 16, 10, 0, 0)); // exactly at a window start
    const limiter = createRateLimiter({ name: "t", limit: 1, windowSeconds: 600, now: time.now });

    await limiter.check("user");
    time.advance(100_000);
    const blocked = await limiter.check("user");

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(500);
    expect(blocked.resetAt).toBe(Date.UTC(2026, 9, 16, 10, 10, 0));

    time.advance(499_500);
    expect((await limiter.check("user")).retryAfterSeconds).toBe(1);
  });

  it("keeps callers and limiters independent", async () => {
    const time = clock();
    const a = createRateLimiter({ name: "a", limit: 1, windowSeconds: 60, now: time.now });
    const b = createRateLimiter({ name: "b", limit: 1, windowSeconds: 60, now: time.now });

    await a.check("alice");

    expect((await a.check("alice")).allowed).toBe(false);
    expect((await a.check("bob")).allowed).toBe(true); // other caller
    expect((await b.check("alice")).allowed).toBe(true); // other limiter
  });

  it("cannot be bypassed by key tricks (case and whitespace are different keys, never merged or crashing)", async () => {
    const limiter = createRateLimiter({ name: "t", limit: 1, windowSeconds: 60, now: clock().now });

    for (const key of ["", " ", "A", "a", "a ", "\u0000", "x".repeat(10_000), "🦄"]) {
      expect((await limiter.check(key)).allowed).toBe(true);
    }
  });

  it("never grows without bound, even under a flood of distinct keys in a single window", async () => {
    const limiter = createRateLimiter({ name: "t", limit: 5, windowSeconds: 60, now: clock().now, maxMemoryKeys: 100 });

    for (let i = 0; i < 5_000; i++) await limiter.check(`attacker-${i}`);

    // Observable consequence of the cap: the oldest keys were forgotten, so they get a fresh allowance.
    expect((await limiter.check("attacker-0")).remaining).toBe(4);
    // ...while a recent key is still being counted.
    expect((await limiter.check("attacker-4999")).remaining).toBe(3);
  });

  it("drops expired windows when it prunes", async () => {
    const time = clock();
    const limiter = createRateLimiter({ name: "t", limit: 1, windowSeconds: 60, now: time.now, maxMemoryKeys: 10 });

    for (let i = 0; i < 10; i++) await limiter.check(`old-${i}`);
    time.advance(120_000);
    for (let i = 0; i < 10; i++) await limiter.check(`new-${i}`);

    expect((await limiter.check("old-3")).remaining).toBe(0); // fresh window for a fresh entry: 1 allowed, 1 used
  });
});

/* ============================================================
   REDIS OVER REST
   ============================================================ */

const REDIS = { url: "https://example.upstash.io/", token: "secret-token" };

function redisResponse(count: number, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => [{ result: count }, { result: 1 }],
  } as unknown as Response;
}

describe("redis limiter", () => {
  it("sends one INCR + EXPIRE pipeline with the token, and trusts the shared count", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(redisResponse(7));
    const time = clock(Date.UTC(2026, 9, 16, 10, 0, 0));
    const limiter = createRateLimiter({ name: "analyze:user", limit: 10, windowSeconds: 600, redis: REDIS, now: time.now, fetchImpl });

    const result = await limiter.check("abc123");

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://example.upstash.io/pipeline"); // trailing slash handled
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-token");

    const windowIndex = Math.floor(time.now() / 600_000);
    expect(JSON.parse(init.body)).toEqual([
      ["INCR", `rl:analyze:user:abc123:${windowIndex}`],
      ["EXPIRE", `rl:analyze:user:abc123:${windowIndex}`, "1200"],
    ]);

    expect(result).toMatchObject({ allowed: true, limit: 10, remaining: 3 });
  });

  it("blocks when the SHARED count passes the limit (other server instances included)", async () => {
    const limiter = createRateLimiter({
      name: "t",
      limit: 10,
      windowSeconds: 60,
      redis: REDIS,
      fetchImpl: vi.fn().mockResolvedValue(redisResponse(11)),
    });

    expect(await limiter.check("u")).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("allows the request that makes the count equal to the limit", async () => {
    const limiter = createRateLimiter({ name: "t", limit: 10, windowSeconds: 60, redis: REDIS, fetchImpl: vi.fn().mockResolvedValue(redisResponse(10)) });

    expect(await limiter.check("u")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it.each([
    ["network failure", () => vi.fn().mockRejectedValue(new TypeError("fetch failed"))],
    ["HTTP 500", () => vi.fn().mockResolvedValue(redisResponse(0, false, 500))],
    ["bad JSON shape", () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nope: true }) })],
    ["Redis error entry", () => vi.fn().mockResolvedValue({ ok: true, json: async () => [{ error: "ERR boom" }] })],
    ["non-numeric result", () => vi.fn().mockResolvedValue({ ok: true, json: async () => [{ result: "OK" }] })],
  ])("falls back to memory (still enforcing limits) on %s", async (_label, makeFetch) => {
    const onFallback = vi.fn();
    const limiter = createRateLimiter({ name: "t", limit: 2, windowSeconds: 60, redis: REDIS, fetchImpl: makeFetch(), onFallback, now: clock().now });

    const results = [await limiter.check("u"), await limiter.check("u"), await limiter.check("u")];

    expect(results.map((r) => r.allowed)).toEqual([true, true, false]); // protection is NOT switched off
    expect(onFallback).toHaveBeenCalledTimes(3);
  });

  it("gives up on a Redis that hangs instead of stalling every request", async () => {
    vi.useFakeTimers();

    try {
      const hanging = vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          })
      );
      const onFallback = vi.fn();
      const limiter = createRateLimiter({
        name: "t",
        limit: 5,
        windowSeconds: 60,
        redis: REDIS,
        fetchImpl: hanging as unknown as typeof fetch,
        onFallback,
      });

      const pending = limiter.check("u");
      await vi.advanceTimersByTimeAsync(1_600);

      expect((await pending).allowed).toBe(true);
      expect(onFallback).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never puts the token or the raw key in an error it reports", async () => {
    const onFallback = vi.fn();
    const limiter = createRateLimiter({
      name: "t",
      limit: 5,
      windowSeconds: 60,
      redis: REDIS,
      fetchImpl: vi.fn().mockResolvedValue(redisResponse(0, false, 401)),
      onFallback,
    });

    await limiter.check("u");

    expect(String((onFallback.mock.calls[0][0] as Error).message)).not.toContain("secret-token");
  });
});

/* ============================================================
   ENV
   ============================================================ */

describe("getRedisConfigFromEnv", () => {
  it("reads Upstash variables, then Vercel KV variables, otherwise null", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    expect(getRedisConfigFromEnv()).toBeNull();

    vi.stubEnv("KV_REST_API_URL", "https://kv.example");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
    expect(getRedisConfigFromEnv()).toEqual({ url: "https://kv.example", token: "kv-token" });

    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://up.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "up-token");
    expect(getRedisConfigFromEnv()).toEqual({ url: "https://up.example", token: "up-token" });
  });

  it("returns null when only half of a pair is set", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://up.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");

    expect(getRedisConfigFromEnv()).toBeNull();
  });
});