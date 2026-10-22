"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";

import { useAuth, useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { getAuthErrorMessage, isPopupBlocked, isUserCancelledPopup } from "@/lib/auth-errors";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  useEffect(() => {
    if (!authLoading && user) router.replace("/diagnosis");
  }, [authLoading, user, router]);

  const handleLogin = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail || !password) {
        toast({ variant: "destructive", title: "Missing information", description: "Please enter your email and password." });
        return;
      }
      if (!auth) {
        toast({ variant: "destructive", title: "Authentication unavailable", description: "Authentication is temporarily unavailable. Please try again." });
        return;
      }

      setIsLoggingIn(true);
      try {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
        toast({ title: "Login successful", description: "Welcome back!" });
      } catch (error: unknown) {
        toast({ variant: "destructive", title: "Login failed", description: getAuthErrorMessage(error) });
      } finally {
        setIsLoggingIn(false);
      }
    },
    [auth, email, password, toast]
  );

  const handleGoogleLogin = useCallback(async () => {
    if (!auth) {
      toast({ variant: "destructive", title: "Authentication unavailable", description: "Authentication is temporarily unavailable. Please try again." });
      return;
    }

    setIsGoogleLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      toast({ title: "Login successful", description: "Welcome back!" });
    } catch (error: unknown) {
      // User closing the popup themselves isn't an app error — stay silent.
      if (isUserCancelledPopup(error)) return;

      if (isPopupBlocked(error)) {
        toast({ variant: "destructive", title: "Popup blocked", description: "Please allow popups for this site and try again." });
        return;
      }
      toast({ variant: "destructive", title: "Google login failed", description: getAuthErrorMessage(error) });
    } finally {
      setIsGoogleLoggingIn(false);
    }
  }, [auth, toast]);

  if (authLoading || user) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center" aria-label={authLoading ? "Checking authentication" : "Redirecting"}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      </main>
    );
  }
  
  const isSubmitting = isLoggingIn || isGoogleLoggingIn;
  
  return (
    <main className="flex min-h-screen w-full items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Enter your email below to login to your account.</CardDescription>
        </CardHeader>
  
        <CardContent>
          <form onSubmit={handleLogin} noValidate>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="m@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={isSubmitting} autoFocus />
              </div>
  
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-sm underline underline-offset-4 hover:no-underline">Forgot password?</Link>
                </div>
                <div className="relative">
                  <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={isSubmitting} className="pr-10" />
                  <Button type="button" variant="ghost" size="icon" className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground hover:bg-transparent" onClick={() => setShowPassword((v) => !v)} disabled={isSubmitting} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                </div>
              </div>
  
              <Button type="submit" className="w-full" disabled={isSubmitting || !email.trim() || !password}>
                {isLoggingIn ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Logging in...</>) : "Login"}
              </Button>
  
              <Button variant="outline" type="button" className="w-full" onClick={handleGoogleLogin} disabled={isSubmitting}>
                {isGoogleLoggingIn ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Connecting...</>) : "Login with Google"}
              </Button>
            </div>
          </form>
  
          <div className="mt-4 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium underline underline-offset-4 hover:no-underline">Sign up</Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}