// src/lib/analyze-document-handler.ts
//
// The logic behind POST /api/analyze-document. It lives here, not in route.ts, because Next.js only
// allows specific exports from a route file (so helpers cannot be exported or unit tested from there).
//
// ORDER OF WORK (cheapest and most protective first; nothing expensive runs before the caller is known):
//   1. size from headers        -> 413
//   2. per-IP rate limit        -> 429   (stops floods of bad tokens)
//   3. verify Firebase ID token -> 401 / 403 / 503
//   4. per-user rate limit      -> 429   (stops one account draining OCR + AI quota)
//   5. read the body with a hard byte cap (works even without Content-Length)
//   6. validate (JSON text or files, checked by real file signature)
//   7. OCR / analysis inside a time budget that stays below the platform's maxDuration

import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

import {
  AuthError,
  getBearerToken,
  getFirebaseProjectId,
  verifyFirebaseIdToken,
  type VerifiedUser,
} from "@/lib/auth-server";
import { analyzeLabText } from "@/lib/document-analysis";
import { UserFacingError } from "@/lib/errors";
import { logger, type Logger } from "@/lib/logger";
import { extractTextFromFile } from "@/lib/ocr";
import {
  createRateLimiter,
  getRedisConfigFromEnv,
  type RateLimiter,
  type RateLimitResult,
} from "@/lib/rate-limit";

/* ============================================================
   LIMITS
   ============================================================ */

/** Vercel rejects request bodies over ~4.5MB, so stay below it. */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** Multipart framing (boundaries, headers) on top of the files themselves. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const MAX_BODY_BYTES = MAX_REQUEST_BYTES + MULTIPART_OVERHEAD_BYTES;

/** 120,000 characters of text is at most ~480KB of UTF-8. */
export const MAX_JSON_BYTES = 512 * 1024;

export const MAX_FILES = 3;

/**
 * Stop starting new work after this long. Must stay below the route's maxDuration (60s), otherwise the
 * platform kills the function and the user gets an empty 504 instead of a useful message.
 */
export const TIME_BUDGET_MS = 50_000;

const ALLOWED_FILE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const textBodySchema = z.object({
  // The browser extracts text from digital PDFs and sends ONLY this.
  text: z.string().min(20, "No readable text.").max(120_000),
});

/* ============================================================
   TYPES
   ============================================================ */

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "bad_request"
  | "too_large"
  | "unsupported_type"
  | "unprocessable"
  | "timeout"
  | "cancelled"
  | "unavailable"
  | "internal";

export interface HandlerDeps {
  verifyToken: (token: string) => Promise<VerifiedUser>;
  ipLimiter: RateLimiter;
  userLimiter: RateLimiter;
  analyzeText: (text: string) => ReturnType<typeof analyzeLabText>;
  extractText: (dataUri: string) => Promise<string>;
  now: () => number;
  /** Anonymous Firebase accounts cost nothing to create, so they are refused unless explicitly allowed. */
  allowAnonymous: boolean;
}

interface RequestState {
  requestId: string;
  started: number;
  log: Logger;
  rate?: RateLimitResult;
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}

/* ============================================================
   SMALL PURE HELPERS (exported for tests)
   ============================================================ */

/** Trust the bytes, not the client-supplied MIME type. */
export function sniffMime(buf: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));

  if (ascii(0, 4) === "%PDF") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => buf[i] === byte)) {
    return "image/png";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";

  return null;
}

/** Vercel overwrites X-Forwarded-For, so its first entry is the real client. Falls back to "unknown". */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && isIP(forwarded)) return forwarded;

  const real = headers.get("x-real-ip")?.trim();
  if (real && isIP(real)) return real;

  return "unknown";
}

/** Rate-limit keys and log fields never contain a raw IP address or user id. */
export function anonymize(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;

  const minutes = Math.ceil(seconds / 60);

  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Reads at most `maxBytes`. Unlike req.json()/formData() this also protects chunked uploads with no Content-Length. */
async function readBodyCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }

    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

/* ============================================================
   DEFAULT DEPENDENCIES
   ============================================================ */

