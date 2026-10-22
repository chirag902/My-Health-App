// src/lib/ocr/tableParser.ts

/**
 * Medical laboratory table parser.
 *
 * Converts text (PDF text layer or OCR output) into structured lab metrics.
 *
 * DESIGN RULES (do not weaken these without a very good reason):
 *
 *  1. NEVER invent data. Every returned value is a substring of the input.
 *  2. PREFER A MISS OVER A MISLABEL. If a row is ambiguous ("Calcium, Ionized",
 *     "Cholesterol/HDL Ratio", an interpretation paragraph, a range legend), the row is
 *     skipped. A missing metric is a UX problem; a wrong metric in a health app is a safety problem.
 *  3. Deterministic and side-effect free. No LLM calls, no diagnosis, no recommendations.
 *  4. Bounded work: input, line count and line length are capped; all regexes are precompiled
 *     and free of nested quantifiers.
 *
 * Pipeline:
 *   text -> normalize -> lines -> (skip headers/prose) -> rows (merge wrapped lines)
 *        -> metric spans -> per-segment analysis (unit, ranges, value) -> flag + confidence
 *        -> de-duplicate -> LabMetric[]
 */

// ============================================================
// TYPES
// ============================================================

export interface LabMetric {
  metric: string;

  /** Measured result exactly as printed (thousands separators removed). May carry a "<" / ">" qualifier. */
  value: string;

  /** Normalized unit, or "Not specified". */
  unit: string;

  /** Reference interval (same as referenceRange; kept for compatibility). */
  range: string;

  /** Reference interval, or "Not specified". Multiple distinct ranges are joined with " / ". */
  referenceRange: string;

  /** "Normal" | "High" | "Low" | "N/A". Extraction-based, NOT a medical interpretation. */
  flag: string;

  /** Extraction confidence from 0 to 0.95 (OCR can always misread). Not clinical certainty. */
  confidence: number;
}

// ============================================================
// LIMITS
// ============================================================

const MAX_OCR_TEXT_LENGTH = 250_000;
const MAX_LINES = 5_000;
const MAX_LINE_LENGTH = 400;

/** Wrapped OCR rows: at most this many following lines are merged into one row. */
const MAX_CONTINUATION_LINES = 3;

/** A result must appear within this many words after the metric name. */
const MAX_VALUE_GAP_WORDS = 5;

/** Words/characters allowed before a metric name ("1.", "Serum", "CBC", ...). */
const MAX_PREFIX_TOKENS = 4;
const MAX_PREFIX_CHARS = 40;

/** Abbreviations this short must have a unit or range to be accepted. */
const SHORT_ALIAS_LENGTH = 4;

const NOT_SPECIFIED = "Not specified";

// ============================================================
// METRIC DICTIONARY  (single source of truth)
// ============================================================

/**
 * canonical name -> aliases (the canonical name is always an alias too).
 *
 * Deliberately absent: ambiguous abbreviations that appear in hospital names / prose
 * (ABC, AMC, PT, TG, K, Na ...). Add them only together with a unit/range guard.
 */
