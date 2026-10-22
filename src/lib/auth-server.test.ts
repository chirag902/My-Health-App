// @vitest-environment node
import { createLocalJWKSet, errors as joseErrors, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  AuthError,
  getBearerToken,
  getFirebaseProjectId,
  MAX_TOKEN_LENGTH,
  verifyFirebaseIdToken,
} from "./auth-server";

/* ============================================================
   A REAL KEY PAIR AND REAL SIGNED TOKENS (nothing about the signature is mocked)
   ============================================================ */

const PROJECT = "my-health-app";
const ISSUER = `https://securetoken.google.com/${PROJECT}`;
const NOW = new Date("2026-10-16T10:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

let goodKey: CryptoKey;
let otherKey: CryptoKey;
let goodPublicKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const good = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256");

  goodKey = good.privateKey;
  goodPublicKey = good.publicKey;
  otherKey = other.privateKey;

  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(good.publicKey)), kid: "key-1", alg: "RS256", use: "sig" }] });
});

interface TokenOptions {
  key?: CryptoKey | Uint8Array;
  alg?: string;
  kid?: string;
  iss?: string;
  aud?: string;
  sub?: string | null;
  iat?: number;
  exp?: number;
  nbf?: number;
  /** extra/overriding payload claims; `undefined` removes a default claim */
  claims?: Record<string, unknown>;
}

async function sign(options: TokenOptions = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    auth_time: NOW_S - 30,
    firebase: { sign_in_provider: "password" },
    ...options.claims,
  };

  for (const [name, value] of Object.entries(payload)) if (value === undefined) delete payload[name];

  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: options.alg ?? "RS256", kid: options.kid ?? "key-1" })
    .setIssuer(options.iss ?? ISSUER)
    .setAudience(options.aud ?? PROJECT)
    .setIssuedAt(options.iat ?? NOW_S - 30)
    .setExpirationTime(options.exp ?? NOW_S + 3_600);

  if (options.sub !== null) jwt.setSubject(options.sub ?? "user-123");
  if (options.nbf !== undefined) jwt.setNotBefore(options.nbf);

  return jwt.sign(options.key ?? goodKey);
}

const verify = (token: string, extra: Partial<Parameters<typeof verifyFirebaseIdToken>[1]> = {}) =>
  verifyFirebaseIdToken(token, { projectId: PROJECT, jwks, now: NOW, ...extra });

const rejectsWith = (promise: Promise<unknown>, reason: string) =>
  expect(promise).rejects.toMatchObject({ name: "AuthError", reason });

afterEach(() => vi.unstubAllEnvs());

/* ============================================================
   VALID TOKENS
   ============================================================ */

describe("valid tokens", () => {
  it("accepts a correctly signed Firebase token and returns the user id", async () => {
    expect(await verify(await sign())).toEqual({ uid: "user-123", isAnonymous: false, emailVerified: false });
  });

  it("reports anonymous sign-ins and verified emails", async () => {
    const anonymous = await verify(await sign({ claims: { firebase: { sign_in_provider: "anonymous" } } }));
    const verified = await verify(await sign({ claims: { email_verified: true } }));

    expect(anonymous.isAnonymous).toBe(true);
    expect(verified.emailVerified).toBe(true);
  });

  it("tolerates a little clock drift but not a lot", async () => {
    await expect(verify(await sign({ exp: NOW_S - 30 }))).resolves.toBeDefined(); // expired 30s ago: within 60s tolerance
    await rejectsWith(verify(await sign({ exp: NOW_S - 120 })), "invalid_token");
  });
});

/* ============================================================
   FORGED OR WRONG TOKENS
   ============================================================ */

describe("rejected tokens", () => {
  it("rejects a token signed by someone else's key", async () => {
    await rejectsWith(verify(await sign({ key: otherKey })), "invalid_token");
  });

  it("rejects a token whose key id is unknown", async () => {
    await rejectsWith(verify(await sign({ kid: "no-such-key" })), "invalid_token");
  });

  it("rejects the wrong audience (a token for a DIFFERENT Firebase project)", async () => {
    await rejectsWith(verify(await sign({ aud: "someone-elses-project" })), "invalid_token");
  });

  it("rejects the wrong issuer", async () => {
    await rejectsWith(verify(await sign({ iss: "https://evil.example.com" })), "invalid_token");
    await rejectsWith(verify(await sign({ iss: "https://securetoken.google.com/other-project" })), "invalid_token");
  });

  it("rejects an expired token and a token that is not valid yet", async () => {
    await rejectsWith(verify(await sign({ exp: NOW_S - 3_600 })), "invalid_token");
    await rejectsWith(verify(await sign({ nbf: NOW_S + 600 })), "invalid_token");
  });

  it("rejects a token without a subject or with an absurd one", async () => {
    await rejectsWith(verify(await sign({ sub: null })), "invalid_token");
    await rejectsWith(verify(await sign({ sub: "x".repeat(200) })), "invalid_token");
  });

  it("rejects 'issued in the future' and 'authenticated in the future' (Firebase's own checklist)", async () => {
    await rejectsWith(verify(await sign({ iat: NOW_S + 600 })), "invalid_token");
    await rejectsWith(verify(await sign({ claims: { auth_time: NOW_S + 600 } })), "invalid_token");
  });

  it("requires an auth_time claim", async () => {
    await rejectsWith(verify(await sign({ claims: { auth_time: undefined } })), "invalid_token");
  });
});

