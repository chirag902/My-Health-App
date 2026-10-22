"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmailAuthProvider, GoogleAuthProvider, deleteUser, reauthenticateWithCredential,
  reauthenticateWithPopup, sendEmailVerification, sendPasswordResetEmail, updateProfile,
} from "firebase/auth";
import { collection, getDocs, writeBatch } from "firebase/firestore";
import {
  AlertTriangle, CalendarDays, CheckCircle2, Loader2, Mail, ShieldCheck, UserRound,
} from "lucide-react";

import { useAuth, useFirestore, useUser } from "@/firebase";
import { logger } from "@/lib/logger";

import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

const MAX_DISPLAY_NAME_LENGTH = 100;
const DELETE_CONFIRM_TEXT = "DELETE";


// Best-effort client-side cleanup before account deletion. Expand this list
// as more features gain Firestore persistence (health-records isn't
// persisted yet per your own project notes, so it's excluded for now).
// USER_SUBCOLLECTIONS_TO_WIPE
const USER_SUBCOLLECTIONS_TO_WIPE = ["motivation", "habits", "journal", "diagnosisFeedback"] as const;


function getFirebaseError(error: unknown) {
  if (error instanceof Error) {
    const firebaseError = error as Error & { code?: string };
    return { code: firebaseError.code ?? "unknown", message: firebaseError.message || "Unknown error" };
  }
  if (error && typeof error === "object") {
    const firebaseError = error as { code?: unknown; message?: unknown };
    return {
      code: typeof firebaseError.code === "string" ? firebaseError.code : "unknown",
      message: typeof firebaseError.message === "string" ? firebaseError.message : "Unknown error",
    };
  }
  return { code: "unknown", message: "Unknown error" };
}

function formatMemberSince(creationTime?: string | null) {
  if (!creationTime) return "Not available";
  const date = new Date(creationTime);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function getAuthProviderLabel(user: { providerData: Array<{ providerId: string }> }) {
  const providerId = user.providerData[0]?.providerId;
  switch (providerId) {
    case "google.com": return "Google";
    case "password": return "Email & Password";
    case "phone": return "Phone";
    default:
      return providerId ? providerId.replace(".com", "").replace(/^\w/, (c) => c.toUpperCase()) : "Firebase Authentication";
  }
}

async function wipeUserCollection(db: ReturnType<typeof useFirestore>, uid: string, collectionName: string) {
  if (!db) return;
  const ref = collection(db, "users", uid, collectionName);
  const snapshot = await getDocs(ref);
  const docs = snapshot.docs;

  for (let i = 0; i < docs.length; i += 450) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + 450)) batch.delete(d.ref);
    await batch.commit();
  }
}

export default function AccountPage() {
  const { user, loading: authLoading } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isSendingPasswordReset, setIsSendingPasswordReset] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);

  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [needsReauthPassword, setNeedsReauthPassword] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
  }, [user?.uid, user?.displayName]);

  const initials = useMemo(() => {
    const name = user?.displayName?.trim();
    if (!name) return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return parts[0][0].toUpperCase();
  }, [user?.displayName]);

  const normalizedCurrentName = displayName.trim();
  const normalizedOriginalName = (user?.displayName ?? "").trim();

  const canUpdateProfile =
    Boolean(user) && !isUpdatingProfile && normalizedCurrentName.length > 0 && normalizedCurrentName !== normalizedOriginalName;

  const isPasswordProvider = user?.providerData[0]?.providerId === "password";

  const handleUpdateProfile = useCallback(async () => {
    if (!user || isUpdatingProfile) return;

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      toast({ variant: "destructive", title: "Invalid display name", description: "Please enter a valid display name." });
      return;
    }
    if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
      toast({ variant: "destructive", title: "Display name is too long", description: `Please keep your display name under ${MAX_DISPLAY_NAME_LENGTH} characters.` });
      return;
    }

    const originalName = (user.displayName ?? "").trim();
    if (trimmedName === originalName) return;

    setIsUpdatingProfile(true);
    try {
      await updateProfile(user, { displayName: trimmedName });
      // Defensive: ensures the Auth user object is current even if the
      // hook's own listener doesn't immediately re-fire on profile edits.
      await user.reload();
      setDisplayName(trimmedName);
      toast({ title: "Profile updated", description: "Your display name has been updated successfully." });
    } catch (error: unknown) {
      const firebaseError = getFirebaseError(error);
      logger.error("Profile update failed", { code: firebaseError.code, error: firebaseError.message });
      toast({ variant: "destructive", title: "Unable to update profile", description: "We couldn't update your profile right now. Please try again." });
    } finally {
      setIsUpdatingProfile(false);
    }
  }, [displayName, isUpdatingProfile, toast, user]);

  const handleChangePassword = useCallback(async () => {
    if (!user || !auth || !user.email || isSendingPasswordReset) return;
    setIsSendingPasswordReset(true);
    try {
      await sendPasswordResetEmail(auth, user.email);
      toast({ title: "Check your email", description: "We've sent a password reset link to your email address." });
    } catch (error: unknown) {
      const firebaseError = getFirebaseError(error);
      logger.error("Password reset request failed", { code: firebaseError.code, error: firebaseError.message });
      toast({ variant: "destructive", title: "Unable to send reset email", description: "Please try again shortly." });
    } finally {
      setIsSendingPasswordReset(false);
    }
  }, [auth, isSendingPasswordReset, toast, user]);

  const handleResendVerification = useCallback(async () => {
    if (!user || isSendingVerification) return;
    setIsSendingVerification(true);
    try {
      await sendEmailVerification(user);
      toast({ title: "Verification email sent", description: "Check your inbox and follow the link to verify your email." });
    } catch (error: unknown) {
      const firebaseError = getFirebaseError(error);
      logger.error("Verification email failed", { code: firebaseError.code, error: firebaseError.message });
      const description = firebaseError.code === "auth/too-many-requests"
        ? "Too many requests. Please wait a few minutes and try again."
        : "We couldn't send the verification email. Please try again.";
      toast({ variant: "destructive", title: "Unable to send verification email", description });
    } finally {
      setIsSendingVerification(false);
    }
  }, [isSendingVerification, toast, user]);

  // REPLACE deletion logic in full:

