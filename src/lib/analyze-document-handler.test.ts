// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real OCR / AI modules are heavy and are never needed: the handler receives fakes through its deps.
vi.mock("@/lib/ocr", () => ({ extractTextFromFile: vi.fn() }));
vi.mock("@/lib/document-analysis", () => ({ analyzeLabText: vi.fn() }));

import {
  anonymize,
  createAnalyzeDocumentHandler,
  formatWait,
  getClientIp,
  MAX_BODY_BYTES,
  MAX_FILES,
  MAX_JSON_BYTES,
  sniffMime,
  TIME_BUDGET_MS,
  type HandlerDeps,
} from "./analyze-document-handler";
import { AuthError } from "./auth-server";
import { UserFacingError } from "./errors";
import { addLogSink, type LogEntry } from "./logger";
import { createRateLimiter } from "./rate-limit";

/* ============================================================
   HARNESS
   ============================================================ */

const ENDPOINT = "http://localhost/api/analyze-document";
const NOW = Date.UTC(2026, 9, 16, 10, 0, 0);

const SUCCESS = { success: true as const, data: { summary: "All good.", keyDataPoints: [], recommendations: [] } };

function setup(overrides: Partial<HandlerDeps> = {}, limits = { user: 10, ip: 100 }) {
  const clock = { now: NOW };

  const ipLimiter = createRateLimiter({ name: "ip", limit: limits.ip, windowSeconds: 600, now: () => clock.now });
  const userLimiter = createRateLimiter({ name: "user", limit: limits.user, windowSeconds: 600, now: () => clock.now });

  // Each mock keeps its vi.fn() type (so tests can read .mock.calls); only the final object is
  // checked against HandlerDeps, via the explicit annotation below, so nothing is silently wrong.
  const verifyToken = vi.fn(async (token: string) => {
    if (token === "token-1") return { uid: "user-1", isAnonymous: false, emailVerified: true };
    if (token === "token-2") return { uid: "user-2", isAnonymous: false, emailVerified: true };
    if (token === "anon-token") return { uid: "anon-1", isAnonymous: true, emailVerified: false };
    throw new AuthError("invalid_token");
  });
  const ipCheck = vi.fn((key: string) => ipLimiter.check(key));
  const userCheck = vi.fn((key: string) => userLimiter.check(key));
  const analyzeText = vi.fn(async (_text: string) => SUCCESS);
  const extractText = vi.fn(async (_dataUri: string) => "Haemoglobin 13.5 g/dL 13 - 17");

  const deps: HandlerDeps = {
    verifyToken,
    ipLimiter: { check: ipCheck },
    userLimiter: { check: userCheck },
    analyzeText,
    extractText,
    now: () => clock.now,
    allowAnonymous: false,
    ...overrides,
  };

  return { deps, clock, handler: createAnalyzeDocumentHandler(deps) };
}

const auth = (token = "token-1") => ({ authorization: `Bearer ${token}` });

const jsonRequest = (body: unknown, headers: Record<string, string> = auth()) =>
  new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" || body instanceof Uint8Array ? (body as unknown as BodyInit) : JSON.stringify(body),
  });

const TEXT = "Haemoglobin 13.5 g/dL 13.0 - 17.0\nGlucose 90 mg/dL 70 - 100";

