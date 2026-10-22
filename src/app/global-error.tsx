"use client";

import { useEffect } from "react";

import "./globals.css";
import { logger } from "@/lib/logger";

/**
 * Last line of defence: runs when the ROOT layout itself fails, so it replaces the whole document.
 * It uses plain elements on purpose, with no providers and no components that could fail again.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("Unhandled global error", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Something went wrong</h1>
          <p className="max-w-md text-muted-foreground">
            The app hit an unexpected problem. Please try again.
          </p>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}