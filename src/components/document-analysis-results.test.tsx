// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { AnalyzeDocumentOutput } from "@/lib/types";

import DocumentAnalysisResults from "./document-analysis-results";

afterEach(cleanup);

/* ============================================================
   FIXTURES
   ============================================================ */

const RESULT = {
  summary: "Most values are in range.\n\nFasting glucose is above the printed range.",
  keyDataPoints: [
    { metric: "Haemoglobin", value: "13.5", unit: "g/dL", referenceRange: "13.0 - 17.0", range: "13.0 - 17.0", flag: "Normal", confidence: 0.92 },
    { metric: "Fasting Blood Sugar", value: "126", unit: "mg/dL", referenceRange: "70 - 100", range: "70 - 100", flag: "High", confidence: 0.92 },
    { metric: "Calcium", value: "7.9", unit: "mg/dL", referenceRange: "8.6 - 10.2", range: "8.6 - 10.2", flag: "Low", confidence: 0.6 },
    { metric: "TSH", value: "2.4", unit: "Not specified", referenceRange: "Not specified", range: "Not specified", flag: "N/A", confidence: 0.55 },
  ],
  recommendations: ["Review these results with a qualified healthcare professional."],
} satisfies AnalyzeDocumentOutput;

const renderResult = (result: unknown = RESULT) =>
  render(<DocumentAnalysisResults result={result as AnalyzeDocumentOutput} />);

const rowOf = (metric: string) => screen.getByText(metric).closest("tr") as HTMLElement;

/* ============================================================
   WHAT THE OLD TABLE DROPPED
   ============================================================ */

describe("values table", () => {
  it("shows the UNIT next to each value (the old table showed '126' with no unit)", () => {
    renderResult();

    const row = rowOf("Fasting Blood Sugar");

    expect(within(row).getByText("126")).toBeTruthy();
    expect(within(row).getByText("mg/dL")).toBeTruthy();
    expect(within(rowOf("Haemoglobin")).getByText("g/dL")).toBeTruthy();
  });

  it("shows the STATUS as text, not only as colour", () => {
    renderResult();

    expect(within(rowOf("Fasting Blood Sugar")).getByText("High")).toBeTruthy();
    expect(within(rowOf("Calcium")).getByText("Low")).toBeTruthy();
    expect(within(rowOf("Haemoglobin")).getByText("Normal")).toBeTruthy();
    expect(within(rowOf("TSH")).getByText("Not compared")).toBeTruthy();
  });

  it("gives screen readers the meaning of each status", () => {
    renderResult();

    expect(rowOf("Fasting Blood Sugar").textContent).toMatch(/above the reference range/);
    expect(rowOf("Calcium").textContent).toMatch(/below the reference range/);
  });

  it("never shows the raw placeholder 'Not specified'; missing data becomes a dash", () => {
    renderResult();

    expect(document.body.textContent).not.toContain("Not specified");
    expect(within(rowOf("TSH")).getByText(/Not stated on the report/)).toBeTruthy();
    expect(within(rowOf("TSH")).queryByText("Not specified")).toBeNull();
  });

  it("marks only hard-to-read values with 'Check'", () => {
    renderResult();

    expect(within(rowOf("Calcium")).getByText("Check")).toBeTruthy();
    expect(within(rowOf("TSH")).getByText("Check")).toBeTruthy();
    expect(within(rowOf("Haemoglobin")).queryByText("Check")).toBeNull();
    expect(within(rowOf("Fasting Blood Sugar")).queryByText("Check")).toBeNull();

    expect(screen.getByText(/were hard to read/)).toBeTruthy();
  });

  it("falls back to the legacy `range` field", () => {
    renderResult({ ...RESULT, keyDataPoints: [{ metric: "X", value: "1", range: "0 - 5" }] });

    expect(within(rowOf("X")).getByText("0 - 5")).toBeTruthy();
  });
});

/* ============================================================
   OVERVIEW + FILTER
   ============================================================ */

