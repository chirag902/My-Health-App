"use client";

import { memo, useMemo, useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  buildCountAxis,
  sanitizeTrendData,
  summarizeTrends,
  type HealthTrendPoint,
} from "@/lib/health-records-utils";

// Re-exported so existing `import { HealthTrendPoint } from "./health-trends-chart"` keeps working.
export type { HealthTrendPoint };

interface HealthTrendsChartProps {
  data?: readonly HealthTrendPoint[];
}

/** Module-level so the default does not create a new array (and a new memo key) on every render. */
const NO_DATA: readonly HealthTrendPoint[] = [];

const chartConfig = {
  records: {
    label: "Health records",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

/* ============================================================
   REDUCED MOTION
   The line-draw animation is skipped for people who asked their OS to reduce motion.
   ============================================================ */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

function getReducedMotionSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotionSnapshot, () => false);
}

/* ============================================================
   COMPONENT
   The parent card already provides the title and description, so this renders only the chart.
   ============================================================ */

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function HealthTrendsChart({ data = NO_DATA }: HealthTrendsChartProps) {
  const points = useMemo(() => sanitizeTrendData(data), [data]);
  const summary = useMemo(() => summarizeTrends(points), [points]);
  const yAxis = useMemo(
    () => buildCountAxis(Math.max(0, ...points.map((point) => point.records))),
    [points]
  );
  const reducedMotion = usePrefersReducedMotion();

  /*
   * "No points" is not the only empty case: the parent passes a full six-month window, so an
   * account with zero records arrives as six zeros. A flat line at 0 looks like a broken chart.
   */
  if (points.length === 0 || summary.total === 0) {
    return (
      <div
        role="status"
        className="flex h-[300px] items-center justify-center rounded-lg border border-dashed"
      >
        <div className="px-4 text-center">
          <p className="font-medium">No health records yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your monthly record counts will appear here once you add records.
          </p>
        </div>
      </div>
    );
  }

  return (
    <figure
      className="w-full"
      aria-label={`Line chart of health records per month, from ${summary.first} to ${summary.last}`}
    >
      <ChartContainer config={chartConfig} className="h-[300px] w-full">
        <LineChart
          accessibilityLayer
          data={points}
          margin={{ top: 12, right: 12, left: 0, bottom: 8 }}
        >
          <CartesianGrid vertical={false} />

          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />

          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={32}
            // Explicit, evenly spaced whole-number ticks (recharts' "auto" pads a max of 1 up to 4).
            domain={[0, yAxis.max]}
            ticks={yAxis.ticks}
          />

          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />

          <Line
            dataKey="records"
            type="monotone"
            stroke="var(--color-records)"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
            isAnimationActive={!reducedMotion}
          />
        </LineChart>
      </ChartContainer>

      {/* Screen-reader alternative: the same numbers as a table. */}
      <table className="sr-only">
        <caption>Health records per month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Records</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <th scope="row">{point.month}</th>
              <td>{point.records}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <figcaption className="mt-3 text-sm text-muted-foreground">
        {plural(summary.total, "record")} from {summary.first} to {summary.last}.
        {summary.peak ? ` Busiest month: ${summary.peak.month} (${summary.peak.records}).` : ""}
      </figcaption>
    </figure>
  );
}

export default memo(HealthTrendsChart);