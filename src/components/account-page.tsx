"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { updateProfile } from "firebase/auth";
import {
  CalendarDays,
  CheckCircle2,
  Loader2,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { useUser } from "@/firebase";
import { logger } from "@/lib/logger";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

const MAX_DISPLAY_NAME_LENGTH = 100;

function getFirebaseError(error: unknown) {
  if (error instanceof Error) {
    const firebaseError = error as Error & {
      code?: string;
    };

    return {
      code: firebaseError.code ?? "unknown",
      message: firebaseError.message || "Unknown error",
    };
  }

  if (error && typeof error === "object") {
    const firebaseError = error as {
      code?: unknown;
      message?: unknown;
    };

    return {
      code:
        typeof firebaseError.code === "string"
          ? firebaseError.code
          : "unknown",
      message:
        typeof firebaseError.message === "string"
          ? firebaseError.message
          : "Unknown error",
    };
  }

  return {
    code: "unknown",
    message: "Unknown error",
  };
}

function formatMemberSince(creationTime?: string | null) {
  if (!creationTime) {
    return "Not available";
  }

  const date = new Date(creationTime);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function getAuthProviderLabel(user: {
  providerData: Array<{ providerId: string }>;
}) {
  const providerId = user.providerData[0]?.providerId;

  switch (providerId) {
    case "google.com":
      return "Google";

    case "password":
      return "Email & Password";

    case "phone":
      return "Phone";

    default:
      return providerId
        ? providerId.replace(".com", "").replace(/^\w/, (char) => char.toUpperCase())
        : "Firebase Authentication";
  }
}

export default function AccountPage() {
  const { user, loading: authLoading } = useUser();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  /*
   * Keep the editable display name synchronized with
   * the Firebase Authentication profile.
   */
  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
  }, [user?.uid, user?.displayName]);

  /*
   * Generate compact initials for the profile avatar.
   */
  const initials = useMemo(() => {
    const name = user?.displayName?.trim();

    if (!name) {
      return "U";
    }

    const parts = name.split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return parts[0][0].toUpperCase();
  }, [user?.displayName]);

  /*
   * Normalize the current and original display names so that
   * unnecessary Firebase update requests are avoided.
   */
  const normalizedCurrentName = displayName.trim();

  const normalizedOriginalName = (user?.displayName ?? "").trim();

  const canUpdateProfile =
    Boolean(user) &&
    !isUpdatingProfile &&
    normalizedCurrentName.length > 0 &&
    normalizedCurrentName !== normalizedOriginalName;

  /*
   * Update the Firebase Authentication display name.
   */
  const handleUpdateProfile = useCallback(async () => {
    if (!user || isUpdatingProfile) {
      return;
    }

    const trimmedName = displayName.trim();

    if (!trimmedName) {
      toast({
        variant: "destructive",
        title: "Invalid display name",
        description: "Please enter a valid display name.",
      });
      return;
    }

    if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
      toast({
        variant: "destructive",
        title: "Display name is too long",
        description: `Please keep your display name under ${MAX_DISPLAY_NAME_LENGTH} characters.`,
      });
      return;
    }

    const originalName = (user.displayName ?? "").trim();

    if (trimmedName === originalName) {
      return;
    }

    setIsUpdatingProfile(true);

    try {
      await updateProfile(user, {
        displayName: trimmedName,
      });

      /*
       * Keep the local input synchronized with the successfully
       * updated Firebase Authentication profile.
       */
      setDisplayName(trimmedName);

      toast({
        title: "Profile updated",
        description: "Your display name has been updated successfully.",
      });
    } catch (error: unknown) {
      const firebaseError = getFirebaseError(error);

      logger.error("Profile update failed", {
        code: firebaseError.code,
        error: firebaseError.message,
      });

      toast({
        variant: "destructive",
        title: "Unable to update profile",
        description:
          "We couldn't update your profile right now. Please try again.",
      });
    } finally {
      setIsUpdatingProfile(false);
    }
  }, [displayName, isUpdatingProfile, toast, user]);

  /*
   * Wait for Firebase Authentication to resolve.
   */
  if (authLoading) {
    return (
      <div
        className="flex min-h-[300px] items-center justify-center"
        aria-label="Loading account"
        role="status"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <span className="sr-only">Loading account</span>
      </div>
    );
  }

  /*
   * The Account page requires an authenticated user.
   */
  if (!user) {
    return (
      <div className="py-16 text-center">
        <UserRound
          className="mx-auto mb-4 h-10 w-10 text-muted-foreground"
          aria-hidden="true"
        />

        <p className="text-muted-foreground">
          Please log in to view your account.
        </p>
      </div>
    );
  }

  const memberSince = formatMemberSince(user.metadata.creationTime);
  const authProvider = getAuthProviderLabel(user);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <Card>
        {/* Profile Header */}
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar className="h-20 w-20 shrink-0 text-3xl">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <CardTitle className="truncate text-3xl">
                {user.displayName || "User"}
              </CardTitle>

              <CardDescription className="mt-1 flex items-center gap-2 truncate">
                <Mail
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">
                  {user.email || "No email address available"}
                </span>
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          {/* Account Overview */}
          <section aria-labelledby="account-overview">
            <h2
              id="account-overview"
              className="mb-4 text-lg font-semibold"
            >
              Account Overview
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="border-none bg-muted/50 shadow-none">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">
                    Account Status
                  </CardTitle>

                  <CheckCircle2
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </CardHeader>

                <CardContent>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full bg-green-500"
                      aria-hidden="true"
                    />

                    <span className="text-2xl font-bold">
                      Active
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    Your account is currently signed in.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-none bg-muted/50 shadow-none">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">
                    Member Since
                  </CardTitle>

                  <CalendarDays
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </CardHeader>

                <CardContent>
                  <div className="text-lg font-bold">
                    {memberSince}
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    MyHealthApp account
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          {/* Authentication Information */}
          <section aria-labelledby="authentication-information">
            <h2
              id="authentication-information"
              className="mb-4 text-lg font-semibold"
            >
              Authentication
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="border-none bg-muted/50 shadow-none">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">
                    Sign-in Method
                  </CardTitle>

                  <ShieldCheck
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </CardHeader>

                <CardContent>
                  <div className="text-lg font-semibold">
                    {authProvider}
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    Authentication is managed by Firebase.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-none bg-muted/50 shadow-none">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">
                    Email Verification
                  </CardTitle>

                  <Mail
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </CardHeader>

                <CardContent>
                  <div className="text-lg font-semibold">
                    {user.emailVerified ? "Verified" : "Not verified"}
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {user.emailVerified
                      ? "Your email address has been verified."
                      : "Your email address has not been verified yet."}
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          {/* Profile Information */}
          <section aria-labelledby="profile-information">
            <h2
              id="profile-information"
              className="mb-4 text-lg font-semibold"
            >
              Profile Information
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Display Name */}
                <div className="space-y-2">
                  <Label htmlFor="displayName">
                    Display Name
                  </Label>

                  <Input
                    id="displayName"
                    name="displayName"
                    type="text"
                    value={displayName}
                    onChange={(event) =>
                      setDisplayName(event.target.value)
                    }
                    maxLength={MAX_DISPLAY_NAME_LENGTH}
                    autoComplete="name"
                    spellCheck={false}
                    disabled={isUpdatingProfile}
                  />

                  <p className="text-xs text-muted-foreground">
                    {displayName.length}/{MAX_DISPLAY_NAME_LENGTH}
                  </p>
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="accountEmail">
                    Email Address
                  </Label>

                  <Input
                    id="accountEmail"
                    name="email"
                    type="email"
                    value={user.email ?? ""}
                    autoComplete="email"
                    disabled
                    readOnly
                  />

                  <p className="text-xs text-muted-foreground">
                    Email changes are managed through the authentication
                    system.
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={() => void handleUpdateProfile()}
                disabled={!canUpdateProfile}
              >
                {isUpdatingProfile ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Updating...
                  </>
                ) : (
                  "Update Profile"
                )}
              </Button>
            </div>
          </section>

          <Separator />

          {/* Security */}
          <section aria-labelledby="account-security">
            <h2
              id="account-security"
              className="mb-4 text-lg font-semibold"
            >
              Security
            </h2>

            <div className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                  aria-hidden="true"
                />

                <div>
                  <p className="font-medium">
                    Account security
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Your account is protected by Firebase
                    Authentication. Firestore access should be restricted
                    by your application's security rules before
                    Firestore-based account statistics are enabled.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <Button
                type="button"
                variant="outline"
                disabled
              >
                Change Password
              </Button>

              <p className="mt-2 text-xs text-muted-foreground">
                Password management is currently handled through the
                authentication system.
              </p>
            </div>
          </section>
        </CardContent>

        <CardFooter>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck
              className="h-3 w-3"
              aria-hidden="true"
            />

            Your account information is managed through authenticated
            Firebase services.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}