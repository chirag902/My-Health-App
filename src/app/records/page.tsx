
"use client";

import AppShell from "@/components/layout/app-shell";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const HealthRecords = dynamic(() => import("@/components/health-records"), {
  ssr: false,
  loading: () => (
    <div className="space-y-8">
      <Skeleton className="h-[350px] w-full" />
      <Skeleton className="h-[200px] w-full" />
    </div>
  ),
});

export default function HealthRecordsPage() {
  return (
    <AppShell>
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold tracking-tight">Health Records</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
          Securely view and manage your health history, lab results, and diagnoses.
        </p>
      </div>
      <HealthRecords />
    </AppShell>
  );
}
