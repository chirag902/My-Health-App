"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, signInWithPopup, updateProfile,
} from "firebase/auth";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";

import { useAuth, useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { getAuthErrorMessage, isPopupBlocked, isUserCancelledPopup } from "@/lib/auth-errors";

const googleProvider = new GoogleAuthProvider();
const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const router = useRouter();
  const { toast } = useToast();
  const auth = useAuth();
  const { user, loading: authLoading } = useUser();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user) router.replace("/diagnosis");
  }, [authLoading, user, router]);

  const handleSignUp = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (loading || googleLoading) return;

      const normalizedFirstName = firstName.trim();
      const normalizedLastName = lastName.trim();
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedFirstName || !normalizedLastName) {
        toast({ variant: "destructive", title: "Missing information", description: "Please enter your first and last name." });
        return;
      }
      if (normalizedFirstName.length > 50 || normalizedLastName.length > 50) {
        toast({ variant: "destructive", title: "Invalid name", description: "First and last names must be 50 characters or fewer." });
        return;
      }
      if (!normalizedEmail) {
        toast({ variant: "destructive", title: "Missing email", description: "Please enter your email address." });
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        toast({ variant: "destructive", title: "Weak password", description: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
        return;
      }
      if (!agreedToTerms) {
        toast({ variant: "destructive", title: "Agreement required", description: "Please agree to the Terms of Service and Privacy Policy to continue." });
        return;
      }
      if (!auth) {
        toast({ variant: "destructive", title: "Authentication unavailable", description: "Please refresh the page and try again." });
        return;
      }

      setLoading(true);
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        const displayName = `${normalizedFirstName} ${normalizedLastName}`.trim();
        await updateProfile(userCredential.user, { displayName });

        // Fires the verification email the account page's "resend" button
        // assumes already exists. Failure here shouldn't block account
        // creation — resend remains available from the account page.
        try {
          await sendEmailVerification(userCredential.user);
        } catch (verificationError) {
          console.error("Initial verification email failed to send:", verificationError);
        }

        toast({ title: "Account created", description: "Welcome to MyHealthApp. Check your email to verify your account." });
      } catch (error: unknown) {
        toast({ variant: "destructive", title: "Sign up failed", description: getAuthErrorMessage(error) });
      } finally {
        setLoading(false);
      }
    },
    [auth, agreedToTerms, email, firstName, lastName, password, loading, googleLoading, toast]
  );

  const handleGoogleSignUp = useCallback(async () => {
    if (loading || googleLoading || !auth) return;
    if (!agreedToTerms) {
      toast({ variant: "destructive", title: "Agreement required", description: "Please agree to the Terms of Service and Privacy Policy to continue." });
      return;
    }

    setGoogleLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      toast({ title: "Welcome to MyHealthApp", description: "Your Google account has been signed in successfully." });
    } catch (error: unknown) {
      if (isUserCancelledPopup(error)) return;

      if (isPopupBlocked(error)) {
        toast({ variant: "destructive", title: "Popup blocked", description: "Please allow popups for this site and try again." });
        return;
      }
      toast({ variant: "destructive", title: "Google sign-up failed", description: getAuthErrorMessage(error) });
    } finally {
      setGoogleLoading(false);
    }
  }, [auth, agreedToTerms, loading, googleLoading, toast]);

   if (authLoading || user) {
      return (
        <main className="flex min-h-screen w-full items-center justify-center" aria-label={authLoading ? "Checking authentication" : "Redirecting"}>
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        </main>
      );
    }

  const isSubmitting = loading || googleLoading;

  return (
    <main className="flex min-h-screen w-full items-center justify-center px-4 py-12">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Create an account</CardTitle>
          <CardDescription>Enter your information to create your MyHealthApp account.</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSignUp} noValidate>
            <div className="grid gap-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="first-name">First name</Label>
                  <Input id="first-name" name="firstName" type="text" placeholder="Chirag" autoComplete="given-name" maxLength={50} required value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={isSubmitting} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="last-name">Last name</Label>
                  <Input id="last-name" name="lastName" type="text" placeholder="Sharma" autoComplete="family-name" maxLength={50} required value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={isSubmitting} />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="you@example.com" autoComplete="email" inputMode="email" maxLength={254} required value={email} onChange={(e) => setEmail(e.target.value)} disabled={isSubmitting} />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <span className="text-xs text-muted-foreground">{MIN_PASSWORD_LENGTH}+ characters</span>
                </div>
                <div className="relative">
                  <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required value={password} onChange={(e) => setPassword(e.target.value)} disabled={isSubmitting} className="pr-12" />
                  <Button type="button" variant="ghost" size="icon" className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground hover:bg-transparent" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} disabled={isSubmitting}>
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox id="terms" checked={agreedToTerms} onCheckedChange={(checked) => setAgreedToTerms(checked === true)} disabled={isSubmitting} className="mt-0.5" />
                <Label htmlFor="terms" className="text-sm font-normal leading-snug text-muted-foreground">
                  I agree to the{" "}
                  {/* ⚠️ VERIFY: these routes don't exist yet — create them before launch */}
                  <Link href="/terms" className="underline underline-offset-4 hover:no-underline">Terms of Service</Link>{" "}
                  and{" "}
                  <Link href="/privacy" className="underline underline-offset-4 hover:no-underline">Privacy Policy</Link>, including how my health data is stored and used.
                </Label>
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting || !agreedToTerms}>
                {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Creating account...</>) : "Create an account"}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Or continue with</span></div>
              </div>

              <Button type="button" variant="outline" className="w-full" onClick={handleGoogleSignUp} disabled={isSubmitting || !agreedToTerms}>
                {googleLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Connecting to Google...</>) : "Continue with Google"}
              </Button>
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Log in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}