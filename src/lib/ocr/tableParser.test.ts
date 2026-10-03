import { describe, it, expect } from "vitest";
import { parseLabTable } from "./tableParser";

describe("parseLabTable", () => {
  it("extracts a standard hemoglobin result correctly", () => {
    const text = "Haemoglobin 15.2 g/dL 13.5 - 17.5";

    const result = parseLabTable(text);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metric: "Haemoglobin",
      value: "15.2",
      unit: "g/dL",
      referenceRange: "13.5 - 17.5",
      flag: "Normal",
    });
  });

  it("identifies a high value", () => {
    const text = "Glucose 200 mg/dL 70 - 100";

    const result = parseLabTable(text);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metric: "Glucose",
      value: "200",
      unit: "mg/dL",
      flag: "High",
    });
  });

  it("identifies a low value", () => {
    const text = "Haemoglobin 10.0 g/dL 13.5 - 17.5";

    const result = parseLabTable(text);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metric: "Haemoglobin",
      value: "10.0",
      unit: "g/dL",
      flag: "Low",
    });
  });

  it("handles multi-line OCR reconstructed rows", () => {
    const text = `Total Leucocyte Count
5000
/cumm
4000-10000`;

    const result = parseLabTable(text);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metric: "Total Leucocyte Count",
      value: "5000",
      unit: "cells/cumm",
    });
  });

  it("ignores section headers", () => {
    const text = `CBC REPORT
RBC Indices
Haemoglobin 15.0 g/dL`;

    const result = parseLabTable(text);

    expect(result).toHaveLength(1);
    expect(result[0].metric).toBe("Haemoglobin");
    expect(
      result.some((item) => item.metric === "RBC Indices")
    ).toBe(false);
  });

  it("handles multiple laboratory results", () => {
    const text = `
Haemoglobin 15.2 g/dL 13.5 - 17.5
Glucose 90 mg/dL 70 - 100
`;

    const result = parseLabTable(text);

    expect(result).toHaveLength(2);

    expect(result[0]).toMatchObject({
      metric: "Haemoglobin",
      value: "15.2",
      unit: "g/dL",
      flag: "Normal",
    });

    expect(result[1]).toMatchObject({
      metric: "Glucose",
      value: "90",
      unit: "mg/dL",
      flag: "Normal",
    });
  });

  it("returns an empty array for empty OCR text", () => {
    expect(parseLabTable("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only OCR text", () => {
    expect(parseLabTable("   \n   \n")).toEqual([]);
  });

  it("does not treat unrelated text as a laboratory result", () => {
    const text = `
Patient Name: John Doe
Hospital Report
Date: 02/10/2026
`;

    const result = parseLabTable(text);

    expect(result).toEqual([]);
  });

  it("preserves decimal laboratory values", () => {
    const text = "Creatinine 1.25 mg/dL 0.6 - 1.2";

    const result = parseLabTable(text);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metric: "Creatinine",
      value: "1.25",
      unit: "mg/dL",
      flag: "High",
    });
  });

  it("does not incorrectly classify a value inside the reference range", () => {
    const text = "Glucose 85 mg/dL 70 - 100";

    const result = parseLabTable(text);

    expect(result).toHaveLength(1);
    expect(result[0].flag).toBe("Normal");
  });
});