// src/components/account-page.tsx
// Replace the existing attemptDelete useCallback in full.

const attemptDelete = useCallback(async () => {
  if (!user || !db) return;

  // Client-only state tied to this browser, not Firestore. Cleared first,
  // before any network call, so it's gone even if deletion fails downstream
  // and the user retries — no partial-cleanup state to reconcile.
  try {
    localStorage.removeItem("mha.feedbackConsent.v1");
    localStorage.removeItem("motivation_history_v1");
    localStorage.removeItem("mha.feedbackConsent.v1");
localStorage.removeItem("motivation_history_v1");
localStorage.removeItem("mha.recentCheckins.v1");
localStorage.removeItem("mha.historyConsent.v1");
// mha.lang.v1 intentionally kept — not health data, no consent was required to set it
  } catch {
    /* storage blocked (private mode, disabled storage): non-fatal, continue */
  }

  for (const collectionName of USER_SUBCOLLECTIONS_TO_WIPE) {
    await wipeUserCollection(db, user.uid, collectionName);
  }

  await deleteUser(user);

  toast({ title: "Account deleted", description: "Your account and data have been removed." });
  router.push("/login");
}, [db, router, toast, user]);

const handleDeleteAccount = useCallback(async () => {
  if (!user || isDeletingAccount || deleteConfirmText !== DELETE_CONFIRM_TEXT) return;

  setIsDeletingAccount(true);
  try {
    await attemptDelete();
  } catch (error: unknown) {
    const firebaseError = getFirebaseError(error);

    if (firebaseError.code === "auth/requires-recent-login") {
      const providerId = user.providerData[0]?.providerId;

      try {
        if (providerId === "google.com") {
          await reauthenticateWithPopup(user, new GoogleAuthProvider());
          await attemptDelete();
          return;
        }
        if (providerId === "password") {
          setNeedsReauthPassword(true);
          toast({ title: "Please confirm your password", description: "For security, re-enter your password to finish deleting your account." });
          return;
        }
        toast({ variant: "destructive", title: "Please sign in again", description: "Log out and back in, then retry deleting your account." });
      } catch (reauthError: unknown) {
        const reauthFirebaseError = getFirebaseError(reauthError);
        logger.error("Reauthentication failed", { code: reauthFirebaseError.code, error: reauthFirebaseError.message });
        toast({ variant: "destructive", title: "Reauthentication failed", description: "Please log out and back in, then retry." });
      }
    } else {
      // NOTE: a failure here (e.g. mid-wipe network drop) may leave the
      // account alive with SOME subcollections already deleted and others
      // not. This is intentional — re-running delete is idempotent (wiping
      // an already-empty collection is a harmless no-op), so instruct the
      // user to just retry rather than treating this as data corruption.
      logger.error("Account deletion failed", { code: firebaseError.code, error: firebaseError.message });
      toast({ variant: "destructive", title: "Deletion incomplete", description: "Some data may have been partially removed. Please try deleting again." });
    }
  } finally {
    setIsDeletingAccount(false);
  }
}, [attemptDelete, deleteConfirmText, isDeletingAccount, toast, user]);

