import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

const AXIS_TICK = { fill: "var(--muted)", fontSize: 11 };
const VALUE_TICK = { fill: "var(--ink)", fontSize: 10 };
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
    <div className="scroll-cat overflow-x-auto">
      <div className="min-w-[560px]" role="img" aria-label={ariaLabel ?? "Grouped bar chart"}>
        <ResponsiveContainer width="100%" height={348}>
          <BarChart data={data} margin={{ top: 20, right: 14, left: -8, bottom: 4 }} barGap={3}>
            <CartesianGrid
              stroke="var(--grid-line)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              interval={0}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--ink)", strokeWidth: 2 }}
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
                stroke="var(--ink)"
                strokeWidth={1.5}
                isAnimationActive={false}
                maxBarSize={34}
              >
                <LabelList
                  dataKey={s.key}
                  position="top"
                  formatter={(v: number | null) => (typeof v === "number" ? fmt2(v) : "")}
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
    <div className="scroll-cat overflow-x-auto">
      <div className="min-w-[560px]" role="img" aria-label="Threshold scan line chart">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={scan} margin={{ top: 16, right: 14, left: -6, bottom: 8 }}>
            <CartesianGrid stroke="var(--grid-line)" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0.05, 0.95]}
              ticks={[0.05, 0.2, 0.4, 0.6, 0.8, 0.95]}
              tickFormatter={fmt2}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--ink)", strokeWidth: 2 }}
              label={{
                value: "Threshold t",
                position: "insideBottom",
                offset: -4,
                fill: "var(--ink)",
                fontSize: 12,
                fontWeight: 700,
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
              stroke="var(--online)"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="leak_rate"
              stroke="var(--error)"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            {inUse !== null && inUse !== undefined && inUse !== pick ? (
              <ReferenceLine x={inUse} stroke="var(--violet)" strokeWidth={2} />
            ) : null}
            {pick !== null && pick !== undefined ? (
              <ReferenceLine
                x={pick}
                stroke="var(--ink)"
                strokeWidth={2}
                strokeDasharray="5 4"
                label={{
                  value: "Selected " + fmt2(pick),
                  position: "top",
                  fill: "var(--ink)",
                  fontSize: 12,
                  fontWeight: 700,
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
    <div className="flex flex-col items-center justify-center border-3 border-ink bg-paper p-3.5 text-center shadow-hard-sm">
      <div className="relative h-[118px] w-[118px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={[
                { name: "rate", value: clamped },
                { name: "rest", value: 1 - clamped },
              ]}
              dataKey="value"
              innerRadius={40}
              outerRadius={52}
              startAngle={90}
              endAngle={-270}
              stroke="var(--ink)"
              strokeWidth={1}
              isAnimationActive={false}
            >
              <Cell fill="var(--online)" />
              <Cell fill="var(--cream)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums">
            {Math.round(clamped * 100)}
            <small className="text-[10.5px] text-muted">%</small>
          </span>
          <span className="text-[10.5px] text-muted">Refusal rate</span>
        </div>
      </div>
      <div className="mt-2.5 text-xs leading-6 text-ink-soft [&_b]:font-bold [&_b]:text-ink">
        {caption}
      </div>
    </div>
  );
}
