// src/lib/health-records-utils.test.ts
import { describe, expect, it } from "vitest";

import {
  buildCountAxis,
  buildDemoRecords,
  buildMonthlyTrends,
  describeHttpFailure,
  getErrorMessage,
  isHeicFile,
  isSuccessfulAnalysisResponse,
  resolveMimeType,
  sanitizeTrendData,
  summarizeTrends,
  type HealthRecord,
} from "./health-records-utils";

const record = (date: string, id = date): HealthRecord => ({
  id,
  date,
  type: "Lab Result",
  title: "x",
  status: "Sample",
});

/* ============================================================
   FILE TYPES
   ============================================================ */

describe("resolveMimeType", () => {
  it.each([
    ["report.pdf", "application/pdf", "application/pdf"],
    ["photo.jpg", "image/jpeg", "image/jpeg"],
    ["photo.png", "image/png", "image/png"],
    ["photo.webp", "image/webp", "image/webp"],
    ["PHOTO.JPEG", "IMAGE/JPEG", "image/jpeg"],
  ])("accepts %s declared as %s", (name, type, expected) => {
    expect(resolveMimeType({ name, type })).toBe(expected);
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(resolveMimeType({ name: "lab-report.pdf", type: "" })).toBe("application/pdf");
    expect(resolveMimeType({ name: "scan.PNG", type: "" })).toBe("image/png");
    expect(resolveMimeType({ name: "scan.webp", type: "application/octet-stream" })).toBe("image/webp");
  });

  it("maps non-standard JPEG type names", () => {
    expect(resolveMimeType({ name: "a.jpg", type: "image/jpg" })).toBe("image/jpeg");
    expect(resolveMimeType({ name: "a.jpg", type: "image/pjpeg" })).toBe("image/jpeg");
  });

  it("rejects unsupported files", () => {
    expect(resolveMimeType({ name: "notes.docx", type: "" })).toBeNull();
    expect(resolveMimeType({ name: "archive", type: "" })).toBeNull();
    expect(resolveMimeType({ name: "movie.mp4", type: "video/mp4" })).toBeNull();
    expect(resolveMimeType({ name: "photo.heic", type: "image/heic" })).toBeNull();
  });

  it("does not trust the extension when the browser declares a DIFFERENT real type", () => {
    // a file named .pdf that the browser says is a video must not be upgraded to a PDF
    expect(resolveMimeType({ name: "sneaky.pdf", type: "video/mp4" })).toBeNull();
  });
});

describe("isHeicFile", () => {
  it("detects iPhone HEIC/HEIF photos by type or extension", () => {
    expect(isHeicFile({ name: "IMG_1.HEIC", type: "" })).toBe(true);
    expect(isHeicFile({ name: "x.heif", type: "" })).toBe(true);
    expect(isHeicFile({ name: "x", type: "image/heic" })).toBe(true);
    expect(isHeicFile({ name: "x.jpg", type: "image/jpeg" })).toBe(false);
  });
});

/* ============================================================
   RESPONSES + ERRORS
   ============================================================ */

describe("response helpers", () => {
  it("describes platform errors that have no JSON body", () => {
    expect(describeHttpFailure(413)).toMatch(/too large/i);
    expect(describeHttpFailure(504)).toMatch(/too long/i);
    expect(describeHttpFailure(404)).toMatch(/could not be found/i);
    expect(describeHttpFailure(401)).toMatch(/sign in again/i);
    expect(describeHttpFailure(403)).toMatch(/not allowed/i);
    expect(describeHttpFailure(429)).toMatch(/too many requests/i);
    expect(describeHttpFailure(503)).toMatch(/temporarily unavailable/i);
    expect(describeHttpFailure(500)).toBe("Document analysis failed.");
  });

  it("recognizes only well-formed success responses", () => {
    expect(isSuccessfulAnalysisResponse({ success: true, data: { summary: "x" } })).toBe(true);

    for (const bad of [null, undefined, "x", 1, {}, { success: true }, { success: false, data: {} }, { data: {} }]) {
      expect(isSuccessfulAnalysisResponse(bad)).toBe(false);
    }
  });

  it("extracts an error message or falls back to a safe default", () => {
    expect(getErrorMessage(new Error("Bad scan"))).toBe("Bad scan");
    expect(getErrorMessage(new Error("   "))).toBe("Something went wrong. Please try again.");
    expect(getErrorMessage("boom")).toBe("Something went wrong. Please try again.");
    expect(getErrorMessage(null)).toBe("Something went wrong. Please try again.");
  });
});

