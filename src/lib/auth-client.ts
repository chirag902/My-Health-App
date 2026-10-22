// src/lib/auth-client.ts  (browser only)
//
// Gets the signed-in user's Firebase ID token to send as "Authorization: Bearer <token>".
// The Firebase SDK caches the token and refreshes it automatically shortly before it expires;
// `forceRefresh` is only for recovering after the server answered 401.
//
// IMPORTANT: this uses initializeFirebase() from @/firebase/config -- the SAME function
// FirebaseClientProvider calls to set up the app for the rest of this project -- rather than a
// bare getAuth(). initializeApp()/getAuth() are idempotent (calling them again just returns the
// already-registered app/auth instance), so this is safe to call from here too, and it removes any
// chance of silently reading a DIFFERENT Firebase app than the one the user actually signed into.
//
// WHY onAuthStateChanged INSTEAD OF auth.currentUser:
// On page load, Firebase restores the session from storage ASYNCHRONOUSLY. Reading
// `auth.currentUser` right away can see "nobody signed in" even though the user really is,
// simply because that restore has not finished yet -- more likely on a slow connection or a
// freshly loaded tab. onAuthStateChanged's FIRST callback only fires once that restore is done,
// so it is the reliable signal. A short timeout stops a genuinely signed-out user waiting forever.

import { onAuthStateChanged, type Auth, type User } from "firebase/auth";

import { initializeFirebase } from "@/firebase/config";
import { UserFacingError } from "@/lib/errors";

const SIGN_IN_MESSAGE = "Please sign in to analyze a document.";
const AUTH_READY_TIMEOUT_MS = 8_000;

function waitForCurrentUser(auth: Auth): Promise<User | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(auth.currentUser); // best effort: use whatever we have after waiting
    }, AUTH_READY_TIMEOUT_MS);

    // The first call happens as soon as Firebase has finished checking storage for a session,
    // signed in or not -- exactly the signal we need.
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(null);
      }
    );
  });
}

export async function getIdToken(forceRefresh = false): Promise<string> {
  let auth: Auth;

  try {
    ({ auth } = initializeFirebase());
  } catch {
    // Firebase has not been initialised on this page.
    throw new UserFacingError(SIGN_IN_MESSAGE);
  }

  const user = auth.currentUser ?? (await waitForCurrentUser(auth));

  if (!user) throw new UserFacingError(SIGN_IN_MESSAGE);

  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    throw new UserFacingError("Your session could not be refreshed. Please sign in again.");
  }
}