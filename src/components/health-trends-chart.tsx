"use client";

import { TrendingUp } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface HealthTrendPoint {
  month: string;
  records: number;
}

interface HealthTrendsChartProps {
  data?: HealthTrendPoint[];
}

const chartConfig = {
  records: {
    label: "Health Records",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

function getMonthRange(data: HealthTrendPoint[]): string {
  if (data.length === 0) {
    return "No historical data";
  }

  return `${data[0].month} - ${data[data.length - 1].month}`;
}

export default function HealthTrendsChart({
  data = [],
}: HealthTrendsChartProps) {
  const hasData = data.length > 0;
  const monthRange = getMonthRange(data);

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="px-0">
        <CardTitle>Monthly Health Trends</CardTitle>

        <CardDescription>
          Number of health records recorded each month.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        {hasData ? (
          <ChartContainer
            config={chartConfig}
            className="h-[300px] w-full"
          >
            <LineChart
              accessibilityLayer
              data={data}
              margin={{
                top: 12,
                right: 12,
                left: 0,
                bottom: 8,
              }}
            >
              <CartesianGrid
                vertical={false}
              />

              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />

              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={32}
              />

              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                  />
                }
              />

              <Line
                dataKey="records"
                type="monotone"
                stroke="var(--color-records)"
                strokeWidth={2}
                dot={{
                  r: 4,
                }}
                activeDot={{
                  r: 6,
                }}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed">
            <div className="text-center">
              <p className="font-medium">
                No health trends yet
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                Add health records to see your monthly trends.
              </p>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="px-0">
        {hasData ? (
          <div className="flex w-full items-start gap-2 text-sm">
            <div className="grid gap-2">
              <div className="flex items-center gap-2 font-medium leading-none">
                Health records over time
                <TrendingUp className="h-4 w-4" />
              </div>

              <div className="leading-none text-muted-foreground">
                {monthRange}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Trend data will appear here when records are available.
          </div>
        )}
      </CardFooter>
    </Card>
  );
}