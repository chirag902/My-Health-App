import HabitTracker from "@/components/habit-tracker";
import AppShell from "@/components/layout/app-shell";

export default function HabitsPage() {
  return (
    <AppShell>
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold tracking-tight">Habit Tracker</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
          Build healthy habits and track your progress. Consistency is key to a mindful life.
        </p>
      </div>
      <HabitTracker />
    </AppShell>
  );
}
