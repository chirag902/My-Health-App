// src/lib/ocr/tableParser.test.ts
//
// All fixtures are SYNTHETIC. Never commit real patient reports as test data.

import { afterEach, describe, expect, it, vi } from "vitest";

import { debugParseLabTable, parseLabTable, type LabMetric } from "./tableParser";

/* ============================================================
   HELPERS
   ============================================================ */

const byName = (metrics: LabMetric[], name: string) =>
  metrics.find((metric) => metric.metric === name);

const names = (metrics: LabMetric[]) => metrics.map((metric) => metric.metric);

/**
 * Core safety property: the parser may only return values that literally appear in the input.
 * (Thousands separators are removed on purpose; "<" / ">" qualifiers are not part of the number.)
 */
function expectNoInventedValues(source: string, metrics: LabMetric[]) {
  const haystack = source.replace(/,/g, "");

  for (const metric of metrics) {
    const printed = metric.value.replace(/^[<>=]+/, "");
    expect(haystack, `value "${metric.value}" for ${metric.metric}`).toContain(printed);
  }
}

/* ============================================================
   1. CORE BEHAVIOUR (original suite, kept)
   ============================================================ */

describe("core extraction", () => {
  it("extracts a standard hemoglobin result", () => {
    const result = parseLabTable("Haemoglobin 15.2 g/dL 13.5 - 17.5");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metric: "Haemoglobin",
      value: "15.2",
      unit: "g/dL",
      referenceRange: "13.5 - 17.5",
      range: "13.5 - 17.5",
      flag: "Normal",
    });
  });

  it("flags a high value", () => {
    const [metric] = parseLabTable("Glucose 200 mg/dL 70 - 100");
    expect(metric).toMatchObject({ metric: "Glucose", value: "200", unit: "mg/dL", flag: "High" });
  });

  it("flags a low value and preserves the printed precision", () => {
    const [metric] = parseLabTable("Haemoglobin 10.0 g/dL 13.5 - 17.5");
    expect(metric).toMatchObject({ value: "10.0", flag: "Low" });
  });

  it("reconstructs a row wrapped over several OCR lines", () => {
    const result = parseLabTable("Total Leucocyte Count\n5000\n/cumm\n4000-10000");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metric: "Total Leucocyte Count",
      value: "5000",
      unit: "cells/cumm",
      referenceRange: "4000 - 10000",
      flag: "Normal",
    });
  });

  it("ignores section headings", () => {
    const result = parseLabTable("CBC REPORT\nRBC Indices\nHaemoglobin 15.0 g/dL");

    expect(names(result)).toEqual(["Haemoglobin"]);
  });

  it("parses several results in order", () => {
    const result = parseLabTable("\nHaemoglobin 15.2 g/dL 13.5 - 17.5\nGlucose 90 mg/dL 70 - 100\n");

    expect(names(result)).toEqual(["Haemoglobin", "Glucose"]);
    expect(result.every((m) => m.flag === "Normal")).toBe(true);
  });

  it("returns [] for empty, whitespace-only and unrelated text", () => {
    expect(parseLabTable("")).toEqual([]);
    expect(parseLabTable("   \n   \n")).toEqual([]);
    expect(parseLabTable("Patient Name: John Doe\nHospital Report\nDate: 02/10/2026")).toEqual([]);
  });

  it("keeps decimals exactly", () => {
    const [metric] = parseLabTable("Creatinine 1.25 mg/dL 0.6 - 1.2");
    expect(metric).toMatchObject({ value: "1.25", flag: "High" });
  });

  it("does not flag a value inside the range", () => {
    expect(parseLabTable("Glucose 85 mg/dL 70 - 100")[0].flag).toBe("Normal");
  });

  it("ignores a metric name with no result", () => {
    expect(parseLabTable("Haemoglobin")).toEqual([]);
    expect(parseLabTable("Haemoglobin Not Done")).toEqual([]);
  });
});

/* ============================================================
   2. FLAG BOUNDARIES
   ============================================================ */

