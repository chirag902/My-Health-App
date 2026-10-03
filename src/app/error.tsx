
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, RefreshCcw } from "lucide-react";

import { logger } from "@/lib/logger";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    logger.error("Uncaught application error", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  const handleGoHome = () => {
    router.replace("/");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10"
            aria-hidden="true"
          >
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>

          <CardTitle className="text-2xl">
            Something went wrong
          </CardTitle>

          <CardDescription>
            We couldn't load this page correctly. Please try again or return
            to the home page.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your data has not been intentionally changed by this error.
            Please try again before continuing.
          </p>
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            type="button"
            onClick={reset}
            className="flex-1"
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Try Again
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleGoHome}
            className="flex-1"
          >
            Go Home
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
