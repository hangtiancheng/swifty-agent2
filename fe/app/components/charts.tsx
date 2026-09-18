import { createRef, customElement, property } from "@swifty.js/lit-jsx";
import type { Plugin } from "chart.js";
import Chart from "chart.js/auto";
import type { PropertyValues } from "lit";

import { LightElement } from "~/lib/light-element";
import { subscribeTheme } from "~/lib/theme";

/* Charts built on Chart.js (recharts replacement):
   - GroupedBarChart: four strategies × buckets, grouped bars (RAG eval)
   - ScanLineChart: threshold scan, two lines (observability · confidence calibration)
   - RingGauge: donut share (refusal rate)
   Pages recompute nothing; these only render the artifacts. Colors are resolved
   from the theme CSS vars at build time and the chart rebuilds on theme flip,
   so light/dark stay in sync automatically. */

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

const fmt2 = (v: number) => v.toFixed(2);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Series colors arrive as "var(--chart-n)" strings (theme-aware); Chart.js needs
    concrete colors, so resolve them against the current theme. */
function resolveColor(c: string): string {
  const m = /^var\((--[^)]+)\)$/.exec(c.trim());
  return m ? cssVar(m[1]) || c : c;
}

function fontStack(): string {
  return cssVar("--font-sans") || "sans-serif";
}

function tooltipStyle() {
  return {
    backgroundColor: cssVar("--inverse-surface"),
    titleColor: cssVar("--inverse-on-surface"),
    bodyColor: cssVar("--inverse-on-surface"),
    cornerRadius: 8,
    padding: 10,
    boxPadding: 4,
    titleFont: { family: fontStack() },
    bodyFont: { family: fontStack() },
  };
}

/** Dashed grid lines (Chart.js v4 has no grid-dash option): draw them by hand
    from the scale ticks, matching the original recharts strokeDasharray="3 3". */