const bytes = (...values: number[]) => new Uint8Array(values);
const PDF = (size = 64) => new Uint8Array(size).map((_, i) => ("%PDF-1.4\n".charCodeAt(i) || 0x20));
const JPEG = () => bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46);
const PNG = () => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const WEBP = () => new Uint8Array([...new TextEncoder().encode("RIFF"), 1, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);

const file = (content: Uint8Array | string, name = "report", type = "application/octet-stream") =>
  new File([content as BlobPart], name, { type });

const filesRequest = (files: File[], headers: Record<string, string> = auth()) => {
  const form = new FormData();
  files.forEach((f) => form.append("document", f));

  return new Request(ENDPOINT, { method: "POST", headers, body: form });
};

/** Recovers the vi.fn() typing for assertions on a HandlerDeps function field. */
const asMock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const read = async (response: Response) => ({ status: response.status, body: await response.json(), headers: response.headers });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ============================================================
   1. AUTHENTICATION
   ============================================================ */

describe("authentication", () => {
  it("refuses a request with no token, and does NOTHING expensive", async () => {
    const { handler, deps } = setup();
    const request = jsonRequest({ text: TEXT }, {});

    const { status, body, headers } = await read(await handler(request));

    expect(status).toBe(401);
    expect(body).toMatchObject({ success: false, code: "unauthorized" });
    expect(headers.get("www-authenticate")).toMatch(/^Bearer/);

    expect(deps.userLimiter.check).not.toHaveBeenCalled();
    expect(deps.analyzeText).not.toHaveBeenCalled();
    expect(deps.extractText).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false); // the upload was never even read
  });

  it.each(["Basic dXNlcjpwYXNz", "Bearer", "Bearer a b", "Token x", "x".repeat(20_000)])(
    "refuses a malformed Authorization header (%#)",
    async (value) => {
      const { handler, deps } = setup();

      const { status } = await read(await handler(jsonRequest({ text: TEXT }, { authorization: value })));

      expect(status).toBe(401);
      expect(deps.verifyToken).not.toHaveBeenCalled();
    }
  );

  it("refuses an invalid token and says nothing about why", async () => {
    const { handler } = setup();

    const { status, body, headers } = await read(await handler(jsonRequest({ text: TEXT }, auth("forged"))));

    expect(status).toBe(401);
    expect(body.error).toBe("Please sign in to analyze a document.");
    expect(headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("blames the SERVER, not the user, when auth is misconfigured, without naming the env variable", async () => {
    const { handler } = setup({ verifyToken: vi.fn().mockRejectedValue(new AuthError("misconfigured", "FIREBASE_PROJECT_ID is not set")) });

    const { status, body } = await read(await handler(jsonRequest({ text: TEXT })));

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/FIREBASE|PROJECT_ID/);
  });

  it("answers 503 with Retry-After when Google's key service is down (the user is not logged out)", async () => {
    const { handler } = setup({ verifyToken: vi.fn().mockRejectedValue(new AuthError("unavailable")) });

    const { status, body, headers } = await read(await handler(jsonRequest({ text: TEXT })));

    expect(status).toBe(503);
    expect(body.code).toBe("unavailable");
    expect(headers.get("retry-after")).toBe("5");
  });

  it("turns an unexpected verifier crash into a generic 500", async () => {
    const { handler } = setup({ verifyToken: vi.fn().mockRejectedValue(new Error("boom: secret internals")) });

    const { status, body } = await read(await handler(jsonRequest({ text: TEXT })));

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("secret internals");
  });

  it("refuses anonymous accounts unless explicitly allowed", async () => {
    const refused = await read(await setup().handler(jsonRequest({ text: TEXT }, auth("anon-token"))));
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden");

    const allowed = await read(await setup({ allowAnonymous: true }).handler(jsonRequest({ text: TEXT }, auth("anon-token"))));
    expect(allowed.status).toBe(200);
  });
});

/* ============================================================
   2. RATE LIMITING
   ============================================================ */

describe("rate limiting", () => {
  it("blocks a user who exceeds their allowance, with Retry-After and a human message", async () => {
    const { handler, deps } = setup({}, { user: 2, ip: 100 });

    expect((await handler(jsonRequest({ text: TEXT }))).status).toBe(200);
    expect((await handler(jsonRequest({ text: TEXT }))).status).toBe(200);

    const { status, body, headers } = await read(await handler(jsonRequest({ text: TEXT })));

    expect(status).toBe(429);
    expect(body).toMatchObject({ success: false, code: "rate_limited" });
    expect(body.error).toMatch(/Too many requests\. Please try again in \d+ (minutes?|seconds?)\./);
    expect(Number(headers.get("retry-after"))).toBeGreaterThan(0);
    expect(deps.analyzeText).toHaveBeenCalledTimes(2); // the blocked request never reached the AI
  });

  it("limits each user separately", async () => {
    const { handler } = setup({}, { user: 1, ip: 100 });

    expect((await handler(jsonRequest({ text: TEXT }, auth("token-1")))).status).toBe(200);
    expect((await handler(jsonRequest({ text: TEXT }, auth("token-1")))).status).toBe(429);
    expect((await handler(jsonRequest({ text: TEXT }, auth("token-2")))).status).toBe(200);
  });

  it("lets a user back in when the window ends", async () => {
    const { handler, clock } = setup({}, { user: 1, ip: 100 });

    await handler(jsonRequest({ text: TEXT }));
    expect((await handler(jsonRequest({ text: TEXT }))).status).toBe(429);

    clock.now += 601_000;

    expect((await handler(jsonRequest({ text: TEXT }))).status).toBe(200);
  });

  it("applies the per-IP limit BEFORE verifying tokens (junk-token floods stay cheap)", async () => {
    const { handler, deps } = setup({}, { user: 10, ip: 2 });

    await handler(jsonRequest({ text: TEXT }, auth("forged-1")));
    await handler(jsonRequest({ text: TEXT }, auth("forged-2")));
    const { status } = await read(await handler(jsonRequest({ text: TEXT }, auth("forged-3"))));

    expect(status).toBe(429);
    expect(deps.verifyToken).toHaveBeenCalledTimes(2); // the third never got as far as the crypto
  });

  it("reports the remaining allowance on every authenticated response", async () => {
    const { handler } = setup({}, { user: 5, ip: 100 });

    const first = await handler(jsonRequest({ text: TEXT }));
    const second = await handler(jsonRequest({ text: TEXT }));

    expect(first.headers.get("x-ratelimit-limit")).toBe("5");
    expect(first.headers.get("x-ratelimit-remaining")).toBe("4");
    expect(second.headers.get("x-ratelimit-remaining")).toBe("3");
  });

  it("counts rejected requests too (probing is not free)", async () => {
    const { handler } = setup({}, { user: 2, ip: 100 });

    await handler(jsonRequest("not json at all"));
    await handler(jsonRequest("still not json"));

    expect((await handler(jsonRequest({ text: TEXT }))).status).toBe(429);
  });

  it("never gives the limiter a raw IP address or user id", async () => {
    const { handler, deps } = setup();

    await handler(jsonRequest({ text: TEXT }, { ...auth(), "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));

    const keys = [...asMock(deps.ipLimiter.check).mock.calls, ...asMock(deps.userLimiter.check).mock.calls].map(
      (call) => call[0] as string
    );

    expect(keys).toHaveLength(2);
    keys.forEach((key) => expect(key).toMatch(/^[0-9a-f]{16}$/));
    expect(keys.join()).not.toMatch(/203\.0\.113\.7|user-1/);
  });
});

/* ============================================================
   3. TEXT PATH
   ============================================================ */

describe("text path (extracted in the browser)", () => {
  it("analyzes the text and returns the result with safe headers", async () => {
    const { handler, deps } = setup();

    const { status, body, headers } = await read(await handler(jsonRequest({ text: TEXT })));

    expect(status).toBe(200);
    expect(body).toEqual(SUCCESS);
    expect(deps.analyzeText).toHaveBeenCalledWith(TEXT);
    expect(deps.extractText).not.toHaveBeenCalled(); // no OCR for text

    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-type")).toContain("application/json");
    expect(headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["malformed JSON", "{ nope"],
    ["an empty body", ""],
    ["invalid UTF-8", new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])],
    ["missing text", { other: 1 }],
    ["text that is too short", { text: "short" }],
    ["text of the wrong type", { text: 123 }],
    ["text that is far too long", { text: "x".repeat(120_001) }],
    ["a JSON array", [TEXT]],
    ["JSON null", "null"],
  ])("answers 400 (not 500) for %s", async (_label, body) => {
    const { handler, deps } = setup();

    const { status, body: result } = await read(await handler(jsonRequest(body)));

    expect(status).toBe(400);
    expect(result.code).toBe("bad_request");
    expect(deps.analyzeText).not.toHaveBeenCalled();
  });

  it("rejects an oversized JSON body with 413", async () => {
    const { handler } = setup();

    const { status, body } = await read(await handler(jsonRequest(JSON.stringify({ text: "x".repeat(MAX_JSON_BYTES + 10) }))));

    expect(status).toBe(413);
    expect(body.code).toBe("too_large");
  });

  it("returns 422 with the reason when the document cannot be analyzed", async () => {
    const { handler } = setup({ analyzeText: vi.fn().mockResolvedValue({ success: false, error: "No readable text." }) });

    const { status, body } = await read(await handler(jsonRequest({ text: TEXT })));

    expect(status).toBe(422);
    expect(body).toEqual({ success: false, error: "No readable text.", code: "unprocessable" });
  });
});

/* ============================================================
   4. FILE PATH
   ============================================================ */

describe("file path (images and PDFs)", () => {
  it("extracts text from a PDF and analyzes it", async () => {
    const { handler, deps } = setup();

    const { status, body } = await read(await handler(filesRequest([file(PDF(), "r.pdf", "application/pdf")])));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(deps.extractText).toHaveBeenCalledTimes(1);
    expect(asMock(deps.extractText).mock.calls[0][0]).toMatch(/^data:application\/pdf;base64,/);
    expect(deps.analyzeText).toHaveBeenCalledWith("Haemoglobin 13.5 g/dL 13 - 17");
  });

  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["WebP", WEBP, "image/webp"],
  ])("recognizes a %s by its bytes, whatever the browser called it", async (_name, make, mime) => {
    const { handler, deps } = setup();

    // The declared type is deliberately wrong: only the bytes decide.
    const { status } = await read(await handler(filesRequest([file(make(), "photo", "text/plain")])));

    expect(status).toBe(200);
    expect(asMock(deps.extractText).mock.calls[0][0]).toMatch(new RegExp(`^data:${mime.replace("/", "\\/")};base64,`));
  });

  it("refuses a file that CLAIMS to be an image but is not (415)", async () => {
    const { handler, deps } = setup();

    const { status, body } = await read(await handler(filesRequest([file("MZ\u0090 this is an executable", "evil.png", "image/png")])));

    expect(status).toBe(415);
    expect(body.code).toBe("unsupported_type");
    expect(deps.extractText).not.toHaveBeenCalled();
  });

  it("joins the text of several files with a blank line", async () => {
    const extractText = vi.fn().mockResolvedValueOnce("page one").mockResolvedValueOnce("page two");
    const { handler, deps } = setup({ extractText });

    await handler(filesRequest([file(JPEG()), file(PNG())]));

    expect(deps.analyzeText).toHaveBeenCalledWith("page one\n\npage two");
  });

  it.each([
    ["no file at all", () => new Request(ENDPOINT, { method: "POST", headers: auth(), body: new FormData() }), 400],
    ["a form field that is not a file", () => { const f = new FormData(); f.append("document", "just text"); return new Request(ENDPOINT, { method: "POST", headers: auth(), body: f }); }, 400],
    ["an empty file", () => filesRequest([file(new Uint8Array(0), "empty.pdf")]), 400],
    ["too many files", () => filesRequest(Array.from({ length: MAX_FILES + 1 }, () => file(JPEG()))), 400],
  ])("answers 400 for %s", async (_label, makeRequest, expected) => {
    const { handler, deps } = setup();

    const { status } = await read(await handler(makeRequest()));

    expect(status).toBe(expected);
    expect(deps.analyzeText).not.toHaveBeenCalled();
  });

  it("answers 400 for a broken multipart body instead of crashing", async () => {
    const { handler } = setup();
    const broken = new Request(ENDPOINT, {
      method: "POST",
      headers: { ...auth(), "content-type": "multipart/form-data; boundary=xyz" },
      body: "this is not a multipart body",
    });

    expect((await read(await handler(broken))).status).toBe(400);
  });

  it("rejects files whose total size is over the limit (413), though the body itself fits", async () => {
    const { handler, deps } = setup();
    const big = () => file(PDF(2_100_000), "big.pdf"); // 2 x 2.1MB = 4.2MB of files, just over the 4MB limit

    const { status, body } = await read(await handler(filesRequest([big(), big()])));

    expect(status).toBe(413);
    expect(body.code).toBe("too_large");
    expect(deps.extractText).not.toHaveBeenCalled();
  });

  it("rejects a body over the hard cap (413) without parsing it", async () => {
    const { handler, deps } = setup();

    const { status } = await read(await handler(filesRequest([file(PDF(MAX_BODY_BYTES + 1_000), "huge.pdf")])));

    expect(status).toBe(413);
    expect(deps.extractText).not.toHaveBeenCalled();
  });

  it("turns a user-facing OCR error into 422 with its message", async () => {
    const { handler } = setup({ extractText: vi.fn().mockRejectedValue(new UserFacingError("This PDF looks like a scan.")) });

    const { status, body } = await read(await handler(filesRequest([file(PDF(), "scan.pdf")])));

    expect(status).toBe(422);
    expect(body.error).toBe("This PDF looks like a scan.");
  });

  it("never leaks internals from an unexpected OCR crash", async () => {
    const { handler } = setup({
      extractText: vi.fn().mockRejectedValue(new Error("sharp failed at /var/task/node_modules/sharp token=abc123")),
    });

    const { status, body } = await read(await handler(filesRequest([file(JPEG())])));

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Document analysis failed. Please try again.", code: "internal" });
  });
});

/* ============================================================
   5. TIME BUDGET AND CANCELLATION
   ============================================================ */

describe("time budget and cancellation", () => {
  it("stops starting new OCR once the budget is spent, so it can still answer before the platform kills it", async () => {
    const { clock, handler, deps } = setup({
      extractText: vi.fn(async () => {
        clock.now += TIME_BUDGET_MS + 1_000; // the first file is very slow
        return "text";
      }),
    });

    const { status, body } = await read(await handler(filesRequest([file(JPEG()), file(PNG())])));

    expect(status).toBe(504);
    expect(body.code).toBe("timeout");
    expect(deps.extractText).toHaveBeenCalledTimes(1); // the second file was never started
    expect(deps.analyzeText).not.toHaveBeenCalled(); // and no AI call is wasted on a doomed request
  });

  it("does not start the AI call when the OCR step used up the budget", async () => {
    const { clock, handler, deps } = setup({
      extractText: vi.fn(async () => {
        clock.now += TIME_BUDGET_MS + 1;
        return "text";
      }),
    });

    expect((await read(await handler(filesRequest([file(JPEG())])))).status).toBe(504);
    expect(deps.analyzeText).not.toHaveBeenCalled();
  });

  it("keeps the budget safely below the route's maxDuration", () => {
    const route = readFileSync(fileURLToPath(new URL("../app/api/analyze-document/route.ts", import.meta.url)), "utf8");
    const maxDuration = Number(/maxDuration\s*=\s*(\d+)/.exec(route)?.[1]);

    expect(TIME_BUDGET_MS / 1_000).toBeLessThan(maxDuration);
  });

  it("stops work for a client that already disconnected (499)", async () => {
    const { handler, deps } = setup();
    const controller = new AbortController();

    const form = new FormData();
    form.append("document", file(JPEG()));
    const request = new Request(ENDPOINT, { method: "POST", headers: auth(), body: form, signal: controller.signal });

    controller.abort();

    const { status } = await read(await handler(request));

    expect(status).toBe(499);
    expect(deps.extractText).not.toHaveBeenCalled();
  });
});

/* ============================================================
   6. SIZE LIMITS ARE ENFORCED WITHOUT TRUSTING HEADERS
   ============================================================ */

describe("size limits", () => {
  it("refuses an oversized Content-Length before doing anything else", async () => {
    const { handler, deps } = setup();

    const request = jsonRequest({ text: TEXT }, { ...auth(), "content-length": String(MAX_BODY_BYTES + 1) });
    const { status, body } = await read(await handler(request));

    expect(status).toBe(413);
    expect(body.code).toBe("too_large");
    expect(deps.ipLimiter.check).not.toHaveBeenCalled();
    expect(deps.verifyToken).not.toHaveBeenCalled();
  });

  it("stops reading a chunked upload that has NO Content-Length once it passes the cap", async () => {
    const { handler, deps } = setup();
    const chunk = new Uint8Array(512 * 1024);
    let pulls = 0;
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk); // would go on forever
      },
      cancel() {
        cancelled = true;
      },
    });

    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: { ...auth(), "content-type": "multipart/form-data; boundary=x" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    const { status } = await read(await handler(request));

    expect(status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(30); // ~4MB cap / 0.5MB chunks: it did not read an unbounded stream
    expect(deps.extractText).not.toHaveBeenCalled();
  });

  it("answers 415 for any other content type", async () => {
    const { handler } = setup();
    const request = new Request(ENDPOINT, { method: "POST", headers: { ...auth(), "content-type": "text/plain" }, body: TEXT });

    const { status, body } = await read(await handler(request));

    expect(status).toBe(415);
    expect(body.code).toBe("unsupported_type");
  });
});