const METRIC_DEFINITIONS: Record<string, readonly string[]> = {
  // ---- CBC ----
  Haemoglobin: ["Hemoglobin", "Hb", "Hgb"],
  "Total Leucocyte Count": [
    "Total Leukocyte Count",
    "Total WBC Count",
    "TLC",
    "WBC Count",
    "WBC",
    "White Blood Cell Count",
    "Leucocyte Count",
    "Leukocyte Count",
  ],
  "Differential Leucocyte Count": ["Differential Leukocyte Count", "DLC"],
  Neutrophils: ["Neutrophil"],
  Lymphocytes: ["Lymphocyte"],
  Eosinophils: ["Eosinophil"],
  Monocytes: ["Monocyte"],
  Basophils: ["Basophil"],
  "Absolute Neutrophils": ["Absolute Neutrophil Count", "ANC"],
  "Absolute Lymphocytes": ["Absolute Lymphocyte Count", "ALC"],
  "Absolute Eosinophils": ["Absolute Eosinophil Count", "AEC"],
  "Absolute Monocytes": ["Absolute Monocyte Count"],
  "Absolute Basophils": ["Absolute Basophil Count"],
  "RBC Count": ["RBC", "Red Blood Cell Count", "Total RBC Count"],
  MCV: ["Mean Corpuscular Volume"],
  MCH: ["Mean Corpuscular Haemoglobin", "Mean Corpuscular Hemoglobin"],
  MCHC: [
    "Mean Corpuscular Haemoglobin Concentration",
    "Mean Corpuscular Hemoglobin Concentration",
  ],
  Hct: ["Hematocrit", "Haematocrit", "PCV", "Packed Cell Volume"],
  "RDW-CV": ["RDW CV"],
  "RDW-SD": ["RDW SD"],
  "Platelet Count": ["Platelets", "Platelet", "PLT"],
  PCT: ["Plateletcrit", "Platelet Crit"],
  MPV: ["Mean Platelet Volume"],
  PDW: ["Platelet Distribution Width"],
  "Platelet Indices": [],

  // ---- Inflammation / glucose ----
  ESR: ["Erythrocyte Sedimentation Rate"],
  CRP: ["C-Reactive Protein", "C Reactive Protein"],
  "hs-CRP": ["hsCRP", "High Sensitivity CRP"],
  Glucose: [],
  "Blood Glucose": [],
  "Fasting Blood Sugar": [
    "FBS",
    "Fasting Glucose",
    "Fasting Plasma Glucose",
    "Glucose Fasting",
  ],
  "Random Blood Sugar": ["RBS", "Random Glucose", "Glucose Random"],
  "Post Prandial Glucose": [
    "PPBS",
    "Post Prandial Blood Sugar",
    "Postprandial Glucose",
    "PP Glucose",
    "Glucose PP",
    "Glucose Post Prandial",
  ],
  HbA1c: [
    "Glycosylated Haemoglobin",
    "Glycosylated Hemoglobin",
    "Glycated Haemoglobin",
    "Glycated Hemoglobin",
    "Haemoglobin A1c",
    "Hemoglobin A1c",
    "Hb A1c",
  ],
  "Estimated Average Glucose": ["eAG"],

  // ---- Thyroid ----
  TSH: ["Thyroid Stimulating Hormone"],
  T3: ["Total T3", "Triiodothyronine"],
  T4: ["Total T4", "Thyroxine"],
  "Free T3": ["FT3", "T3 Free"],
  "Free T4": ["FT4", "T4 Free"],

  // ---- Kidney ----
  Creatinine: ["Serum Creatinine"],
  Urea: [],
  "Blood Urea": [],
  BUN: ["Blood Urea Nitrogen", "Urea Nitrogen"],
  "Uric Acid": ["Serum Uric Acid"],
  eGFR: ["Estimated GFR", "GFR"],

  // ---- Lipids ----
  "Total Cholesterol": ["Cholesterol", "Cholesterol Total", "Serum Cholesterol"],
  HDL: ["HDL Cholesterol", "HDL-C"],
  LDL: ["LDL Cholesterol", "LDL-C"],
  VLDL: ["VLDL Cholesterol"],
  "Non-HDL Cholesterol": [],
  Triglycerides: ["Triglyceride"],

  // ---- Liver ----
  "Total Bilirubin": ["Bilirubin Total", "Serum Bilirubin Total"],
  "Direct Bilirubin": ["Bilirubin Direct", "Conjugated Bilirubin"],
  "Indirect Bilirubin": ["Bilirubin Indirect", "Unconjugated Bilirubin"],
  "AST (SGOT)": ["SGOT", "AST", "SGOT (AST)", "SGOT/AST", "AST/SGOT"],
  "ALT (SGPT)": ["SGPT", "ALT", "SGPT (ALT)", "SGPT/ALT", "ALT/SGPT"],
  "Alkaline Phosphatase": ["ALP"],
  GGT: ["Gamma GT", "Gamma Glutamyl Transferase", "GGTP"],
  Albumin: ["Serum Albumin"],
  Globulin: ["Serum Globulin"],
  "Total Protein": ["Serum Total Protein"],

  // ---- Electrolytes / minerals ----
  Sodium: ["Serum Sodium"],
  Potassium: ["Serum Potassium"],
  Chloride: ["Serum Chloride"],
  Calcium: ["Total Calcium", "Serum Calcium"],
  Magnesium: ["Serum Magnesium"],
  Phosphorus: ["Phosphate", "Inorganic Phosphorus"],

  // ---- Vitamins / iron studies ----
  "Vitamin B12": ["B12"],
  "Vitamin D": ["25-OH Vitamin D", "25 Hydroxy Vitamin D", "Vitamin D Total"],
  Folate: ["Folic Acid"],
  Ferritin: ["Serum Ferritin"],
  Iron: ["Serum Iron"],
  TIBC: ["Total Iron Binding Capacity", "Iron Binding Capacity"],
  UIBC: ["Unsaturated Iron Binding Capacity"],
  "Transferrin Saturation": [],

  // ---- Hormones / markers ----
  Insulin: [],
  Testosterone: ["Total Testosterone"],
  Progesterone: [],
  Estradiol: [],
  Cortisol: [],
  Prolactin: [],
  PSA: ["Total PSA", "Prostate Specific Antigen"],
  Homocysteine: [],

  // ---- Enzymes / coagulation ----
  Amylase: [],
  Lipase: [],
  "Prothrombin Time": [],
  INR: [],
};

