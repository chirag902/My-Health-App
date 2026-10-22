"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

/**
 * Catches errors thrown while rendering any route segment.
 * The component is deliberately NOT called `Error`, which would shadow the global type.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Never log or show error.message here: it can contain user data or internals.
    logger.error("Unhandled route error", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main
      id="main-content"
      className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">
        An unexpected error occurred. Please try again. If it keeps happening, come back in a few
        minutes.
      </p>

      {error.digest ? (
        <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}

      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}