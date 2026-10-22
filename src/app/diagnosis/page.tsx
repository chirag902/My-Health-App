import type { Metadata } from "next";
import dynamic from "next/dynamic";

import AppShell from "@/components/layout/app-shell";
import SymptomChecker from "@/components/symptom-checker";
import { Skeleton } from "@/components/ui/skeleton";

export const maxDuration = 60; // Diagnosis Server Action calls a grounded model; this is the page that hosts it.

export const metadata: Metadata = {
  title: "AI Health Companion | MyHealthApp",
  description:
    "Chat with your AI health companion for a quick symptom check or an in-depth conversation. Personalized guidance — not a substitute for professional medical advice.",
};

const DailyMotivation = dynamic(() => import("@/components/daily-motivation"), {
  loading: () => (
    <div aria-hidden="true" className="h-[104px] w-full rounded-xl">
      <Skeleton className="h-full w-full rounded-xl bg-primary/40" />
    </div>
  ),
});

export default function DiagnosisPage() {
  return (
    <AppShell>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">AI Companion</h1>
        <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
          Choose a mode to chat with your AI companion. Get a quick analysis or have an
          in-depth conversation about your symptoms. This is a safe space to talk, and not a
          substitute for professional medical advice.
        </p>
      </div>

      <div className="mx-auto mb-6 max-w-4xl">
        <DailyMotivation />
      </div>

      <SymptomChecker />
    </AppShell>
  );
}