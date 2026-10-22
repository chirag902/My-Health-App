"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  arrayUnion, collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc,
} from "firebase/firestore";
import {
  differenceInCalendarDays, format, isToday, parseISO, subDays,
} from "date-fns";
import {
  Bed, BookOpen, Brain, Check, Dumbbell, Flame, Footprints, HeartPulse,
  Loader2, Moon, Plus, Salad, Smartphone, Trash2,
} from "lucide-react";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useFirestore, useUser } from "@/firebase";
import { errorEmitter } from "@/firebase/error-emitter";
import { FirestorePermissionError } from "@/firebase/errors";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type HabitIconType =
  | "Brain" | "BookOpen" | "Bed" | "Dumbbell" | "Moon" | "Footprints" | "HeartPulse" | "Smartphone" | "Salad";

interface Habit {
  id: string;
  name: string;
  iconType: HabitIconType;
  completions: string[];
  order: number;
}

interface FirestoreHabitData {
  name?: unknown;
  iconType?: unknown;
  completions?: unknown;
  userId?: unknown;
  order?: unknown;
}

interface FirestoreHabit extends FirestoreHabitData {
  id: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const HABITS_COLLECTION = "habits";
const DAY_CHECK_INTERVAL_MS = 60_000;

// 2026 wellness-research-grounded defaults, seeded once per user on first
// load. Deterministic ids make seeding idempotent — safe even if two tabs
// race to seed simultaneously.
const DEFAULT_HABITS: ReadonlyArray<{ id: string; name: string; iconType: HabitIconType; order: number }> = [
  { id: "default-strength", name: "Walk or Strength Move", iconType: "Footprints", order: 0 },
  { id: "default-sleep", name: "Protect Sleep Rhythm", iconType: "Moon", order: 1 },
  { id: "default-nervous-system", name: "Nervous System Reset", iconType: "HeartPulse", order: 2 },
  { id: "default-digital-sunset", name: "Digital Sunset", iconType: "Smartphone", order: 3 },
  { id: "default-gut-health", name: "Gut-Friendly Meal", iconType: "Salad", order: 4 },
  { id: "default-journal", name: "Name One Feeling", iconType: "BookOpen", order: 5 },
];

const ICON_OPTIONS: ReadonlyArray<{ value: HabitIconType; label: string }> = [
  { value: "Footprints", label: "Movement" },
  { value: "Moon", label: "Sleep" },
  { value: "HeartPulse", label: "Nervous system" },
  { value: "Smartphone", label: "Digital detox" },
  { value: "Salad", label: "Nutrition" },
  { value: "BookOpen", label: "Journaling" },
  { value: "Brain", label: "Mindfulness" },
  { value: "Bed", label: "Rest" },
  { value: "Dumbbell", label: "Exercise" },
];

const ICON_MAP: Record<HabitIconType, typeof Brain> = {
  Brain, BookOpen, Bed, Dumbbell, Moon, Footprints, HeartPulse, Smartphone, Salad,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const getDayKey = (date: Date): string => format(date, "yyyy-MM-dd");
const getTodayKey = (): string => getDayKey(new Date());

const getLastSevenDays = (): Date[] => {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => subDays(today, 6 - index));
};

const isHabitIconType = (value: unknown): value is HabitIconType =>
  typeof value === "string" && value in ICON_MAP;

const getFirestoreCompletions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

const calculateStreak = (completions: string[]): number => {
  if (completions.length === 0) return 0;
  const uniqueDates = Array.from(new Set(completions)).filter(Boolean).sort((a, b) => b.localeCompare(a));
  if (uniqueDates.length === 0) return 0;

  const today = new Date();
  const latestDate = parseISO(uniqueDates[0]);
  const daysSinceLatest = differenceInCalendarDays(today, latestDate);
  if (daysSinceLatest > 1 || daysSinceLatest < 0) return 0;

  let streak = 0;
  let expectedDate = latestDate;
  for (const dateString of uniqueDates) {
    const date = parseISO(dateString);
    const diff = differenceInCalendarDays(expectedDate, date);
    if (diff === 0) {
      streak += 1;
      expectedDate = subDays(expectedDate, 1);
    } else if (diff > 0) {
      break;
    }
  }
  return streak;
};

/* -------------------------------------------------------------------------- */
/* Weekly Overview                                                            */
/* -------------------------------------------------------------------------- */

function WeekdayIndicator({ habits, last7Days }: { habits: Habit[]; last7Days: Date[] }) {
  const allHabitsCount = habits.length;

  const weeklyData = useMemo(() => {
    return last7Days.map((day) => {
      const dayKey = getDayKey(day);
      const completedCount = habits.reduce(
        (count, habit) => count + (habit.completions.includes(dayKey) ? 1 : 0), 0
      );
      const ratio = allHabitsCount > 0 ? completedCount / allHabitsCount : 0;
      return { day, dayKey, completedCount, ratio };
    });
  }, [habits, last7Days, allHabitsCount]);

  return (
    <Card className="mb-6">
      <CardHeader><CardTitle className="text-lg">Weekly Overview</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2" aria-label="Habit completion for the last seven days">
          {weeklyData.map(({ day, dayKey, completedCount, ratio }) => {
            const isCurrentDay = isToday(day);
            let backgroundClass = "bg-muted";
            if (ratio > 0 && ratio <= 0.5) backgroundClass = "bg-primary/20";
            else if (ratio > 0.5 && ratio < 1) backgroundClass = "bg-primary/50";
            else if (ratio === 1) backgroundClass = "bg-primary/80";

            return (
              <Tooltip key={dayKey}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 flex-col items-center gap-2 rounded-md p-1 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`${format(day, "MMM d")}: ${completedCount} of ${allHabitsCount} habits completed`}
                  >
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-full transition-colors", backgroundClass, isCurrentDay && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
                      {isCurrentDay && <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />}
                    </div>
                    <span className="text-xs text-muted-foreground">{format(day, "E")}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>{format(day, "MMM d")}: {completedCount}/{allHabitsCount} habits completed</p></TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Add Habit Form                                                             */
/* -------------------------------------------------------------------------- */

function AddHabitForm({ onAdd, isSubmitting }: { onAdd: (name: string, icon: HabitIconType) => void; isSubmitting: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<HabitIconType>("Brain");

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 60) return;
    onAdd(trimmed, icon);
    setName("");
    setIcon("Brain");
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setIsOpen(true)}>
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        Add custom habit
      </Button>
    );
  }

  return (
    <Card className="p-4">
      
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      
<div className="flex-1">
  <Input
    placeholder="Habit name"
    value={name}
    onChange={(e) => setName(e.target.value)}
    maxLength={60}
    aria-label="New habit name"
  />
  {name.length > 40 && (
    <p className={cn("mt-1 text-xs", name.length >= 60 ? "text-destructive" : "text-muted-foreground")}>
      {name.length}/60 — shorter names display better on mobile
    </p>
  )}
</div>
        <Select value={icon} onValueChange={(v) => setIcon(v as HabitIconType)}>
          <SelectTrigger className="sm:w-44" aria-label="Habit category icon">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ICON_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting || !name.trim()}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Main Habit Tracker                                                         */
/* -------------------------------------------------------------------------- */

export default function HabitTracker() {
  const { toast } = useToast();
  const db = useFirestore();
  const { user } = useUser();

  const [firestoreHabits, setFirestoreHabits] = useState<FirestoreHabit[]>([]);
  const [isLoadingHabits, setIsLoadingHabits] = useState(true);
  const [savingHabitId, setSavingHabitId] = useState<string | null>(null);
  const [deletingHabitId, setDeletingHabitId] = useState<string | null>(null);
  const [isAddingHabit, setIsAddingHabit] = useState(false);
  const hasSeededRef = useRef(false);

  const [todayKey, setTodayKey] = useState(getTodayKey());

  useEffect(() => {
    const interval = setInterval(() => {
      const current = getTodayKey();
      setTodayKey((prev) => (prev === current ? prev : current));
    }, DAY_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const last7Days = useMemo(() => getLastSevenDays(), [todayKey]);

  /* ---------------------------------------------------------------------- */
  /* Live Firestore sync — onSnapshot replaces one-time getDocs.             */
  /* Cross-tab/device completions and additions now appear in real time.    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!db || !user) {
      setFirestoreHabits([]);
      setIsLoadingHabits(false);
      hasSeededRef.current = false;
      return;
    }

    setIsLoadingHabits(true);
    const habitsQuery = query(collection(db, "users", user.uid, HABITS_COLLECTION), orderBy("order", "asc"));

    const unsubscribe = onSnapshot(
      habitsQuery,
      async (snapshot) => {
        const loadedHabits: FirestoreHabit[] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Seed 2026-default habits exactly once per session, only if the
        // user truly has none yet. Deterministic ids make this safe against
        // duplicate writes from concurrent tabs.
        if (snapshot.empty && !hasSeededRef.current) {
          hasSeededRef.current = true;
          try {
            await Promise.all(
              DEFAULT_HABITS.map((habit) =>
                setDoc(doc(db, "users", user.uid, HABITS_COLLECTION, habit.id), {
                  name: habit.name,
                  iconType: habit.iconType,
                  completions: [],
                  order: habit.order,
                  userId: user.uid,
                })
              )
            );
          } catch (error) {
            console.error("Failed to seed default habits:", error);
          }
          return; // onSnapshot fires again once seed writes land
        }

        setFirestoreHabits(loadedHabits);
        setIsLoadingHabits(false);
      },
      (error: unknown) => {
        const firebaseError = error as { code?: string; message?: string };
        if (firebaseError.code === "permission-denied") {
          errorEmitter.emit(
            "permission-error",
            new FirestorePermissionError({ path: `users/${user.uid}/${HABITS_COLLECTION}`, operation: "list" })
          );
        }
        console.error("Failed to load habits:", { code: firebaseError.code ?? "unknown", message: firebaseError.message ?? "Unknown error" });
        toast({ variant: "destructive", title: "Couldn't load habit progress", description: "Live sync is unavailable right now." });
        setIsLoadingHabits(false);
      }
    );

    return () => unsubscribe();
  }, [db, user, toast]);

  const normalizedHabits = useMemo<Habit[]>(() => {
    return firestoreHabits.map((habit) => ({
      id: habit.id,
      name: typeof habit.name === "string" ? habit.name : "Habit",
      iconType: isHabitIconType(habit.iconType) ? habit.iconType : "Brain",
      completions: getFirestoreCompletions(habit.completions),
      order: typeof habit.order === "number" ? habit.order : 999,
    }));
  }, [firestoreHabits]);

  const completionSets = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const habit of normalizedHabits) map.set(habit.id, new Set(habit.completions));
    return map;
  }, [normalizedHabits]);

  /* ---------------------------------------------------------------------- */
  /* Complete habit                                                         */
  /* ---------------------------------------------------------------------- */

  const handleComplete = useCallback(
    async (habitId: string, habitName: string) => {
      if (!user || !db) return;
      if (savingHabitId === habitId) return;
      if (isLoadingHabits) return;

      const habit = normalizedHabits.find((item) => item.id === habitId);
      if (!habit) return;

      const currentTodayKey = getTodayKey();
      if (habit.completions.includes(currentTodayKey)) {
        toast({ title: "Already completed", description: `You've already completed "${habitName}" today.` });
        return;
      }

      const habitDoc = doc(db, "users", user.uid, HABITS_COLLECTION, habitId);
      setSavingHabitId(habitId);

      try {
        await updateDoc(habitDoc, { completions: arrayUnion(currentTodayKey) });
        toast({ title: "Habit completed!", description: `Great job on "${habitName}" today!` });
        // No optimistic local state needed — onSnapshot delivers the
        // confirmed update within ~1 tick, and this avoids the dedupe
        // bug from maintaining a parallel optimistic copy.
      } catch (error: unknown) {
        const firebaseError = error as { code?: string; message?: string };
        if (firebaseError.code === "permission-denied") {
          errorEmitter.emit("permission-error", new FirestorePermissionError({ path: habitDoc.path, operation: "update" }));
        }
        console.error("Failed to save habit:", { code: firebaseError.code ?? "unknown", message: firebaseError.message ?? "Unknown error" });
        toast({ variant: "destructive", title: "Couldn't save habit", description: "Your completion could not be saved. Please try again." });
      } finally {
        setSavingHabitId(null);
      }
    },
    [db, normalizedHabits, savingHabitId, isLoadingHabits, toast, user]
  );

  /* ---------------------------------------------------------------------- */
  /* Add / delete custom habit                                              */
  /* ---------------------------------------------------------------------- */

  const handleAddHabit = useCallback(
    async (name: string, iconType: HabitIconType) => {
      if (!user || !db) return;
      setIsAddingHabit(true);
      try {
        const newHabitRef = doc(collection(db, "users", user.uid, HABITS_COLLECTION));
        await setDoc(newHabitRef, {
          name, iconType, completions: [], userId: user.uid, order: Date.now(),
        });
      } catch (error) {
        console.error("Failed to add habit:", error);
        toast({ variant: "destructive", title: "Couldn't add habit", description: "Please try again." });
      } finally {
        setIsAddingHabit(false);
      }
    },
    [db, user, toast]
  );

  const handleDeleteHabit = useCallback(
    async (habitId: string, habitName: string) => {
      if (!user || !db) return;
      if (!window.confirm(`Delete "${habitName}"? This removes its full history.`)) return;

      setDeletingHabitId(habitId);
      try {
        await deleteDoc(doc(db, "users", user.uid, HABITS_COLLECTION, habitId));
        toast({ title: "Habit removed", description: `"${habitName}" has been deleted.` });
      } catch (error) {
        console.error("Failed to delete habit:", error);
        toast({ variant: "destructive", title: "Couldn't delete habit", description: "Please try again." });
      } finally {
        setDeletingHabitId(null);
      }
    },
    [db, user, toast]
  );

  /* ---------------------------------------------------------------------- */
  /* Authentication state                                                   */
  /* ---------------------------------------------------------------------- */

  if (!user) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-8 text-center">
          <Brain className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h3 className="font-semibold">Sign in to track your habits</h3>
          <p className="mt-1 text-sm text-muted-foreground">Your habit progress will be saved securely to your account.</p>
        </CardContent>
      </Card>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <WeekdayIndicator habits={normalizedHabits} last7Days={last7Days} />

        {isLoadingHabits ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading your habits...
          </div>
        ) : (
         
<div className="grid gap-6 lg:grid-cols-2">
            {normalizedHabits.map((habit) => {
              const streak = calculateStreak(habit.completions);
              const completionSet = completionSets.get(habit.id) ?? new Set<string>();
              const isCompletedToday = completionSet.has(todayKey);
              const isSaving = savingHabitId === habit.id;
              const isDeleting = deletingHabitId === habit.id;
              const Icon = ICON_MAP[habit.iconType];

              return (
                <Card key={habit.id} className="flex h-full flex-col shadow-sm transition-shadow duration-200 hover:shadow-md">
                  
<CardHeader className="flex-col gap-2 pb-2">
  <CardTitle className="flex items-start gap-3 text-lg font-semibold">
    <Icon className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
    <span className="line-clamp-2 min-w-0">{habit.name}</span>
  </CardTitle>
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-1.5 text-sm font-bold text-amber-500" aria-label={`${streak} day streak`}>
      <Flame className="h-5 w-5" aria-hidden="true" />
      <span>{streak} day{streak === 1 ? "" : "s"}</span>
    </div>
    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => void handleDeleteHabit(habit.id, habit.name)} disabled={isDeleting} aria-label={`Delete ${habit.name}`}>
      {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  </div>
</CardHeader>

                  <CardContent className="flex flex-1 flex-col justify-end">
                    <Button
                      type="button"
                      className="mt-4 w-full"
                      onClick={() => void handleComplete(habit.id, habit.name)}
                      disabled={isCompletedToday || isSaving}
                      variant={isCompletedToday ? "secondary" : "default"}
                      aria-label={isCompletedToday ? `${habit.name} completed today` : `Mark ${habit.name} as complete`}
                    >
                      {isSaving ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Saving...</>
                      ) : isCompletedToday ? (
                        <><Check className="mr-2 h-5 w-5" aria-hidden="true" />Completed Today</>
                      ) : (
                        "Mark as Complete"
                      )}
                    </Button>
                  </CardContent>

                  <CardFooter className="justify-center gap-2 p-4 pt-2">
                    {last7Days.map((day) => {
                      const dayKey = getDayKey(day);
                      const completed = completionSet.has(dayKey);
                      const isCurrentDay = isToday(day);
                      return (
                        <Tooltip key={dayKey}>
                          <TooltipTrigger asChild>
                            <button type="button" className="rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`${format(day, "MMM d")}: ${completed ? "Completed" : "Not completed"}`}>
                              <span className={cn("block h-5 w-5 rounded-full transition-colors", completed ? "bg-primary" : "bg-muted", isCurrentDay && "ring-2 ring-primary ring-offset-2 ring-offset-background")} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent><p>{format(day, "MMM d")}: {completed ? "Completed" : "Not Completed"}</p></TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}

        {!isLoadingHabits && <AddHabitForm onAdd={(name, icon) => void handleAddHabit(name, icon)} isSubmitting={isAddingHabit} />}
      </div>
    </TooltipProvider>
  );
}