/* ============================================================
   DEMO DATA + TRENDS
   ============================================================ */

describe("buildMonthlyTrends", () => {
  const now = new Date("2026-10-14T10:00:00Z");

  it("returns six buckets ending with the current month", () => {
    expect(buildMonthlyTrends([], now).map((p) => p.month)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
  });

  it("works across a year boundary", () => {
    expect(buildMonthlyTrends([], new Date("2026-02-10T00:00:00Z")).map((p) => p.month)).toEqual([
      "Sep",
      "Oct",
      "Nov",
      "Dec",
      "Jan",
      "Feb",
    ]);
  });

  it("counts records per month and ignores anything outside the window", () => {
    const trends = buildMonthlyTrends(
      [
        record("2026-10-01"),
        record("2026-10-13", "b"),
        record("2026-07-20"),
        record("2026-04-30"), // too old
        record("2027-01-01"), // future
      ],
      now
    );

    expect(trends.map((p) => p.records)).toEqual([0, 0, 1, 0, 0, 2]);
  });

  it("ignores invalid dates instead of throwing", () => {
    expect(() => buildMonthlyTrends([record("not-a-date"), record("")], now)).not.toThrow();
    expect(buildMonthlyTrends([record("not-a-date")], now).every((p) => p.records === 0)).toBe(true);
  });

  it("assigns month-edge timestamps by UTC, not by the viewer's timezone", () => {
    const trends = buildMonthlyTrends(
      [record("2026-09-30T23:59:59Z"), record("2026-10-01T00:00:00Z", "b")],
      now
    );

    expect(trends[4].records).toBe(1); // Sep
    expect(trends[5].records).toBe(1); // Oct
  });

  it("does not mutate its input", () => {
    const records = [record("2026-10-01")];
    const copy = JSON.stringify(records);

    buildMonthlyTrends(records, now);

    expect(JSON.stringify(records)).toBe(copy);
  });
});

describe("buildDemoRecords", () => {
  const now = new Date("2026-10-14T10:00:00Z");

  it("returns three clearly labelled sample records with unique ids and ISO dates", () => {
    const records = buildDemoRecords(now);

    expect(records).toHaveLength(3);
    expect(new Set(records.map((r) => r.id)).size).toBe(3);
    expect(records.every((r) => r.status === "Sample")).toBe(true);
    expect(records.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
  });

  it("always fills the chart (regression: static 2023/2024 dates made every bar zero)", () => {
    // every day of a leap year, so month/year boundaries are all covered
    for (let day = 0; day < 366; day++) {
      const today = new Date(Date.UTC(2028, 0, 1 + day, 12));
      const total = buildMonthlyTrends(buildDemoRecords(today), today).reduce((sum, p) => sum + p.records, 0);

      expect(total, today.toISOString()).toBe(3);
    }
  });
});

/* ============================================================
   CHART HELPERS
   ============================================================ */

describe("sanitizeTrendData", () => {
  it("passes well-formed points through unchanged", () => {
    const data = [
      { month: "May", records: 0 },
      { month: "Jun", records: 3 },
    ];

    expect(sanitizeTrendData(data)).toEqual(data);
  });

  it("repairs bad counts: negative, fractional, NaN, Infinity, strings, missing", () => {
    const result = sanitizeTrendData([
      { month: "A", records: -4 },
      { month: "B", records: 2.9 },
      { month: "C", records: NaN },
      { month: "D", records: Infinity },
      { month: "E", records: "7" },
      { month: "F" },
    ]);

    expect(result.map((p) => p.records)).toEqual([0, 2, 0, 0, 0, 0]);
  });

  it("drops malformed points and trims month labels", () => {
    const result = sanitizeTrendData([null, 5, "x", {}, { month: "" }, { month: "   " }, { month: 3 }, { month: "  Oct  ", records: 1 }]);

    expect(result).toEqual([{ month: "Oct", records: 1 }]);
  });

  it("returns [] for non-arrays and caps very long input", () => {
    for (const bad of [null, undefined, "x", 1, {}]) expect(sanitizeTrendData(bad)).toEqual([]);

    const many = Array.from({ length: 500 }, (_, i) => ({ month: `M${i}`, records: 1 }));
    expect(sanitizeTrendData(many)).toHaveLength(24);
  });

  it("does not mutate its input", () => {
    const data = [{ month: "May", records: -1 }];
    const copy = JSON.stringify(data);

    sanitizeTrendData(data);

    expect(JSON.stringify(data)).toBe(copy);
  });
});

describe("summarizeTrends", () => {
  it("totals, names the window, and finds the busiest month", () => {
    const summary = summarizeTrends([
      { month: "May", records: 0 },
      { month: "Jun", records: 3 },
      { month: "Jul", records: 1 },
    ]);

    expect(summary).toEqual({ total: 4, first: "May", last: "Jul", peak: { month: "Jun", records: 3 } });
  });

  it("prefers the most recent month when several tie", () => {
    const summary = summarizeTrends([
      { month: "May", records: 2 },
      { month: "Jun", records: 2 },
      { month: "Jul", records: 1 },
    ]);

    expect(summary.peak?.month).toBe("Jun");
  });

  it("has no peak when every month is zero (so the chart shows its empty state)", () => {
    expect(summarizeTrends([{ month: "May", records: 0 }, { month: "Jun", records: 0 }])).toMatchObject({
      total: 0,
      peak: null,
    });
  });

  it("handles an empty list", () => {
    expect(summarizeTrends([])).toEqual({ total: 0, first: "", last: "", peak: null });
  });
});

describe("buildCountAxis", () => {
  it.each([
    [0, [0, 1, 2]],
    [1, [0, 1, 2]],
    [2, [0, 1, 2]],
    [3, [0, 1, 2, 3]],
    [5, [0, 1, 2, 3, 4, 5]],
    [6, [0, 2, 4, 6]],
    [7, [0, 2, 4, 6, 8]],
    [12, [0, 5, 10, 15]],
    [40, [0, 10, 20, 30, 40]],
    [103, [0, 50, 100, 150]],
  ])("max %s -> ticks %j", (max, ticks) => {
    expect(buildCountAxis(max).ticks).toEqual(ticks);
  });

  it("always starts at 0, spaces ticks evenly, tops out above the data and shows at most 6 labels", () => {
    for (let max = 0; max <= 5_000; max += 7) {
      const { max: top, ticks } = buildCountAxis(max);
      const gaps = new Set(ticks.slice(1).map((tick, i) => tick - ticks[i]));

      expect(ticks[0], `max ${max}`).toBe(0);
      expect(gaps.size, `max ${max}`).toBe(1);
      expect(top, `max ${max}`).toBeGreaterThanOrEqual(max);
      expect(ticks[ticks.length - 1]).toBe(top);
      expect(ticks.length, `max ${max}`).toBeLessThanOrEqual(6);
      expect(ticks.every(Number.isInteger)).toBe(true);
    }
  });

  it("survives nonsense input", () => {
    for (const bad of [NaN, Infinity, -5, 0.2]) {
      const axis = buildCountAxis(bad as number);

      expect(axis.ticks.length).toBeGreaterThanOrEqual(3);
      expect(axis.ticks.every(Number.isInteger)).toBe(true);
    }
  });
});