/** Differential count names that become "Absolute X" when reported with a count unit. */
const ABSOLUTE_COUNT_NAMES: Record<string, string> = {
  Neutrophils: "Absolute Neutrophils",
  Lymphocytes: "Absolute Lymphocytes",
  Eosinophils: "Absolute Eosinophils",
  Monocytes: "Absolute Monocytes",
  Basophils: "Absolute Basophils",
};

// ============================================================
// REGEX BUILDING (all compiled once at module load)
// ============================================================

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasKey(value: string): string {
  return value.toLowerCase().replace(/[\s,]+/g, " ").trim();
}

const ALIAS_TO_CANONICAL = new Map<string, string>();

for (const [canonical, aliases] of Object.entries(METRIC_DEFINITIONS)) {
  for (const alias of [canonical, ...aliases]) {
    const key = aliasKey(alias);
    if (!ALIAS_TO_CANONICAL.has(key)) {
      ALIAS_TO_CANONICAL.set(key, canonical);
    }
  }
}

/**
 * One alternation, longest alias first, so "Mean Corpuscular Haemoglobin Concentration"
 * wins over "Mean Corpuscular Haemoglobin" and "HDL Cholesterol" wins over "Cholesterol".
 * Whitespace inside an alias also tolerates commas ("Bilirubin, Total").
 */
const METRIC_REGEX = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?:${[...ALIAS_TO_CANONICAL.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => escapeRegex(key).replace(/ /g, String.raw`[\s,]+`))
    .join("|")})(?![A-Za-z0-9])`,
  "gi"
);

/**
 * Numbers: plain, decimal, Western grouping (1,250,000) and Indian grouping (2,50,000).
 * Signs are intentionally unsupported: lab results are non-negative and "13-17" must stay a range.
 */
const NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d+)(?:\.\d+)?|\.\d+`;

const NUMBER_REGEX = new RegExp(NUMBER, "g");

const TWO_SIDED_RANGE_REGEX = new RegExp(
  String.raw`(?<![\w.,])(${NUMBER})\s*(?:-|to)\s*(${NUMBER})`,
  "gi"
);

const BOUND_REGEX = new RegExp(
  String.raw`(?<![\w.])(<=|>=|<|>|up\s*to|upto|not\s+more\s+than|less\s+than|below|under|greater\s+than|more\s+than|above|over)\s*[:=]?\s*(${NUMBER})`,
  "gi"
);

/** Units. Boundaries stop "dL" matching inside "Handle", "fL" inside "Reflex", etc. */
const NUMERATOR = String.raw`(?:mmol|nmol|pmol|µmol|umol|mEq|mOsm|mIU|µIU|uIU|gms|gm|mcg|µg|ug|mg|ng|pg|kU|IU|g|U)`;
const DENOMINATOR = String.raw`(?:dL|mL|µL|uL|kg|hr|L)`;

const UNIT_SOURCE = [
  // 10^3/µL, x10^9/L, 10 9/L
  String.raw`(?:x\s*)?10\s*[\^*]?\s*\d{1,2}\s*\/\s*(?:µL|uL|L|cumm|mm3)`,
  // million/cumm, thou/mm3, lakhs/µL
  String.raw`(?:million|mill|thou|lakhs?)\s*\/\s*(?:cu\.?\s*mm|cumm|mm3|µL|uL)`,
  // cells/cumm, /cumm, /cu.mm, /mm3, cells/µL
  String.raw`(?:cells?\s*)?\/\s*(?:cu\.?\s*mm|cumm|mm3|cmm|µL|uL)`,
  // g/dL, gm/dL, mg/dL, mmol/L, ng/mL, µIU/mL, IU/L, U/L ...
  String.raw`${NUMERATOR}\s*\/\s*${DENOMINATOR}`,
  // ESR
  String.raw`mm\s*\/\s*(?:1st\s*)?(?:hr|h|hour)`,
  // standalone
  String.raw`gm\s*%|g\s*%`,
  String.raw`fL`,
  String.raw`pg`,
  String.raw`%`,
  String.raw`sec(?:onds?)?`,
].join("|");

const UNIT_REGEX = new RegExp(
  String.raw`(?<![A-Za-z])(?:${UNIT_SOURCE})(?![A-Za-z])`,
  "gi"
);

/** Non-global twin of UNIT_REGEX for .test(): global regexes keep lastIndex state between calls. */
const UNIT_PROBE_REGEX = new RegExp(UNIT_REGEX.source, "i");

// ---- header / prose / noise detection ----

const HEADER_TERM_REGEXES = [
  "test name",
  "test description",
  "test",
  "investigation",
  "parameter",
  "result",
  "results",
  "value",
  "unit",
  "units",
  "reference range",
  "reference interval",
  "ref range",
  "normal range",
  "bio reference",
  "biological reference",
  "interval",
  "method",
  "flag",
  "remarks",
].map((term) => new RegExp(String.raw`\b${term}\b`, "i"));

/** Sentences found in interpretation notes, never in table rows. */
const PROSE_CUE_REGEX =
  /\b(?:indicates?|indicative|suggest(?:s|ive|ed)?|consistent with|diagnos\w*|recommend\w*|should|associated with|risk of|criteria|interpretation|clinical|correlat\w*|patients?|therapy|treatment|screening)\b/i;

const MAX_PROSE_WORDS = 16;

/** Lines that must never be merged into a metric row. */
const NOISE_LINE_REGEX =
  /\b(?:page|dob|date|collected|reported|registered|received|specimen|barcode|lab\s*no|uhid|mrn|patient|doctor|dr\.?|phone|mobile|age|sex|gender|accession|sample)\b/i;

/**
 * Words that change WHICH test a row is. If one sits next to a metric name we do not
 * recognise as an alias ("Calcium, Ionized", "Cholesterol/HDL Ratio", "Glucose, Urine",
 * "Neutrophils (Absolute)", "Reverse T3"), we skip the row instead of mislabeling it.
 * Also covers words that mean "this is reference text, not a result".
 */
const QUALIFIER_DENY = new Set([
  "free",
  "ionized",
  "ionised",
  "corrected",
  "estimated",
  "calculated",
  "urine",
  "urinary",
  "csf",
  "fluid",
  "ratio",
  "index",
  "absolute",
  "reverse",
  "delta",
  "cord",
  "neonatal",
  "spot",
  "post",
  "postprandial",
  "pp",
  "pre",
  // reference-text legends: "Desirable: <200", "Normal range ..."
  "normal",
  "desirable",
  "optimal",
  "borderline",
  "reference",
  "ref",
  "range",
  "adult",
  "adults",
  "male",
  "female",
  "child",
  "children",
  "men",
  "women",
]);

// ============================================================
// SMALL HELPERS
// ============================================================

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "\u2070": "0",
  "\u00b9": "1",
  "\u00b2": "2",
  "\u00b3": "3",
  "\u2074": "4",
  "\u2075": "5",
  "\u2076": "6",
  "\u2077": "7",
  "\u2078": "8",
  "\u2079": "9",
};

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[|\u2502]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOCRText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, "-") // every dash/minus variant -> "-"
    .replace(/\u03bc/g, "\u00b5") // Greek mu -> micro sign
    .replace(/\u00d7/g, "x")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+/g, (run) =>
      "^" + [...run].map((ch) => SUPERSCRIPT_DIGITS[ch] ?? "").join("")
    );
}

function cleanNumber(value: string): string {
  return value.replace(/,/g, "").trim();
}

function toNumber(value: string): number {
  return Number(cleanNumber(value));
}

