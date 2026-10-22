// src/lib/lab-results.test.ts
import { describe, expect, it } from "vitest";

import {
  asText,
  filterPoints,
  needsVerification,
  normalizeFlag,
  normalizeKeyDataPoints,
  pluralize,
  summarizePoints,
  textOrNull,
  VERIFY_BELOW_CONFIDENCE,
} from "./lab-results";

describe("asText / textOrNull", () => {
  it("collapses whitespace and accepts finite numbers", () => {
    expect(asText("  Haemo   globin \n ")).toBe("Haemo globin");
    expect(asText(13.5)).toBe("13.5");
  });

  it("turns everything else into an empty string", () => {
    for (const bad of [null, undefined, {}, [], true, NaN, Infinity]) {
      expect(asText(bad)).toBe("");
    }
  });

  it("bounds very long text", () => {
    const result = asText("x".repeat(5_000));

    expect(result.length).toBeLessThanOrEqual(201);
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it.each(["", "  ", "Not specified", "NOT SPECIFIED", "N/A", "n/a", "-", "\u2014", "none", "null", "undefined"])(
    "treats %j as 'no value'",
    (placeholder) => {
      expect(textOrNull(placeholder)).toBeNull();
    }
  );

  it("keeps real text, including text that merely contains a placeholder word", () => {
    expect(textOrNull("g/dL")).toBe("g/dL");
    expect(textOrNull("13.0 - 17.0")).toBe("13.0 - 17.0");
    expect(textOrNull("Not specified by lab, see note")).toBe("Not specified by lab, see note");
  });
});

describe("normalizeFlag", () => {
  it.each([
    ["High", "high"],
    ["HIGH", "high"],
    ["H", "high"],
    ["h", "high"],
    ["critical high", "high"],
    ["Critically High", "high"],
    ["above range", "high"],
    ["elevated", "high"],
    ["Low", "low"],
    ["L", "low"],
    ["critical low", "low"],
    ["below", "low"],
    ["decreased", "low"],
    ["Normal", "normal"],
    ["within range", "normal"],
    ["OK", "normal"],
  ])("maps %j to %s", (raw, expected) => {
    expect(normalizeFlag(raw)).toBe(expected);
  });

  it.each(["N/A", "", "   ", "Not specified", "borderline", "pending", null, undefined, 42, {}, "Hemolyzed"])(
    "maps %j to 'unknown'",
    (raw) => {
      expect(normalizeFlag(raw)).toBe("unknown");
    }
  );

  it("does not mistake words that merely START with a flag letter", () => {
    // "Hemolyzed" starts with "h", "Lipemic" with "l": neither is a flag
    expect(normalizeFlag("Hemolyzed")).toBe("unknown");
    expect(normalizeFlag("Lipemic")).toBe("unknown");
  });
});

describe("needsVerification", () => {
  it("flags low confidence only", () => {
    expect(needsVerification(0.55)).toBe(true);
    expect(needsVerification(VERIFY_BELOW_CONFIDENCE - 0.01)).toBe(true);
    expect(needsVerification(VERIFY_BELOW_CONFIDENCE)).toBe(false);
    expect(needsVerification(0.92)).toBe(false);
  });

  it("does not guess when confidence is missing or invalid", () => {
    for (const bad of [undefined, null, "0.2", NaN, {}]) {
      expect(needsVerification(bad)).toBe(false);
    }
  });
});

describe("normalizeKeyDataPoints", () => {
  const good = {
    metric: "Haemoglobin",
    value: "13.5",
    unit: "g/dL",
    referenceRange: "13.0 - 17.0",
    flag: "Normal",
    confidence: 0.92,
  };

  it("converts a well-formed row", () => {
    expect(normalizeKeyDataPoints([good])).toEqual([
      {
        id: "0-Haemoglobin",
        metric: "Haemoglobin",
        value: "13.5",
        unit: "g/dL",
        referenceRange: "13.0 - 17.0",
        flag: "normal",
        needsVerification: false,
      },
    ]);
  });

  it("never shows 'Not specified': placeholders become null", () => {
    const [point] = normalizeKeyDataPoints([{ ...good, unit: "Not specified", referenceRange: "Not specified", flag: "N/A" }]);

    expect(point.unit).toBeNull();
    expect(point.referenceRange).toBeNull();
    expect(point.flag).toBe("unknown");
  });

  it("falls back to the legacy `range` field", () => {
    const [point] = normalizeKeyDataPoints([{ metric: "X", value: "1", range: "0 - 5" }]);

    expect(point.referenceRange).toBe("0 - 5");
  });

  it("prefers `referenceRange` over `range`", () => {
    const [point] = normalizeKeyDataPoints([{ metric: "X", value: "1", referenceRange: "1 - 2", range: "0 - 5" }]);

    expect(point.referenceRange).toBe("1 - 2");
  });

  it("accepts numeric values and keeps the printed text", () => {
    expect(normalizeKeyDataPoints([{ metric: "TSH", value: 2.4 }])[0].value).toBe("2.4");
    expect(normalizeKeyDataPoints([{ metric: "ALT", value: "035" }])[0].value).toBe("035");
  });

  it("drops rows that have nothing useful to show", () => {
    const result = normalizeKeyDataPoints([
      good,
      null,
      "text",
      42,
      [],
      {},
      { metric: "", value: "1" },
      { metric: "NoValue" },
      { metric: "Placeholder", value: "N/A" },
    ]);

    expect(result.map((p) => p.metric)).toEqual(["Haemoglobin"]);
  });

  it("returns [] for anything that is not an array", () => {
    for (const bad of [null, undefined, "x", 1, {}, { length: 3 }]) {
      expect(normalizeKeyDataPoints(bad)).toEqual([]);
    }
  });

  it("gives every row a unique id even when metric names repeat", () => {
    const ids = normalizeKeyDataPoints([good, good, good]).map((p) => p.id);

    expect(new Set(ids).size).toBe(3);
  });
});

describe("summarizePoints / filterPoints / pluralize", () => {
  const points = normalizeKeyDataPoints([
    { metric: "A", value: "1", flag: "High", confidence: 0.9 },
    { metric: "B", value: "2", flag: "Low", confidence: 0.5 },
    { metric: "C", value: "3", flag: "Normal", confidence: 0.9 },
    { metric: "D", value: "4", flag: "N/A", confidence: 0.4 },
    { metric: "E", value: "5", flag: "Normal" },
  ]);

  it("counts every category", () => {
    expect(summarizePoints(points)).toEqual({
      total: 5,
      high: 1,
      low: 1,
      normal: 2,
      unknown: 1,
      flagged: 2,
      toVerify: 2,
    });
  });

  it("summarizes an empty list", () => {
    expect(summarizePoints([])).toEqual({ total: 0, high: 0, low: 0, normal: 0, unknown: 0, flagged: 0, toVerify: 0 });
  });

  it("filters to values outside the range without mutating the input", () => {
    const before = JSON.stringify(points);

    expect(filterPoints(points, true).map((p) => p.metric)).toEqual(["A", "B"]);
    expect(filterPoints(points, false)).toHaveLength(5);
    expect(JSON.stringify(points)).toBe(before);
  });

  it("pluralizes", () => {
    expect(pluralize(0, "value")).toBe("0 values");
    expect(pluralize(1, "value")).toBe("1 value");
    expect(pluralize(2, "value")).toBe("2 values");
  });
});