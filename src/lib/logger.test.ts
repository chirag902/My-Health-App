// @vitest-environment node
// src/lib/logger.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addLogSink, createLogger, logger, sanitizeForLog, type LogEntry } from "./logger";

/* ============================================================
   HELPERS
   ============================================================ */

const clean = (value: unknown) => sanitizeForLog(value) as Record<string, unknown>;

function spyConsole() {
  return {
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

const firstJsonLine = (spy: ReturnType<typeof vi.spyOn>) => JSON.parse(spy.mock.calls[0][0] as string);

// Belt and braces: even if a jsdom "window" exists, these tests exercise the SERVER code path
// unless a test explicitly pretends to be a browser.
beforeEach(() => {
  vi.stubGlobal("window", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ============================================================
   1. KEY-BASED REDACTION
   ============================================================ */

describe("key-based redaction", () => {
  it("redacts credentials, identifiers and health content at any depth", () => {
    const result = clean({
      password: "hunter2",
      user: { email: "a@b.com", profile: { phone: "9999999999", symptoms: "chest pain" } },
      headers: { Authorization: "Bearer abc", "set-cookie": "sid=1" },
      journal_entry: "I felt sad today",
      OCR_TEXT: "Haemoglobin 13.5",
      documentDataUri: "data:application/pdf;base64,AAAA",
      conversation: [{ role: "user", content: "hi" }],
      fileName: "Rahul_Sharma_blood_report.pdf",
    });

    expect(JSON.stringify(result)).not.toMatch(/hunter2|a@b\.com|9999999999|chest pain|Bearer abc|sad today|13\.5|Rahul/);
    expect(result.password).toBe("[REDACTED]");
    expect((result.user as any).profile.symptoms).toBe("[REDACTED]");
    expect(result.fileName).toBe("[REDACTED]");
  });

  it("matches key VARIANTS by fragment (idToken, userPassword, sessionId...)", () => {
    const result = clean({ idToken: "x", userPassword: "y", refresh_token: "z", clientSecret: "s", sessionId: "q" });

    expect(Object.values(result).every((v) => v === "[REDACTED]")).toBe(true);
  });

  it("keeps harmless numeric counters whose key merely contains 'token'", () => {
    expect(clean({ promptTokens: 120, completionTokens: 45, hasToken: true })).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      hasToken: true,
    });
  });

  it("still redacts a numeric OTP/PIN (exact-key match)", () => {
    expect(clean({ otp: 123456, pin: 4321 })).toEqual({ otp: "[REDACTED]", pin: "[REDACTED]" });
  });

  it("does not redact ordinary operational fields", () => {
    const data = { ms: 420, ok: true, issueCount: 2, mime: "image/jpeg", metrics: 14, error: "TypeError" };

    expect(clean(data)).toEqual(data);
  });
});

/* ============================================================
   2. VALUE-BASED SCRUBBING
   ============================================================ */

describe("value-based scrubbing", () => {
  it("scrubs secrets hiding inside innocent keys", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2";
    const result = clean({
      detail: `auth failed for rahul@example.com with Bearer abc.DEF-123 and ${jwt}`,
      other: "key gsk_abcdefghijklmnopqrstuvwxyz123456 leaked",
      google: "AIzaSyA1234567890abcdefghijklmnopqrstuvw",
    });

    const printed = JSON.stringify(result);

    expect(printed).not.toContain("rahul@example.com");
    expect(printed).not.toContain("abc.DEF-123");
    expect(printed).not.toContain(jwt);
    expect(printed).not.toContain("gsk_abc");
    expect(printed).not.toContain("AIzaSy");
    expect(printed).toContain("[REDACTED_EMAIL]");
    expect(printed).toContain("[REDACTED_JWT]");
  });

  it("scrubs data URIs and long base64 blobs", () => {
    const blob = "QUJD".repeat(60);
    const result = clean({
      a: `see data:image/png;base64,${blob} end`,
      b: `payload ${blob}`,
    });

    expect(JSON.stringify(result)).not.toContain("QUJDQUJD");
  });

  it("truncates long strings and reports how much was cut", () => {
    const result = clean({ detail: "word ".repeat(500) });

    expect(String(result.detail).length).toBeLessThan(400);
    expect(String(result.detail)).toMatch(/\[\+\d+ chars\]$/);
  });

  it("cannot be made slow by a huge hostile string", () => {
    const start = performance.now();
    clean({ detail: "a".repeat(5_000_000), other: "a@".repeat(1_000_000) });

    expect(performance.now() - start).toBeLessThan(200);
  });
});

/* ============================================================
   3. STRUCTURE + TYPE SAFETY
   ============================================================ */

describe("structure handling", () => {
  it("keeps nested arrays as arrays (regression: the old logger turned them into objects)", () => {
    const result = clean({ matrix: [[1, 2], [3, 4]], list: ["a", ["b", "c"]] });

    expect(result.matrix).toEqual([[1, 2], [3, 4]]);
    expect(Array.isArray((result.list as unknown[])[1])).toBe(true);
  });

  it("survives circular references", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    a.child = { parent: a };

    const result = clean(a) as any;

    expect(result.self).toBe("[Circular]");
    expect(result.child.parent).toBe("[Circular]");
  });

  it("does not mistake the same object used twice (siblings) for a cycle", () => {
    const shared = { ok: true };

    expect(clean({ a: shared, b: shared })).toEqual({ a: { ok: true }, b: { ok: true } });
  });

  it("limits depth, array length and key count", () => {
    const deep: any = {};
    let cursor = deep;
    for (let i = 0; i < 20; i++) cursor = cursor.next = {};

    expect(JSON.stringify(clean(deep))).toContain("[MaxDepth]");

    const list = clean({ items: Array.from({ length: 100 }, (_, i) => i) }).items as unknown[];
    expect(list).toHaveLength(21);
    expect(list[20]).toBe("[+80 more items]");

    const wide = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
    const cutWide = clean(wide);
    expect(Object.keys(cutWide)).toHaveLength(51);
    expect(cutWide._truncatedKeys).toBe(150);
  });

  it("never prints file or binary contents", () => {
    const result = clean({
      buffer: Buffer.from("secret lab report"),
      bytes: new Uint8Array(1024),
      blob: new Blob(["x".repeat(10)], { type: "application/pdf" }),
      file: new File(["abc"], "patient.pdf"),
      attachment: new File(["abc"], "patient.pdf"),
    });

    expect(result.buffer).toBe("[Binary 17 bytes]");
    expect(result.bytes).toBe("[Binary 1024 bytes]");
    expect(result.blob).toBe("[Blob 10 bytes]");
    expect(result.attachment).toBe("[Blob 3 bytes]");
    expect(JSON.stringify(result)).not.toContain("patient.pdf");
  });

  it("handles values JSON.stringify cannot", () => {
    const result = clean({
      big: BigInt(10),
      sym: Symbol("s"),
      fn: () => 1,
      nan: NaN,
      inf: Infinity,
      date: new Date("2026-10-14T00:00:00Z"),
      badDate: new Date("nope"),
      map: new Map([["a", 1]]),
      set: new Set([1, 2]),
      url: new URL("https://x.test/?token=abcdef"),
    });

    expect(result).toMatchObject({
      big: "10",
      fn: "[Function]",
      nan: "NaN",
      inf: "Infinity",
      date: "2026-10-14T00:00:00.000Z",
      badDate: "[Invalid Date]",
      map: [["a", 1]],
      set: [1, 2],
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("survives hostile objects (throwing getters, throwing proxies)", () => {
    const hostile = {
      get boom() {
        throw new Error("getter exploded");
      },
    };
    const proxy = new Proxy({}, {
      ownKeys() {
        throw new Error("proxy exploded");
      },
    });

    expect(() => clean({ hostile, proxy })).not.toThrow();
    expect(clean({ proxy }).proxy).toBe("[Unserializable]");
  });
});

/* ============================================================
   4. ERRORS
   ============================================================ */

describe("error serialization", () => {
  it("keeps name, code and a short stack but scrubs the message", () => {
    const error = Object.assign(new Error("lookup failed for rahul@example.com"), { code: "permission-denied" });

    const result = clean({ error }).error as any;

    expect(result.name).toBe("Error");
    expect(result.code).toBe("permission-denied");
    expect(result.message).toContain("[REDACTED_EMAIL]");
    expect(result.message).not.toContain("rahul@example.com");
    expect(result.stack.split("\n").length).toBeLessThanOrEqual(8);
  });

  it("serializes nested causes", () => {
    const error = new Error("outer", { cause: new TypeError("inner") });

    expect((clean({ error }).error as any).cause.name).toBe("TypeError");
  });

  it("accepts an Error directly: logger.error('msg', error)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spies = spyConsole();

    logger.error("boom", new RangeError("bad"));

    expect(firstJsonLine(spies.error).data.error.name).toBe("RangeError");
  });
});

/* ============================================================
   5. LEVELS + OUTPUT
   ============================================================ */

describe("levels and output", () => {
  it("is silent in the test environment by default", () => {
    const spies = spyConsole();

    logger.error("quiet");

    expect(spies.error).not.toHaveBeenCalled();
  });

  it("emits info in production (regression: the old logger dropped ALL info logs there)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spies = spyConsole();

    logger.info("analysis finished", { ms: 420, ok: true });

    expect(spies.info).toHaveBeenCalledTimes(1);
    expect(firstJsonLine(spies.info)).toMatchObject({
      level: "info",
      message: "analysis finished",
      data: { ms: 420, ok: true },
    });
  });

  it("suppresses debug in production but shows it in development", () => {
    const spies = spyConsole();

    vi.stubEnv("NODE_ENV", "production");
    logger.debug("hidden");
    expect(spies.debug).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "development");
    logger.debug("shown");
    expect(spies.debug).toHaveBeenCalledWith("[DEBUG]", "shown");
  });

  it("honours LOG_LEVEL", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spies = spyConsole();

    vi.stubEnv("LOG_LEVEL", "error");
    logger.info("a");
    logger.warn("b");
    logger.error("c");

    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalledTimes(1);

    vi.stubEnv("LOG_LEVEL", "silent");
    logger.error("d");
    expect(spies.error).toHaveBeenCalledTimes(1);
  });

  it("writes exactly one JSON line per event, on the right console stream", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_REGION", "bom1");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    const spies = spyConsole();

    logger.warn("slow");
    logger.error("failed");

    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.error).toHaveBeenCalledTimes(1);

    const entry = firstJsonLine(spies.warn);
    expect(entry).toMatchObject({ level: "warn", message: "slow", env: "production", region: "bom1", release: "abcdef1" });
    expect(new Date(entry.timestamp).toString()).not.toBe("Invalid Date");
    expect(entry.data).toBeUndefined();
  });

  it("prints readable output in a browser, even when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", {});
    const spies = spyConsole();

    logger.warn("careful", { ms: 5 });

    expect(spies.warn).toHaveBeenCalledWith("[WARN]", "careful", { ms: 5 });
  });

  it("adds server metadata (env, region, release) on the server but never in a browser", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_REGION", "bom1");
    spyConsole();

    const entries: LogEntry[] = [];
    const off = addLogSink((entry) => entries.push(entry));

    logger.info("on the server");
    vi.stubGlobal("window", {});
    logger.info("in the browser");
    off();

    expect(entries[0]).toMatchObject({ env: "production", region: "bom1" });
    expect(entries[1].env).toBeUndefined();
    expect(entries[1].region).toBeUndefined();
  });

  it("is readable in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const spies = spyConsole();

    logger.warn("careful", { ms: 5 });

    expect(spies.warn).toHaveBeenCalledWith("[WARN]", "careful", { ms: 5 });
  });

  it("scrubs the message text itself", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spies = spyConsole();

    logger.error(`failed for rahul@example.com`);

    expect(firstJsonLine(spies.error).message).toBe("failed for [REDACTED_EMAIL]");
  });

  it("caps the size of a single log line", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spies = spyConsole();

    // 50 keys x 300 chars is ~15KB > the 8KB line cap
    const big = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, "x ".repeat(150)]));
    logger.info("huge", big);

    const entry = firstJsonLine(spies.info);
    expect(entry.data._truncated).toBe(true);
  });

  it("never throws, whatever it is given", () => {
    vi.stubEnv("NODE_ENV", "production");
    spyConsole();

    const cyc: any = {};
    cyc.cyc = cyc;

    expect(() => {
      logger.info(undefined as unknown as string);
      logger.info("x", cyc);
      logger.info("x", BigInt(10));
      logger.info("x", Symbol("s"));
      logger.error("x", null);
      logger.error("x", ["a", ["b"]]);
    }).not.toThrow();
  });
});

