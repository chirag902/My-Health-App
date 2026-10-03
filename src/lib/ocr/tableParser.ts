// src/lib/ocr/tableParser.ts

/**
 * Medical Laboratory Table Parser
 *
 * Purpose:
 * - Convert OCR text into structured laboratory metrics.
 * - Handle imperfect OCR/table alignment.
 * - Preserve numeric results when unit/reference range is missing.
 * - Detect common laboratory units.
 * - Reconstruct rows when OCR collapses columns.
 * - Calculate conservative extraction confidence.
 *
 * Safety:
 * - This parser NEVER invents laboratory values.
 * - Missing information is represented as "Not specified".
 * - This parser extracts data; it does NOT diagnose disease.
 *
 * Pipeline:
 *
 * OCR text
 *   ↓
 * normalize OCR
 *   ↓
 * reconstruct rows
 *   ↓
 * detect metric
 *   ↓
 * extract measured value
 *   ↓
 * extract unit
 *   ↓
 * extract reference range
 *   ↓
 * calculate flag
 *   ↓
 * calculate confidence
 *   ↓
 * LabMetric[]
 *
 * IMPORTANT:
 * - Keep this parser deterministic.
 * - Do not put LLM calls, diagnosis logic, or medical recommendations here.
 * - The server-side AI layer should interpret these structured values.
 */

// ============================================================
// TYPES
// ============================================================

export interface LabMetric {
  metric: string;

  /** Actual measured laboratory result. */
  value: string;

  /** Laboratory unit. */
  unit: string;

  /** Reference interval. */
  range: string;

  /** UI/API-facing reference interval. */
  referenceRange: string;

  /** Normal / High / Low / N/A. */
  flag: string;

  /** Extraction confidence from 0 to 1. */
  confidence: number;
}

// ============================================================
// LIMITS
// ============================================================

/**
 * Defense-in-depth limit.
 *
 * The server action should already enforce a stricter OCR/document
 * size limit. This prevents the parser from being accidentally called
 * with an enormous string elsewhere in the application.
 */
const MAX_OCR_TEXT_LENGTH = 250_000;

const MAX_LINES = 5_000;

// ============================================================
// KNOWN METRICS
// ============================================================

/**
 * Common laboratory metrics.
 *
 * Aliases and OCR variations are intentionally included.
 */
const KNOWN_METRICS = [
  // CBC
  "Haemoglobin",
  "Hemoglobin",
  "HB",
  "HGB",

  "Total Leucocyte Count",
  "Total Leukocyte Count",
  "Total WBC Count",
  "TLC",
  "WBC Count",
  "White Blood Cell Count",

  "Differential Leucocyte Count",
  "Differential Leukocyte Count",
  "DLC",

  "Neutrophils",
  "Neutrophil",
  "Lymphocytes",
  "Lymphocyte",
  "Eosinophils",
  "Eosinophil",
  "Monocytes",
  "Monocyte",
  "Basophils",
  "Basophil",

  "Absolute Neutrophils",
  "Absolute Neutrophil Count",
  "ANC",

  "Absolute Lymphocytes",
  "Absolute Lymphocyte Count",
  "ALC",

  "Absolute Eosinophils",
  "Absolute Eosinophil Count",
  "AEC",

  "Absolute Monocytes",
  "Absolute Monocyte Count",
  "AMC",

  "Absolute Basophils",
  "Absolute Basophil Count",
  "ABC",

  // RBC
  "RBC Count",
  "RBC",
  "Red Blood Cell Count",

  "MCV",
  "Mean Corpuscular Volume",

  "MCH",
  "Mean Corpuscular Haemoglobin",
  "Mean Corpuscular Hemoglobin",

  "MCHC",
  "Mean Corpuscular Haemoglobin Concentration",
  "Mean Corpuscular Hemoglobin Concentration",

  "Hct",
  "HCT",
  "Hematocrit",
  "Haematocrit",
  "PCV",
  "Packed Cell Volume",

  "RDW-CV",
  "RDW CV",
  "RDW-CV%",
  "RDW-SD",

  // Platelets
  "Platelet Count",
  "Platelets",
  "Platelet",
  "PCT",
  "Plateletcrit",
  "Platelet Crit",
  "MPV",
  "Mean Platelet Volume",
  "PDW",
  "Platelet Distribution Width",
  "Platelet Indices",

  // Inflammation / glucose
  "ESR",
  "CRP",
  "Blood Glucose",
  "Glucose",
  "Fasting Blood Sugar",
  "FBS",
  "Random Blood Sugar",
  "RBS",
  "HbA1c",

  // Thyroid
  "TSH",
  "T3",
  "T4",
  "Free T3",
  "Free T4",

  // Kidney
  "Creatinine",
  "Urea",
  "Blood Urea",
  "BUN",
  "Uric Acid",

  // Lipids
  "Total Cholesterol",
  "Cholesterol",
  "HDL",
  "LDL",
  "VLDL",
  "Triglycerides",

  // Liver
  "Bilirubin Total",
  "Total Bilirubin",
  "Bilirubin Direct",
  "Direct Bilirubin",
  "Bilirubin Indirect",
  "Indirect Bilirubin",

  "SGOT",
  "AST",
  "SGPT",
  "ALT",
  "ALP",
  "Alkaline Phosphatase",
  "Albumin",
  "Total Protein",

  // Electrolytes
  "Sodium",
  "Potassium",
  "Chloride",
  "Calcium",
  "Magnesium",
  "Phosphorus",

  // Vitamins / iron
  "Vitamin B12",
  "Vitamin D",
  "Ferritin",
  "Iron",

  // Hormones
  "Insulin",
  "Testosterone",
  "Progesterone",
  "Estradiol",
  "Cortisol",

  // Enzymes
  "Amylase",
  "Lipase",
] as const;

