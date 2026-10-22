"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

const THEMES = { light: "", dark: ".dark" } as const

export type ChartConfig = {
  [k: string]: {
    label?: React.ReactNode
    icon?: React.ComponentType<{ className?: string }>
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Partial<Record<keyof typeof THEMES, string>> }
  )
}

type ChartContextProps = { config: ChartConfig }
const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) throw new Error("useChart must be used within a <ChartContainer />")
  return context
}

/* -------------------------------------------------------------------------- */
/* Chart Container                                                            */
/* -------------------------------------------------------------------------- */

type ChartContainerProps = React.ComponentProps<"div"> & {
  ref?: React.Ref<HTMLDivElement>
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"]
  /** Minimum pixel height passed to ResponsiveContainer. Prevents the
   *  "width(0) / height(0)" recharts warning when a parent has no
   *  explicit height on first paint. */
  minHeight?: number
  /** CSP nonce for the injected <style> tag. Wire this to your
   *  middleware-generated nonce once CSP is added (next.config.ts). */
  nonce?: string
}

function ChartContainer({
  id,
  className,
  children,
  config,
  minHeight = 200,
  nonce,
  ref,
  ...props
}: ChartContainerProps) {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs",
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
          "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-layer]:outline-none",
          "[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border",
          "[&_.recharts-radial-bar-background-sector]:fill-muted",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted",
          "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-border",
          "[&_.recharts-sector[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-sector]:outline-none",
          "[&_.recharts-surface]:outline-none",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} nonce={nonce} />
        <RechartsPrimitive.ResponsiveContainer minHeight={minHeight}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

/* -------------------------------------------------------------------------- */
/* Chart Style                                                                */
/* -------------------------------------------------------------------------- */