interface Span {
  start: number;
  end: number;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function overlapsAny(span: Span, others: Span[]): boolean {
  return others.some((other) => overlaps(span, other));
}

// ============================================================
// UNIT NORMALIZATION
// ============================================================

const NUMERATOR_NAMES: Record<string, string> = {
  g: "g",
  gm: "g",
  gms: "g",
  mg: "mg",
  "µg": "µg",
  ug: "µg",
  mcg: "µg",
  ng: "ng",
  pg: "pg",
  nmol: "nmol",
  pmol: "pmol",
  "µmol": "µmol",
  umol: "µmol",
  mmol: "mmol",
  meq: "mEq",
  mosm: "mOsm",
  miu: "mIU",
  "µiu": "µIU",
  uiu: "µIU",
  iu: "IU",
  u: "U",
  ku: "kU",
};

const DENOMINATOR_NAMES: Record<string, string> = {
  dl: "dL",
  l: "L",
  ml: "mL",
  "µl": "µL",
  ul: "µL",
  kg: "kg",
  hr: "hr",
};

function normalizeUnit(raw: string): string {
  const compact = raw.replace(/\s+/g, "").toLowerCase();

  if (!compact) return NOT_SPECIFIED;
  if (compact === "%") return "%";
  if (compact === "g%" || compact === "gm%") return "g%";
  if (compact === "fl") return "fL";
  if (compact === "pg") return "pg";
  if (/^sec(?:onds?)?$/.test(compact)) return "sec";
  if (/^mm\/(?:1st)?(?:hr|h|hour)$/.test(compact)) return "mm/hr";

  if (/^(?:cells?)?\/(?:cu\.?mm|cumm|mm3|cmm)$/.test(compact)) return "cells/cumm";
  if (/^(?:cells?)?\/(?:µl|ul)$/.test(compact)) return "cells/µL";

  const population = /^(million|mill|thou|lakhs?)\/(cu\.?mm|cumm|mm3|µl|ul)$/.exec(compact);
  if (population) {
    const head = population[1].startsWith("lakh")
      ? "lakhs"
      : population[1] === "thou"
        ? "thou"
        : "million";
    return `${head}/${/µl|ul/.test(population[2]) ? "µL" : "cumm"}`;
  }

  const scientific = /^x?10[\^*]?(\d{1,2})\/(l|µl|ul|cumm|mm3)$/.exec(compact);
  if (scientific) {
    const denominator = /µl|ul/.test(scientific[2])
      ? "µL"
      : /cumm|mm3/.test(scientific[2])
        ? "cumm"
        : "L";
    return `10^${scientific[1]}/${denominator}`;
  }

  const rate = /^([a-zµ]+)\/([a-zµ]+)$/.exec(compact);
  if (rate) {
    const numerator = NUMERATOR_NAMES[rate[1]];
    const denominator = DENOMINATOR_NAMES[rate[2]];
    if (numerator && denominator) return `${numerator}/${denominator}`;
  }

  return raw.trim();
}

// ============================================================
// REFERENCE RANGES
// ============================================================

type RefRange =
  | { kind: "between"; low: number; high: number; text: string }
  | { kind: "max"; limit: number; inclusive: boolean; text: string }
  | { kind: "min"; limit: number; inclusive: boolean; text: string };

function boundToRange(operator: string, numberText: string): RefRange | null {
  const limit = toNumber(numberText);
  if (!Number.isFinite(limit)) return null;

  const op = operator.toLowerCase().replace(/\s+/g, " ");
  const printed = cleanNumber(numberText);

  const isMax = ["<", "<=", "up to", "upto", "not more than", "less than", "below", "under"].includes(op);
  const isMin = [">", ">=", "greater than", "more than", "above", "over"].includes(op);
  const inclusive = ["<=", ">=", "up to", "upto", "not more than"].includes(op);

  if (isMax) {
    return { kind: "max", limit, inclusive, text: `${inclusive ? "<=" : "<"}${printed}` };
  }

  if (isMin) {
    return { kind: "min", limit, inclusive, text: `${inclusive ? ">=" : ">"}${printed}` };
  }

  return null;
}

function formatQualifier(operator: string): string {
  const op = operator.toLowerCase().replace(/\s+/g, " ");
  if (["<", "less than", "below", "under"].includes(op)) return "<";
  if (["<=", "up to", "upto", "not more than"].includes(op)) return "<=";
  if ([">", "greater than", "more than", "above", "over"].includes(op)) return ">";
  return ">=";
}

// ============================================================
// ROW ANALYSIS (text after a metric name)
// ============================================================

interface RowAnalysis {
  value: string;
  hasQualifier: boolean;
  unit: string;
  ranges: RefRange[];
  gapWords: string[];
}

interface Found<T> extends Span {
  data: T;
}

function findAll<T>(
  regex: RegExp,
  text: string,
  map: (match: RegExpExecArray) => T | null
): Array<Found<T>> {
  const results: Array<Found<T>> = [];

  for (const match of text.matchAll(regex)) {
    const data = map(match as RegExpExecArray);
    if (data === null) continue;
    results.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, data });
  }

  return results;
}

/** "14-10-2026" and "12/05/24" must never be read as the range 14-10. */
function looksLikeDatePart(text: string, span: Span): boolean {
  const before = text.slice(Math.max(0, span.start - 2), span.start);
  const after = text.slice(span.end, span.end + 2);

  return /\d[-/.]$/.test(before) || /^[-/]\d/.test(after);
}

