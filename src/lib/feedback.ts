"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase"; // ⚠️ VERIFY export names/path
import type { DiagnosisMode, Urgency } from "@/lib/types";

const CONSENT_KEY = "mha.feedbackConsent.v1"; // ⚠️ add to account-deletion localStorage cleanup
export type UrgencyRating = "too_low" | "correct" | "too_high";

export const hasFeedbackConsent = (): boolean => {
  try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; }
};

export const setFeedbackConsent = (v: boolean): void => {
  try { v ? localStorage.setItem(CONSENT_KEY, "1") : localStorage.removeItem(CONSENT_KEY); } catch { /* ignore */ }
};

/** Anonymous aggregate signal only: no symptom text, no profile, no free text. */
export async function submitDiagnosisFeedback(input: {
  mode: DiagnosisMode;
  urgency: Urgency;
  helpful: boolean;
  urgencyRating: UrgencyRating;
}): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false; // signed-out: nothing to attribute to, skip silently
  try {
    await addDoc(collection(db, "users", uid, "diagnosisFeedback"), { ...input, createdAt: serverTimestamp() });
    return true;
  } catch {
    return false; // best-effort; never blocks the UI
  }
}