/* ============================================================
   CLASSIC JWT ATTACKS
   ============================================================ */

describe("JWT attacks", () => {
  it("rejects an unsigned token ('alg: none')", async () => {
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      iss: ISSUER,
      aud: PROJECT,
      sub: "attacker",
      iat: NOW_S - 30,
      auth_time: NOW_S - 30,
      exp: NOW_S + 3_600,
    })}.`;

    await rejectsWith(verify(forged), "invalid_token");
  });

  it("rejects algorithm confusion (HS256 signed with the PUBLIC key as the secret)", async () => {
    const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("spki", goodPublicKey));
    const forged = await sign({ alg: "HS256", key: publicKeyBytes });

    await rejectsWith(verify(forged), "invalid_token");
  });

  it("rejects tokens that merely look like JWTs", async () => {
    for (const junk of ["a.b.c", "....", "eyJhbGciOiJSUzI1NiJ9.e30.", "not a token", "🦄"]) {
      await rejectsWith(verify(junk), "invalid_token");
    }
  });

  it("rejects a tampered payload", async () => {
    const [header, , signature] = (await sign()).split(".");
    const evilPayload = Buffer.from(
      JSON.stringify({ iss: ISSUER, aud: PROJECT, sub: "admin", iat: NOW_S - 30, auth_time: NOW_S - 30, exp: NOW_S + 3_600 })
    ).toString("base64url");

    await rejectsWith(verify(`${header}.${evilPayload}.${signature}`), "invalid_token");
  });
});

/* ============================================================
   INPUT LIMITS + SERVER PROBLEMS
   ============================================================ */

describe("limits and server-side problems", () => {
  it("rejects empty and oversized tokens before doing any crypto", async () => {
    await rejectsWith(verify(""), "malformed_token");
    await rejectsWith(verify("a".repeat(MAX_TOKEN_LENGTH + 1)), "malformed_token");
  });

  it("is a SERVER error (not the user's fault) when the project id is missing", async () => {
    await rejectsWith(verifyFirebaseIdToken(await sign(), { projectId: undefined, jwks, now: NOW }), "misconfigured");
    await rejectsWith(verifyFirebaseIdToken(await sign(), { projectId: "", jwks, now: NOW }), "misconfigured");
  });

  it("is 'unavailable', not 'invalid', when Google's key server cannot be reached", async () => {
    const networkDown: JWTVerifyGetKey = async () => {
      throw new TypeError("fetch failed");
    };
    const timedOut: JWTVerifyGetKey = async () => {
      throw new joseErrors.JWKSTimeout();
    };
    const googleError: JWTVerifyGetKey = async () => {
      throw new joseErrors.JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
    };

    const token = await sign();

    await rejectsWith(verify(token, { jwks: networkDown }), "unavailable");
    await rejectsWith(verify(token, { jwks: timedOut }), "unavailable");
    await rejectsWith(verify(token, { jwks: googleError }), "unavailable");
  });

  it("only ever throws AuthError", async () => {
    for (const token of [await sign({ key: otherKey }), "junk", "", "a".repeat(10_000)]) {
      await expect(verify(token)).rejects.toBeInstanceOf(AuthError);
    }
  });
});

/* ============================================================
   HEADER + ENV HELPERS
   ============================================================ */

describe("getBearerToken", () => {
  const headers = (value?: string) => new Headers(value === undefined ? {} : { authorization: value });

  it("extracts the token", () => {
    expect(getBearerToken(headers("Bearer abc.def-ghi_jkl="))).toBe("abc.def-ghi_jkl=");
    expect(getBearerToken(headers("bearer abc"))).toBe("abc");
    expect(getBearerToken(headers("  Bearer abc  "))).toBe("abc");
  });

  it.each([undefined, "", "Bearer", "Bearer ", "Basic abc", "Token abc", "Bearer a b", "Bearer abc!", "Bearer <script>", "abc"])(
    "returns null for %j",
    (value) => {
      expect(getBearerToken(headers(value))).toBeNull();
    }
  );

  it("returns null for an oversized header", () => {
    expect(getBearerToken(headers(`Bearer ${"a".repeat(MAX_TOKEN_LENGTH + 100)}`))).toBeNull();
  });
});

describe("getFirebaseProjectId", () => {
  it("prefers the server variable, falls back to the public one, and is undefined otherwise", () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "");
    expect(getFirebaseProjectId()).toBeUndefined();

    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "public-id");
    expect(getFirebaseProjectId()).toBe("public-id");

    vi.stubEnv("FIREBASE_PROJECT_ID", "server-id");
    expect(getFirebaseProjectId()).toBe("server-id");
  });
});