function ChartStyle({
  id,
  config,
  nonce,
}: {
  id: string
  config: ChartConfig
  nonce?: string
}) {
  const colorConfig = Object.entries(config).filter(
    ([, itemConfig]) => itemConfig.theme || itemConfig.color
  )
  if (!colorConfig.length) return null

  return (
    <style
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ?? itemConfig.color
    return color ? `  --color-${key}: ${color};` : null
  })
  .filter(Boolean)
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Shared payload types (loose on purpose — recharts 3 payload value shapes   */
/* vary by chart type: number, string, or array for stacked/area series)      */
/* -------------------------------------------------------------------------- */

type ChartTooltipItem = {
  dataKey?: unknown
  name?: unknown
  value?: unknown
  color?: string
  payload?: Record<string, unknown>
}

type ChartTooltipFormatter = (
  value: unknown,
  name: unknown,
  item: ChartTooltipItem,
  index: number,
  payload: Record<string, unknown>
) => React.ReactNode

type ChartTooltipLabelFormatter = (
  label: unknown,
  payload: readonly ChartTooltipItem[]
) => React.ReactNode

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

const ChartTooltip = RechartsPrimitive.Tooltip

type ChartTooltipContentProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>
  active?: boolean
  payload?: readonly ChartTooltipItem[]
  label?: React.ReactNode
  labelFormatter?: ChartTooltipLabelFormatter
  formatter?: ChartTooltipFormatter
  hideLabel?: boolean
  hideIndicator?: boolean
  indicator?: "line" | "dot" | "dashed"
  nameKey?: string
  labelKey?: string
  labelClassName?: string
  color?: string

  // Recharts-internal props it injects into a custom `content` element.
  // Destructured below so they never reach the DOM via {...props}.
  cursor?: unknown
  allowEscapeViewBox?: unknown
  animationDuration?: unknown
  animationEasing?: unknown
  axisId?: unknown
  contentStyle?: unknown
  filterNull?: unknown
  includeHidden?: unknown
  isAnimationActive?: unknown
  itemSorter?: unknown
  itemStyle?: unknown
  labelStyle?: unknown
  reverseDirection?: unknown
  useTranslate3d?: unknown
  wrapperStyle?: unknown
  activeIndex?: unknown
  accessibilityLayer?: unknown
  coordinate?: unknown
  viewBox?: unknown
  position?: unknown
  offset?: unknown
  animationId?: unknown
  trigger?: unknown
}

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  ref,

  // Discard all Recharts-internal props — never forward to the DOM.
  cursor: _cursor,
  allowEscapeViewBox: _allowEscapeViewBox,
  animationDuration: _animationDuration,
  animationEasing: _animationEasing,
  axisId: _axisId,
  contentStyle: _contentStyle,
  filterNull: _filterNull,
  includeHidden: _includeHidden,
  isAnimationActive: _isAnimationActive,
  itemSorter: _itemSorter,
  itemStyle: _itemStyle,
  labelStyle: _labelStyle,
  reverseDirection: _reverseDirection,
  useTranslate3d: _useTranslate3d,
  wrapperStyle: _wrapperStyle,
  activeIndex: _activeIndex,
  accessibilityLayer: _accessibilityLayer,
  coordinate: _coordinate,
  viewBox: _viewBox,
  position: _position,
  offset: _offset,
  animationId: _animationId,
  trigger: _trigger,

  ...props
}: ChartTooltipContentProps) {
  const { config } = useChart()

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null

    const [item] = payload
    const key = String(labelKey || item.dataKey || item.name || "value")
    const itemConfig = getPayloadConfigFromPayload(config, item, key)

    const value =
      !labelKey && typeof label === "string"
        ? config[label]?.label || label
        : itemConfig?.label

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>
          {labelFormatter(value ?? label, payload)}
        </div>
      )
    }
    if (!value) return null
    return <div className={cn("font-medium", labelClassName)}>{value}</div>
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey])

  if (!active || !payload?.length) return null

  const nestLabel = payload.length === 1 && indicator !== "dot"

  return (
    <div
      ref={ref}
      className={cn(
        "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
        className
      )}
      {...props}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(nameKey || item.name || item.dataKey || "value")
          const itemConfig = getPayloadConfigFromPayload(config, item, key)
          const fillColor = getStringField(item.payload, "fill")
          const indicatorColor = color || fillColor || item.color

          return (
            <div
              key={`${String(item.dataKey)}-${index}`}
              className={cn(
                "flex w-full flex-wrap items-stretch gap-2",
                "[&>svg]:h-2.5 [&>svg]:w-2.5",
                "[&>svg]:text-muted-foreground",
                indicator === "dot" && "items-center"
              )}
            >
              {formatter && item.value !== undefined && item.name !== undefined ? (
                formatter(item.value, item.name, item, index, item.payload ?? {})
              ) : (
                <>
                  {itemConfig?.icon ? (
                    <itemConfig.icon />
                  ) : (
                    !hideIndicator && (
                      <div
                        className={cn("shrink-0 rounded-[2px]", "border-[--color-border]", "bg-[--color-bg]", {
                          "h-2.5 w-2.5": indicator === "dot",
                          "w-1": indicator === "line",
                          "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                          "my-0.5": nestLabel && indicator === "dashed",
                        })}
                        style={
                          {
                            "--color-bg": indicatorColor,
                            "--color-border": indicatorColor,
                          } as React.CSSProperties
                        }
                      />
                    )
                  )}
                  <div className={cn("flex flex-1 justify-between leading-none", nestLabel ? "items-end" : "items-center")}>
                    <div className="grid gap-1.5">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-muted-foreground">
                        {itemConfig?.label || String(item.name ?? "")}
                      </span>
                    </div>
                    {item.value !== undefined && item.value !== null && (
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {formatChartValue(item.value)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Legend                                                                     */
/* -------------------------------------------------------------------------- */

const ChartLegend = RechartsPrimitive.Legend

type ChartLegendItem = {
  dataKey?: unknown
  value?: unknown
  color?: string
}

type ChartLegendContentProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>
  payload?: readonly ChartLegendItem[]
  verticalAlign?: "top" | "middle" | "bottom"
  hideIcon?: boolean
  nameKey?: string
}

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
  ref,
  ...props
}: ChartLegendContentProps) {
  const { config } = useChart()
  if (!payload?.length) return null

  return (
    <div
      ref={ref}
      className={cn("flex items-center justify-center gap-4", verticalAlign === "top" ? "pb-3" : "pt-3", className)}
      {...props}
    >
      {payload.map((item, index) => {
        const key = String(nameKey || item.dataKey || "value")
        const itemConfig = getPayloadConfigFromPayload(config, item, key)

        return (
          <div
            key={`${String(item.value)}-${index}`}
            className={cn("flex items-center gap-1.5", "[&>svg]:h-3 [&>svg]:w-3", "[&>svg]:text-muted-foreground")}
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
            )}
            {itemConfig?.label}
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getStringField(record: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = record?.[field]
  return typeof value === "string" ? value : undefined
}

function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) return undefined

  const record = payload as Record<string, unknown>
  const nestedPayload =
    typeof record.payload === "object" && record.payload !== null
      ? (record.payload as Record<string, unknown>)
      : undefined

  let configLabelKey = key
  const directValue = record[key]

  if (typeof directValue === "string") {
    configLabelKey = directValue
  } else if (nestedPayload && typeof nestedPayload[key] === "string") {
    configLabelKey = nestedPayload[key] as string
  }

  return config[configLabelKey] ?? config[key]
}

/** Only formats actual numbers. Does NOT coerce numeric-looking strings
 *  (years, lab codes, IDs) — the old version broke e.g. "2024" -> "2,024". */
function formatChartValue(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString()
  return String(value)
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle }