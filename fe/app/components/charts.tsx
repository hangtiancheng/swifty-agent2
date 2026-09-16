import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

/* Declarative charts built on recharts (no hand-written SVG):
   - GroupedBarChart: four strategies × buckets, grouped bars (RAG eval)
   - ScanLineChart: threshold scan, two lines (observability · confidence calibration)
   - RingGauge: donut share (refusal rate)
   Pages recompute nothing; these only render the artifacts. Colors use the theme
   CSS vars so light/dark flip automatically. */

export interface BarGroup {
  key: string;
  label: string;
  sub?: string;
  /** Aggregate group (e.g. "overall"); kept for callers that filter on it. */
  agg?: boolean;
}

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

const AXIS_TICK = { fill: "var(--on-surface-variant)", fontSize: 11 };
const VALUE_TICK = { fill: "var(--on-surface-variant)", fontSize: 10 };
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const fmt2 = (v: number) => v.toFixed(2);

/** Grouped bar chart. A null value renders no bar (not scored ≠ zero). */
export function GroupedBarChart({
  groups,
  series,
  getVal,
  ariaLabel,
}: {
  groups: BarGroup[];
  series: BarSeries[];
  getVal: (seriesKey: string, groupKey: string) => number | null | undefined;
  ariaLabel?: string;
}) {
  const data = groups.map((g) => {
    const row: Record<string, string | number | null> = { label: g.label };
    for (const s of series) {
      const v = getVal(s.key, g.key);
      row[s.key] = v === undefined ? null : v;
    }
    return row;
  });

  return (
    <div className="scroll-slim overflow-x-auto">
      <div
        className="min-w-[560px]"
        role="img"
        aria-label={ariaLabel ?? "Grouped bar chart"}
      >
        <ResponsiveContainer width="100%" height={348}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 14, left: -8, bottom: 4 }}
            barGap={4}
          >
            <CartesianGrid
              stroke="var(--outline-variant)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              interval={0}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--outline-variant)", strokeWidth: 1 }}
            />
            <YAxis
              domain={[0, 1]}
              ticks={Y_TICKS}
              tickFormatter={fmt2}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color}
                radius={[5, 5, 0, 0]}
                isAnimationActive={true}
                animationDuration={600}
                maxBarSize={34}
              >
                <LabelList
                  dataKey={s.key}
                  position="top"
                  formatter={(v: unknown) =>
                    typeof v === "number" ? fmt2(v) : ""
                  }
                  style={VALUE_TICK}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Threshold scan: answerable pass rate / should-refuse leak rate, plus the
    selected threshold (dashed) and the threshold in use (violet). */
export function ScanLineChart({
  scan,
  pick,
  inUse,
}: {
  scan: { t: number; pass_rate: number; leak_rate: number }[];
  pick?: number | null;
  inUse?: number | null;
}) {
  return (
    <div className="scroll-slim overflow-x-auto">
      <div
        className="min-w-[560px]"
        role="img"
        aria-label="Threshold scan line chart"
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={scan}
            margin={{ top: 16, right: 14, left: -6, bottom: 8 }}
          >
            <CartesianGrid
              stroke="var(--outline-variant)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0.05, 0.95]}
              ticks={[0.05, 0.2, 0.4, 0.6, 0.8, 0.95]}
              tickFormatter={fmt2}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--outline-variant)", strokeWidth: 1 }}
              label={{
                value: "Threshold t",
                position: "insideBottom",
                offset: -4,
                fill: "var(--on-surface-variant)",
                fontSize: 12,
                fontWeight: 500,
              }}
            />
            <YAxis
              domain={[0, 1]}
              ticks={Y_TICKS}
              tickFormatter={fmt2}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Line
              type="monotone"
              dataKey="pass_rate"
              stroke="var(--success)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={true}
              animationDuration={700}
            />
            <Line
              type="monotone"
              dataKey="leak_rate"
              stroke="var(--error)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={true}
              animationDuration={700}
            />
            {inUse !== null && inUse !== undefined && inUse !== pick ? (
              <ReferenceLine
                x={inUse}
                stroke="var(--tertiary)"
                strokeWidth={2}
              />
            ) : null}
            {pick !== null && pick !== undefined ? (
              <ReferenceLine
                x={pick}
                stroke="var(--primary)"
                strokeWidth={2}
                strokeDasharray="5 4"
                label={{
                  value: "Selected " + fmt2(pick),
                  position: "top",
                  fill: "var(--primary)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Donut share gauge; rate is 0–1. */
export function RingGauge({
  rate,
  caption,
}: {
  rate: number;
  caption: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, rate));
  return (
    <div className="bg-surface-container-low flex flex-col items-center justify-center rounded-lg p-4 text-center">
      <div className="relative h-[124px] w-[124px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={[
                { name: "rate", value: clamped, fill: "var(--success)" },
                {
                  name: "rest",
                  value: 1 - clamped,
                  fill: "var(--surface-container-highest)",
                },
              ]}
              dataKey="value"
              innerRadius={44}
              outerRadius={56}
              startAngle={90}
              endAngle={-270}
              cornerRadius={6}
              strokeWidth={0}
              isAnimationActive={true}
              animationDuration={700}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-headline-medium text-on-surface font-medium tabular-nums">
            {Math.round(clamped * 100)}
            <small className="text-on-surface-variant text-[11px]">%</small>
          </span>
          <span className="text-on-surface-variant text-label-small">
            Refusal rate
          </span>
        </div>
      </div>
      <div className="text-body-small text-on-surface-variant [&_b]:text-on-surface mt-2.5 leading-6 [&_b]:font-semibold">
        {caption}
      </div>
    </div>
  );
}