function analyzeRest(rest: string): RowAnalysis {
  const units = findAll(UNIT_REGEX, rest, (m) => normalizeUnit(m[0]));

  const twoSided = findAll<RefRange>(TWO_SIDED_RANGE_REGEX, rest, (m) => {
    const low = toNumber(m[1]);
    const high = toNumber(m[2]);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null;
    return { kind: "between", low, high, text: `${cleanNumber(m[1])} - ${cleanNumber(m[2])}` };
  }).filter((item) => !looksLikeDatePart(rest, item) && !overlapsAny(item, units));

  const bounds = findAll(BOUND_REGEX, rest, (m) => ({ operator: m[1], number: m[2] })).filter(
    (item) => !overlapsAny(item, [...units, ...twoSided])
  );

  /* Digits inside units ("10^3/µL") are never results. Belt-and-braces: the "last number before
     the unit" rule below already avoids them, but this keeps the candidate list honest. */
  const numbers = findAll(NUMBER_REGEX, rest, (m) => cleanNumber(m[0])).filter(
    (item) => !overlapsAny(item, [...units, ...twoSided, ...bounds])
  );

  /* A "<0.5" BEFORE any other number/unit is a qualified RESULT; anywhere else it is a range. */
  let qualified: { text: string; span: Span } | null = null;
  const boundRanges: Array<Found<RefRange>> = [];

  for (const bound of bounds) {
    const hasNumberBefore = numbers.some((n) => n.start < bound.start);
    const hasUnitBefore = units.some((u) => u.start < bound.start);

    /* Only a SYMBOL ("<0.5"), directly after the name, can be a qualified result.
       Words ("above 126") and anything preceded by text ("Normal: <100") are reference text. */
    const isSymbol = /^[<>]/.test(bound.data.operator);
    const textBefore = /[A-Za-z]/.test(rest.slice(0, bound.start));

    if (!qualified && isSymbol && !textBefore && !hasNumberBefore && !hasUnitBefore) {
      qualified = {
        text: `${formatQualifier(bound.data.operator)}${cleanNumber(bound.data.number)}`,
        span: bound,
      };
      continue;
    }

    const range = boundToRange(bound.data.operator, bound.data.number);
    if (range) boundRanges.push({ start: bound.start, end: bound.end, data: range });
  }

  const allRanges = [...twoSided, ...boundRanges].sort((a, b) => a.start - b.start);

  const distinct: RefRange[] = [];
  for (const item of allRanges) {
    if (!distinct.some((existing) => existing.text === item.data.text)) {
      distinct.push(item.data);
    }
  }

  /* ---- choose the measured value ---- */
  const firstUnit = units[0];
  const firstRangeStart = allRanges.length > 0 ? allRanges[0].start : Infinity;

  let value = "";

  if (qualified) {
    value = qualified.text;
  } else if (numbers.length > 0) {
    let chosen: Found<string> | undefined;

    if (firstUnit) {
      const beforeUnit = numbers.filter((n) => n.start < firstUnit.start);
      chosen = beforeUnit[beforeUnit.length - 1];
    }

    if (!chosen) {
      const beforeRange = numbers.filter((n) => n.start < firstRangeStart);
      chosen = beforeRange[beforeRange.length - 1];
    }

    value = (chosen ?? numbers[0]).data;
  }

  /* ---- words between the metric name and the first structural token ---- */
  const structuralStarts = [
    numbers[0]?.start,
    firstUnit?.start,
    allRanges[0]?.start,
    bounds[0]?.start,
  ].filter((n): n is number => typeof n === "number");

  const gapEnd = structuralStarts.length > 0 ? Math.min(...structuralStarts) : rest.length;

  const gapWords = (rest.slice(0, gapEnd).match(/[A-Za-z]{2,}/g) ?? []).map((w) => w.toLowerCase());

  return {
    value,
    hasQualifier: qualified !== null,
    unit: firstUnit ? firstUnit.data : NOT_SPECIFIED,
    ranges: distinct,
    gapWords,
  };
}

// ============================================================
// FLAG + CONFIDENCE
// ============================================================

/**
 * Extraction-based flag, NOT a medical interpretation.
 * Anything ambiguous (qualified result, several reference ranges, no range) is "N/A".
 */