function makeDashedGrid(vertical: boolean): Plugin {
  return {
    id: vertical ? "dashedGridV" : "dashedGridH",
    beforeDatasetsDraw(chart) {
      const area = chart.chartArea;
      const ctx = chart.ctx;
      const scale = vertical ? chart.scales.x : chart.scales.y;
      if (!scale) {
        return;
      }
      ctx.save();
      ctx.strokeStyle = cssVar("--outline-variant");
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (const tick of scale.ticks) {
        const p = scale.getPixelForValue(tick.value);
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(p, area.top);
          ctx.lineTo(p, area.bottom);
        } else {
          ctx.moveTo(area.left, p);
          ctx.lineTo(area.right, p);
        }
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

/* ---------- Base: canvas lifecycle + theme rebuild ---------- */

abstract class ChartElement extends LightElement {
  protected chart?: Chart;
  protected canvasRef = createRef<HTMLCanvasElement>();
  private unsubTheme?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubTheme = subscribeTheme(() => {
      this.rebuild();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubTheme?.();
    this.chart?.destroy();
    this.chart = undefined;
  }

  protected override updated(changed: PropertyValues): void {
    if (!this.chart) {
      this.build();
      return;
    }
    if (this.shouldRebuild(changed)) {
      this.rebuild();
    }
  }

  protected rebuild(): void {
    this.chart?.destroy();
    this.chart = undefined;
    this.build();
  }

  /** Rebuild (with entrance animation) when the data inputs change — same feel
      as the recharts originals, which re-animated on data changes. */
  protected shouldRebuild(_changed: PropertyValues): boolean {
    return false;
  }

  protected abstract build(): void;
}

/* ---------- Grouped bar chart ---------- */

@customElement("grouped-bar-chart")
export class GroupedBarChartEl extends ChartElement {
  @property({ attribute: false }) groups: BarGroup[] = [];
  @property({ attribute: false }) series: BarSeries[] = [];
  @property({ attribute: false }) getVal: (seriesKey: string, groupKey: string) => number | null | undefined =
    () => null;
  @property() ariaLabel = "Grouped bar chart";

  protected override shouldRebuild(changed: PropertyValues): boolean {
    return changed.has("groups") || changed.has("series") || changed.has("getVal");
  }

  protected override build(): void {
    const canvas = this.canvasRef.value;
    if (!canvas || !this.groups.length || !this.series.length) {
      return;
    }
    Chart.defaults.font.family = fontStack();
    const tickColor = cssVar("--on-surface-variant");
    const axisColor = cssVar("--outline-variant");

    // Numeric value on top of every bar (recharts LabelList equivalent)
    const valueLabels: Plugin<"bar"> = {
      id: "valueLabels",
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = `10px ${fontStack()}`;
        ctx.fillStyle = cssVar("--on-surface-variant");
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        chart.data.datasets.forEach((ds, di) => {
          const meta = chart.getDatasetMeta(di);
          if (meta.hidden) {
            return;
          }
          meta.data.forEach((bar, i) => {
            const v = ds.data[i];
            if (typeof v === "number") {
              ctx.fillText(v.toFixed(2), bar.x, bar.y - 4);
            }
          });
        });
        ctx.restore();
      },
    };

    this.chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: this.groups.map((g) => g.label),
        datasets: this.series.map((s) => ({
          label: s.label,
          // A null value renders no bar (not scored ≠ zero)
          data: this.groups.map((g) => {
            const v = this.getVal(s.key, g.key);
            return v === undefined || v === null ? null : v;
          }),
          backgroundColor: resolveColor(s.color),
          borderRadius: { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 },
          borderSkipped: false,
          maxBarThickness: 34,
          categoryPercentage: 0.78,
          barPercentage: 0.92,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
        layout: { padding: { top: 20, right: 14 } },
        scales: {
          x: {
            grid: { display: false },
            border: { color: axisColor },
            ticks: { color: tickColor, font: { size: 11 } },
          },
          y: {
            min: 0,
            max: 1,
            grid: { display: false },
            border: { display: false },
            ticks: {
              stepSize: 0.25,
              color: tickColor,
              font: { size: 11 },
              callback: (v: string | number) => fmt2(Number(v)),
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: tooltipStyle(),
        },
      },
      plugins: [makeDashedGrid(false), valueLabels],
    });
  }

  protected override render() {
    return (
      <div class="scroll-slim overflow-x-auto">
        <div class="relative h-[348px] min-w-[560px]" role="img" aria-label={this.ariaLabel}>
          <canvas ref={this.canvasRef} />
        </div>
      </div>
    );
  }
}

/* ---------- Threshold scan line chart ---------- */

export interface ScanPoint {
  t: number;
  pass_rate: number;
  leak_rate: number;
}

@customElement("scan-line-chart")
export class ScanLineChartEl extends ChartElement {
  @property({ attribute: false }) scan: ScanPoint[] = [];
  @property({ attribute: false }) pick?: number | null;
  @property({ attribute: false }) inUse?: number | null;

  protected override shouldRebuild(changed: PropertyValues): boolean {
    return changed.has("scan") || changed.has("pick") || changed.has("inUse");
  }

  protected override build(): void {
    const canvas = this.canvasRef.value;
    if (!canvas || !this.scan.length) {
      return;
    }
    Chart.defaults.font.family = fontStack();
    const tickColor = cssVar("--on-surface-variant");
    const axisColor = cssVar("--outline-variant");
    const pick = this.pick;
    const inUse = this.inUse;

    // Selected threshold (dashed primary) + threshold in use (violet) reference lines
    const refLines: Plugin<"line"> = {
      id: "refLines",
      afterDatasetsDraw(chart) {
        const xs = chart.scales.x;
        const area = chart.chartArea;
        const ctx = chart.ctx;
        const draw = (t: number, color: string, dash: number[], label?: string) => {
          const x = xs.getPixelForValue(t);
          if (x < area.left - 1 || x > area.right + 1) {
            return;
          }
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.setLineDash(dash);
          ctx.beginPath();
          ctx.moveTo(x, area.top);
          ctx.lineTo(x, area.bottom);
          ctx.stroke();
          if (label) {
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.font = `500 12px ${fontStack()}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(label, x, area.top - 6);
          }
          ctx.restore();
        };
        if (inUse !== null && inUse !== undefined && inUse !== pick) {
          draw(inUse, cssVar("--tertiary"), []);
        }
        if (pick !== null && pick !== undefined) {
          draw(pick, cssVar("--primary"), [5, 4], "Selected " + fmt2(pick));
        }
      },
    };

    this.chart = new Chart(canvas, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Answerable pass rate",
            data: this.scan.map((p) => ({ x: p.t, y: p.pass_rate })),
            borderColor: cssVar("--success"),
            backgroundColor: cssVar("--success"),
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.35,
          },
          {
            label: "Should-refuse leak rate",
            data: this.scan.map((p) => ({ x: p.t, y: p.leak_rate })),
            borderColor: cssVar("--error"),
            backgroundColor: cssVar("--error"),
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: "easeOutQuart" },
        layout: { padding: { top: 24, right: 14 } },
        scales: {
          x: {
            type: "linear",
            min: 0.05,
            max: 0.95,
            grid: { display: false },
            border: { color: axisColor },
            ticks: {
              color: tickColor,
              font: { size: 11 },
              callback: (v: string | number) => fmt2(Number(v)),
            },
            afterBuildTicks(axis) {
              axis.ticks = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map((v) => ({ value: v }));
            },
            title: {
              display: true,
              text: "Threshold t",
              color: tickColor,
              font: { size: 12, weight: 500 },
            },
          },
          y: {
            min: 0,
            max: 1,
            grid: { display: false },
            border: { display: false },
            ticks: {
              stepSize: 0.25,
              color: tickColor,
              font: { size: 11 },
              callback: (v: string | number) => fmt2(Number(v)),
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle(),
            callbacks: {
              title: (items) => (items.length ? "Threshold " + fmt2(items[0].parsed.x ?? 0) : ""),
            },
          },
        },
      },
      plugins: [makeDashedGrid(false), makeDashedGrid(true), refLines],
    });
  }

  protected override render() {
    return (
      <div class="scroll-slim overflow-x-auto">
        <div class="relative h-[300px] min-w-[560px]" role="img" aria-label="Threshold scan line chart">
          <canvas ref={this.canvasRef} />
        </div>
      </div>
    );
  }
}

/* ---------- Ring gauge (donut share) ---------- */

@customElement("ring-gauge")
export class RingGaugeEl extends ChartElement {
  /** rate is 0–1 */
  @property({ attribute: false }) rate = 0;
  @property({ attribute: false }) caption: unknown = "";

  protected override shouldRebuild(changed: PropertyValues): boolean {
    return changed.has("rate");
  }

  protected override build(): void {
    const canvas = this.canvasRef.value;
    if (!canvas) {
      return;
    }
    Chart.defaults.font.family = fontStack();
    const clamped = Math.max(0, Math.min(1, this.rate));
    this.chart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["rate", "rest"],
        datasets: [
          {
            data: [clamped, 1 - clamped],
            backgroundColor: [cssVar("--success"), cssVar("--surface-container-highest")],
            borderWidth: 0,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "78%",
        animation: { duration: 700, easing: "easeOutQuart" },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });
  }

  protected override render() {
    const pct = Math.round(Math.max(0, Math.min(1, this.rate)) * 100);
    return (
      <div class="bg-surface-container-low flex flex-col items-center justify-center rounded-lg p-4 text-center">
        <div class="relative h-[124px] w-[124px]">
          <canvas ref={this.canvasRef} />
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-headline-medium text-on-surface font-medium tabular-nums">
              {pct}
              <small class="text-on-surface-variant text-[11px]">%</small>
            </span>
            <span class="text-on-surface-variant text-label-small">Refusal rate</span>
          </div>
        </div>
        <div class="text-body-small text-on-surface-variant [&_b]:text-on-surface mt-2.5 leading-6 [&_b]:font-semibold">
          {this.caption}
        </div>
      </div>
    );
  }
}
