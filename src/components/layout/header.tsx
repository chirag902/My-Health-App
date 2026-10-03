
"use client";

import Link from "next/link";
import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";

import { useAuth, useUser } from "@/firebase";

import { Button } from "@/components/ui/button";
import { SosDialog } from "@/components/sos-dialog";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";

export default function Header() {
  const { user } = useUser();
  const auth = useAuth();

  const router = useRouter();
  const { toast } = useToast();

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);

    try {
      await signOut(auth);

      toast({
        title: "Logged Out",
        description: "You have been successfully logged out.",
      });

      router.replace("/login");
    } catch (error: unknown) {
      console.error("Logout failed:", error);

      toast({
        variant: "destructive",
        title: "Logout Failed",
        description: "Unable to log out. Please try again.",
      });
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center border-b bg-card/30 px-4 backdrop-blur-lg md:px-6">
      <SidebarTrigger className="md:hidden" />

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <ThemeToggle />

        <SosDialog>
          <Button
            variant="destructive"
            type="button"
            aria-label="Open emergency SOS"
          >
            SOS
          </Button>
        </SosDialog>

        {user ? (
          <Button
            onClick={handleLogout}
            variant="ghost"
            size="sm"
            disabled={isLoggingOut}
            type="button"
          >
            {isLoggingOut ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}

            {isLoggingOut ? "Logging out..." : "Logout"}
          </Button>
        ) : (
          <>
            <Button asChild variant="ghost">
              <Link href="/login">Login</Link>
            </Button>

            <Button asChild>
              <Link href="/signup">Sign Up</Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