describe("flag calculation", () => {
  it("treats the range ends as inclusive", () => {
    expect(parseLabTable("Haemoglobin 13.5 g/dL 13.5 - 17.5")[0].flag).toBe("Normal");
    expect(parseLabTable("Haemoglobin 17.5 g/dL 13.5 - 17.5")[0].flag).toBe("Normal");
  });

  it("distinguishes < from <=", () => {
    expect(parseLabTable("Triglycerides 150 mg/dL <150")[0].flag).toBe("High");
    expect(parseLabTable("Triglycerides 150 mg/dL <=150")[0].flag).toBe("Normal");
    expect(parseLabTable("Triglycerides 149 mg/dL <150")[0].flag).toBe("Normal");
  });

  it("distinguishes > from >=", () => {
    expect(parseLabTable("HDL 40 mg/dL >40")[0].flag).toBe("Low");
    expect(parseLabTable("HDL 40 mg/dL >=40")[0].flag).toBe("Normal");
    expect(parseLabTable("HDL 55 mg/dL >40")[0].flag).toBe("Normal");
  });

  it("understands 'Up to' and 'to' ranges and prints them normalized", () => {
    expect(parseLabTable("Creatinine 1.0 mg/dL Up to 1.2")[0]).toMatchObject({
      referenceRange: "<=1.2",
      flag: "Normal",
    });

    expect(parseLabTable("Creatinine 0.9 mg/dL 0.5 to 1.2")[0]).toMatchObject({
      referenceRange: "0.5 - 1.2",
      flag: "Normal",
    });
  });

  it("returns N/A when there is no reference range", () => {
    expect(parseLabTable("Haemoglobin 13.5 g/dL")[0]).toMatchObject({
      referenceRange: "Not specified",
      flag: "N/A",
    });
  });

  it("ignores a garbled range whose low end is above its high end", () => {
    expect(parseLabTable("Haemoglobin 13.5 g/dL 17 - 13")[0]).toMatchObject({
      referenceRange: "Not specified",
      flag: "N/A",
    });
  });

  it("does NOT guess a flag when several reference ranges are printed", () => {
    const [metric] = parseLabTable("Haemoglobin 13.5 g/dL Male 13 - 17 Female 12 - 15");

    expect(metric.flag).toBe("N/A");
    expect(metric.referenceRange).toBe("13 - 17 / 12 - 15");
  });

  it("does NOT guess a flag for lipid category ladders", () => {
    const [metric] = parseLabTable("Total Cholesterol 190 mg/dL <200 200 - 239");

    expect(metric.flag).toBe("N/A");
    expect(metric.referenceRange).toContain("<200");
    expect(metric.referenceRange).toContain("200 - 239");
  });
});

/* ============================================================
   3. UNITS
   ============================================================ */

describe("units", () => {
  it.each([
    ["Haemoglobin 13.5 gm/dL 13 - 17", "g/dL"],
    ["Haemoglobin 13.5 g% 13 - 17", "g%"],
    ["Haemoglobin 13.5 gm% 13 - 17", "g%"],
    ["ESR 12 mm/hr 0 - 15", "mm/hr"],
    ["ESR 12 mm/1st hr 0 - 15", "mm/hr"],
    ["TSH 2.4 uIU/mL 0.4 - 4.5", "µIU/mL"],
    ["TSH 2.4 mIU/L 0.4 - 4.5", "mIU/L"],
    ["Vitamin B12 450 pg/mL 200 - 900", "pg/mL"],
    ["Ferritin 120 ng/mL 30 - 400", "ng/mL"],
    ["Sodium 140 mmol/L 135 - 145", "mmol/L"],
    ["SGPT 35 U/L 5 - 41", "U/L"],
    ["SGOT 28 IU/L 5 - 40", "IU/L"],
    ["MCV 85 fL 80 - 100", "fL"],
    ["MCH 29 pg 27 - 32", "pg"],
    ["Neutrophils 60 % 40 - 80", "%"],
    ["Prothrombin Time 12.5 sec 11 - 13.5", "sec"],
    ["RBC Count 4.8 million/cumm 4.5 - 5.5", "million/cumm"],
    ["Total Leucocyte Count 7200 /cumm 4000 - 11000", "cells/cumm"],
    ["Total Leucocyte Count 7200 cells/cu.mm 4000 - 11000", "cells/cumm"],
    ["Total Leucocyte Count 7200 /mm3 4000 - 11000", "cells/cumm"],
  ])("normalizes the unit in %j to %s", (row, unit) => {
    expect(parseLabTable(row)[0].unit).toBe(unit);
  });

  it("reads scientific-notation units WITHOUT mistaking their digits for the result", () => {
    // A naive number scan would pick "3" out of "10^3/µL".
    expect(parseLabTable("Absolute Neutrophil Count 3.2 10^3/µL 2.0 - 7.0")[0]).toMatchObject({
      metric: "Absolute Neutrophils",
      value: "3.2",
      unit: "10^3/µL",
      flag: "Normal",
    });

    expect(parseLabTable("Platelet Count 250 x10^9/L 150 - 410")[0]).toMatchObject({
      value: "250",
      unit: "10^9/L",
    });
  });

  it("handles superscript digits and the Greek mu", () => {
    expect(parseLabTable("Platelet Count 250 10³/µL 150 - 410")[0]).toMatchObject({
      value: "250",
      unit: "10^3/µL",
    });

    expect(parseLabTable("Platelet Count 250 10^3/\u03bcL 150 - 410")[0].unit).toBe("10^3/µL");
  });

  it("does not invent units from letters inside ordinary words", () => {
    // "fL" in "Reflex", "dL" in "Handle", "pg" in "Page" must not become units.
    expect(parseLabTable("Haemoglobin 13.5 Reflex test 13 - 17")[0].unit).toBe("Not specified");
    expect(parseLabTable("Haemoglobin 13.5 Handle with care 13 - 17")[0].unit).toBe("Not specified");
  });
});

