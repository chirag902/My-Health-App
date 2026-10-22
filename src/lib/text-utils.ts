export const MAX_FIELD_LENGTH = 120;

// Control chars, zero-width space, bidi marks/overrides/isolates, BOM.
// Keeps ZWJ/ZWNJ (U+200C/D, required by Indic scripts) and normal whitespace.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000E-\u001F\u007F\u0080-\u0084\u0086-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function* graphemes(s: string): Generator<string> {
  if (segmenter) for (const g of segmenter.segment(s)) yield g.segment;
  else yield* Array.from(s);
}

export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** Grapheme-safe: never cuts a Devanagari conjunct or emoji in half. */
export function truncate(s: string, max: number, ellipsis = false): string {
  if (s.length <= max) return s;
  const budget = ellipsis ? max - 1 : max;
  let out = "";
  for (const g of graphemes(s)) {
    if (out.length + g.length > budget) break;
    out += g;
  }
  out = out.trimEnd();
  return ellipsis ? `${out}…` : out;
}

export function limitText(value: unknown, maxLength = MAX_FIELD_LENGTH): string {
  return truncate(cleanText(value), maxLength);
}

/** `fallback` is returned for NaN/Infinity/non-numbers. Default kept at 0.5 for existing callers. */
export function clampConfidence(value: unknown, fallback = 0.5): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

/** Cleans, de-duplicates (case-insensitive), truncates, caps count. */
export function cleanStringArray(value: unknown, maxItems = 10, maxLength = 300): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = truncate(cleanText(item), maxLength, true);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function normalizeMetricName(metric: string): string {
  return cleanText(metric)
    .normalize("NFKC") // µ (U+00B5) and μ (U+03BC) become one character
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Deterministic dosing guard. Deliberately excludes grams/ml (diet advice: "30 g protein").
const DOSAGE =
  /\d(?:[.,]\d+)?\s?(?:mg|mcg|[µμ]g|ug|iu|units?)\b|\b\d+\s?(?:tablets?|tabs?|capsules?|drops|puffs)\b/i;

export const containsDosage = (s: string): boolean => DOSAGE.test(s);