/* ============================================================
   7. EVERY RESPONSE IS SAFE
   ============================================================ */

describe("every response, success or failure", () => {
  it("is JSON with no-store, nosniff and a request id", async () => {
    const { handler } = setup({}, { user: 100, ip: 100 });

    const responses = await Promise.all([
      handler(jsonRequest({ text: TEXT })), // 200
      handler(jsonRequest({ text: TEXT }, {})), // 401
      handler(jsonRequest("{ bad")), // 400
      handler(filesRequest([file("MZ nope")])), // 415
      handler(jsonRequest({ text: TEXT }, { ...auth(), "content-length": "999999999" })), // 413
    ]);

    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([200, 401, 400, 415, 413]));

    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(typeof (await response.json()).success).toBe("boolean");
    }
  });

  it("gives every request its own id", async () => {
    const { handler } = setup();

    const ids = await Promise.all([handler(jsonRequest({ text: TEXT })), handler(jsonRequest({ text: TEXT }))]).then((rs) =>
      rs.map((r) => r.headers.get("x-request-id"))
    );

    expect(ids[0]).not.toBe(ids[1]);
  });
});

/* ============================================================
   8. LOGGING NEVER LEAKS
   ============================================================ */

describe("logging", () => {
  it("records what happened, correlated by request id, without tokens, ids, IPs or document text", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    ["debug", "info", "warn", "error"].forEach((method) => vi.spyOn(console, method as "info").mockImplementation(() => {}));

    const entries: LogEntry[] = [];
    const off = addLogSink((entry) => entries.push(entry));

    const { handler } = setup();
    const secretText = "Haemoglobin 13.5 g/dL SECRET-LAB-VALUE-777";

    const ok = await handler(jsonRequest({ text: secretText }, { ...auth(), "x-forwarded-for": "198.51.100.23" }));
    await handler(jsonRequest({ text: secretText }, { authorization: "Bearer super-secret-forged-token" }));
    off();

    const printed = JSON.stringify(entries);

    expect(printed).not.toMatch(/token-1|super-secret-forged-token|SECRET-LAB-VALUE-777|198\.51\.100\.23|user-1/);

    const completed = entries.find((entry) => entry.message === "Request completed" && entry.data?.status === 200);
    expect(completed?.context?.requestId).toBe(ok.headers.get("x-request-id"));
    expect(completed?.context?.user).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof completed?.data?.ms).toBe("number");

    expect(entries.some((entry) => entry.level === "warn" && entry.message === "Authentication failed")).toBe(true);
  });
});

