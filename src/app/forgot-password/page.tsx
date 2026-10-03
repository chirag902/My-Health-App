"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { sendPasswordResetEmail } from "firebase/auth";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";

import { useAuth } from "@/firebase";
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

export default function ForgotPasswordPage() {
  const auth = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const getAuthErrorMessage = useCallback((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      switch (error.code) {
        case "auth/invalid-email":
          return "Please enter a valid email address.";

        case "auth/user-not-found":
          /*
           * Keep the message generic rather than revealing whether
           * an email address is registered.
           */
          return "If an account exists for this email, a password reset email will be sent.";

        case "auth/too-many-requests":
          return "Too many requests were made. Please wait a while and try again.";

        case "auth/network-request-failed":
          return "A network error occurred. Please check your connection and try again.";
      }
    }

    return "Unable to send the password reset email right now. Please try again.";
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail) {
        toast({
          variant: "destructive",
          title: "Email required",
          description: "Please enter the email address associated with your account.",
        });
        return;
      }

      if (!auth) {
        toast({
          variant: "destructive",
          title: "Authentication unavailable",
          description:
            "Authentication is temporarily unavailable. Please try again later.",
        });
        return;
      }

      setIsSending(true);

      try {
        await sendPasswordResetEmail(auth, normalizedEmail);

        setEmailSent(true);

        toast({
          title: "Check your email",
          description:
            "If an account exists for this email, we've sent password reset instructions.",
        });
      } catch (error: unknown) {
        /*
         * Firebase can reveal whether an email exists depending on
         * configuration/version. Keep the user-facing response
         * generic to reduce account-enumeration risk.
         */
        const message = getAuthErrorMessage(error);

        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "auth/user-not-found"
        ) {
          setEmailSent(true);

          toast({
            title: "Check your email",
            description: message,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Unable to send reset email",
            description: message,
          });
        }
      } finally {
        setIsSending(false);
      }
    },
    [auth, email, getAuthErrorMessage, toast]
  );

  if (emailSent) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2
                className="h-6 w-6 text-primary"
                aria-hidden="true"
              />
            </div>

            <CardTitle className="text-2xl">
              Check your email
            </CardTitle>

            <CardDescription>
              If an account exists for{" "}
              <span className="font-medium text-foreground">
                {email.trim()}
              </span>
              , password reset instructions have been sent.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <Button asChild className="w-full">
              <Link href="/login">Back to Login</Link>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setEmailSent(false);
              }}
            >
              Try another email
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Mail
              className="h-5 w-5 text-primary"
              aria-hidden="true"
            />
          </div>

          <CardTitle className="text-2xl">
            Forgot your password?
          </CardTitle>

          <CardDescription>
            Enter the email address associated with your account and
            we&apos;ll send you instructions to reset your password.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} noValidate>
            <div className="grid gap-4">
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
                  autoFocus
                  maxLength={254}
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  disabled={isSending}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isSending || !email.trim()}
              >
                {isSending ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>

              <Button
                asChild
                type="button"
                variant="ghost"
                className="w-full"
              >
                <Link href="/login">
                  <ArrowLeft
                    className="mr-2 h-4 w-4"
                    aria-hidden="true"
                  />
                  Back to Login
                </Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}