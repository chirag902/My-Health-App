import type { Metadata } from "next";

import HabitTracker from "@/components/habit-tracker";
import AppShell from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Habit Tracker | MyHealthApp",
  description: "Build healthy habits and track your daily progress.",
};

export default function HabitsPage() {
  return (
    <AppShell>
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Habit Tracker</h1>
        <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
          Build healthy habits and track your progress. Consistency is key to a mindful life.
        </p>
      </div>
      <HabitTracker />
    </AppShell>
  );
}