/* ============================================================
   9. PURE HELPERS
   ============================================================ */

describe("sniffMime", () => {
  it("identifies the four supported types by signature", () => {
    expect(sniffMime(PDF())).toBe("application/pdf");
    expect(sniffMime(JPEG())).toBe("image/jpeg");
    expect(sniffMime(PNG())).toBe("image/png");
    expect(sniffMime(WEBP())).toBe("image/webp");
  });

  it("rejects everything else, including truncated and look-alike data", () => {
    const text = (value: string) => new TextEncoder().encode(value);

    for (const unknown of [
      new Uint8Array(0),
      bytes(0xff),
      bytes(0xff, 0xd8), // JPEG signature cut short
      bytes(0x89, 0x50, 0x4e, 0x47), // PNG signature cut short
      text("RIFF\u0001\u0000\u0000\u0000WAVEfmt "), // RIFF container, but WAV not WebP
      text("GIF89a"),
      text("<html>%PDF</html>"),
      text("MZ"),
    ]) {
      expect(sniffMime(unknown)).toBeNull();
    }
  });
});

describe("getClientIp", () => {
  const ip = (headers: Record<string, string>) => getClientIp(new Headers(headers));

  it("takes the first X-Forwarded-For address, then X-Real-IP", () => {
    expect(ip({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).toBe("203.0.113.7");
    expect(ip({ "x-real-ip": "198.51.100.9" })).toBe("198.51.100.9");
    expect(ip({ "x-forwarded-for": "2001:db8::1" })).toBe("2001:db8::1");
  });

  it("never returns arbitrary client-supplied text", () => {
    expect(ip({ "x-forwarded-for": "<script>alert(1)</script>" })).toBe("unknown");
    expect(ip({ "x-forwarded-for": "not-an-ip", "x-real-ip": "198.51.100.9" })).toBe("198.51.100.9");
    expect(ip({ "x-forwarded-for": "999.1.1.1" })).toBe("unknown");
    expect(ip({})).toBe("unknown");
  });
});

describe("anonymize / formatWait", () => {
  it("hashes deterministically to 16 hex characters", () => {
    expect(anonymize("user-1")).toMatch(/^[0-9a-f]{16}$/);
    expect(anonymize("user-1")).toBe(anonymize("user-1"));
    expect(anonymize("user-1")).not.toBe(anonymize("user-2"));
  });

  it("speaks plainly", () => {
    expect(formatWait(1)).toBe("1 second");
    expect(formatWait(45)).toBe("45 seconds");
    expect(formatWait(60)).toBe("1 minute");
    expect(formatWait(61)).toBe("2 minutes");
    expect(formatWait(600)).toBe("10 minutes");
  });
});

describe("route.ts", () => {
  it("exports only what Next.js allows from a route file (anything else breaks the build)", () => {
    const route = readFileSync(fileURLToPath(new URL("../app/api/analyze-document/route.ts", import.meta.url)), "utf8");
    const exported = [...route.matchAll(/^export\s+(?:const|function|async function)\s+(\w+)/gm)].map((m) => m[1]);

    expect(exported.sort()).toEqual(["POST", "maxDuration", "runtime"]);
  });
});