/* ============================================================
   4. NUMBERS
   ============================================================ */

describe("numbers", () => {
  it("reads Indian digit grouping (lakh format)", () => {
    expect(parseLabTable("Platelet Count 2,50,000 /cumm 1,50,000 - 4,10,000")[0]).toMatchObject({
      value: "250000",
      referenceRange: "150000 - 410000",
      flag: "Normal",
    });
  });

  it("reads Western digit grouping", () => {
    expect(parseLabTable("Total Leucocyte Count 11,500 /cumm 4,000 - 11,000")[0]).toMatchObject({
      value: "11500",
      flag: "High",
    });
  });

  it("keeps a '<' result as a qualified value and refuses to flag it", () => {
    const [metric] = parseLabTable("CRP <0.5 mg/L 0 - 5");

    expect(metric).toMatchObject({ value: "<0.5", unit: "mg/L", referenceRange: "0 - 5", flag: "N/A" });
  });

  it("never reads a date as a reference range", () => {
    const [metric] = parseLabTable("Haemoglobin 13.5 g/dL 13.0 - 17.0 Reported 14-10-2026");

    expect(metric.referenceRange).toBe("13.0 - 17.0");
    expect(metric.flag).toBe("Normal");
  });

  it("does not use the reference range numbers as the result", () => {
    expect(parseLabTable("TSH 2.4 0.4 - 4.5")[0].value).toBe("2.4");
  });

  it("picks the result, not a number inside the test name", () => {
    expect(parseLabTable("Vitamin D (25-OH) 32 ng/mL 30 - 100")[0]).toMatchObject({
      metric: "Vitamin D",
      value: "32",
    });
  });
});

/* ============================================================
   5. SAFETY: A MISS IS BETTER THAN A MISLABEL
   ============================================================ */