function computeFlag(value: string, ranges: RefRange[], hasQualifier: boolean): string {
  if (hasQualifier || ranges.length !== 1) return "N/A";

  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) return "N/A";

  const range = ranges[0];

  switch (range.kind) {
    case "between":
      if (numeric < range.low) return "Low";
      if (numeric > range.high) return "High";
      return "Normal";

    case "max":
      return (range.inclusive ? numeric <= range.limit : numeric < range.limit) ? "Normal" : "High";

    case "min":
      return (range.inclusive ? numeric >= range.limit : numeric > range.limit) ? "Normal" : "Low";
  }
}

function computeConfidence(params: {
  hasUnit: boolean;
  hasRange: boolean;
  cleanRow: boolean;
  reconstructed: boolean;
  multipleRanges: boolean;
  qualified: boolean;
}): number {
  let score = 0.45 + 0.15; // value found + metric recognized

  if (params.hasUnit) score += 0.12;
  if (params.hasRange) score += 0.12;
  if (params.cleanRow) score += 0.08;
  if (params.reconstructed) score -= 0.04;
  if (params.multipleRanges) score -= 0.1;
  if (params.qualified) score -= 0.1;

  /* Capped below 1: OCR can always misread a digit. */
  return Math.max(0, Math.min(0.95, Number(score.toFixed(2))));
}

// ============================================================
// METRIC DETECTION IN A LINE
// ============================================================

interface MetricSpan extends Span {
  canonical: string;
  matched: string;
}

function findMetrics(line: string): MetricSpan[] {
  const spans: MetricSpan[] = [];

  for (const match of line.matchAll(METRIC_REGEX)) {
    const canonical = ALIAS_TO_CANONICAL.get(aliasKey(match[0]));
    if (!canonical) continue;

    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length, canonical, matched: match[0] });
  }

  return spans;
}

function isAcceptablePrefix(prefix: string): boolean {
  const trimmed = prefix.trim();
  if (!trimmed) return true;

  if (trimmed.length > MAX_PREFIX_CHARS) return false;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length > MAX_PREFIX_TOKENS) return false;

  return !tokens.some((token) => QUALIFIER_DENY.has(token.toLowerCase().replace(/[^a-z]/g, "")));
}

function looksLikeProse(line: string): boolean {
  if (PROSE_CUE_REGEX.test(line)) return true;

  const words = line.match(/[A-Za-z]{3,}/g);
  return (words?.length ?? 0) > MAX_PROSE_WORDS;
}

function isHeaderLine(line: string): boolean {
  if (/\d/.test(line)) return false;

  let hits = 0;

  for (const regex of HEADER_TERM_REGEXES) {
    if (regex.test(line) && ++hits >= 2) return true;
  }

  return false;
}

function cleanSegment(segment: string): string {
  return segment.replace(/^[\s:;,|*\-]+/, "").trim();
}

// ============================================================
// SEGMENT -> LabMetric
// ============================================================

function buildMetric(
  span: MetricSpan,
  rest: string,
  context: { cleanRow: boolean; reconstructed: boolean }
): LabMetric | null {
  const analysis = analyzeRest(cleanSegment(rest));

  if (!analysis.value) return null;

  /* Result must sit right next to the name; long gaps mean prose or a different test. */
  if (analysis.gapWords.length > MAX_VALUE_GAP_WORDS) return null;
  if (analysis.gapWords.some((word) => QUALIFIER_DENY.has(word))) return null;

  const hasUnit = analysis.unit !== NOT_SPECIFIED;
  const hasRange = analysis.ranges.length > 0;

  /* "TSH 2021" with no unit and no range is far more likely a year or an ID than a result. */
  const isShortAlias = span.matched.replace(/\s+/g, "").length <= SHORT_ALIAS_LENGTH;
  if (isShortAlias && !hasUnit && !hasRange) return null;

  /* "Neutrophils 2.9 10^3/µL" is the ABSOLUTE count; "Neutrophils 60 %" is the percentage. */
  let canonical = span.canonical;
  if (ABSOLUTE_COUNT_NAMES[canonical] && hasUnit && analysis.unit !== "%") {
    canonical = ABSOLUTE_COUNT_NAMES[canonical];
  }

  const referenceRange = hasRange
    ? analysis.ranges.map((range) => range.text).join(" / ")
    : NOT_SPECIFIED;

  return {
    metric: canonical,
    value: analysis.value,
    unit: analysis.unit,
    range: referenceRange,
    referenceRange,
    flag: computeFlag(analysis.value, analysis.ranges, analysis.hasQualifier),
    confidence: computeConfidence({
      hasUnit,
      hasRange,
      cleanRow: context.cleanRow,
      reconstructed: context.reconstructed,
      multipleRanges: analysis.ranges.length > 1,
      qualified: analysis.hasQualifier,
    }),
  };
}

