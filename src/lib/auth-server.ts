// src/lib/auth-server.ts
//
// Verifies Firebase ID tokens on the server WITHOUT firebase-admin and WITHOUT any secret.
// Firebase signs ID tokens with Google's private keys; we check them against Google's PUBLIC keys,
// following Firebase's documented checklist:
//   - signature (RS256 only, key matched by "kid")
//   - iss  = https://securetoken.google.com/<projectId>
//   - aud  = <projectId>
//   - exp / nbf in range, iat and auth_time not in the future
//   - sub  = a non-empty user id
//
// Limitation (same as any offline JWT check): a token revoked in the last hour still verifies until it
// expires. firebase-admin's verifyIdToken(token, true) is the way to close that gap if you ever need it.
//
// Required env var:  FIREBASE_PROJECT_ID   (or NEXT_PUBLIC_FIREBASE_PROJECT_ID)

import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";

/* ============================================================
   TYPES
   ============================================================ */

export type AuthFailureReason =
  | "missing_token"
  | "malformed_token"
  | "invalid_token"
  | "unavailable" // Google's key server could not be reached: not the user's fault
  | "misconfigured"; // the server has no project id: not the user's fault

export class AuthError extends Error {
  readonly reason: AuthFailureReason;

  constructor(reason: AuthFailureReason, message?: string) {
    super(message ?? reason);
    this.name = "AuthError";
    this.reason = reason;
  }
}

export interface VerifiedUser {
  uid: string;
  isAnonymous: boolean;
  emailVerified: boolean;
}

export interface VerifyOptions {
  projectId: string | undefined;
  /** Injected in tests. Defaults to Google's public keys. */
  jwks?: JWTVerifyGetKey;
  /** Injected in tests. */
  now?: Date;
}

/* ============================================================
   CONSTANTS
   ============================================================ */

const GOOGLE_JWKS_URL = new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
);

/** Real Firebase ID tokens are roughly 900 to 1,500 characters. Anything far larger is an attack, not a token. */
export const MAX_TOKEN_LENGTH = 4_096;

const CLOCK_TOLERANCE_SECONDS = 60;

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-_=.]+)$/i;

let remoteKeys: JWTVerifyGetKey | undefined;

/** One shared, cached key set per server instance (keys are re-fetched only when needed). */
function defaultKeys(): JWTVerifyGetKey {
  remoteKeys ??= createRemoteJWKSet(GOOGLE_JWKS_URL, {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });

  return remoteKeys;
}

/* ============================================================
   HELPERS
   ============================================================ */

export function getFirebaseProjectId(): string | undefined {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined;
}

/** Extracts the token from "Authorization: Bearer <token>", or null if absent or malformed. */
export function getBearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");

  if (!header || header.length > MAX_TOKEN_LENGTH + 16) return null;

  const match = BEARER_PATTERN.exec(header.trim());

  return match ? match[1] : null;
}

function classify(error: unknown): AuthError {
  if (error instanceof joseErrors.JWKSTimeout) return new AuthError("unavailable");

  if (error instanceof joseErrors.JOSEError) {
    // jose reports a failed key download (HTTP error from Google) as a generic error.
    if (error.code === "ERR_JOSE_GENERIC" && /JSON Web Key Set/i.test(error.message)) {
      return new AuthError("unavailable");
    }

    return new AuthError("invalid_token");
  }

  // Network failures while fetching keys surface as plain errors.
  return new AuthError("unavailable");
}

/* ============================================================
   VERIFY
   ============================================================ */

export async function verifyFirebaseIdToken(token: string, options: VerifyOptions): Promise<VerifiedUser> {
  const { projectId } = options;

  if (!projectId) {
    throw new AuthError("misconfigured", "FIREBASE_PROJECT_ID is not set");
  }

  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new AuthError("malformed_token");
  }

  const now = options.now ?? new Date();

  let payload;

  try {
    ({ payload } = await jwtVerify(token, options.jwks ?? defaultKeys(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"], // never accept "none" or HMAC variants
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: now,
    }));
  } catch (error) {
    throw classify(error);
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const latestAllowed = nowSeconds + CLOCK_TOLERANCE_SECONDS;

  const { sub, iat } = payload;
  const authTime = (payload as { auth_time?: unknown }).auth_time;

  if (typeof sub !== "string" || sub.length === 0 || sub.length > 128) {
    throw new AuthError("invalid_token", "missing subject");
  }

  // jose does not check "iat"; Firebase's checklist does.
  if (typeof iat !== "number" || iat > latestAllowed) {
    throw new AuthError("invalid_token", "issued in the future");
  }

  if (typeof authTime !== "number" || authTime > latestAllowed) {
    throw new AuthError("invalid_token", "authenticated in the future");
  }

  const firebase = (payload as { firebase?: { sign_in_provider?: unknown } }).firebase;

  return {
    uid: sub,
    isAnonymous: firebase?.sign_in_provider === "anonymous",
    emailVerified: (payload as { email_verified?: unknown }).email_verified === true,
  };
}