describe("anti-mislabel guards", () => {
  it("skips interpretation prose even when it contains a metric and a number", () => {
    expect(
      parseLabTable("Fasting glucose above 126 mg/dL on two occasions is suggestive of diabetes mellitus.")
    ).toEqual([]);

    expect(parseLabTable("Glucose values above 126 mg/dL")).toEqual([]);
  });

  it("blocks sentences that look exactly like a result row (only the prose filter can catch these)", () => {
    // "Glucose 126 mg/dL" is perfectly table-shaped; the sentence cues are the only giveaway.
    expect(parseLabTable("Glucose 126 mg/dL or higher on two occasions is diagnostic of diabetes")).toEqual([]);
    expect(parseLabTable("Haemoglobin 7 g/dL or lower should prompt urgent evaluation")).toEqual([]);
    expect(parseLabTable("Creatinine 1.5 mg/dL is associated with reduced kidney function")).toEqual([]);
  });

  it("skips reference-range legends that have no result", () => {
    expect(parseLabTable("Total Cholesterol Desirable <200")).toEqual([]);
    expect(parseLabTable("Glucose Fasting Normal: <100 mg/dL")).toEqual([]);
  });

  it.each([
    "Calcium, Ionized 4.8 mg/dL 4.5 - 5.3",
    "Glucose, Urine 0 mg/dL 0 - 15",
    "Cholesterol/HDL Ratio 4.7 0 - 5",
    "LDL/HDL Ratio 2.1 0 - 3.5",
    "Albumin/Globulin Ratio 1.2 1.0 - 2.1",
    "Neutrophils (Absolute) 2.9 10^3/µL 2.0 - 7.0",
    "Reverse T3 25 ng/dL 10 - 24",
    "Corrected Calcium 9.1 mg/dL 8.6 - 10.2",
  ])("skips the ambiguous row %j instead of mislabeling it", (row) => {
    expect(parseLabTable(row)).toEqual([]);
  });

  it("maps look-alike tests to the RIGHT metric", () => {
    expect(names(parseLabTable("Total Iron Binding Capacity 320 µg/dL 250 - 450"))).toEqual(["TIBC"]);
    expect(names(parseLabTable("Serum Iron 80 µg/dL 60 - 170"))).toEqual(["Iron"]);
    expect(names(parseLabTable("HDL Cholesterol 45 mg/dL 40 - 60"))).toEqual(["HDL"]);
    expect(names(parseLabTable("Free T4 1.1 ng/dL 0.8 - 1.8"))).toEqual(["Free T4"]);
    expect(names(parseLabTable("T4 Free 1.1 ng/dL 0.8 - 1.8"))).toEqual(["Free T4"]);
    expect(names(parseLabTable("Glucose Fasting 92 mg/dL 70 - 100"))).toEqual(["Fasting Blood Sugar"]);
    expect(names(parseLabTable("Post Prandial Blood Sugar 130 mg/dL 70 - 140"))).toEqual([
      "Post Prandial Glucose",
    ]);
    expect(names(parseLabTable("Bilirubin, Total 0.8 mg/dL 0.2 - 1.2"))).toEqual(["Total Bilirubin"]);
  });

  it("separates percentage and absolute differential counts", () => {
    const result = parseLabTable("Neutrophils 60 % 40 - 80\nNeutrophils 2.9 10^3/µL 2.0 - 7.0");

    expect(names(result)).toEqual(["Neutrophils", "Absolute Neutrophils"]);
    expect(byName(result, "Neutrophils")?.unit).toBe("%");
    expect(byName(result, "Absolute Neutrophils")?.value).toBe("2.9");
  });

  it("rejects short abbreviations that have neither a unit nor a range", () => {
    expect(parseLabTable("TSH 2021")).toEqual([]);
    expect(parseLabTable("Hb 13.5")).toEqual([]);
    expect(parseLabTable("ABC Diagnostics Lab 2026")).toEqual([]);

    expect(parseLabTable("Hb 13.5 g/dL")).toHaveLength(1);
  });

  it("does not treat a metric far from any number as that metric's result", () => {
    expect(parseLabTable("Calcium supplementation was discussed during the visit on the 14th")).toEqual([]);
  });
});

/* ============================================================
   6. LAYOUTS
   ============================================================ */

describe("layouts", () => {
  it("does not drop a real result just because the row contains the word 'Result'", () => {
    expect(parseLabTable("Glucose Fasting Result 90 mg/dL 70 - 100")[0]).toMatchObject({
      metric: "Fasting Blood Sugar",
      value: "90",
    });
  });

  it("skips real table header rows", () => {
    expect(parseLabTable("Test Name  Result  Unit  Biological Reference Interval")).toEqual([]);
  });

  it("splits a two-column row into two metrics", () => {
    const result = parseLabTable("Haemoglobin 13.5 g/dL 13.0 - 17.0 Glucose 90 mg/dL 70 - 100");

    expect(names(result)).toEqual(["Haemoglobin", "Glucose"]);
    expect(byName(result, "Glucose")).toMatchObject({ value: "90", unit: "mg/dL" });
  });

  it("joins a wrapped test name", () => {
    const [metric] = parseLabTable("Mean Corpuscular Haemoglobin\nConcentration 33.5 g/dL 32 - 36");

    expect(metric).toMatchObject({ metric: "MCHC", value: "33.5" });
  });

  it("does not merge page footers or patient lines into a result row", () => {
    const result = parseLabTable("Haemoglobin 13.5 g/dL\nPage 1 of 3\nDr. Sharma 12345");

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("13.5");
  });

  it("handles an abbreviation repeated in brackets", () => {
    expect(parseLabTable("Fasting Blood Sugar (FBS) 92 mg/dL 70 - 100")).toHaveLength(1);
    expect(parseLabTable("Haemoglobin (Hb) 13.5 g/dL 13 - 17")[0].value).toBe("13.5");
  });

  it("ignores table borders and non-breaking spaces", () => {
    expect(parseLabTable("| Haemoglobin |\u00a013.5 | g/dL | 13.0 - 17.0 |")[0]).toMatchObject({
      value: "13.5",
      unit: "g/dL",
    });
  });

  it("supports Windows line endings and every dash variant", () => {
    const text = "Haemoglobin 13.5 g/dL 13.0\u201317.0\r\nGlucose 90 mg/dL 70\u221100\r\n";
    const result = parseLabTable(text);

    expect(result).toHaveLength(2);
    expect(result[0].referenceRange).toBe("13.0 - 17.0");
  });
});

