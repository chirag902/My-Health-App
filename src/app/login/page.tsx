"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";

import { useAuth, useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";

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

const googleProvider = new GoogleAuthProvider();

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();

  const auth = useAuth();
  const { user, loading: authLoading } = useUser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isGoogleLoggingIn, setIsGoogleLoggingIn] = useState(false);

  /*
   * Redirect authenticated users away from the login page.
   *
   * We intentionally keep navigation in one place rather than
   * navigating both inside the login handlers and this effect.
   */
  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/diagnosis");
    }
  }, [authLoading, user, router]);

  const getAuthErrorMessage = useCallback((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      switch (error.code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
          return "The email or password is incorrect.";

        case "auth/invalid-email":
          return "Please enter a valid email address.";

        case "auth/user-disabled":
          return "This account has been disabled.";

        case "auth/too-many-requests":
          return "Too many unsuccessful attempts. Please try again later.";

        case "auth/network-request-failed":
          return "A network error occurred. Please check your connection.";

        case "auth/popup-closed-by-user":
          return "Google sign-in was cancelled.";

        case "auth/popup-blocked":
          return "Your browser blocked the Google sign-in popup. Please allow popups and try again.";

        case "auth/account-exists-with-different-credential":
          return "An account already exists with a different sign-in method.";
      }
    }

    return "Unable to sign in right now. Please try again.";
  }, []);

  const handleLogin = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail || !password) {
        toast({
          variant: "destructive",
          title: "Missing information",
          description: "Please enter your email and password.",
        });
        return;
      }

      if (!auth) {
        toast({
          variant: "destructive",
          title: "Authentication unavailable",
          description:
            "Authentication is temporarily unavailable. Please try again.",
        });
        return;
      }

      setIsLoggingIn(true);

      try {
        await signInWithEmailAndPassword(
          auth,
          normalizedEmail,
          password
        );

        toast({
          title: "Login successful",
          description: "Welcome back!",
        });

        /*
         * Do not navigate here.
         * The auth-state effect above handles navigation after
         * Firebase confirms the authenticated user.
         */
      } catch (error: unknown) {
        toast({
          variant: "destructive",
          title: "Login failed",
          description: getAuthErrorMessage(error),
        });
      } finally {
        setIsLoggingIn(false);
      }
    },
    [auth, email, password, getAuthErrorMessage, toast]
  );

  const handleGoogleLogin = useCallback(async () => {
    if (!auth) {
      toast({
        variant: "destructive",
        title: "Authentication unavailable",
        description:
          "Authentication is temporarily unavailable. Please try again.",
      });
      return;
    }

    setIsGoogleLoggingIn(true);

    try {
      await signInWithPopup(auth, googleProvider);

      toast({
        title: "Login successful",
        description: "Welcome back!",
      });

      /*
       * Navigation is handled by the auth-state effect.
       */
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Google login failed",
        description: getAuthErrorMessage(error),
      });
    } finally {
      setIsGoogleLoggingIn(false);
    }
  }, [auth, getAuthErrorMessage, toast]);

  /*
   * Avoid rendering the login form while Firebase is still
   * determining whether an existing session is active.
   */
  if (authLoading) {
    return (
      <main
        className="flex min-h-[70vh] w-full items-center justify-center"
        aria-label="Checking authentication"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
      </main>
    );
  }

  /*
   * If already authenticated, the effect above will redirect.
   * Keep the intermediate UI minimal.
   */
  if (user) {
    return (
      <main
        className="flex min-h-[70vh] w-full items-center justify-center"
        aria-label="Redirecting"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
      </main>
    );
  }

  const isSubmitting = isLoggingIn || isGoogleLoggingIn;

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>

          <CardDescription>
            Enter your email below to login to your account.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleLogin} noValidate>
            <div className="grid gap-4">
              {/* Email */}
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>

                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              {/* Password */}
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">Password</Label>

                  <Link
                    href="/forgot-password"
                    className="text-sm underline underline-offset-4 hover:no-underline"
                  >
                    Forgot password?
                  </Link>
                </div>

                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    disabled={isSubmitting}
                    className="pr-10"
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                    onClick={() =>
                      setShowPassword((current) => !current)
                    }
                    disabled={isSubmitting}
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                    aria-pressed={showPassword}
                  >
                    {showPassword ? (
                      <EyeOff
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                    ) : (
                      <Eye
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                    )}
                  </Button>
                </div>
              </div>

              {/* Email login */}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  isSubmitting ||
                  !email.trim() ||
                  !password
                }
              >
                {isLoggingIn ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Logging in...
                  </>
                ) : (
                  "Login"
                )}
              </Button>

              {/* Google login */}
              <Button
                variant="outline"
                type="button"
                className="w-full"
                onClick={handleGoogleLogin}
                disabled={isSubmitting}
              >
                {isGoogleLoggingIn ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Connecting...
                  </>
                ) : (
                  "Login with Google"
                )}
              </Button>
            </div>
          </form>

          <div className="mt-4 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-medium underline underline-offset-4 hover:no-underline"
            >
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}