// handleReauthWithPassword — state declarations removed, logic unchanged:
const handleReauthWithPassword = useCallback(async () => {
  if (!user || !user.email || !reauthPassword || isDeletingAccount) return;

  setIsDeletingAccount(true);
  try {
    const credential = EmailAuthProvider.credential(user.email, reauthPassword);
    await reauthenticateWithCredential(user, credential);
    await attemptDelete();
  } catch (error: unknown) {
    const firebaseError = getFirebaseError(error);
    logger.error("Password reauth failed", { code: firebaseError.code, error: firebaseError.message });
    const description = firebaseError.code === "auth/invalid-credential" || firebaseError.code === "auth/wrong-password"
      ? "Incorrect password. Please try again."
      : "Reauthentication failed. Please try again.";
    toast({ variant: "destructive", title: "Unable to confirm identity", description });
  } finally {
    setIsDeletingAccount(false);
    setReauthPassword("");
  }
}, [attemptDelete, isDeletingAccount, reauthPassword, toast, user]);

  if (authLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center" aria-label="Loading account" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Loading account</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-16 text-center">
        <UserRound className="mx-auto mb-4 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-muted-foreground">Please log in to view your account.</p>
      </div>
    );
  }

  const memberSince = formatMemberSince(user.metadata.creationTime);
  const authProvider = getAuthProviderLabel(user);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar className="h-20 w-20 shrink-0 text-3xl">
              <AvatarFallback className="bg-primary text-primary-foreground">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="truncate text-3xl">{user.displayName || "User"}</CardTitle>
              <CardDescription className="mt-1 flex items-center gap-2 truncate">
                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{user.email || "No email address available"}</span>
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <section aria-labelledby="account-overview">
            <h2 id="account-overview" className="mb-4 text-lg font-semibold">Account Overview</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="border-none bg-muted/50 shadow-none">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Account Status</CardTitle>
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-green-500" aria-hidden="true" />
                    <span className="text-2xl font-bold">Active</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Your account is currently signed in.</p>
                </CardContent>
              </Card>
              <Card className="border-none bg-muted/50 shadow-none">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Member Since</CardTitle>
                  <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold">{memberSince}</div>
                  <p className="mt-1 text-xs text-muted-foreground">MyHealthApp account</p>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          <section aria-labelledby="authentication-information">
            <h2 id="authentication-information" className="mb-4 text-lg font-semibold">Authentication</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="border-none bg-muted/50 shadow-none">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Sign-in Method</CardTitle>
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-semibold">{authProvider}</div>
                  <p className="mt-1 text-xs text-muted-foreground">Authentication is managed by Firebase.</p>
                </CardContent>
              </Card>
              <Card className="border-none bg-muted/50 shadow-none">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Email Verification</CardTitle>
                  <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-semibold">{user.emailVerified ? "Verified" : "Not verified"}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {user.emailVerified ? "Your email address has been verified." : "Your email address has not been verified yet."}
                  </p>
                  {!user.emailVerified && (
                    <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void handleResendVerification()} disabled={isSendingVerification}>
                      {isSendingVerification ? (<><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Sending...</>) : "Resend verification email"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          <section aria-labelledby="profile-information">
            <h2 id="profile-information" className="mb-4 text-lg font-semibold">Profile Information</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName" name="displayName" type="text" value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={MAX_DISPLAY_NAME_LENGTH} autoComplete="name" spellCheck={false} disabled={isUpdatingProfile}
                  />
                  <p className="text-xs text-muted-foreground">{displayName.length}/{MAX_DISPLAY_NAME_LENGTH}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountEmail">Email Address</Label>
                  <Input id="accountEmail" name="email" type="email" value={user.email ?? ""} autoComplete="email" disabled readOnly />
                  <p className="text-xs text-muted-foreground">Email changes are managed through the authentication system.</p>
                </div>
              </div>
              <Button type="button" onClick={() => void handleUpdateProfile()} disabled={!canUpdateProfile}>
                {isUpdatingProfile ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Updating...</>) : "Update Profile"}
              </Button>
            </div>
          </section>

          <Separator />

          <section aria-labelledby="account-security">
            <h2 id="account-security" className="mb-4 text-lg font-semibold">Security</h2>
            <div className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="font-medium">Account security</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your account is protected by Firebase Authentication. Firestore access is restricted by your application's security rules.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              {isPasswordProvider ? (
                <Button type="button" variant="outline" onClick={() => void handleChangePassword()} disabled={isSendingPasswordReset}>
                  {isSendingPasswordReset ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</>) : "Change Password"}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your account uses {authProvider} sign-in — password changes are managed by {authProvider}.
                </p>
              )}
              {isPasswordProvider && (
                <p className="mt-2 text-xs text-muted-foreground">We'll email you a secure link to set a new password.</p>
              )}
            </div>
          </section>

          <Separator />

          <section aria-labelledby="danger-zone">
            <h2 id="danger-zone" className="mb-4 text-lg font-semibold text-destructive">Danger Zone</h2>
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-medium">Delete account</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Permanently deletes your account and your journal, habit, and motivation history. This cannot be undone.
                  </p>

                  {!showDeleteConfirm ? (
                    <Button type="button" variant="destructive" size="sm" className="mt-3" onClick={() => setShowDeleteConfirm(true)}>
                      Delete my account
                    </Button>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <Label htmlFor="deleteConfirm" className="text-xs">
                        Type <span className="font-mono font-bold">{DELETE_CONFIRM_TEXT}</span> to confirm
                      </Label>
                      <Input
                        id="deleteConfirm" value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        disabled={isDeletingAccount} className="max-w-xs"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button" variant="destructive" size="sm"
                          onClick={() => void handleDeleteAccount()}
                          disabled={isDeletingAccount || deleteConfirmText !== DELETE_CONFIRM_TEXT}
                        >
                          {isDeletingAccount ? (<><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Deleting...</>) : "Permanently delete"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }} disabled={isDeletingAccount}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </CardContent>

        <CardFooter>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Your account information is managed through authenticated Firebase services.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}