/**
 * Canonical metric names.
 */
const METRIC_ALIASES: Record<string, string> = {
  // CBC
  haemoglobin: "Haemoglobin",
  hemoglobin: "Haemoglobin",
  hb: "Haemoglobin",
  hgb: "Haemoglobin",

  "total leucocyte count": "Total Leucocyte Count",
  "total leukocyte count": "Total Leucocyte Count",
  "total wbc count": "Total Leucocyte Count",
  tlc: "Total Leucocyte Count",
  "wbc count": "Total Leucocyte Count",
  "white blood cell count": "Total Leucocyte Count",

  "differential leucocyte count": "Differential Leucocyte Count",
  "differential leukocyte count": "Differential Leucocyte Count",
  dlc: "Differential Leucocyte Count",

  neutrophil: "Neutrophils",
  neutrophils: "Neutrophils",
  lymphocyte: "Lymphocytes",
  lymphocytes: "Lymphocytes",
  eosinophil: "Eosinophils",
  eosinophils: "Eosinophils",
  monocyte: "Monocytes",
  monocytes: "Monocytes",
  basophil: "Basophils",
  basophils: "Basophils",

  "absolute neutrophils": "Absolute Neutrophils",
  "absolute neutrophil count": "Absolute Neutrophils",
  anc: "Absolute Neutrophils",

  "absolute lymphocytes": "Absolute Lymphocytes",
  "absolute lymphocyte count": "Absolute Lymphocytes",
  alc: "Absolute Lymphocytes",

  "absolute eosinophils": "Absolute Eosinophils",
  "absolute eosinophil count": "Absolute Eosinophils",
  aec: "Absolute Eosinophils",

  "absolute monocytes": "Absolute Monocytes",
  "absolute monocyte count": "Absolute Monocytes",
  amc: "Absolute Monocytes",

  "absolute basophils": "Absolute Basophils",
  "absolute basophil count": "Absolute Basophils",
  abc: "Absolute Basophils",

  // RBC
  "rbc count": "RBC Count",
  rbc: "RBC Count",
  "red blood cell count": "RBC Count",

  mcv: "MCV",
  "mean corpuscular volume": "MCV",

  mch: "MCH",
  "mean corpuscular haemoglobin": "MCH",
  "mean corpuscular hemoglobin": "MCH",

  mchc: "MCHC",
  "mean corpuscular haemoglobin concentration": "MCHC",
  "mean corpuscular hemoglobin concentration": "MCHC",

  hct: "Hct",
  hematocrit: "Hct",
  haematocrit: "Hct",
  pcv: "Hct",
  "packed cell volume": "Hct",

  "rdw-cv": "RDW-CV",
  "rdw cv": "RDW-CV",
  "rdw-cv%": "RDW-CV",
  "rdw-sd": "RDW-SD",

  // Platelets
  "platelet count": "Platelet Count",
  platelets: "Platelet Count",
  platelet: "Platelet Count",

  pct: "PCT",
  plateletcrit: "PCT",
  "platelet crit": "PCT",

  mpv: "MPV",
  "mean platelet volume": "MPV",

  pdw: "PDW",
  "platelet distribution width": "PDW",

  "platelet indices": "Platelet Indices",

  // General tests
  esr: "ESR",
  crp: "CRP",

  glucose: "Glucose",
  "blood glucose": "Blood Glucose",

  fbs: "Fasting Blood Sugar",
  "fasting blood sugar": "Fasting Blood Sugar",

  rbs: "Random Blood Sugar",
  "random blood sugar": "Random Blood Sugar",

  hba1c: "HbA1c",

  // Thyroid
  tsh: "TSH",
  t3: "T3",
  t4: "T4",
  "free t3": "Free T3",
  "free t4": "Free T4",

  // Kidney
  creatinine: "Creatinine",
  urea: "Urea",
  "blood urea": "Blood Urea",
  bun: "BUN",
  "uric acid": "Uric Acid",

  // Lipids
  "total cholesterol": "Total Cholesterol",
  cholesterol: "Cholesterol",
  hdl: "HDL",
  ldl: "LDL",
  vldl: "VLDL",
  triglycerides: "Triglycerides",

  // Liver
  "bilirubin total": "Bilirubin Total",
  "total bilirubin": "Total Bilirubin",
  "bilirubin direct": "Bilirubin Direct",
  "direct bilirubin": "Direct Bilirubin",
  "bilirubin indirect": "Bilirubin Indirect",
  "indirect bilirubin": "Indirect Bilirubin",

  sgot: "SGOT",
  ast: "AST",
  sgpt: "SGPT",
  alt: "ALT",
  alp: "ALP",
  "alkaline phosphatase": "Alkaline Phosphatase",
  albumin: "Albumin",
  "total protein": "Total Protein",

  // Electrolytes
  sodium: "Sodium",
  potassium: "Potassium",
  chloride: "Chloride",
  calcium: "Calcium",
  magnesium: "Magnesium",
  phosphorus: "Phosphorus",

  // Vitamins / iron
  "vitamin b12": "Vitamin B12",
  "vitamin d": "Vitamin D",
  ferritin: "Ferritin",
  iron: "Iron",

  // Hormones
  insulin: "Insulin",
  testosterone: "Testosterone",
  progesterone: "Progesterone",
  estradiol: "Estradiol",
  cortisol: "Cortisol",

  // Enzymes
  amylase: "Amylase",
  lipase: "Lipase",
};