export function createDefaultDeps(): HandlerDeps {
  const redis = getRedisConfigFromEnv();
  const windowSeconds = intFromEnv("ANALYZE_RATE_LIMIT_WINDOW_SECONDS", 600);

  const onFallback = (error: unknown) =>
    logger.warn("Rate limiter fell back to memory", { error: error instanceof Error ? error.name : "UnknownError" });

  if (!redis && process.env.NODE_ENV === "production") {
    logger.warn(
      "Rate limiting is per-instance only. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for limits shared across instances."
    );
  }

  return {
    verifyToken: (token) => verifyFirebaseIdToken(token, { projectId: getFirebaseProjectId() }),
    ipLimiter: createRateLimiter({
      name: "analyze:ip",
      limit: intFromEnv("ANALYZE_RATE_LIMIT_IP", 60),
      windowSeconds,
      redis,
      onFallback,
    }),
    userLimiter: createRateLimiter({
      name: "analyze:user",
      limit: intFromEnv("ANALYZE_RATE_LIMIT_USER", 10),
      windowSeconds,
      redis,
      onFallback,
    }),
    analyzeText: analyzeLabText,
    extractText: extractTextFromFile,
    now: Date.now,
    allowAnonymous: process.env.ALLOW_ANONYMOUS_AUTH === "true",
  };
}

/* ============================================================
   RESPONSES
   Health data must never be cached, sniffed or left uncorrelated.
   ============================================================ */