/* ============================================================
   7. DE-DUPLICATION + CONFIDENCE
   ============================================================ */

describe("de-duplication", () => {
  it("keeps the more complete duplicate", () => {
    const result = parseLabTable("Haemoglobin 13.5\nHaemoglobin 13.5 g/dL 13.0 - 17.0");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ unit: "g/dL", flag: "Normal" });
  });

  it("keeps the first of two equally good conflicting duplicates (never merges values)", () => {
    const result = parseLabTable("Glucose 90 mg/dL 70 - 100\nGlucose 95 mg/dL 70 - 100");

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("90");
  });
});

describe("confidence", () => {
  it("scores a clean complete row highly but never above 0.95", () => {
    const [metric] = parseLabTable("Haemoglobin 13.5 g/dL 13.0 - 17.0");

    expect(metric.confidence).toBeGreaterThan(0.85);
    expect(metric.confidence).toBeLessThanOrEqual(0.95);
  });

  it("scores reconstructed, qualified and multi-range rows lower", () => {
    const clean = parseLabTable("Haemoglobin 13.5 g/dL 13.0 - 17.0")[0].confidence;
    const wrapped = parseLabTable("Haemoglobin\n13.5\ng/dL\n13.0 - 17.0")[0].confidence;
    const noUnitOrRange = parseLabTable("Haemoglobin 13.5")[0].confidence;
    const multi = parseLabTable("Haemoglobin 13.5 g/dL Male 13 - 17 Female 12 - 15")[0].confidence;

    expect(wrapped).toBeLessThan(clean);
    expect(noUnitOrRange).toBeLessThan(clean);
    expect(multi).toBeLessThan(clean);
  });
});

/* ============================================================
   8. REALISTIC REPORTS (synthetic, PDF-text-layer style)
   ============================================================ */

describe("realistic reports", () => {
  const CBC = `
COMPLETE BLOOD COUNT (CBC)
Test Name  Result  Unit  Biological Reference Interval
Haemoglobin  13.5  gm/dL  13.0 - 17.0
Total Leucocyte Count  7,200  /cumm  4,000 - 11,000
Differential Leucocyte Count
Neutrophils  60  %  40 - 80
Lymphocytes  30  %  20 - 40
Eosinophils  03  %  1 - 6
Platelet Count  2,50,000  /cumm  1,50,000 - 4,10,000
RBC Count  4.8  million/cumm  4.5 - 5.5
MCV  85  fL  80 - 100
ESR  12  mm/hr  0 - 15
Page 1 of 2
`;

  const LIPID_THYROID_LFT = `
Total Cholesterol  210  mg/dL  <200
HDL Cholesterol  45  mg/dL  40 - 60
LDL Cholesterol  135  mg/dL  <100
Triglycerides  180  mg/dL  <150
Cholesterol/HDL Ratio  4.7  0 - 5
TSH  2.40  uIU/mL  0.40 - 4.50
Free T4  1.1  ng/dL  0.8 - 1.8
SGOT (AST)  28  U/L  5 - 40
SGPT (ALT)  55  U/L  5 - 41
Bilirubin Total  0.8  mg/dL  0.2 - 1.2
Alkaline Phosphatase  95  U/L  40 - 129
Note: Fasting glucose above 126 mg/dL on two occasions is suggestive of diabetes mellitus.
`;

  it("parses a CBC", () => {
    const result = parseLabTable(CBC);

    expect(names(result)).toEqual([
      "Haemoglobin",
      "Total Leucocyte Count",
      "Neutrophils",
      "Lymphocytes",
      "Eosinophils",
      "Platelet Count",
      "RBC Count",
      "MCV",
      "ESR",
    ]);

    expect(byName(result, "Haemoglobin")).toMatchObject({ value: "13.5", unit: "g/dL", flag: "Normal" });
    expect(byName(result, "Total Leucocyte Count")).toMatchObject({ value: "7200", unit: "cells/cumm" });
    expect(byName(result, "Platelet Count")).toMatchObject({ value: "250000", flag: "Normal" });
    expect(byName(result, "Eosinophils")?.value).toBe("03");
    expect(byName(result, "ESR")).toMatchObject({ value: "12", unit: "mm/hr" });
    expect(result.every((m) => m.flag === "Normal")).toBe(true);

    expectNoInventedValues(CBC, result);
  });

  it("parses lipid, thyroid and liver panels, and skips ratio rows and notes", () => {
    const result = parseLabTable(LIPID_THYROID_LFT);

    expect(names(result)).toEqual([
      "Total Cholesterol",
      "HDL",
      "LDL",
      "Triglycerides",
      "TSH",
      "Free T4",
      "AST (SGOT)",
      "ALT (SGPT)",
      "Total Bilirubin",
      "Alkaline Phosphatase",
    ]);

    expect(byName(result, "Total Cholesterol")?.flag).toBe("High");
    expect(byName(result, "HDL")?.flag).toBe("Normal");
    expect(byName(result, "LDL")?.flag).toBe("High");
    expect(byName(result, "ALT (SGPT)")?.flag).toBe("High");
    expect(byName(result, "AST (SGOT)")?.flag).toBe("Normal");
    expect(byName(result, "TSH")).toMatchObject({ value: "2.40", unit: "µIU/mL", flag: "Normal" });

    // no row was produced from the ratio line or the interpretation note
    expect(result.some((m) => m.value === "4.7")).toBe(false);
    expect(result.some((m) => m.value === "126")).toBe(false);

    expectNoInventedValues(LIPID_THYROID_LFT, result);
  });

  it("parses the same CBC when it arrives as noisy single-spaced OCR text", () => {
    const ocr = CBC.replace(/ {2,}/g, " ");
    const result = parseLabTable(ocr);

    expect(names(result)).toContain("Haemoglobin");
    expect(byName(result, "Platelet Count")?.value).toBe("250000");
    expectNoInventedValues(ocr, result);
  });

  it("is deterministic", () => {
    expect(parseLabTable(CBC)).toEqual(parseLabTable(CBC));
  });
});

