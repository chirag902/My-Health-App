// src/lib/health-records-utils.ts
//
// Pure helpers for the Health Records screen. No React, no browser APIs: easy to test.

import type { AnalyzeDocumentOutput } from "@/lib/types";

/* ============================================================
   TYPES
   ============================================================ */

export interface HealthRecord {
  id: string;
  date: string;
  type: string;
  title: string;
  status: string;
}

export interface HealthTrendPoint {
  month: string;
  records: number;
}

/* ============================================================
   FILE TYPES
   ============================================================ */

export const ALLOWED_FILE_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Non-standard names some browsers and phones report for JPEG. */
const LEGACY_MIME: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** iPhone photos that cannot be read in the browser or by the server. */
export function isHeicFile(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  const extension = extensionOf(file.name);

  return type === "image/heic" || type === "image/heif" || extension === "heic" || extension === "heif";
}

/**
 * The browser's `file.type` is empty or "application/octet-stream" for some files
 * (certain Android pickers, some Windows setups). Fall back to the extension so a valid
 * PDF or photo is not rejected as "unsupported".
 *
 * Returns a supported MIME type, or null.
 */
export function resolveMimeType(file: { name: string; type: string }): string | null {
  const declared = file.type.toLowerCase().trim();

  if (ALLOWED_FILE_TYPES.has(declared)) return declared;
  if (LEGACY_MIME[declared]) return LEGACY_MIME[declared];

  if (declared === "" || declared === "application/octet-stream") {
    return EXTENSION_TO_MIME[extensionOf(file.name)] ?? null;
  }

  return null;
}

/* ============================================================
   RESPONSES + ERRORS
   ============================================================ */

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Something went wrong. Please try again.";
}

export function describeHttpFailure(status: number): string {
  if (status === 413) return "The upload was too large. Please use a smaller file.";
  if (status === 504) return "The analysis took too long. Please try a clearer or smaller document.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "Your account is not allowed to analyze documents.";
  if (status === 404) return "The analysis service could not be found. Please try again later.";
  if (status === 429) return "Too many requests. Please wait a few minutes and try again.";
  if (status === 503) return "The service is temporarily unavailable. Please try again in a moment.";
  return "Document analysis failed.";
}

export function isSuccessfulAnalysisResponse(
  value: unknown
): value is { success: true; data: AnalyzeDocumentOutput } {
  if (typeof value !== "object" || value === null) return false;

  const response = value as { success?: unknown; data?: unknown };

  return response.success === true && response.data !== undefined;
}

/* ============================================================
   DEMO DATA + TRENDS
   ============================================================ */

const DAY_MS = 86_400_000;

/**
 * Sample records, dated relative to `now` so the chart never goes stale.
 * UI examples only; never present them as the user's real medical data.
 */
export function buildDemoRecords(now: Date): HealthRecord[] {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);

  return [
    { id: "demo-1", date: daysAgo(12), type: "Lab Result", title: "Annual Blood Panel", status: "Sample" },
    { id: "demo-2", date: daysAgo(45), type: "Diagnosis", title: "Example Diagnosis Record", status: "Sample" },
    { id: "demo-3", date: daysAgo(130), type: "Consultation Note", title: "Example Consultation Note", status: "Sample" },
  ];
}

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function monthLabel(year: number, monthIndex: number): string {
  // timeZone "UTC" is essential: the date below is midnight UTC on the 1st, which would
  // display as the PREVIOUS month for every viewer west of UTC (the whole Americas).
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, monthIndex, 1))
  );
}

/** Six monthly buckets ending with the month of `now`. Counts the records it is given; invents nothing. */
export function buildMonthlyTrends(
  records: readonly HealthRecord[],
  now: Date = new Date(),
  monthsToDisplay = 6
): HealthTrendPoint[] {
  const buckets = new Map<string, HealthTrendPoint>();

  for (let offset = monthsToDisplay - 1; offset >= 0; offset--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();

    buckets.set(monthKey(year, month), { month: monthLabel(year, month), records: 0 });
  }

  for (const record of records) {
    const date = new Date(record.date);
    if (Number.isNaN(date.getTime())) continue;

    const bucket = buckets.get(monthKey(date.getUTCFullYear(), date.getUTCMonth()));
    if (bucket) bucket.records += 1;
  }

  return [...buckets.values()];
}

/* ============================================================
   CHART HELPERS
   ============================================================ */

const MAX_TREND_POINTS = 24;

export interface TrendSummary {
  /** Sum of all records in the window. */
  total: number;
  first: string;
  last: string;
  /** Busiest month (the most recent one if several tie); null when there are no records at all. */
  peak: HealthTrendPoint | null;
}

/**
 * Defensive copy of whatever the chart is given. Drops malformed points and turns
 * negative, fractional or non-numeric counts into safe whole numbers.
 */
export function sanitizeTrendData(data: unknown): HealthTrendPoint[] {
  if (!Array.isArray(data)) return [];

  const points: HealthTrendPoint[] = [];

  for (const item of data.slice(0, MAX_TREND_POINTS)) {
    if (typeof item !== "object" || item === null) continue;

    const { month, records } = item as { month?: unknown; records?: unknown };

    if (typeof month !== "string" || month.trim() === "") continue;

    points.push({
      month: month.trim().slice(0, 12),
      records: typeof records === "number" && Number.isFinite(records) ? Math.max(0, Math.floor(records)) : 0,
    });
  }

  return points;
}

export function summarizeTrends(data: readonly HealthTrendPoint[]): TrendSummary {
  let total = 0;
  let peak: HealthTrendPoint | null = null;

  for (const point of data) {
    total += point.records;

    if (point.records > 0 && (peak === null || point.records >= peak.records)) {
      peak = point;
    }
  }

  return {
    total,
    first: data.length > 0 ? data[0].month : "",
    last: data.length > 0 ? data[data.length - 1].month : "",
    peak,
  };
}

/* ============================================================
   Y AXIS
   ============================================================ */

export interface CountAxis {
  /** Top of the axis (>= the largest value). */
  max: number;
  /** Evenly spaced whole numbers starting at 0. */
  ticks: number[];
}

/**
 * Clean, evenly spaced whole-number ticks for a count axis (0, 1, 2 ... or 0, 5, 10 ...).
 * recharts' own "auto" domain pads a maximum of 1 up to 4, and a plain max() gives uneven ticks like 0, 2, 5.
 * Steps follow the familiar 1-2-5 sequence; never more than `maxTicks` labels; never below 2 at the top.
 */
export function buildCountAxis(dataMax: number, maxTicks = 6): CountAxis {
  const peak = Math.max(2, Math.ceil(Number.isFinite(dataMax) ? dataMax : 0));
  const wanted = peak / Math.max(1, maxTicks - 1);

  let step = 1;
  for (let magnitude = 1; ; magnitude *= 10) {
    const candidate = [1, 2, 5, 10].map((multiplier) => multiplier * magnitude).find((value) => value >= wanted);

    if (candidate !== undefined) {
      step = candidate;
      break;
    }
  }

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];

  for (let value = 0; value <= max; value += step) ticks.push(value);

  return { max, ticks };
}