function parseLine(line: string, reconstructed: boolean): LabMetric[] {
  if (looksLikeProse(line)) return [];

  const spans = findMetrics(line);
  if (spans.length === 0) return [];

  const prefix = line.slice(0, spans[0].start);
  const prefixOk = isAcceptablePrefix(prefix);
  const cleanRow = prefix.trim() === "" && !reconstructed;

  const metrics: LabMetric[] = [];

  spans.forEach((span, index) => {
    if (index === 0 && !prefixOk) return;

    const next = spans[index + 1];
    const rest = line.slice(span.end, next ? next.start : line.length);

    const metric = buildMetric(span, rest, { cleanRow, reconstructed });
    if (metric) metrics.push(metric);
  });

  return metrics;
}

// ============================================================
// ROW RECONSTRUCTION (wrapped OCR lines)
// ============================================================

interface Row {
  text: string;
  reconstructed: boolean;
}

function isUsefulContinuationLine(line: string): boolean {
  return /\d/.test(line) || UNIT_PROBE_REGEX.test(line);
}

/** A row with value + unit + range needs no more lines. */
function isRowComplete(rowText: string): boolean {
  const spans = findMetrics(rowText);
  if (spans.length === 0) return false;

  const next = spans[1];
  const analysis = analyzeRest(cleanSegment(rowText.slice(spans[0].end, next ? next.start : undefined)));

  return Boolean(analysis.value) && analysis.unit !== NOT_SPECIFIED && analysis.ranges.length > 0;
}

function buildRows(lines: string[]): Row[] {
  const rows: Row[] = [];

  let current = "";
  let merged = 0;

  const flush = () => {
    if (current) rows.push({ text: current, reconstructed: merged > 0 });
    current = "";
    merged = 0;
  };

  for (const line of lines) {
    if (isHeaderLine(line)) {
      flush();
      continue;
    }

    if (findMetrics(line).length > 0) {
      flush();
      current = line;
      continue;
    }

    const canMerge =
      current !== "" &&
      merged < MAX_CONTINUATION_LINES &&
      !NOISE_LINE_REGEX.test(line) &&
      isUsefulContinuationLine(line) &&
      !isRowComplete(current);

    if (canMerge) {
      current = `${current} ${line}`;
      merged += 1;
      continue;
    }

    flush();
  }

  flush();

  return rows;
}

// ============================================================
// DE-DUPLICATION
// ============================================================

function completeness(metric: LabMetric): number {
  return (
    (metric.unit !== NOT_SPECIFIED ? 1 : 0) +
    (metric.referenceRange !== NOT_SPECIFIED ? 1 : 0) +
    (metric.flag !== "N/A" ? 1 : 0)
  );
}

/** Keep the more complete extraction; ties go to higher confidence, then to the first one seen. */
function pickBetter(existing: LabMetric, incoming: LabMetric): LabMetric {
  const diff = completeness(incoming) - completeness(existing);
  if (diff !== 0) return diff > 0 ? incoming : existing;

  return incoming.confidence > existing.confidence ? incoming : existing;
}

function deduplicate(metrics: LabMetric[]): LabMetric[] {
  const byName = new Map<string, LabMetric>();

  for (const metric of metrics) {
    const key = metric.metric.toLowerCase();
    const existing = byName.get(key);

    byName.set(key, existing ? pickBetter(existing, metric) : metric);
  }

  return [...byName.values()];
}

// ============================================================
// INPUT PREPARATION + PUBLIC API
// ============================================================

function prepareLines(text: string): string[] {
  return normalizeOCRText(text.slice(0, MAX_OCR_TEXT_LENGTH))
    .split("\n")
    .map((line) => normalizeWhitespace(line).slice(0, MAX_LINE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_LINES);
}

export function parseLabTable(text: string): LabMetric[] {
  if (typeof text !== "string" || !text.trim()) return [];

  const rows = buildRows(prepareLines(text));

  return deduplicate(rows.flatMap((row) => parseLine(row.text, row.reconstructed)));
}

/**
 * Development helper. Disabled in production because OCR text can contain sensitive health data.
 */
export function debugParseLabTable(text: string): { rows: string[]; metrics: LabMetric[] } {
  if (process.env.NODE_ENV === "production" || typeof text !== "string") {
    return { rows: [], metrics: [] };
  }

  return {
    rows: buildRows(prepareLines(text)).map((row) => row.text),
    metrics: parseLabTable(text),
  };
}