describe("overview and filter", () => {
  it("summarizes how many values are outside the range", () => {
    renderResult();

    expect(screen.getByText("4 values extracted")).toBeTruthy();
    expect(screen.getByText("1 above range")).toBeTruthy();
    expect(screen.getByText("1 below range")).toBeTruthy();
  });

  it("filters to values outside the range and announces the result", async () => {
    renderResult();
    const user = userEvent.setup();

    const toggle = screen.getByRole("button", { name: /outside range only \(2\)/i });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByRole("row")).toHaveLength(5); // header + 4

    await user.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + High + Low
    expect(screen.queryByText("Haemoglobin")).toBeNull();
    expect(screen.getByText(/Showing 2 of 4 values/)).toBeTruthy();

    await user.click(toggle);

    expect(screen.getAllByRole("row")).toHaveLength(5);
  });

  it("hides the filter when it would be pointless (nothing flagged, or everything flagged)", () => {
    const normal = { metric: "A", value: "1", flag: "Normal" };
    const high = { metric: "B", value: "2", flag: "High" };

    const { unmount } = renderResult({ ...RESULT, keyDataPoints: [normal, { ...normal, metric: "C" }] });
    expect(screen.queryByRole("button", { name: /outside range only/i })).toBeNull();
    unmount();

    renderResult({ ...RESULT, keyDataPoints: [high, { ...high, metric: "D" }] });
    expect(screen.queryByRole("button", { name: /outside range only/i })).toBeNull();
  });
});

/* ============================================================
   SUMMARY + RECOMMENDATIONS
   ============================================================ */

describe("summary and recommendations", () => {
  it("keeps the AI's paragraphs and says it was AI-generated", () => {
    renderResult();

    const summary = screen.getByText(/Most values are in range/);

    expect(summary.textContent).toContain("Fasting glucose is above the printed range.");
    expect(summary.className).toMatch(/whitespace-pre-line/);
    expect(screen.getByText(/Generated by AI/i)).toBeTruthy();
  });

  it("renders AI text as plain text (no HTML injection)", () => {
    const { container } = renderResult({
      ...RESULT,
      summary: '<img src=x onerror="window.__pwned = true"> <script>window.__pwned = true</script>',
      recommendations: ['<b onmouseover="window.__pwned = true">bold</b>'],
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(container.textContent).toContain("<img src=x");
  });

  it("shows the recommendations and hides the section when there are none", () => {
    const { unmount } = renderResult();
    expect(screen.getByText("Review these results with a qualified healthcare professional.")).toBeTruthy();
    expect(screen.getByText(/This is not medical advice/)).toBeTruthy();
    unmount();

    renderResult({ ...RESULT, recommendations: [] });
    expect(screen.queryByText("Recommendations")).toBeNull();
  });

  it("has a sensible message when the summary is empty", () => {
    renderResult({ ...RESULT, summary: "   " });

    expect(screen.getByText(/No summary was generated/)).toBeTruthy();
  });
});

/* ============================================================
   EMPTY AND MALFORMED DATA
   ============================================================ */

describe("empty and malformed data", () => {
  it("explains what to do when no values could be read, instead of showing nothing", () => {
    renderResult({ ...RESULT, keyDataPoints: [] });

    expect(screen.getByText(/No laboratory values could be read/)).toBeTruthy();
    expect(screen.getByText(/clearer photo/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("does not crash or print 'undefined' on garbage input", () => {
    const garbage = [
      { summary: undefined, keyDataPoints: undefined, recommendations: undefined },
      { summary: 42, keyDataPoints: "nope", recommendations: "nope" },
      { summary: "ok", keyDataPoints: [null, 1, "x", {}, { metric: 5, value: {} }], recommendations: [null, 3, {}, ""] },
      {},
    ];

    for (const result of garbage) {
      const { container, unmount } = renderResult(result);

      expect(container.textContent).not.toMatch(/undefined|null|NaN|\[object/);
      unmount();
    }
  });

  it("copes with a missing result object", () => {
    expect(() => renderResult(undefined)).not.toThrow();
  });
});

/* ============================================================
   ACCESSIBILITY
   ============================================================ */

describe("accessibility", () => {
  it("gives the table a caption and column headers", () => {
    renderResult();

    const table = screen.getByRole("table");

    expect(table.querySelector("caption")?.textContent).toMatch(/Laboratory values extracted/);
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Metric",
      "Result",
      "Reference range",
      "Status",
    ]);
  });

  it("uses real heading levels for the three sections", () => {
    renderResult();

    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim())).toEqual([
      "AI Summary",
      "Key Data Points",
      "Recommendations",
    ]);
  });

  it("hides decorative icons from assistive technology", () => {
    const { container } = renderResult();

    const icons = container.querySelectorAll("svg");

    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon.getAttribute("aria-hidden")).toBe("true"));
  });

  it("lets the table scroll sideways on narrow screens instead of breaking the layout", () => {
    renderResult();

    // any scrolling ancestor will do: shadcn's own <Table> already adds one, ours adds a second
    expect(screen.getByRole("table").closest('[class*="overflow-"]')).not.toBeNull();
  });
});