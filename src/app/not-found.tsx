import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen w-full items-center justify-center bg-background p-4"
    >
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">404</p>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Page not found</h1>
        <p className="text-muted-foreground">
          The page you are looking for does not exist or has moved.
        </p>
        <Button asChild className="mt-2">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}