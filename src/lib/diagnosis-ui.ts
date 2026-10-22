
import type { DiagnosisResult, HealthProfile, Urgency, DiagnosisSource } from "@/lib/types";





export type DiagnosisData = DiagnosisResult;
export type Source = DiagnosisSource;
export type { HealthProfile, Urgency };



export const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];

export const isSafeUrl = (u: string) => {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};

export const specialtySlug = (s: string) =>
  s.toLowerCase().trim().replace(/\s+/g, "-");

export function sanitizeProfile(raw: unknown): HealthProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string, n: number) =>
    typeof r[k] === "string" ? (r[k] as string).trim().slice(0, n) : "";
  const sex = r.sex === "female" || r.sex === "male" || r.sex === "other" ? r.sex : "";
  return {
    age: s("age", 3).replace(/\D/g, ""),
    sex,
    conditions: s("conditions", 300),
    medications: s("medications", 300),
    allergies: s("allergies", 300),
    pregnant: r.pregnant === true && sex !== "male",
  };
}

export const hasProfile = (p: HealthProfile) =>
  Object.values(p).some((v) => v === true || (typeof v === "string" && v.trim()));

// ---------- Item 4: local longitudinal context (opt-in) ----------
export interface HistoryEntry { date: string; urgency: Urgency; topIssue: string }
const HISTORY_KEY = "mha.recentCheckins.v1"; // add to account-deletion cleanup
const HISTORY_CONSENT_KEY = "mha.historyConsent.v1"; // add to account-deletion cleanup
const HISTORY_MAX = 3;

export const hasHistoryConsent = (): boolean => {
  try { return localStorage.getItem(HISTORY_CONSENT_KEY) === "1"; } catch { return false; }
};
export const setHistoryConsent = (v: boolean): void => {
  try {
    if (v) localStorage.setItem(HISTORY_CONSENT_KEY, "1");
    else { localStorage.removeItem(HISTORY_CONSENT_KEY); localStorage.removeItem(HISTORY_KEY); }
  } catch { /* ignore */ }
};
export function getLocalHistory(): HistoryEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(raw) ? raw.slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}
export function addLocalHistoryEntry(entry: HistoryEntry): void {
  try {
    const next = [entry, ...getLocalHistory().filter((h) => h.date !== entry.date)].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}
export const historyToLines = (h: HistoryEntry[]): string[] => h.map((e) => `${e.date}: ${e.urgency} — ${e.topIssue}`);

// ---------- Item 5: language selection ----------
export const LOCALES = [
  { id: "en-IN", label: "English" },
  { id: "hi-IN", label: "हिंदी" },
  { id: "hi-Latn-IN", label: "Hinglish" },
] as const;
export type LocaleId = (typeof LOCALES)[number]["id"];
const LANG_KEY = "mha.lang.v1"; // not health data, no consent gate needed
export const getSavedLocale = (): LocaleId => {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return (LOCALES.some((l) => l.id === v) ? v : "en-IN") as LocaleId;
  } catch { return "en-IN"; }
};
export const saveLocale = (id: LocaleId): void => {
  try { localStorage.setItem(LANG_KEY, id); } catch { /* ignore */ }
};

/* ---------- Client-side red-flag pre-check (runs BEFORE the LLM) ---------- */

export type Crisis = "mental" | "medical" | null;

const MENTAL =
  /(suicid\w*|kill (myself|me)|end (my life|it all)|want to die|don'?t want to live|no point (living|to (any of )?this)|can'?t go on|better off dead|self[- ]?harm|hurt myself|marna chahta|marna chahti|jeena nahi (chahta|chahti)|jaan de (doon|dena)|sab khatam|आत्महत्या|खुदकुशी|मरना चाहत[ाी]|जीना नहीं चाहत[ाी]|जीने का मन नहीं|सब खत्म (करना|करने))/i;

const MEDICAL =
  /(chest (pain|pressure|tightness)|can'?t (breathe|catch my breath)|cannot breathe|short(ness)? of breath|difficulty breathing|turning blue|lips (are )?blue|face droop|slurred speech|one[- ]sided weakness|sudden numbness.*(side|arm|leg|face)|cannot feel (my|her|his) (arm|leg|face)|unconscious|passed out|seizure|severe bleeding|heavy bleeding (won'?t|wont) stop|vomiting blood|blood in (stool|vomit)|overdose|poison|anaphyla|swollen (tongue|throat)|throat (closing|swelling)|seene mein dard|saans nahi|behosh|दौरा पड़ा|बेहोश|लकवा|खून की उल्टी|पेशाब में खून|सीने में दर्द|सा[ँं]स (नहीं|लेने में तकलीफ))/i;
// MENTAL: |आत्महत्या|खुदकुशी|मरना चाहत[ाी]|जीना नहीं चाहत[ाी]|jeena nahi
// MEDICAL: |सीने में दर्द|सा[ँं]स (?:नहीं|लेने में तकलीफ)|बेहोश|मिर्गी का दौरा|खून की उल्टी|लकवा
export const detectCrisis = (t: string): Crisis =>
  MENTAL.test(t) ? "mental" : MEDICAL.test(t) ? "medical" : null;

/* ---------- Serialization (history context + "copy for doctor") ---------- */

export function diagnosisToText(d: DiagnosisData): string {
  const out: string[] = [];
  const add = (label: string, items: unknown) => {
    const l = list(items);
    if (l.length) out.push(`${label}: ${l.join("; ")}`);
  };
  if (d.urgency)
    out.push(`Urgency: ${d.urgency}${d.urgencyReason ? ` (${d.urgencyReason})` : ""}`);
  add("Possible physical causes", d.relatedPhysicalIllnesses);
  add("Emotional wellbeing patterns", d.mentalHealthConditions);
  add("Red flags", d.redFlags);
  add("Lifestyle", d.wellnessAdvice?.lifestyle);
  add("Mindfulness", d.wellnessAdvice?.mindfulness);
  add("Diet", d.wellnessAdvice?.diet);
  add("Questions for doctor", d.questionsForDoctor);
  out.push("Preliminary AI analysis. Not a medical diagnosis.");
  return out.join("\n");
}