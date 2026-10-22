// @vitest-environment jsdom
//
// Renders the REAL recharts library to an SVG (works with recharts 2.x and 3.x). Only shadcn's ChartContainer is replaced: the real one
// measures its parent with ResizeObserver, which jsdom does not have, so the stand-in gives the chart a fixed size.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/chart", async () => {
  const React = await import("react");
  const { Tooltip } = await import("recharts");

  return {
    ChartContainer: ({ children, className }: { children: React.ReactElement; className?: string }) =>
      React.createElement("div", { className }, React.cloneElement(children, { width: 600, height: 300 } as object)),
    ChartTooltip: Tooltip,
    ChartTooltipContent: () => null,
  };
});

import HealthTrendsChart from "./health-trends-chart";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DATA = [
  { month: "May", records: 0 },
  { month: "Jun", records: 1 },
  { month: "Jul", records: 0 },
  { month: "Aug", records: 0 },
  { month: "Sep", records: 1 },
  { month: "Oct", records: 2 },
];

const ZEROS = DATA.map((point) => ({ ...point, records: 0 }));

/** Pretend the OS "reduce motion" setting is on or off. */
function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const linePath = (container: HTMLElement) => container.querySelector("path.recharts-line-curve");
/**
 * Axis label text. recharts 2 draws labels INSIDE the axis group (.recharts-xAxis ...), recharts 3 draws
 * them in a separate layer (.recharts-xAxis-tick-labels ...). Both are accepted so this works on either.
 */
const tickTexts = (container: HTMLElement, axis: "xAxis" | "yAxis") =>
  [
    ...container.querySelectorAll(
      `.recharts-${axis} .recharts-cartesian-axis-tick-value, .recharts-${axis}-tick-labels .recharts-cartesian-axis-tick-value`
    ),
  ].map((node) => node.textContent);

/* ============================================================
   REAL RENDERING
   ============================================================ */

describe("chart rendering", () => {
  it("draws a real line with every month on the X axis", () => {
    setReducedMotion(false);
    const { container } = render(<HealthTrendsChart data={DATA} />);

    expect(container.querySelector("svg")).not.toBeNull();
    expect(linePath(container)).not.toBeNull();
    expect(tickTexts(container, "xAxis")).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
  });

  it.each([
    [[0, 1, 0, 0, 1, 1], ["0", "1", "2"]],
    [[0, 0, 0, 0, 0, 5], ["0", "1", "2", "3", "4", "5"]],
    [[0, 3, 0, 0, 0, 7], ["0", "2", "4", "6", "8"]],
    [[0, 12, 0, 0, 0, 3], ["0", "5", "10", "15"]],
  ])("Y axis for %j shows clean, evenly spaced whole numbers %j", (counts, expected) => {
    setReducedMotion(false);
    const data = counts.map((records, i) => ({ month: "ABCDEF"[i], records }));
    const { container } = render(<HealthTrendsChart data={data} />);

    // regression: recharts' own 'auto' domain gave 0..4 for a maximum of 1, and 0,2,5 was uneven
    expect(tickTexts(container, "yAxis")).toEqual(expected);
  });

  it("is a single drawn line with a stroke colour taken from the chart config", () => {
    setReducedMotion(false);
    const { container } = render(<HealthTrendsChart data={DATA} />);

    expect(container.querySelectorAll("path.recharts-line-curve")).toHaveLength(1);
    expect(linePath(container)?.getAttribute("stroke")).toBe("var(--color-records)");
  });
});

/* ============================================================
   MOTION
   ============================================================ */

describe("reduced motion", () => {
  it("animates the line by default", () => {
    setReducedMotion(false);
    const { container } = render(<HealthTrendsChart data={DATA} />);

    expect(linePath(container)?.getAttribute("stroke-dasharray")).toBe("0px 0px");
  });

  it("does NOT animate when the user asked their OS to reduce motion", () => {
    setReducedMotion(true);
    const { container } = render(<HealthTrendsChart data={DATA} />);

    expect(linePath(container)).not.toBeNull();
    expect(linePath(container)?.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("still renders in environments without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);

    expect(() => render(<HealthTrendsChart data={DATA} />)).not.toThrow();
  });
});

/* ============================================================
   EMPTY STATES
   ============================================================ */

describe("empty states", () => {
  it.each([
    ["no data prop", undefined],
    ["an empty array", []],
    ["six months of zeros (what the parent really sends for a new user)", ZEROS],
    ["only malformed points", [null, 5, { month: "" }, { records: 3 }]],
    ["not an array at all", "nope"],
  ])("shows the empty state for %s, instead of a flat line at zero", (_label, data) => {
    const { container } = render(<HealthTrendsChart data={data as never} />);

    expect(screen.getByText("No health records yet")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("figure")).toBeNull();
  });

  it("does not claim a trend when there is none (regression: a 'trending up' icon always showed)", () => {
    const { container } = render(<HealthTrendsChart data={ZEROS} />);

    expect(container.textContent).not.toMatch(/over time|trend/i);
  });
});

/* ============================================================
   ACCESSIBILITY + SUMMARY
   ============================================================ */

describe("accessibility and summary", () => {
  it("is a labelled figure", () => {
    render(<HealthTrendsChart data={DATA} />);

    expect(screen.getByRole("figure").getAttribute("aria-label")).toBe(
      "Line chart of health records per month, from May to Oct"
    );
  });

  it("gives screen readers the same numbers as a table", () => {
    render(<HealthTrendsChart data={DATA} />);

    const table = screen.getByRole("table", { name: "Health records per month" });
    const rows = within(table).getAllByRole("row").slice(1); // skip header

    expect(rows.map((row) => row.textContent)).toEqual(["May0", "Jun1", "Jul0", "Aug0", "Sep1", "Oct2"]);
  });

  it("summarizes the window in plain words", () => {
    render(<HealthTrendsChart data={DATA} />);

    expect(screen.getByText(/4 records from May to Oct\. Busiest month: Oct \(2\)\./)).toBeTruthy();
  });

  it("uses the singular for a single record", () => {
    render(<HealthTrendsChart data={ZEROS.map((p, i) => (i === 5 ? { ...p, records: 1 } : p))} />);

    expect(screen.getByText(/1 record from May to Oct/)).toBeTruthy();
  });

  it("repairs bad numbers instead of crashing", () => {
    const messy = [
      { month: "May", records: -3 },
      { month: "Jun", records: 2.7 },
      { month: "Jul", records: Number.NaN },
      { month: "Aug", records: Number.POSITIVE_INFINITY },
    ];

    const { container } = render(<HealthTrendsChart data={messy} />);

    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
    expect(screen.getByText(/2 records from May to Aug/)).toBeTruthy();
  });
});

/* ============================================================
   NO DUPLICATE CHROME
   ============================================================ */

describe("layout", () => {
  it("renders no title of its own (the parent card already has one)", () => {
    render(<HealthTrendsChart data={DATA} />);

    expect(screen.queryByText("Monthly Health Trends")).toBeNull();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });
});