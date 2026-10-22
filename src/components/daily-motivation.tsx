"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "./ui/skeleton";
import { Sparkles } from "lucide-react";
import { getMotivationAction } from "@/app/actions";
import { auth } from "@/lib/firebase"; // ⚠️ VERIFY path
import { getTodayAndHistory, saveToday } from "@/lib/motivation/store-client";
import { pickTheme, pickFallback, ThemeId } from "@/lib/motivation/engine";

function dayOfYear(): number {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
  const diff = now.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

export default function DailyMotivation() {
  const [motivation, setMotivation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, () => {
      load().catch((e) => {
        console.error("DailyMotivation load:", e);
        setMotivation(pickFallback("discipline" as ThemeId, []));
        setLoading(false);
      });
    });
    return () => unsub();
  }, []);

  async function load() {
    setLoading(true);
    const { today, history, uid } = await getTodayAndHistory();

    if (today) {
      setMotivation(today.message);
      setLoading(false);
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const recentThemes = history.slice(0, 3).map((h) => h.theme);
    const recentMessages = history.map((h) => h.message);
    const theme = pickTheme(dayOfYear(), recentThemes);

    const result = await getMotivationAction({ theme, recentMessages });

    const message = result.success && result.data
      ? result.data.message
      : pickFallback(theme, recentMessages);

    setMotivation(message);
    setLoading(false);

    // daily-motivation.tsx — pass it through when saving
await saveToday({ message, theme, date, source: result.success && result.data ? result.data.source : "fallback" }, uid);
    
  }

  return (
    <Card className="bg-primary/80 border-primary text-primary-foreground shadow-lg transition-transform duration-300 hover:scale-105">
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <Sparkles className="w-8 h-8 flex-shrink-0" />
          {loading ? (
            <div className="space-y-2 w-full">
              <Skeleton className="h-4 w-3/4 bg-primary-foreground/20" />
              <Skeleton className="h-4 w-1/2 bg-primary-foreground/20" />
            </div>
          ) : (
            <p className="text-lg font-medium">{motivation}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}