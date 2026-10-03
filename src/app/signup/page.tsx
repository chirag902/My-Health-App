"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  type AuthError,
} from "firebase/auth";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";

import { useAuth, useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const googleProvider = new GoogleAuthProvider();

function getAuthErrorMessage(error: unknown): string {
  const code = (error as AuthError | undefined)?.code;

  switch (code) {
    case "auth/email-already-in-use":
      return "An account already exists with this email. Please log in instead.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/weak-password":
      return "Your password is too weak. Please choose a stronger password.";

    case "auth/operation-not-allowed":
      return "Email/password sign-up is currently unavailable. Please try again later.";

    case "auth/popup-closed-by-user":
      return "Google sign-up was cancelled.";

    case "auth/popup-blocked":
      return "The Google sign-up popup was blocked. Please allow popups and try again.";

    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email using a different sign-in method.";

    case "auth/network-request-failed":
      return "A network error occurred. Please check your connection and try again.";

    case "auth/too-many-requests":
      return "Too many attempts were made. Please wait a moment and try again.";

    default:
      return "We couldn't create your account. Please try again.";
  }
}

export default function SignupPage() {
  const router = useRouter();
  const { toast } = useToast();

  const auth = useAuth();
  const { user, loading: authLoading } = useUser();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  /*
   * Auth state is the source of truth for navigation.
   * This prevents duplicate router.push() calls after signup.
   */
  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/diagnosis");
    }
  }, [authLoading, user, router]);

  const handleSignUp = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (loading || googleLoading) {
        return;
      }

      const normalizedFirstName = firstName.trim();
      const normalizedLastName = lastName.trim();
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPassword = password;

      if (!normalizedFirstName || !normalizedLastName) {
        toast({
          variant: "destructive",
          title: "Missing information",
          description: "Please enter your first and last name.",
        });
        return;
      }

      if (normalizedFirstName.length > 50 || normalizedLastName.length > 50) {
        toast({
          variant: "destructive",
          title: "Invalid name",
          description: "First and last names must be 50 characters or fewer.",
        });
        return;
      }

      if (!normalizedEmail) {
        toast({
          variant: "destructive",
          title: "Missing email",
          description: "Please enter your email address.",
        });
        return;
      }

      if (normalizedPassword.length < 6) {
        toast({
          variant: "destructive",
          title: "Weak password",
          description: "Password must be at least 6 characters long.",
        });
        return;
      }

      if (!auth) {
        toast({
          variant: "destructive",
          title: "Authentication unavailable",
          description: "Please refresh the page and try again.",
        });
        return;
      }

      setLoading(true);

      try {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          normalizedEmail,
          normalizedPassword
        );

        const displayName =
          `${normalizedFirstName} ${normalizedLastName}`.trim();

        await updateProfile(userCredential.user, {
          displayName,
        });

        toast({
          title: "Account created",
          description: "Welcome to MyHealthApp.",
        });

        /*
         * Do not manually navigate here.
         * onAuthStateChanged/useUser() will detect the authenticated user
         * and the effect above will redirect to /diagnosis.
         */
      } catch (error: unknown) {
        toast({
          variant: "destructive",
          title: "Sign up failed",
          description: getAuthErrorMessage(error),
        });
      } finally {
        setLoading(false);
      }
    },
    [
      auth,
      email,
      firstName,
      lastName,
      password,
      loading,
      googleLoading,
      toast,
    ]
  );

  const handleGoogleSignUp = useCallback(async () => {
    if (loading || googleLoading || !auth) {
      return;
    }

    setGoogleLoading(true);

    try {
      await signInWithPopup(auth, googleProvider);

      toast({
        title: "Welcome to MyHealthApp",
        description: "Your Google account has been signed in successfully.",
      });

      /*
       * Navigation is handled by the auth-state effect.
       */
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Google sign-up failed",
        description: getAuthErrorMessage(error),
      });
    } finally {
      setGoogleLoading(false);
    }
  }, [auth, loading, googleLoading, toast]);

  if (authLoading || user) {
    return (
      <div
        className="flex min-h-screen w-full items-center justify-center"
        aria-label="Loading"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
      </div>
    );
  }

  const isSubmitting = loading || googleLoading;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Create an account</CardTitle>

          <CardDescription>
            Enter your information to create your MyHealthApp account.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSignUp} noValidate>
            <div className="grid gap-5">
              {/* Name */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="first-name">First name</Label>

                  <Input
                    id="first-name"
                    name="firstName"
                    type="text"
                    placeholder="Chirag"
                    autoComplete="given-name"
                    maxLength={50}
                    required
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="last-name">Last name</Label>

                  <Input
                    id="last-name"
                    name="lastName"
                    type="text"
                    placeholder="Sharma"
                    autoComplete="family-name"
                    maxLength={50}
                    required
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Email */}
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>

                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  inputMode="email"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {/* Password */}
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>

                  <span className="text-xs text-muted-foreground">
                    6+ characters
                  </span>
                </div>

                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={isSubmitting}
                    className="pr-12"
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showPassword}
                    disabled={isSubmitting}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Email signup */}
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {loading ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Creating account...
                  </>
                ) : (
                  "Create an account"
                )}
              </Button>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>

                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or continue with
                  </span>
                </div>
              </div>

              {/* Google */}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignUp}
                disabled={isSubmitting}
              >
                {googleLoading ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Connecting to Google...
                  </>
                ) : (
                  "Continue with Google"
                )}
              </Button>
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}