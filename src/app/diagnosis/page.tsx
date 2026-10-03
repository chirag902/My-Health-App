
"use client";

import dynamic from "next/dynamic";

import AppShell from "@/components/layout/app-shell";
import SymptomChecker from "@/components/symptom-checker";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy-load DailyMotivation so it does not increase the initial
// JavaScript bundle or main-thread work for the diagnosis page.
const DailyMotivation = dynamic(
  () => import("@/components/daily-motivation"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-24 w-full" />,
  }
);

export default function DiagnosisPage() {
  return (
    <AppShell>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          AI Companion
        </h1>

        <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
          Choose a mode to chat with your AI companion. Get a quick analysis
          or have an in-depth conversation about your symptoms. This is a
          safe space to talk, and not a substitute for professional medical
          advice.
        </p>
      </div>

      <div className="mx-auto mb-6 max-w-4xl">
        <DailyMotivation />
      </div>

      <SymptomChecker />
    </AppShell>
  );
}
