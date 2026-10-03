"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import {
  differenceInCalendarDays,
  format,
  isToday,
  parseISO,
  subDays,
} from "date-fns";

import {
  Bed,
  BookOpen,
  Brain,
  Check,
  Dumbbell,
  Flame,
  Loader2,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { useFirestore, useUser } from "@/firebase";

import { errorEmitter } from "@/firebase/error-emitter";
import { FirestorePermissionError } from "@/firebase/errors";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type HabitIconType =
  | "Brain"
  | "BookOpen"
  | "Bed"
  | "Dumbbell";

interface Habit {
  id: string;
  name: string;
  iconType: HabitIconType;
  completions: string[];
}

/**
 * Raw Firestore document shape.
 *
 * IMPORTANT:
 * `id` is not stored inside the document data.
 * Firestore document ID is added locally after reading the document.
 */
interface FirestoreHabitData {
  name?: unknown;
  iconType?: unknown;
  completions?: unknown;
  userId?: unknown;
}

interface FirestoreHabit extends FirestoreHabitData {
  id: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const HABITS_COLLECTION = "habits";

const INITIAL_HABITS: ReadonlyArray<{
  id: string;
  name: string;
  iconType: HabitIconType;
}> = [
  {
    id: "meditate",
    name: "Meditate",
    iconType: "Brain",
  },
  {
    id: "journal",
    name: "Journal",
    iconType: "BookOpen",
  },
  {
    id: "sleep",
    name: "8+ Hours Sleep",
    iconType: "Bed",
  },
  {
    id: "exercise",
    name: "Exercise",
    iconType: "Dumbbell",
  },
];

const ICON_MAP: Record<
  HabitIconType,
  typeof Brain
> = {
  Brain,
  BookOpen,
  Bed,
  Dumbbell,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Uses a calendar date rather than a timestamp.
 *
 * Example:
 * 2026-10-03
 */
const getTodayKey = (): string =>
  format(new Date(), "yyyy-MM-dd");

const getLastSevenDays = (): Date[] => {
  const today = new Date();

  return Array.from({ length: 7 }, (_, index) =>
    subDays(today, 6 - index)
  );
};

const isHabitIconType = (
  value: unknown
): value is HabitIconType => {
  return (
    value === "Brain" ||
    value === "BookOpen" ||
    value === "Bed" ||
    value === "Dumbbell"
  );
};

const getFirestoreCompletions = (
  value: unknown
): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string"
  );
};

/**
 * Calculates the current streak.
 *
 * A streak remains active when the latest completion is:
 * - today
 * - yesterday
 *
 * Any older gap breaks the streak.
 */
const calculateStreak = (
  completions: string[]
): number => {
  if (completions.length === 0) {
    return 0;
  }

  const uniqueDates = Array.from(
    new Set(completions)
  )
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  if (uniqueDates.length === 0) {
    return 0;
  }

  const today = new Date();
  const latestDate = parseISO(uniqueDates[0]);

  const daysSinceLatest =
    differenceInCalendarDays(
      today,
      latestDate
    );

  if (
    daysSinceLatest > 1 ||
    daysSinceLatest < 0
  ) {
    return 0;
  }

  let streak = 0;
  let expectedDate = latestDate;

  for (const dateString of uniqueDates) {
    const date = parseISO(dateString);

    if (
      differenceInCalendarDays(
        expectedDate,
        date
      ) === 0
    ) {
      streak += 1;
      expectedDate = subDays(
        expectedDate,
        1
      );
    } else if (
      differenceInCalendarDays(
        expectedDate,
        date
      ) > 0
    ) {
      break;
    }
  }

  return streak;
};

/* -------------------------------------------------------------------------- */
/* Weekly Overview                                                            */
/* -------------------------------------------------------------------------- */

interface WeekdayIndicatorProps {
  habits: Habit[];
  last7Days: Date[];
}

function WeekdayIndicator({
  habits,
  last7Days,
}: WeekdayIndicatorProps) {
  const allHabitsCount = habits.length;

  const weeklyData = useMemo(() => {
    return last7Days.map((day) => {
      const dayKey = format(
        day,
        "yyyy-MM-dd"
      );

      const completedCount =
        habits.reduce((count, habit) => {
          return (
            count +
            (habit.completions.includes(
              dayKey
            )
              ? 1
              : 0)
          );
        }, 0);

      const ratio =
        allHabitsCount > 0
          ? completedCount /
            allHabitsCount
          : 0;

      return {
        day,
        dayKey,
        completedCount,
        ratio,
      };
    });
  }, [habits, last7Days, allHabitsCount]);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">
          Weekly Overview
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div
          className="grid grid-cols-7 gap-2"
          aria-label="Habit completion for the last seven days"
        >
          {weeklyData.map(
            ({
              day,
              dayKey,
              completedCount,
              ratio,
            }) => {
              const isCurrentDay =
                isToday(day);

              let backgroundClass =
                "bg-muted";

              if (
                ratio > 0 &&
                ratio <= 0.5
              ) {
                backgroundClass =
                  "bg-primary/20";
              } else if (
                ratio > 0.5 &&
                ratio < 1
              ) {
                backgroundClass =
                  "bg-primary/50";
              } else if (
                ratio === 1
              ) {
                backgroundClass =
                  "bg-primary/80";
              }

              return (
                <Tooltip key={dayKey}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex min-w-0 flex-col items-center gap-2 rounded-md p-1 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={`${format(
                        day,
                        "MMM d"
                      )}: ${completedCount} of ${allHabitsCount} habits completed`}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                          backgroundClass,
                          isCurrentDay &&
                            "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        )}
                      >
                        {isCurrentDay && (
                          <span
                            className="h-2 w-2 rounded-full bg-primary"
                            aria-hidden="true"
                          />
                        )}
                      </div>

                      <span className="text-xs text-muted-foreground">
                        {format(day, "E")}
                      </span>
                    </button>
                  </TooltipTrigger>

                  <TooltipContent>
                    <p>
                      {format(
                        day,
                        "MMM d"
                      )}
                      :{" "}
                      {completedCount}/
                      {allHabitsCount} habits
                      completed
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            }
          )}
        </div>
      </CardContent>
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

  /**
   * Firestore data is deliberately kept separate from the
   * static habit configuration.
   *
   * This allows the four habit cards to render immediately.
   */
  const [firestoreHabits, setFirestoreHabits] =
    useState<FirestoreHabit[]>([]);

  /**
   * Only used internally while the initial Firestore
   * request is happening.
   *
   * IMPORTANT:
   * This state NEVER blocks the UI.
   */
  const [isLoadingHabits, setIsLoadingHabits] =
    useState(false);

  const [savingHabitId, setSavingHabitId] =
    useState<string | null>(null);

  /* ------------------------------------------------------------------------ */
  /* Load Firestore data in the background                                    */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!db || !user) {
      setFirestoreHabits([]);
      setIsLoadingHabits(false);
      return;
    }

    let cancelled = false;

    const loadHabits = async () => {
      setIsLoadingHabits(true);

      try {
        const habitsRef = collection(
          db,
          "users",
          user.uid,
          HABITS_COLLECTION
        );

        const snapshot =
          await getDocs(habitsRef);

        if (cancelled) {
          return;
        }

        const loadedHabits: FirestoreHabit[] =
          snapshot.docs.map(
            (habitDoc) => ({
              id: habitDoc.id,
              ...habitDoc.data(),
            })
          );

        setFirestoreHabits(
          loadedHabits
        );
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }

        const firebaseError =
          error as {
            code?: string;
            message?: string;
          };

        if (
          firebaseError.code ===
          "permission-denied"
        ) {
          errorEmitter.emit(
            "permission-error",
            new FirestorePermissionError(
              {
                path: `users/${user.uid}/${HABITS_COLLECTION}`,
                operation: "list",
              }
            )
          );
        }

        console.error(
          "Failed to load habits:",
          {
            code:
              firebaseError.code ??
              "unknown",
            message:
              firebaseError.message ??
              "Unknown error",
          }
        );

        toast({
          variant: "destructive",
          title: "Couldn't load habit progress",
          description:
            "Your habit cards are available, but saved progress could not be loaded.",
        });
      } finally {
        if (!cancelled) {
          setIsLoadingHabits(false);
        }
      }
    };

    void loadHabits();

    return () => {
      cancelled = true;
    };
  }, [db, user, toast]);

  /* ------------------------------------------------------------------------ */
  /* Static calendar data                                                     */
  /* ------------------------------------------------------------------------ */

  const last7Days = useMemo(
    () => getLastSevenDays(),
    []
  );

  const todayKey = getTodayKey();

  /* ------------------------------------------------------------------------ */
  /* Merge static habits + Firestore state                                   */
  /* ------------------------------------------------------------------------ */

  const normalizedHabits =
    useMemo<Habit[]>(() => {
      const firestoreHabitMap =
        new Map<string, FirestoreHabit>();

      for (const habit of firestoreHabits) {
        firestoreHabitMap.set(
          habit.id,
          habit
        );
      }

      return INITIAL_HABITS.map(
        (habit) => {
          const firestoreHabit =
            firestoreHabitMap.get(
              habit.id
            );

          return {
            ...habit,
            completions:
              getFirestoreCompletions(
                firestoreHabit?.completions
              ),
          };
        }
      );
    }, [firestoreHabits]);

  /* ------------------------------------------------------------------------ */
  /* Precompute completion sets                                               */
  /* ------------------------------------------------------------------------ */

  const completionSets = useMemo(() => {
    const map = new Map<
      string,
      Set<string>
    >();

    for (const habit of normalizedHabits) {
      map.set(
        habit.id,
        new Set(habit.completions)
      );
    }

    return map;
  }, [normalizedHabits]);

  /* ------------------------------------------------------------------------ */
  /* Complete habit                                                           */
  /* ------------------------------------------------------------------------ */

  const handleComplete = useCallback(
    async (
      habitId: string,
      habitName: string
    ) => {
      if (!user || !db) {
        return;
      }

      if (savingHabitId === habitId) {
        return;
      }

      const habit =
        normalizedHabits.find(
          (item) =>
            item.id === habitId
        );

      if (!habit) {
        return;
      }

      const currentTodayKey =
        getTodayKey();

      if (
        habit.completions.includes(
          currentTodayKey
        )
      ) {
        toast({
          title: "Already completed",
          description: `You've already completed "${habitName}" today.`,
        });

        return;
      }

      const habitDoc = doc(
        db,
        "users",
        user.uid,
        HABITS_COLLECTION,
        habitId
      );

      const existingFirestoreHabit =
        firestoreHabits.find(
          (item) =>
            item.id === habitId
        );

      /**
       * Keep the previous state so we can
       * rollback if Firestore rejects the write.
       */
      const previousHabits =
        firestoreHabits;

      /**
       * Optimistic UI update.
       *
       * The user sees the completion immediately,
       * without waiting for Firestore.
       */
      setFirestoreHabits(
        (current) => {
          const existingIndex =
            current.findIndex(
              (item) =>
                item.id === habitId
            );

          if (
            existingIndex === -1
          ) {
            return [
              ...current,
              {
                id: habitId,
                name: habitName,
                iconType:
                  INITIAL_HABITS.find(
                    (item) =>
                      item.id ===
                      habitId
                  )?.iconType ??
                  "Brain",
                completions: [
                  currentTodayKey,
                ],
                userId: user.uid,
              },
            ];
          }

          return current.map(
            (item, index) => {
              if (
                index !==
                existingIndex
              ) {
                return item;
              }

              return {
                ...item,
                completions: [
                  ...getFirestoreCompletions(
                    item.completions
                  ),
                  currentTodayKey,
                ],
              };
            }
          );
        }
      );

      setSavingHabitId(habitId);

      try {
        if (
          !existingFirestoreHabit
        ) {
          await setDoc(
            habitDoc,
            {
              name: habitName,
              iconType:
                INITIAL_HABITS.find(
                  (item) =>
                    item.id ===
                    habitId
                )?.iconType ??
                "Brain",
              completions: [
                currentTodayKey,
              ],
              userId: user.uid,
            }
          );
        } else {
          await updateDoc(
            habitDoc,
            {
              completions:
                arrayUnion(
                  currentTodayKey
                ),
            }
          );
        }

        toast({
          title: "Habit completed!",
          description: `Great job on "${habitName}" today!`,
        });
      } catch (error: unknown) {
        /**
         * Roll back optimistic UI state
         * when the Firestore operation fails.
         */
        setFirestoreHabits(
          previousHabits
        );

        const firebaseError =
          error as {
            code?: string;
            message?: string;
          };

        if (
          firebaseError.code ===
          "permission-denied"
        ) {
          errorEmitter.emit(
            "permission-error",
            new FirestorePermissionError(
              {
                path:
                  habitDoc.path,
                operation:
                  existingFirestoreHabit
                    ? "update"
                    : "create",
              }
            )
          );
        }

        console.error(
          "Failed to save habit:",
          {
            code:
              firebaseError.code ??
              "unknown",
            message:
              firebaseError.message ??
              "Unknown error",
          }
        );

        toast({
          variant: "destructive",
          title: "Couldn't save habit",
          description:
            "Your completion could not be saved. Please try again.",
        });
      } finally {
        setSavingHabitId(null);
      }
    },
    [
      db,
      firestoreHabits,
      normalizedHabits,
      savingHabitId,
      toast,
      user,
    ]
  );

  /* ------------------------------------------------------------------------ */
  /* Authentication state                                                     */
  /* ------------------------------------------------------------------------ */

  if (!user) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-8 text-center">
          <Brain
            className="mb-3 h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />

          <h3 className="font-semibold">
            Sign in to track your habits
          </h3>

          <p className="mt-1 text-sm text-muted-foreground">
            Your habit progress will
            be saved securely to your
            account.
          </p>
        </CardContent>
      </Card>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-0">
        <WeekdayIndicator
          habits={normalizedHabits}
          last7Days={last7Days}
        />

        <div className="grid gap-6 md:grid-cols-2">
          {normalizedHabits.map(
            (habit) => {
              const streak =
                calculateStreak(
                  habit.completions
                );

              const completionSet =
                completionSets.get(
                  habit.id
                ) ??
                new Set<string>();

              const isCompletedToday =
                completionSet.has(
                  todayKey
                );

              const isSaving =
                savingHabitId ===
                habit.id;

              const Icon =
                ICON_MAP[
                  habit.iconType
                ];

              return (
                <Card
                  key={habit.id}
                  className="flex h-full flex-col shadow-sm transition-shadow duration-200 hover:shadow-md"
                >
                  <CardHeader className="flex-row items-center justify-between gap-4 pb-2">
                    <CardTitle className="flex min-w-0 items-center gap-3 text-lg font-semibold">
                      <Icon
                        className="h-6 w-6 shrink-0 text-primary"
                        aria-hidden="true"
                      />

                      <span className="truncate">
                        {habit.name}
                      </span>
                    </CardTitle>

                    <div
                      className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-amber-500"
                      aria-label={`${streak} day streak`}
                    >
                      <Flame
                        className="h-5 w-5"
                        aria-hidden="true"
                      />

                      <span>
                        {streak} day
                        {streak === 1
                          ? ""
                          : "s"}
                      </span>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-1 flex-col justify-end">
                    <Button
                      type="button"
                      className="mt-4 w-full"
                      onClick={() =>
                        void handleComplete(
                          habit.id,
                          habit.name
                        )
                      }
                      disabled={
                        isCompletedToday ||
                        isSaving
                      }
                      variant={
                        isCompletedToday
                          ? "secondary"
                          : "default"
                      }
                      aria-label={
                        isCompletedToday
                          ? `${habit.name} completed today`
                          : `Mark ${habit.name} as complete`
                      }
                    >
                      {isSaving ? (
                        <>
                          <Loader2
                            className="mr-2 h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />

                          Saving...
                        </>
                      ) : isCompletedToday ? (
                        <>
                          <Check
                            className="mr-2 h-5 w-5"
                            aria-hidden="true"
                          />

                          Completed Today
                        </>
                      ) : (
                        "Mark as Complete"
                      )}
                    </Button>
                  </CardContent>

                  <CardFooter className="justify-center gap-2 p-4 pt-2">
                    {last7Days.map(
                      (day) => {
                        const dayKey =
                          format(
                            day,
                            "yyyy-MM-dd"
                          );

                        const completed =
                          completionSet.has(
                            dayKey
                          );

                        const isCurrentDay =
                          isToday(day);

                        return (
                          <Tooltip
                            key={dayKey}
                          >
                            <TooltipTrigger
                              asChild
                            >
                              <button
                                type="button"
                                className="rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                aria-label={`${format(
                                  day,
                                  "MMM d"
                                )}: ${
                                  completed
                                    ? "Completed"
                                    : "Not completed"
                                }`}
                              >
                                <span
                                  className={cn(
                                    "block h-5 w-5 rounded-full transition-colors",
                                    completed
                                      ? "bg-primary"
                                      : "bg-muted",
                                    isCurrentDay &&
                                      "ring-2 ring-primary ring-offset-2 ring-offset-background"
                                  )}
                                />
                              </button>
                            </TooltipTrigger>

                            <TooltipContent>
                              <p>
                                {format(
                                  day,
                                  "MMM d"
                                )}
                                :{" "}
                                {completed
                                  ? "Completed"
                                  : "Not Completed"}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      }
                    )}
                  </CardFooter>
                </Card>
              );
            }
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}