// src/lib/lab-results.ts
//
// Pure helpers that turn the analysis output into display-ready rows.
//
// DEFENSIVE ON PURPOSE: the input comes from a server action, an AI pipeline and (later) saved
// records. Any of them can hand us missing fields, odd casing, numbers instead of strings or
// placeholders such as "Not specified". The screen must never crash or show "undefined".

/* ============================================================
   TYPES
   ============================================================ */

   export type FlagKind = "high" | "low" | "normal" | "unknown";

   export interface DisplayPoint {
     /** Stable key for React lists. */
     id: string;
     metric: string;
     /** The measured result exactly as extracted. We never reformat numbers. */
     value: string;
     /** null when the report did not state one (never show "Not specified" to users). */
     unit: string | null;
     referenceRange: string | null;
     flag: FlagKind;
     /** True when extraction confidence is low enough that the user should compare with the paper report. */
     needsVerification: boolean;
   }
   
   export interface ResultsSummary {
     total: number;
     high: number;
     low: number;
     normal: number;
     unknown: number;
     /** high + low: values outside the printed reference range. */
     flagged: number;
     toVerify: number;
   }
   
   /* ============================================================
      CONSTANTS
      ============================================================ */
   
   /** Below this extraction confidence we ask the user to double-check the value against the report. */
   export const VERIFY_BELOW_CONFIDENCE = 0.7;
   
   const MAX_TEXT_LENGTH = 200;
   
   const PLACEHOLDERS = new Set(["", "not specified", "n/a", "na", "none", "null", "undefined", "-", "\u2014", "\u2013"]);
   
   /* ============================================================
      TEXT
      ============================================================ */
   
   /** Collapses whitespace and bounds length. Accepts numbers; everything else becomes "". */
   export function asText(value: unknown): string {
     const text =
       typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
   
     const cleaned = text.replace(/\s+/g, " ").trim();
   
     return cleaned.length > MAX_TEXT_LENGTH ? `${cleaned.slice(0, MAX_TEXT_LENGTH)}\u2026` : cleaned;
   }
   
   /** Returns null for empty values and placeholders like "Not specified" or "N/A". */
   export function textOrNull(value: unknown): string | null {
     const text = asText(value);
   
     return PLACEHOLDERS.has(text.toLowerCase()) ? null : text;
   }
   
   /* ============================================================
      FLAGS
      ============================================================ */
   
   const HIGH_PATTERN = /^(?:critical(?:ly)?\s+)?(?:high|h|above|elevated|increased)\b/i;
   const LOW_PATTERN = /^(?:critical(?:ly)?\s+)?(?:low|l|below|decreased|reduced)\b/i;
   const NORMAL_PATTERN = /^(?:normal|within(?:\s+range)?|ok)\b/i;
   
   /** Maps whatever the pipeline sent ("High", "H", "critical high", "N/A", ...) to one of four kinds. */
   export function normalizeFlag(raw: unknown): FlagKind {
     const text = asText(raw);
   
     if (HIGH_PATTERN.test(text)) return "high";
     if (LOW_PATTERN.test(text)) return "low";
     if (NORMAL_PATTERN.test(text)) return "normal";
   
     return "unknown";
   }
   
   /* ============================================================
      CONFIDENCE
      ============================================================ */
   
   export function needsVerification(confidence: unknown): boolean {
     return typeof confidence === "number" && Number.isFinite(confidence) && confidence < VERIFY_BELOW_CONFIDENCE;
   }
   
   /* ============================================================
      NORMALIZATION
      ============================================================ */
   
   function isRecord(value: unknown): value is Record<string, unknown> {
     return typeof value === "object" && value !== null && !Array.isArray(value);
   }
   
   /**
    * Converts the raw `keyDataPoints` array into display rows.
    * Rows without a metric name or without a value are dropped: there is nothing useful to show.
    */
   export function normalizeKeyDataPoints(raw: unknown): DisplayPoint[] {
     if (!Array.isArray(raw)) return [];
   
     const points: DisplayPoint[] = [];
   
     raw.forEach((item, index) => {
       if (!isRecord(item)) return;
   
       const metric = asText(item.metric);
       const value = textOrNull(item.value);
   
       if (!metric || value === null) return;
   
       points.push({
         id: `${index}-${metric}`,
         metric,
         value,
         unit: textOrNull(item.unit),
         // `referenceRange` is the current field; `range` is kept for older data.
         referenceRange: textOrNull(item.referenceRange) ?? textOrNull(item.range),
         flag: normalizeFlag(item.flag),
         needsVerification: needsVerification(item.confidence),
       });
     });
   
     return points;
   }
   
   /* ============================================================
      SUMMARY
      ============================================================ */
   
   export function summarizePoints(points: readonly DisplayPoint[]): ResultsSummary {
     const summary: ResultsSummary = { total: points.length, high: 0, low: 0, normal: 0, unknown: 0, flagged: 0, toVerify: 0 };
   
     for (const point of points) {
       summary[point.flag] += 1;
       if (point.needsVerification) summary.toVerify += 1;
     }
   
     summary.flagged = summary.high + summary.low;
   
     return summary;
   }
   
   /** Rows to show. When `flaggedOnly` is on, rows outside the reference range stay visible. */
   export function filterPoints(points: readonly DisplayPoint[], flaggedOnly: boolean): DisplayPoint[] {
     return flaggedOnly ? points.filter((point) => point.flag === "high" || point.flag === "low") : [...points];
   }
   
   export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
     return `${count} ${count === 1 ? singular : plural}`;
   }