function reply(state: RequestState, body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": state.requestId,
    ...extraHeaders,
  };

  if (state.rate) {
    headers["X-RateLimit-Limit"] = String(state.rate.limit);
    headers["X-RateLimit-Remaining"] = String(state.rate.remaining);
    headers["X-RateLimit-Reset"] = String(Math.ceil(state.rate.resetAt / 1_000));
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function fail(
  state: RequestState,
  status: number,
  code: ErrorCode,
  error: string,
  extraHeaders?: Record<string, string>
): Response {
  return reply(state, { success: false, error, code }, status, extraHeaders);
}

function rateLimited(state: RequestState, result: RateLimitResult): Response {
  return fail(
    state,
    429,
    "rate_limited",
    `Too many requests. Please try again in ${formatWait(result.retryAfterSeconds)}.`,
    { "Retry-After": String(result.retryAfterSeconds) }
  );
}

/* ============================================================
   HANDLER
   ============================================================ */

export function createAnalyzeDocumentHandler(overrides: Partial<HandlerDeps> = {}) {
  const deps: HandlerDeps = { ...createDefaultDeps(), ...overrides };

  const timeLeft = (state: RequestState) => TIME_BUDGET_MS - (deps.now() - state.started);

  /* ---------- authentication ---------- */

  async function authenticate(req: Request, state: RequestState): Promise<VerifiedUser | Response> {
    const token = getBearerToken(req.headers);

    if (!token) {
      state.log.warn("Authentication failed", { reason: "missing_or_malformed_token" });

      return fail(state, 401, "unauthorized", "Please sign in to analyze a document.", {
        "WWW-Authenticate": 'Bearer realm="analyze-document"',
      });
    }

    try {
      const user = await deps.verifyToken(token);

      if (user.isAnonymous && !deps.allowAnonymous) {
        state.log.warn("Anonymous account refused");

        return fail(state, 403, "forbidden", "Please sign in with an account to analyze documents.");
      }

      return user;
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;

      if (error.reason === "misconfigured") {
        state.log.error("Authentication is not configured (is FIREBASE_PROJECT_ID set?)");

        return fail(state, 500, "internal", "The server is not configured correctly. Please try again later.");
      }

      if (error.reason === "unavailable") {
        state.log.error("Could not reach the token key service");

        return fail(state, 503, "unavailable", "Sign-in checks are temporarily unavailable. Please try again.", {
          "Retry-After": "5",
        });
      }

      state.log.warn("Authentication failed", { reason: error.reason });

      return fail(state, 401, "unauthorized", "Please sign in to analyze a document.", {
        "WWW-Authenticate": 'Bearer realm="analyze-document", error="invalid_token"',
      });
    }
  }

  /* ---------- turning a result into a response ---------- */

  function analysisResponse(state: RequestState, result: Awaited<ReturnType<typeof analyzeLabText>>, extra: Record<string, unknown>): Response {
    state.log.info("Analysis finished", { ...extra, ok: result.success });

    return result.success
      ? reply(state, result, 200)
      : reply(state, { ...result, code: "unprocessable" satisfies ErrorCode }, 422);
  }

  /* ---------- Path A: text the browser already extracted ---------- */

  async function handleText(req: Request, state: RequestState): Promise<Response> {
    const bytes = await readBodyCapped(req, MAX_JSON_BYTES);

    let json: unknown;

    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return fail(state, 400, "bad_request", "The request body is not valid JSON.");
    }

    const parsed = textBodySchema.safeParse(json);

    if (!parsed.success) {
      return fail(state, 400, "bad_request", "No readable text was found in the document.");
    }

    const result = await deps.analyzeText(parsed.data.text);

    return analysisResponse(state, result, { source: "text" });
  }

  /* ---------- Path B: image(s) or a PDF ---------- */

  async function handleFiles(req: Request, state: RequestState): Promise<Response> {
    const bytes = await readBodyCapped(req, MAX_BODY_BYTES);

    let form: FormData;

    try {
      // The boundary in the original header is case-sensitive: pass it through untouched.
      // The cast below is a TypeScript 5.7+ lib.dom.d.ts strictness quirk (Uint8Array<ArrayBufferLike>
      // vs BodyInit's narrower Uint8Array<ArrayBuffer>), not a runtime issue: Node's Response accepts
      // a plain Uint8Array, and every multipart test in analyze-document-handler.test.ts exercises
      // this exact line successfully.
      form = await new Response(bytes as BodyInit, {
        headers: { "content-type": req.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      return fail(state, 400, "bad_request", "The upload could not be read.");
    }

    const files = form.getAll("document").filter((entry): entry is File => typeof entry !== "string");

    if (files.length === 0) return fail(state, 400, "bad_request", "No file uploaded.");

    if (files.length > MAX_FILES) {
      return fail(state, 400, "bad_request", `Please upload at most ${MAX_FILES} files.`);
    }

    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_REQUEST_BYTES) {
      return fail(state, 413, "too_large", "The upload is too large. Please use files under 4 MB in total.");
    }

    const texts: string[] = [];

    for (const file of files) {
      if (req.signal.aborted) return fail(state, 499, "cancelled", "The request was cancelled.");

      if (timeLeft(state) <= 0) {
        return fail(state, 504, "timeout", "The analysis took too long. Please try a clearer or smaller document.");
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      if (buffer.length === 0) return fail(state, 400, "bad_request", "One of the files is empty.");

      // The declared type is ignored on purpose: only the file's own bytes decide what it is.
      const mime = sniffMime(buffer);

      if (!mime || !ALLOWED_FILE_TYPES.has(mime)) {
        return fail(state, 415, "unsupported_type", "Unsupported file type. Use PDF, JPG, PNG or WebP.");
      }

      // Sequential on purpose: one shared OCR worker.
      texts.push(await deps.extractText(`data:${mime};base64,${buffer.toString("base64")}`));
    }

    if (timeLeft(state) <= 0) {
      return fail(state, 504, "timeout", "The analysis took too long. Please try a clearer or smaller document.");
    }

    const result = await deps.analyzeText(texts.join("\n\n"));

    return analysisResponse(state, result, { source: "files", files: files.length });
  }

  /* ---------- pipeline ---------- */

  async function run(req: Request, state: RequestState): Promise<Response> {
    // 1. Cheap rejection from headers alone.
    const declaredLength = Number(req.headers.get("content-length") ?? 0);

    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return fail(state, 413, "too_large", "The upload is too large. Please use a file under 4 MB.");
    }

    // 2. Per-IP limit BEFORE any crypto, so floods of junk tokens are cheap to refuse.
    const ipResult = await deps.ipLimiter.check(anonymize(getClientIp(req.headers)));

    if (!ipResult.allowed) {
      state.log.warn("Rate limited", { scope: "ip" });
      return rateLimited(state, ipResult);
    }

    // 3. Who is this?
    const authenticated = await authenticate(req, state);
    if (authenticated instanceof Response) return authenticated;

    state.log = state.log.child({ user: anonymize(authenticated.uid) });

    // 4. Per-user limit (counted for every authenticated attempt, valid or not).
    const userResult = await deps.userLimiter.check(anonymize(authenticated.uid));
    state.rate = userResult;

    if (!userResult.allowed) {
      state.log.warn("Rate limited", { scope: "user" });
      return rateLimited(state, userResult);
    }

    // 5. Route by content type.
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

    if (contentType.startsWith("application/json")) return handleText(req, state);
    if (contentType.startsWith("multipart/form-data")) return handleFiles(req, state);

    return fail(state, 415, "unsupported_type", "Unsupported request format.");
  }

  function respondToUnexpected(error: unknown, state: RequestState): Response {
    if (error instanceof PayloadTooLargeError) {
      return fail(state, 413, "too_large", "The upload is too large. Please use a file under 4 MB.");
    }

    if (error instanceof UserFacingError) {
      return fail(state, 422, "unprocessable", error.message);
    }

    // Never log document content, never leak internals to the client.
    state.log.error("Unhandled error", { error });

    return fail(state, 500, "internal", "Document analysis failed. Please try again.");
  }

  /* ---------- entry point ---------- */

  return async function POST(req: Request): Promise<Response> {
    const requestId = randomUUID();

    const state: RequestState = {
      requestId,
      started: deps.now(),
      log: logger.child({ requestId }),
    };

    let response: Response;

    try {
      response = await run(req, state);
    } catch (error) {
      response = respondToUnexpected(error, state);
    }

    state.log.info("Request completed", { status: response.status, ms: deps.now() - state.started });

    return response;
  };
}