/* ============================================================
   6. CHILD LOGGERS, TIMERS, SINKS
   ============================================================ */

describe("child loggers, timers and sinks", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("adds bound context to every line and sanitizes it", () => {
    const spies = spyConsole();
    const log = createLogger({ requestId: "r-1", email: "a@b.com" }).child({ route: "analyze" });

    log.info("hello", { ok: true });

    const entry = firstJsonLine(spies.info);
    expect(entry.context).toEqual({ requestId: "r-1", email: "[REDACTED]", route: "analyze" });
    expect(entry.data).toEqual({ ok: true });
  });

  it("times an operation and merges extra data", () => {
    const spies = spyConsole();

    const done = logger.startTimer("ocr", { mime: "image/png" });
    const ms = done({ pages: 2 });

    expect(ms).toBeGreaterThanOrEqual(0);
    expect(firstJsonLine(spies.info)).toMatchObject({
      message: "ocr finished",
      data: { mime: "image/png", pages: 2 },
    });
    expect(typeof firstJsonLine(spies.info).data.ms).toBe("number");
  });

  it("forwards sanitized entries to sinks and survives a broken sink", () => {
    spyConsole();
    const received: LogEntry[] = [];

    const off1 = addLogSink((entry) => received.push(entry));
    const off2 = addLogSink(() => {
      throw new Error("sink down");
    });

    logger.error("bad", { password: "p", ms: 3 });

    expect(received).toHaveLength(1);
    expect(received[0].data).toEqual({ password: "[REDACTED]", ms: 3 });

    off1();
    off2();
    logger.error("again");
    expect(received).toHaveLength(1);
  });
});