/* ============================================================
   9. ROBUSTNESS + PERFORMANCE
   ============================================================ */

describe("robustness", () => {
  it("returns [] for non-string input", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(parseLabTable(bad as unknown as string)).toEqual([]);
    }
  });

  it("survives binary junk and control characters", () => {
    const junk = Array.from({ length: 2000 }, (_, i) => String.fromCharCode(i % 256)).join("");
    expect(() => parseLabTable(junk)).not.toThrow();
  });

  it("handles pathological inputs quickly (no catastrophic backtracking)", () => {
    const inputs = [
      "9".repeat(200_000),
      "1,".repeat(100_000),
      "Haemoglobin " + "1 ".repeat(50_000),
      "Haemoglobin " + "1-".repeat(50_000),
      "Haemoglobin " + "<".repeat(50_000),
      "Hb " + "mg/".repeat(50_000),
      "(".repeat(100_000),
    ];

    const start = performance.now();
    for (const input of inputs) parseLabTable(input);

    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it("parses the maximum number of lines fast (dictionary is precompiled)", () => {
    const row = "Haemoglobin 13.5 g/dL 13.0 - 17.0\nGlucose 90 mg/dL 70 - 100\nTSH 2.4 uIU/mL 0.4 - 4.5\n";
    const text = row.repeat(2_000);

    const start = performance.now();
    parseLabTable(text);

    expect(performance.now() - start).toBeLessThan(1_500);
  });

  it("truncates absurdly long lines instead of scanning them", () => {
    const text = "Haemoglobin 13.5 g/dL 13.0 - 17.0 " + "x".repeat(100_000);
    expect(parseLabTable(text)[0].value).toBe("13.5");
  });
});

/* ============================================================
   10. DEBUG HELPER
   ============================================================ */

describe("debugParseLabTable", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns rows and metrics in development", () => {
    vi.stubEnv("NODE_ENV", "development");

    const debug = debugParseLabTable("Haemoglobin 13.5 g/dL 13.0 - 17.0");

    expect(debug.rows).toHaveLength(1);
    expect(debug.metrics).toHaveLength(1);
  });

  it("is disabled in production so health text can never leak through it", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(debugParseLabTable("Haemoglobin 13.5 g/dL 13.0 - 17.0")).toEqual({ rows: [], metrics: [] });
  });
});