/**
 * Longest metric first.
 *
 * This is intentionally calculated once instead of sorting on every row.
 */
const SORTED_METRICS = [...KNOWN_METRICS].sort(
  (a, b) => b.length - a.length
);

// ============================================================
// REGEX / TOKENIZATION
// ============================================================

/**
 * Numeric token.
 *
 * Supports:
 * 15
 * 15.2
 * .5
 * 0.5
 * 1,250
 * 1,250.50
 * -2.5
 */
const NUMBER_PATTERN =
  String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-+]?\.\d+`;

/**
 * Reference ranges:
 *
 * 13-17
 * 13 - 17
 * 13.5–17.5
 * 0.5 to 1.2
 * <5
 * <=5
 * ≤5
 * >40
 * >=40
 * ≥40
 */
const RANGE_REGEX = new RegExp(
  String.raw`(?:<=|>=|<|>|≤|≥)?\s*(${NUMBER_PATTERN})\s*(?:-|to)\s*(${NUMBER_PATTERN})|(?:<=|>=|<|>|≤|≥)\s*(${NUMBER_PATTERN})`,
  "i"
);

/**
 * Laboratory units.
 *
 * Keep longer/specific units first.
 */
const UNIT_PATTERNS = [
  /mg\s*\/\s*dL/i,
  /g\s*\/\s*dL/i,
  /mmol\s*\/\s*L/i,
  /mEq\s*\/\s*L/i,
  /mIU\s*\/\s*L/i,
  /mIU\s*\/\s*mL/i,
  /µIU\s*\/\s*mL/i,
  /uIU\s*\/\s*mL/i,
  /IU\s*\/\s*L/i,
  /IU\s*\/\s*mL/i,
  /U\s*\/\s*L/i,
  /ng\s*\/\s*mL/i,
  /ng\s*\/\s*dL/i,
  /µg\s*\/\s*dL/i,
  /ug\s*\/\s*dL/i,
  /µg\s*\/\s*L/i,
  /ug\s*\/\s*L/i,
  /mcg\s*\/\s*dL/i,
  /mcg\s*\/\s*L/i,
  /mEq\s*\/\s*L/i,
  /mOsm\s*\/\s*kg/i,
  /cells?\s*\/\s*(?:cumm|cu\.?\s*mm|µL|uL)/i,
  /million\s*\/\s*(?:cumm|µL|uL)/i,
  /lakhs?\s*\/\s*(?:µL|uL)/i,
  /x\s*10\s*\^\s*\d+\s*\/\s*L/i,
  /10\s*\^\s*\d+\s*\/\s*L/i,
  /10\s*9\s*\/\s*L/i,
  /10\s*12\s*\/\s*L/i,
  /fL/i,
  /pg/i,
  /%/i,
  /mL/i,
  /dL/i,
  /cumm/i,
  /cu\.?\s*mm/i,
] as const;

/**
 * Words commonly found in table headers.
 */
const HEADER_WORDS = [
  "test",
  "test description",
  "investigation",
  "parameter",
  "result",
  "results",
  "reference range",
  "ref range",
  "normal range",
  "unit",
  "units",
  "bio reference",
] as const;

/**
 * Words indicating that the result is not numerically available.
 *
 * IMPORTANT:
 * We do not automatically discard every row containing one of these
 * words. If a numeric value is present, the numeric value is preserved.
 */
const NON_VALUE_WORDS = [
  "not done",
  "not available",
  "not detected",
  "pending",
  "cancelled",
  "canceled",
] as const;

// ============================================================
// INTERNAL TYPES
// ============================================================

interface PositionedToken {
  value: string;
  index: number;
  length: number;
}

interface PositionedMatch {
  value: string;
  index: number;
  length: number;
}

interface MetricMatch {
  metric: string;
  index: number;
  length: number;
}

// ============================================================
// GENERAL HELPERS
// ============================================================

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[|│]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize common OCR punctuation while preserving line breaks.
 */
function normalizeOCRText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐-‒–—]/g, "-")
    .replace(/\u00a0/g, " ");
}

function cleanMetricName(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^[:;,.\-]+/, "")
    .replace(/[:;,.\-]+$/, "")
    .trim();
}

function cleanNumericValue(value: string): string {
  return value.replace(/,/g, "").trim();
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? normalizeWhitespace(value) : "";
}

function canonicalMetricName(metric: string): string {
  const cleaned = cleanMetricName(metric);
  return METRIC_ALIASES[cleaned.toLowerCase()] || cleaned;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Boundary-safe metric pattern.
 *
 * We intentionally do NOT use plain indexOf() here.
 *
 * This prevents:
 * - "Iron" matching inside unrelated words
 * - "T3" matching inside another token
 * - "ALT" matching inside "ALTERED"
 * - "HDL" matching inside arbitrary text
 */
function createMetricRegex(metric: string): RegExp {
  const escaped = escapeRegex(metric).replace(/\s+/g, String.raw`\s+`);

  return new RegExp(
    String.raw`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`,
    "i"
  );
}

function normalizeUnit(unit: string): string {
  const cleaned = normalizeWhitespace(unit);

  if (!cleaned) {
    return "Not specified";
  }

  const lower = cleaned.toLowerCase();

  const normalizedMap: Record<string, string> = {
    "g/dl": "g/dL",
    "g / dl": "g/dL",

    "mg/dl": "mg/dL",
    "mg / dl": "mg/dL",

    "mmol/l": "mmol/L",
    "mmol / l": "mmol/L",

    "miu/l": "mIU/L",
    "miu / l": "mIU/L",

    "miu/ml": "mIU/mL",
    "miu / ml": "mIU/mL",

    "uiu/ml": "uIU/mL",
    "uiu / ml": "uIU/mL",

    "µiu/ml": "µIU/mL",
    "µiu / ml": "µIU/mL",

    "iu/l": "IU/L",
    "iu / l": "IU/L",

    "iu/ml": "IU/mL",
    "iu / ml": "IU/mL",

    "u/l": "U/L",
    "u / l": "U/L",

    "ng/ml": "ng/mL",
    "ng / ml": "ng/mL",

    "ng/dl": "ng/dL",
    "ng / dl": "ng/dL",

    "µg/dl": "µg/dL",
    "µg / dl": "µg/dL",

    "ug/dl": "µg/dL",
    "ug / dl": "µg/dL",

    "µg/l": "µg/L",
    "µg / l": "µg/L",

    "ug/l": "µg/L",
    "ug / l": "µg/L",

    "mcg/dl": "µg/dL",
    "mcg / dl": "µg/dL",

    "mcg/l": "µg/L",
    "mcg / l": "µg/L",

    "fl": "fL",

    "µl": "µL",
    "ul": "µL",

    "pg": "pg",

    "ml": "mL",
    "dl": "dL",

    "%": "%",

    "cumm": "cells/cumm",
    "cu mm": "cells/cumm",
    "cu. mm": "cells/cumm",
  };

  return normalizedMap[lower] || cleaned;
}

function normalizeRange(value: string): string {
  const cleaned = normalizeWhitespace(value);

  if (!cleaned) {
    return "Not specified";
  }

  return cleaned
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+to\s+/i, " to ");
}

function isHeaderLine(line: string): boolean {
  const normalized = normalizeWhitespace(line).toLowerCase();

  return HEADER_WORDS.some(header => {
    if (normalized === header) {
      return true;
    }

    if (normalized.startsWith(`${header} `)) {
      return true;
    }

    if (normalized.endsWith(` ${header}`)) {
      return true;
    }

    return normalized.includes(` ${header} `);
  });
}

function containsUnavailableResult(line: string): boolean {
  const lower = line.toLowerCase();

  return NON_VALUE_WORDS.some(word => lower.includes(word));
}

// ============================================================
// METRIC DETECTION
// ============================================================

function findMetricInLine(line: string): MetricMatch | null {
  const normalized = normalizeWhitespace(line);

  for (const candidate of SORTED_METRICS) {
    const regex = createMetricRegex(candidate);
    const match = regex.exec(normalized);

    if (!match || match.index !== 0) {
      continue;
    }

    return {
      metric: canonicalMetricName(candidate),
      index: 0,
      length: match[0].length,
    };
  }

  return null;
}

function findMetricAnywhere(line: string): MetricMatch | null {
  const normalized = normalizeWhitespace(line);

  for (const candidate of SORTED_METRICS) {
    const regex = createMetricRegex(candidate);
    const match = regex.exec(normalized);

    if (!match || match.index === undefined) {
      continue;
    }

    return {
      metric: canonicalMetricName(candidate),
      index: match.index,
      length: match[0].length,
    };
  }

  return null;
}

// ============================================================
// RANGE EXTRACTION
// ============================================================

function extractRange(text: string): PositionedMatch | null {
  const normalized = normalizeWhitespace(text);
  const match = RANGE_REGEX.exec(normalized);

  if (!match || match.index === undefined) {
    return null;
  }

  const raw = match[0].trim();

  return {
    value: normalizeRange(raw),
    index: match.index,
    length: raw.length,
  };
}

// ============================================================
// UNIT EXTRACTION
// ============================================================

function extractUnit(text: string): PositionedMatch | null {
  const normalized = normalizeWhitespace(text);

  let best: PositionedMatch | null = null;

  for (const pattern of UNIT_PATTERNS) {
    const match = pattern.exec(normalized);

    if (!match || match.index === undefined) {
      continue;
    }

    const raw = match[0].trim();

    if (!raw) {
      continue;
    }

    const candidate: PositionedMatch = {
      value: normalizeUnit(raw),
      index: match.index,
      length: raw.length,
    };

    /**
     * Prefer the earliest unit because a laboratory row normally has
     * the unit directly after the measured value.
     *
     * If two patterns match at the same position, prefer the longer one.
     */
    if (
      !best ||
      candidate.index < best.index ||
      (candidate.index === best.index &&
        candidate.length > best.length)
    ) {
      best = candidate;
    }
  }

  return best;
}

// ============================================================
// NUMBER EXTRACTION
// ============================================================

function extractNumbers(text: string): PositionedToken[] {
  const regex = new RegExp(NUMBER_PATTERN, "g");
  const results: PositionedToken[] = [];

  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    results.push({
      value: cleanNumericValue(match[0]),
      index: match.index,
      length: match[0].length,
    });
  }

  return results;
}

// ============================================================
// RESULT VALUE EXTRACTION
// ============================================================

/**
 * Determine whether a numeric token overlaps the reference range.
 */
function isInsideRange(
  number: PositionedToken,
  range: PositionedMatch
): boolean {
  const numberStart = number.index;
  const numberEnd = number.index + number.length;

  const rangeStart = range.index;
  const rangeEnd = range.index + range.length;

  return numberStart < rangeEnd && numberEnd > rangeStart;
}

/**
 * Extract the measured laboratory value.
 *
 * Examples:
 *
 * Haemoglobin 15 g/dL 13-17
 *                  ↑
 *              measured value
 *
 * Glucose 102 mg/dL
 *         ↑
 *
 * TSH 2.4 0.4-4.0
 *     ↑
 *
 * The reference range is explicitly excluded from candidate result
 * numbers so that 13 and 17 cannot accidentally become the result.
 */
function extractResultValue(text: string): string {
  const normalized = normalizeWhitespace(text);

  const numbers = extractNumbers(normalized);

  if (numbers.length === 0) {
    return "";
  }

  const range = extractRange(normalized);

  const candidateNumbers = range
    ? numbers.filter(number => !isInsideRange(number, range))
    : numbers;

  if (candidateNumbers.length === 0) {
    return "";
  }

  const unit = extractUnit(normalized);

  /**
   * If a unit exists, the measured result is usually the closest
   * numeric token immediately before the unit.
   */
  if (unit) {
    const beforeUnit = candidateNumbers.filter(
      number => number.index < unit.index
    );

    if (beforeUnit.length > 0) {
      return beforeUnit[beforeUnit.length - 1].value;
    }
  }

  /**
   * If a reference range exists, prefer the final numeric value
   * before that range.
   */
  if (range) {
    const beforeRange = candidateNumbers.filter(
      number => number.index < range.index
    );

    if (beforeRange.length > 0) {
      return beforeRange[beforeRange.length - 1].value;
    }
  }

  /**
   * Final deterministic fallback:
   * first numeric token that is not part of the reference range.
   */
  return candidateNumbers[0]?.value || "";
}

// ============================================================
// RANGE PARSING
// ============================================================

function parseRange(range: string): {
  low: number | null;
  high: number | null;
  operator: string | null;
} {
  const normalized = normalizeRange(range);

  if (normalized === "Not specified") {
    return {
      low: null,
      high: null,
      operator: null,
    };
  }

  const twoSidedMatch = normalized.match(
    new RegExp(
      String.raw`(${NUMBER_PATTERN})\s*(?:-|to)\s*(${NUMBER_PATTERN})`,
      "i"
    )
  );

  if (twoSidedMatch) {
    const low = Number(cleanNumericValue(twoSidedMatch[1]));
    const high = Number(cleanNumericValue(twoSidedMatch[2]));

    return {
      low: Number.isFinite(low) ? low : null,
      high: Number.isFinite(high) ? high : null,
      operator: "range",
    };
  }

  const operatorMatch = normalized.match(
    new RegExp(
      String.raw`(<=|>=|<|>|≤|≥)\s*(${NUMBER_PATTERN})`,
      "i"
    )
  );

  if (operatorMatch) {
    const operator =
      operatorMatch[1] === "≤"
        ? "<="
        : operatorMatch[1] === "≥"
          ? ">="
          : operatorMatch[1];

    const boundary = Number(cleanNumericValue(operatorMatch[2]));

    if (!Number.isFinite(boundary)) {
      return {
        low: null,
        high: null,
        operator: null,
      };
    }

    return {
      low:
        operator === ">" || operator === ">="
          ? boundary
          : null,

      high:
        operator === "<" || operator === "<="
          ? boundary
          : null,

      operator,
    };
  }

  return {
    low: null,
    high: null,
    operator: null,
  };
}

// ============================================================
// FLAG CALCULATION
// ============================================================

/**
 * Calculate a simple extraction-based flag.
 *
 * This is NOT a medical interpretation.
 *
 * Important:
 * - <5  means value must be strictly below 5.
 * - <=5 means value may equal 5.
 * - >40 means value must be strictly above 40.
 * - >=40 means value may equal 40.
 */
function calculateFlag(
  value: string,
  referenceRange: string
): string {
  if (!value || referenceRange === "Not specified") {
    return "N/A";
  }

  const numericValue = Number(cleanNumericValue(value));

  if (!Number.isFinite(numericValue)) {
    return "N/A";
  }

  const parsedRange = parseRange(referenceRange);

  // Two-sided range: low - high
  if (
    parsedRange.low !== null &&
    parsedRange.high !== null
  ) {
    if (numericValue < parsedRange.low) {
      return "Low";
    }

    if (numericValue > parsedRange.high) {
      return "High";
    }

    return "Normal";
  }

  // Upper-bound-only range.
  if (parsedRange.high !== null) {
    if (parsedRange.operator === "<") {
      return numericValue < parsedRange.high
        ? "Normal"
        : "High";
    }

    if (parsedRange.operator === "<=") {
      return numericValue <= parsedRange.high
        ? "Normal"
        : "High";
    }
  }

  // Lower-bound-only range.
  if (parsedRange.low !== null) {
    if (parsedRange.operator === ">") {
      return numericValue > parsedRange.low
        ? "Normal"
        : "Low";
    }

    if (parsedRange.operator === ">=") {
      return numericValue >= parsedRange.low
        ? "Normal"
        : "Low";
    }
  }

  return "N/A";
}

// ============================================================
// CONFIDENCE
// ============================================================

/**
 * Extraction confidence only.
 *
 * This score does NOT mean:
 * - medical correctness
 * - diagnostic certainty
 * - clinical significance
 *
 * It describes how confidently the parser extracted the row.
 */
function calculateConfidence(params: {
  hasValue: boolean;
  hasUnit: boolean;
  hasRange: boolean;
  metricRecognized: boolean;
  cleanRow: boolean;
  reconstructed: boolean;
}): number {
  const {
    hasValue,
    hasUnit,
    hasRange,
    metricRecognized,
    cleanRow,
    reconstructed,
  } = params;

  if (!hasValue) {
    return 0;
  }

  let score = 0.45;

  if (metricRecognized) {
    score += 0.15;
  }

  if (hasUnit) {
    score += 0.12;
  }

  if (hasRange) {
    score += 0.12;
  }

  if (cleanRow) {
    score += 0.08;
  }

  if (reconstructed) {
    score -= 0.04;
  }

  /**
   * Deliberately cap below 1.0.
   *
   * Even a clean OCR extraction is not guaranteed to be medically
   * correct because OCR itself can misread characters.
   */
  return Math.max(
    0,
    Math.min(0.95, Number(score.toFixed(2)))
  );
}

// ============================================================
// ROW PARSING
// ============================================================

function parseMetricRow(
  metric: string,
  remainingText: string,
  options: {
    cleanRow: boolean;
    reconstructed: boolean;
  }
): LabMetric | null {
  const cleaned = normalizeWhitespace(remainingText);

  if (!cleaned) {
    return null;
  }

  const value = extractResultValue(cleaned);

  /**
   * Preserve numeric results even if OCR missed the unit or range.
   */
  if (!value) {
    return null;
  }

  const unitMatch = extractUnit(cleaned);
  const rangeMatch = extractRange(cleaned);

  const unit = unitMatch
    ? normalizeUnit(unitMatch.value)
    : "Not specified";

  const referenceRange = rangeMatch
    ? normalizeRange(rangeMatch.value)
    : "Not specified";

  const flag = calculateFlag(
    value,
    referenceRange
  );

  const confidence = calculateConfidence({
    hasValue: Boolean(value),
    hasUnit: unit !== "Not specified",
    hasRange: referenceRange !== "Not specified",
    metricRecognized: true,
    cleanRow: options.cleanRow,
    reconstructed: options.reconstructed,
  });

  return {
    metric: canonicalMetricName(metric),
    value,
    unit,
    range: referenceRange,
    referenceRange,
    flag,
    confidence,
  };
}

// ============================================================
// ROW RECONSTRUCTION
// ============================================================

interface ReconstructedRow {
  text: string;
  reconstructed: boolean;
}

/**
 * Detect whether a line looks like a continuation of a laboratory row.
 *
 * We deliberately DO NOT use a generic "line.length < 80" rule.
 *
 * That rule can incorrectly merge unrelated OCR text such as:
 * - patient information
 * - comments
 * - footnotes
 * - headings
 *
 * A continuation line must contain something structurally useful:
 * numeric value, unit, or reference range.
 */
function isUsefulContinuationLine(line: string): boolean {
  return (
    extractNumbers(line).length > 0 ||
    Boolean(extractUnit(line)) ||
    Boolean(extractRange(line))
  );
}

function reconstructRows(
  lines: string[]
): ReconstructedRow[] {
  const rows: ReconstructedRow[] = [];

  let currentRow = "";
  let currentWasReconstructed = false;

  for (const originalLine of lines) {
    const line = normalizeWhitespace(originalLine);

    if (!line) {
      continue;
    }

    const metricAtStart = findMetricInLine(line);

    /**
     * New metric row.
     */
    if (metricAtStart) {
      if (currentRow) {
        rows.push({
          text: currentRow,
          reconstructed: currentWasReconstructed,
        });
      }

      currentRow = line;
      currentWasReconstructed = false;
      continue;
    }

    /**
     * No current row:
     * preserve it for the "metric anywhere" pass later.
     */
    if (!currentRow) {
      rows.push({
        text: line,
        reconstructed: false,
      });

      continue;
    }

    /**
     * Merge only structurally useful continuation lines.
     */
    if (isUsefulContinuationLine(line)) {
      currentRow = `${currentRow} ${line}`;
      currentWasReconstructed = true;
      continue;
    }

    /**
     * A new non-metric line without useful numeric/table structure
     * should not be blindly merged into the laboratory row.
     */
    rows.push({
      text: currentRow,
      reconstructed: currentWasReconstructed,
    });

    rows.push({
      text: line,
      reconstructed: false,
    });

    currentRow = "";
    currentWasReconstructed = false;
  }

  if (currentRow) {
    rows.push({
      text: currentRow,
      reconstructed: currentWasReconstructed,
    });
  }

  return rows;
}

// ============================================================
// DUPLICATE HANDLING
// ============================================================

function completenessScore(metric: LabMetric): number {
  return (
    (metric.value !== "Not specified" ? 1 : 0) +
    (metric.unit !== "Not specified" ? 1 : 0) +
    (metric.referenceRange !== "Not specified" ? 1 : 0)
  );
}

function mergeDuplicateMetric(
  existing: LabMetric,
  incoming: LabMetric
): LabMetric {
  const existingCompleteness =
    completenessScore(existing);

  const incomingCompleteness =
    completenessScore(incoming);

  /**
   * Prefer a more complete extraction.
   */
  if (incomingCompleteness > existingCompleteness) {
    return incoming;
  }

  if (existingCompleteness > incomingCompleteness) {
    return existing;
  }

  /**
   * If equally complete, prefer higher extraction confidence.
   */
  if (incoming.confidence > existing.confidence) {
    return incoming;
  }

  /**
   * If equally confident, keep the first stable result.
   *
   * We intentionally do not merge two conflicting numeric values.
   * A downstream medical layer should never receive an invented
   * combination of conflicting OCR values.
   */
  return existing;
}

// ============================================================
// INPUT NORMALIZATION
// ============================================================

function prepareInput(text: string): string[] {
  const normalizedText = normalizeOCRText(text)
    .slice(0, MAX_OCR_TEXT_LENGTH);

  return normalizedText
    .split("\n")
    .map(line => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(0, MAX_LINES);
}

// ============================================================
// MAIN PARSER
// ============================================================

export function parseLabTable(text: string): LabMetric[] {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  /**
   * Defense-in-depth input limit.
   */
  if (text.length > MAX_OCR_TEXT_LENGTH) {
    text = text.slice(0, MAX_OCR_TEXT_LENGTH);
  }

  const rawLines = prepareInput(text);

  if (rawLines.length === 0) {
    return [];
  }

  const rows = reconstructRows(rawLines);

  const results: LabMetric[] = [];

  for (const row of rows) {
    const line = row.text;

    if (!line || isHeaderLine(line)) {
      continue;
    }

    /**
     * ----------------------------------------------------------
     * PASS 1: metric at beginning of row
     * ----------------------------------------------------------
     *
     * Example:
     *
     * Haemoglobin 15 g/dL 13-17
     */
    const startMetric = findMetricInLine(line);

    if (startMetric) {
      const remaining = line
        .slice(startMetric.length)
        .replace(/^[\s:;,|*\-]+/, "")
        .trim();

      const parsed = parseMetricRow(
        startMetric.metric,
        remaining,
        {
          cleanRow: !row.reconstructed,
          reconstructed: row.reconstructed,
        }
      );

      if (parsed) {
        results.push(parsed);
        continue;
      }
    }

    /**
     * ----------------------------------------------------------
     * PASS 2: metric somewhere inside row
     * ----------------------------------------------------------
     *
     * Handles OCR such as:
     *
     * CBC Haemoglobin 15 g/dL 13-17
     *
     * or:
     *
     * Test Haemoglobin 15 g/dL 13-17
     */
    const anywhereMetric = findMetricAnywhere(line);

    if (!anywhereMetric) {
      continue;
    }

    const remaining = line
      .slice(
        anywhereMetric.index +
          anywhereMetric.length
      )
      .replace(/^[\s:;,|*\-]+/, "")
      .trim();

    const parsed = parseMetricRow(
      anywhereMetric.metric,
      remaining,
      {
        cleanRow: false,
        reconstructed: row.reconstructed,
      }
    );

    if (parsed) {
      results.push(parsed);
    }
  }

  /**
   * ----------------------------------------------------------
   * DEDUPLICATION
   * ----------------------------------------------------------
   *
   * Keep one deterministic result per canonical metric.
   */
  const deduplicated = new Map<
    string,
    LabMetric
  >();

  for (const metric of results) {
    const key = metric.metric.toLowerCase();

    const existing = deduplicated.get(key);

    if (!existing) {
      deduplicated.set(key, metric);
      continue;
    }

    deduplicated.set(
      key,
      mergeDuplicateMetric(existing, metric)
    );
  }

  return Array.from(
    deduplicated.values()
  );
}

// ============================================================
// DEVELOPMENT DEBUG HELPER
// ============================================================

/**
 * Development/debug helper.
 *
 * IMPORTANT:
 * Do not expose this directly through a production endpoint because
 * OCR input can contain sensitive health information.
 */
export function debugParseLabTable(
  text: string
): {
  rows: string[];
  metrics: LabMetric[];
} {
  if (typeof text !== "string") {
    return {
      rows: [],
      metrics: [],
    };
  }

  const lines = prepareInput(text);

  const rows = reconstructRows(lines);

  return {
    rows: rows.map(row => row.text),
    metrics: parseLabTable(text),
  };
}