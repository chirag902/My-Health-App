// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ initializeFirebase: vi.fn(), onAuthStateChanged: vi.fn() }));

vi.mock("firebase/auth", () => ({ onAuthStateChanged: mocks.onAuthStateChanged }));
vi.mock("@/firebase/config", () => ({ initializeFirebase: mocks.initializeFirebase }));

import { getIdToken } from "./auth-client";
import { UserFacingError } from "./errors";

afterEach(() => {
  mocks.initializeFirebase.mockReset();
  mocks.onAuthStateChanged.mockReset();
  vi.useRealTimers();
});

const SIGN_IN = "Please sign in to analyze a document.";

function signedInAuth(token = "abc.def.ghi") {
  const user = { getIdToken: vi.fn().mockResolvedValue(token) };
  return { auth: { currentUser: user }, user };
}

/** initializeFirebase() always returns { app, auth, firestore }; only `auth` matters here. */
function mockInitializeFirebase(auth: unknown) {
  mocks.initializeFirebase.mockReturnValue({ app: {}, auth, firestore: {} });
}

/** A fake onAuthStateChanged that never calls back on its own; the test fires it manually. */
function controllableListener() {
  const unsubscribe = vi.fn();
  let fireNext: ((user: unknown) => void) | null = null;
  let fireError: ((error: unknown) => void) | null = null;

  mocks.onAuthStateChanged.mockImplementation((_auth, onNext, onError) => {
    fireNext = onNext;
    fireError = onError;
    return unsubscribe;
  });

  return {
    unsubscribe,
    fireNext: (user: unknown) => fireNext?.(user),
    fireError: (error: unknown) => fireError?.(error),
  };
}

describe("getIdToken", () => {
  it("returns the signed-in user's token and does not force a refresh by default", async () => {
    const { auth, user } = signedInAuth();
    mockInitializeFirebase(auth);

    expect(await getIdToken()).toBe("abc.def.ghi");
    expect(user.getIdToken).toHaveBeenCalledWith(false);
  });

  it("never subscribes to auth state when a user is already known (fast path)", async () => {
    const { auth } = signedInAuth();
    mockInitializeFirebase(auth);

    await getIdToken();

    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled();
  });

  it("forces a refresh when asked (used after a 401)", async () => {
    const { auth, user } = signedInAuth("fresh");
    mockInitializeFirebase(auth);

    expect(await getIdToken(true)).toBe("fresh");
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });

  it("asks the user to sign in when Firebase confirms nobody is signed in", async () => {
    mockInitializeFirebase({ currentUser: null });
    const listener = controllableListener();

    const pending = getIdToken();
    listener.fireNext(null); // Firebase finished checking storage: genuinely signed out

    await expect(pending).rejects.toMatchObject({ name: "UserFacingError", message: SIGN_IN });
    expect(listener.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("asks the user to sign in when Firebase is not initialised at all", async () => {
    mocks.initializeFirebase.mockImplementation(() => {
      throw new Error("Firebase: No Firebase App '[DEFAULT]' has been created");
    });

    await expect(getIdToken()).rejects.toMatchObject({ name: "UserFacingError", message: SIGN_IN });
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled();
  });

  it("reads the SAME app the rest of the project uses, not a bare default", async () => {
    const { auth } = signedInAuth();
    mockInitializeFirebase(auth);

    await getIdToken();

    expect(mocks.initializeFirebase).toHaveBeenCalledTimes(1);
  });

  it("waits for Firebase to restore the session after a page load, instead of seeing 'nobody'", async () => {
    const user = { getIdToken: vi.fn().mockResolvedValue("restored") };
    mockInitializeFirebase({ currentUser: null });
    const listener = controllableListener();

    const pending = getIdToken();
    listener.fireNext(user); // the restore finishes a tick later, with a real user

    expect(await pending).toBe("restored");
    expect(listener.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("treats an auth-state error as signed out, instead of hanging", async () => {
    mockInitializeFirebase({ currentUser: null });
    const listener = controllableListener();

    const pending = getIdToken();
    listener.fireError(new Error("permission-denied"));

    await expect(pending).rejects.toMatchObject({ name: "UserFacingError", message: SIGN_IN });
  });

  it("gives up after a timeout instead of waiting forever for a restore that never finishes", async () => {
    vi.useFakeTimers();
    mockInitializeFirebase({ currentUser: null });
    controllableListener(); // registers, but this test never fires it

    const pending = getIdToken();
    const assertion = expect(pending).rejects.toMatchObject({ name: "UserFacingError", message: SIGN_IN });

    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });

  it("uses whatever currentUser is available once the timeout fires, even if the listener never called back", async () => {
    vi.useFakeTimers();
    const user = { getIdToken: vi.fn().mockResolvedValue("late-but-present") };
    const auth: { currentUser: unknown } = { currentUser: null };
    mockInitializeFirebase(auth);
    controllableListener();

    const pending = getIdToken();
    auth.currentUser = user; // set by some other part of the app, without going through our listener
    await vi.advanceTimersByTimeAsync(8_000);

    expect(await pending).toBe("late-but-present");
  });

  it("ignores a late callback after the timeout has already settled the promise", async () => {
    vi.useFakeTimers();
    mockInitializeFirebase({ currentUser: null });
    const listener = controllableListener();

    const pending = getIdToken();
    // Attach the rejection handler BEFORE advancing timers, so Node never sees an
    // unhandled rejection even for the instant between the reject and this assertion.
    const assertion = expect(pending).rejects.toMatchObject({ name: "UserFacingError" });
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;

    // Must not throw or resolve a second time.
    expect(() => listener.fireNext(signedInAuth().user)).not.toThrow();
  });

  it("reports an unrefreshable session without exposing Firebase's internal message", async () => {
    const user = { getIdToken: vi.fn().mockRejectedValue(new Error("auth/network-request-failed: secret internals")) };
    mockInitializeFirebase({ currentUser: user });

    const error = await getIdToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe("Your session could not be refreshed. Please sign in again.");
    expect((error as Error).message).not.toContain("secret internals");
  });
});