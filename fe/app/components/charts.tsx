import type { ReactNode } from "react";

import { cn } from "~/lib/cn";

/* 手写 SVG 图表(原工程同款,改为声明式 React 组件):
   - GroupedBarChart:四策略 × 分桶分组柱状图(RAG 评估)
   - ScanLineChart:阈值扫描双折线(观测与成本 · 置信度校准)
   - RingGauge:圆环占比(拒答率)
   页面一个数都不重算,只把产物画出来。 */

export interface BarGroup {
  key: string;
  label: string;
  sub?: string;
  /** 总体组:前面画条虚线与分桶隔开 */
  agg?: boolean;
}

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

const NS_TEXT = {
  axis: "fill-muted text-[11px]",
  glabel: "fill-ink text-[12.5px] font-bold",
  gsub: "fill-muted text-[10px]",
  vlabel: "fill-ink text-[10.5px] tabular-nums",
};

/** 分组柱状图:null 值画 25% 透明度的矮柱并标 —(没评上 ≠ 0 分) */
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
  const W = 720;
  const H = 348;
  const M = { l: 40, r: 14, t: 20, b: 58 };
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const y0 = M.t + plotH;
  const gap = 26;
  const groupW = (plotW - gap * (groups.length - 1)) / groups.length;
  const pad = 9;
  const barGap = 4;
  const barW = (groupW - pad * 2 - barGap * (series.length - 1)) / series.length;
  const fmt = (v: number) => v.toFixed(2);

  return (
    <div className="scroll-cat overflow-x-auto">
      <svg
        className="block h-auto w-full min-w-[560px]"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel ?? "分组柱状图"}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const ty = y0 - t * plotH;
          return (
            <g key={t}>
              <line
                x1={M.l}
                y1={ty}
                x2={M.l + plotW}
                y2={ty}
                className="stroke-ink/15"
                strokeWidth={1}
              />
              <text
                x={M.l - 8}
                y={ty + 3.5}
                textAnchor="end"
                className={NS_TEXT.axis}
              >
                {t.toFixed(2)}
              </text>
            </g>
          );
        })}
        <line
          x1={M.l}
          y1={y0}
          x2={M.l + plotW}
          y2={y0}
          className="stroke-ink"
          strokeWidth={2.5}
        />
        {groups.map((b, i) => {
          const gx = M.l + i * (groupW + gap);
          const cx = gx + groupW / 2;
          return (
            <g key={b.key}>
              {b.agg ? (
                <line
                  x1={gx - gap / 2}
                  y1={M.t - 2}
                  x2={gx - gap / 2}
                  y2={y0}
                  className="stroke-ink"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              ) : null}
              {series.map((s, j) => {
                const raw = getVal(s.key, b.key);
                const val = raw ?? 0;
                const bx = gx + pad + j * (barW + barGap);
                const bh = Math.max(val * plotH, 2);
                const by = y0 - bh;
                return (
                  <g key={s.key}>
                    <rect
                      x={bx}
                      y={by}
                      width={barW}
                      height={bh}
                      fill={s.color}
                      className="stroke-ink"
                      strokeWidth={2}
                      shapeRendering="crispEdges"
                      opacity={raw === null || raw === undefined ? 0.25 : 1}
                    />
                    <text
                      x={bx + barW / 2}
                      y={by - 5}
                      textAnchor="middle"
                      className={NS_TEXT.vlabel}
                    >
                      {raw === null || raw === undefined ? "—" : fmt(raw)}
                    </text>
                  </g>
                );
              })}
              <text x={cx} y={y0 + 22} textAnchor="middle" className={NS_TEXT.glabel}>
                {b.label}
              </text>
              {b.sub ? (
                <text x={cx} y={y0 + 37} textAnchor="middle" className={NS_TEXT.gsub}>
                  {b.sub}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ChartLegend({
  items,
  bestKey,
  className,
}: {
  items: BarSeries[];
  bestKey?: string;
  className?: string;
}) {
  return (
    <div className={cn("mt-2.5 mb-0.5 flex flex-wrap gap-x-4 gap-y-1.5", className)}>
      {items.map((s) => (
        <span
          key={s.key}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs",
            s.key === bestKey && "font-bold",
          )}
        >
          <i
            className="h-3 w-3 border-2 border-ink"
            style={{ background: s.color }}
          />
          {s.label}
          {s.key === bestKey ? "(最佳)" : ""}
        </span>
      ))}
    </div>
  );
}

/** 阈值扫描:可答通过率 / 应拒放行率双折线 + 选定阈值(虚线)与在用阈值(紫线) */
export function ScanLineChart({
  scan,
  pick,
  inUse,
}: {
  scan: { t: number; pass_rate: number; leak_rate: number }[];
  pick?: number | null;
  inUse?: number | null;
}) {
  const W = 720;
  const H = 300;
  const M = { l: 42, r: 14, t: 16, b: 46 };
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const y0 = M.t + plotH;
  const xs = (t: number) => M.l + ((t - 0.05) / 0.9) * plotW;
  const ys = (v: number) => y0 - v * plotH;
  const line = (key: "pass_rate" | "leak_rate") =>
    scan.map((r) => xs(r.t).toFixed(1) + "," + ys(r[key]).toFixed(1)).join(" ");

  return (
    <div className="scroll-cat overflow-x-auto">
      <svg
        className="block h-auto w-full min-w-[560px]"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="阈值扫描折线图"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={M.l}
              y1={ys(t)}
              x2={M.l + plotW}
              y2={ys(t)}
              className="stroke-ink/15"
              strokeWidth={1}
            />
            <text x={M.l - 8} y={ys(t) + 3.5} textAnchor="end" className={NS_TEXT.axis}>
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={M.l} y1={y0} x2={M.l + plotW} y2={y0} className="stroke-ink" strokeWidth={2.5} />
        {[0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map((t) => (
          <text key={t} x={xs(t)} y={y0 + 20} textAnchor="middle" className={NS_TEXT.axis}>
            {t.toFixed(2)}
          </text>
        ))}
        <text x={M.l + plotW / 2} y={y0 + 38} textAnchor="middle" className={NS_TEXT.glabel}>
          阈值 t
        </text>
        <polyline points={line("pass_rate")} fill="none" strokeWidth={2.5} className="stroke-online" />
        <polyline points={line("leak_rate")} fill="none" strokeWidth={2.5} className="stroke-error" />
        {inUse !== null && inUse !== undefined && inUse !== pick ? (
          <line x1={xs(inUse)} y1={M.t} x2={xs(inUse)} y2={y0} className="stroke-violet" strokeWidth={2} />
        ) : null}
        {pick !== null && pick !== undefined ? (
          <g>
            <line
              x1={xs(pick)}
              y1={M.t}
              x2={xs(pick)}
              y2={y0}
              className="stroke-ink"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <text x={xs(pick) + 6} y={M.t + 12} className={NS_TEXT.glabel}>
              选定 {pick.toFixed(2)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/** 圆环占比:rate 0~1 */
export function RingGauge({
  rate,
  caption,
}: {
  rate: number;
  caption: ReactNode;
}) {
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex flex-col items-center justify-center border-3 border-ink bg-paper p-3.5 text-center shadow-hard-sm">
      <div className="relative h-[118px] w-[118px]">
        <svg width="118" height="118" viewBox="0 0 118 118" className="-rotate-90" aria-hidden>
          <circle cx="59" cy="59" r={R} fill="none" strokeWidth="13" className="stroke-cream" />
          <circle
            cx="59"
            cy="59"
            r={R}
            fill="none"
            strokeWidth="13"
            className="stroke-online"
            strokeDasharray={C.toFixed(1)}
            strokeDashoffset={(C * (1 - rate)).toFixed(1)}
            strokeLinecap="butt"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums">
            {Math.round(rate * 100)}
            <small className="text-[10.5px] text-muted">%</small>
          </span>
          <span className="text-[10.5px] text-muted">拒答率</span>
        </div>
      </div>
      <div className="mt-2.5 text-xs leading-6 text-ink-soft [&_b]:font-bold [&_b]:text-ink">
        {caption}
      </div>
    </div>
  );
}
