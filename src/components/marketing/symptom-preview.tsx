"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

// Real examples reflecting actual symptom-checker inputs — not generic
// placeholder text. This is the core AI Symptom Check feature itself,
// demonstrated, not described.
const EXAMPLES = [
  "persistent headache for the last 3 days",
  "lower back pain after lifting something heavy",
  "constant fatigue and trouble sleeping",
  "mild chest tightness when climbing stairs",
] as const;

const TYPE_SPEED_MS = 45;
const DELETE_SPEED_MS = 25;
const HOLD_MS = 1400;

export default function SymptomPreview() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [phase, setPhase] = useState<"typing" | "holding" | "deleting">("typing");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setDisplayedText(EXAMPLES[0]);
      return;
    }

    const current = EXAMPLES[exampleIndex];
    let timeout: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      if (displayedText.length < current.length) {
        timeout = setTimeout(() => setDisplayedText(current.slice(0, displayedText.length + 1)), TYPE_SPEED_MS);
      } else {
        timeout = setTimeout(() => setPhase("holding"), HOLD_MS);
      }
    } else if (phase === "holding") {
      timeout = setTimeout(() => setPhase("deleting"), 0);
    } else {
      if (displayedText.length > 0) {
        timeout = setTimeout(() => setDisplayedText(displayedText.slice(0, -1)), DELETE_SPEED_MS);
      } else {
        setExampleIndex((i) => (i + 1) % EXAMPLES.length);
        setPhase("typing");
      }
    }

    return () => clearTimeout(timeout);
  }, [displayedText, phase, exampleIndex, reducedMotion]);

  return (
    <Link
      href="/signup"
      className="group mx-auto flex max-w-xl items-center gap-3 rounded-2xl border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-brand/50"
      aria-label="Try the AI symptom checker — describe how you feel"
    >
      <span className="flex-1 truncate text-sm text-muted-foreground sm:text-base">
        {displayedText || "\u00A0"}
        <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-brand" aria-hidden="true" />
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand">
        Try it <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}