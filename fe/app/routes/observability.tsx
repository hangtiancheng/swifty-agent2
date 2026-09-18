import { customElement } from "@swifty.js/lit-jsx";

import "~/components/charts";
import "~/components/job-row";
import {
  MissingBox,
  PageLoading,
  PageShell,
  Panel,
  SectionHead,
  TableScroll,
  Tbl,
  Td,
  Th,
  Tr,
} from "~/components/ui";
import { api } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmt3, fmtTime, pctFmt, thousands } from "~/lib/format";
import { growOnce } from "~/lib/motion";
import { DataLoaderElement } from "~/lib/page-element";
import { ReadNote } from "~/lib/read-note";
import type { JobSpec } from "~/lib/types";

/* Each of the three reports renders exactly what /api/observability/overview
   serves: cost and calibration come from make-produced artifacts, trends from
   the eval_runs table — the page never recomputes a single number. Delta
   arrows are pairwise diffs over the same rows, not a separate dataset. */

const METRIC_LABEL: Record<string, string> = {
  recall_at_5: "Recall@5",
  recall_at_10: "Recall@10",
  mrr: "MRR",
  faithfulness: "Faithfulness",
  refusal_rate: "Refusal rate",
};
const DELTA_EPS = 0.005; // Same cutoff as the terminal trend table: movement below it counts as flat

interface CostRow {
  intent: string;
  count: number;
  tokens: number;
  avg_tokens: number;
  share: number;
}

interface CostBlock {
  present: boolean;
  status: string;
  job: JobSpec;
  make: string;
  hint: string | null;
  meta: { days?: number; generated_at?: string | null };
  rows: CostRow[];
  total_tokens: number | null;
  total_requests: number | null;
  top: CostRow | null;
  read_note: string | null;
}

interface TrendRun {
  id: number;
  triggered_by: string;
  dataset_size: number;
  metrics: Record<string, number | null>;
  created_at: string | null;
}

interface TrendBlock {
  present: boolean;
  status: string;
  job: JobSpec;
  make: string;
  hint?: string;
  note?: string;
  metric_names: string[];
  runs: TrendRun[];
  read_note: string | null;
}

interface DistStats {
  n: number;
  min: number;
  p25: number;
  p50: number;
  p75: number;
  max: number;
}

interface CalibrationBlock {
  present: boolean;
  status: string;
  job: JobSpec;
  make: string;
  hint?: string;
  weights: {
    top1: number;
    valid_count: number;
    margin: number;
    key_clause: number;
  };
  distribution: { answerable: DistStats; absent: DistStats };
  scan: { t: number; pass_rate: number; leak_rate: number }[];
  recommended: {
    threshold: number;
    youden_j: number;
    pass_rate: number;
    leak_rate: number;
  };
  read_note: string | null;
  in_use: number;
  in_sync: boolean;
}

interface Overview {
  cost: CostBlock;
  trend: TrendBlock;
  calibration: CalibrationBlock;
}

function Kpis({
  items,
}: {
  items: { label: string; val: unknown; unit?: string; sub: unknown }[];
}) {
  return (
    <div class="mt-1 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((k) => (
        <div class="bg-card shadow-e1 border-outline-variant rounded-lg border px-3 pt-2.5 pb-3">
          <div class="text-on-surface-variant text-[11.5px]">{k.label}</div>
          <div class="text-headline-small font-medium tabular-nums">
            {k.val}
            {k.unit ? <small class="ml-0.5 text-[13px]">{k.unit}</small> : null}
          </div>
          <div class="text-on-surface-variant text-[11.5px] leading-6">
            {k.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

function NoteBox({ title, children }: { title: string; children: unknown }) {
  return (
    <div class="bg-surface-container-low rounded-lg p-3">
      <h3 class="mb-1 text-[12.5px] font-medium">{title}</h3>
      <p class="text-on-surface-variant text-xs leading-7">{children}</p>
    </div>
  );
}

@customElement("observability-page")
export class ObservabilityPage extends DataLoaderElement<Overview> {
  protected override pageTitle = "MeowMeow Select · Observability";

  protected override load(): Promise<Overview> {
    return api<Overview>("/api/observability/overview");
  }

  /** Footer shared by all three panels: re-run button + log output, invoking the same make as the terminal */
  private jobFoot(block: { job: JobSpec; make: string }) {
    return (
      <div>
        <SectionHead>Re-run from this page</SectionHead>
        <job-row
          specs={[block.job]}
          onFinish={() => {
            void this.reload();
          }}
          note={block.make}
        ></job-row>
      </div>
    );
  }

  private costPanel(d: CostBlock) {
    const body: unknown[] = [];
    if (!d.present || !d.rows.length) {
      body.push(<MissingBox>{d.hint}</MissingBox>);
    } else {
      const m = d.meta;
      const top = d.top;
      body.push(
        Kpis({
          items: [
            {
              label: "Most expensive intent",
              val: top?.intent ?? "—",
              sub: top
                ? pctFmt(top.share) +
                  " of spend · avg " +
                  thousands(top.avg_tokens) +
                  " tokens/request"
                : "—",
            },
            {
              label: "Total tokens",
              val: thousands(d.total_tokens),
              sub:
                String(d.total_requests ?? 0) +
                " questions · last " +
                String(m.days ?? "—") +
                " days",
            },
            {
              label: "Intent routes",
              val: String(d.rows.length),
              sub: "Intents with traces in the window",
            },
            {
              label: "Last run",
              val: (m.generated_at ?? "—").slice(5),
              sub: "Page reads artifacts only; never queries Langfuse",
            },
          ],
        }),
      );
      body.push(
        <div class="mt-3.5 flex flex-col gap-3">
          {d.rows.map((r) => (
            <div>
              <div class="flex items-baseline justify-between gap-2 text-[12.5px]">
                <div>
                  <b class="font-semibold">{r.intent}</b>
                  <span class="text-on-surface-variant ml-2 text-[11px]">
                    {r.count} requests · avg {thousands(r.avg_tokens)} tokens
                  </span>
                </div>
                <div class="font-medium tabular-nums">
                  {pctFmt(r.share)} · {thousands(r.tokens)}
                </div>
              </div>
              <div class="bg-surface-container-highest mt-1 h-4 overflow-hidden rounded-full">
                <span
                  ref={(el: Element | undefined) => {
                    growOnce(el, `${String(Math.max(1.5, r.share * 100))}%`);
                  }}
                  class={cn(
                    "block h-full rounded-full",
                    top === r ? "bg-primary" : "bg-primary/40",
                  )}
                />
              </div>
            </div>
          ))}
        </div>,
      );
      body.push(<SectionHead>Details</SectionHead>);
      body.push(
        <TableScroll>
          <Tbl>
            <thead>
              <tr>
                <Th>Intent</Th>
                <Th>Requests</Th>
                <Th>Total tokens</Th>
                <Th>Avg tokens</Th>
                <Th>Share</Th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <Tr>
                  <Td>{r.intent}</Td>
                  <Td num>{r.count}</Td>
                  <Td num>{thousands(r.tokens)}</Td>
                  <Td num>{thousands(r.avg_tokens)}</Td>
                  <Td num>{pctFmt(r.share)}</Td>
                </Tr>
              ))}
            </tbody>
          </Tbl>
        </TableScroll>,
      );
      if (top) {
        const most = d.rows.reduce<CostRow>(
          (a, b) => (b.avg_tokens > a.avg_tokens ? b : a),
          d.rows[0],
        );
        body.push(
          <ReadNote
            note={d.read_note}
            fallback={
              <>
                <b>{top.intent}</b> accounts for <b>{pctFmt(top.share)}</b> of
                total spend — to cut cost, trim its prompt or move it to a
                smaller model first. The highest per-request average is{" "}
                <b>
                  {most.intent} {thousands(most.avg_tokens)}
                </b>{" "}
                tokens; a high average means one question triggers multiple
                model calls (multi-step ReAct tool chains do this), so it
                reflects chain length, not question volume.
              </>
            }
          />,
        );
      }
    }
    body.push(this.jobFoot(d));
    return (
      <Panel
        title="Intent cost ledger"
        pill={
          <span class="bg-secondary-container text-on-secondary-container inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap">
            Source: Langfuse
          </span>
        }
        lede="The intent-classification node tags every trace with an intent label; grouping tokens by that label shows which question types cost the most. To cut spend, target the most expensive route first — no need to swap models globally."
      >
        {body}
      </Panel>
    );
  }

  private trendPanel(d: TrendBlock) {
    const body: unknown[] = [];
    if (d.status === "error") {
      body.push(<MissingBox>Failed to load trend: {d.note ?? ""}</MissingBox>);
    } else if (!d.present) {
      body.push(<MissingBox>{d.hint}</MissingBox>);
    } else {
      const runs = d.runs;
      const latest = runs[0];
      const prev = runs[1];
      const drops = prev
        ? d.metric_names.filter(
            (n) =>
              (latest.metrics[n] ?? 0) < (prev.metrics[n] ?? 0) - DELTA_EPS,
          )
        : [];
      body.push(
        Kpis({
          items: [
            {
              label: "Runs recorded",
              val: String(runs.length),
              sub: "Keeps the last ten runs",
            },
            {
              label: "Latest run",
              val: fmt3(latest.metrics.faithfulness),
              sub: "Faithfulness · whether answers fabricate content",
            },
            {
              label: "Retrieval MRR",
              val: fmt3(latest.metrics.mrr),
              sub:
                latest.metrics.recall_at_5 !== undefined
                  ? "Recall@5 " + fmt3(latest.metrics.recall_at_5)
                  : "Recall@10 " + fmt3(latest.metrics.recall_at_10),
            },
            {
              label: "Vs. previous run",
              val: drops.length ? String(drops.length) : "0",
              unit: " metrics down",
              sub: drops.length
                ? drops.map((n) => METRIC_LABEL[n] ?? n).join(", ") + " dropped"
                : "Flat or up",
            },
          ],
        }),
      );
      body.push(<SectionHead unit="newest first">Last ten runs</SectionHead>);
      body.push(
        <TableScroll>
          <Tbl>
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Time</Th>
                <Th>Trigger</Th>
                <Th>Eval set</Th>
                {d.metric_names.map((n) => (
                  <Th>{METRIC_LABEL[n] ?? n}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => {
                const older = runs[i + 1];
                return (
                  <Tr>
                    <Td>#{r.id}</Td>
                    <Td>{fmtTime(r.created_at).slice(5, 16)}</Td>
                    <Td>{r.triggered_by}</Td>
                    <Td num>{r.dataset_size}</Td>
                    {d.metric_names.map((n) => {
                      const v = r.metrics[n];
                      const o = older ? older.metrics[n] : undefined;
                      let cls = "";
                      let arrow = "";
                      if (
                        v !== undefined &&
                        v !== null &&
                        o !== undefined &&
                        o !== null
                      ) {
                        const delta = v - o;
                        if (delta > DELTA_EPS) {
                          cls = "text-success";
                          arrow = "↑";
                        } else if (delta < -DELTA_EPS) {
                          cls =
                            "bg-error-container font-medium text-on-error-container";
                          arrow = "⚠↓";
                        } else {
                          cls = "text-on-surface-variant";
                          arrow = "→";
                        }
                      }
                      return (
                        <Td num class={cls}>
                          {fmt3(v)}
                          {arrow ? <span class="ml-1.5">{arrow}</span> : null}
                        </Td>
                      );
                    })}
                  </Tr>
                );
              })}
            </tbody>
          </Tbl>
        </TableScroll>,
      );
      body.push(
        <ReadNote
          note={d.read_note}
          fallback={
            drops.length ? (
              <>
                Versus the previous run,{" "}
                <b>{drops.map((n) => METRIC_LABEL[n] ?? n).join(", ")}</b> are
                declining. Check the recently approved items in the review queue
                first — a faithfulness drop is the classic sign of dirty
                knowledge entering the base.
              </>
            ) : (
              <>
                No metric regressed versus the previous run. The value of trends
                is not the absolute score of one run but{" "}
                <b>keeping the next run from dropping</b> — schedule it (cron,
                one run a day) so regressions get seen.
              </>
            )
          }
        />,
      );
    }
    body.push(this.jobFoot(d));
    return (
      <Panel
        title="Evaluation trends"
        pill={
          <span class="bg-secondary-container text-on-secondary-container inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap">
            Source: eval_runs table
          </span>
        }
        lede="The flywheel keeps writing into the Knowledge Base; the eval pipeline exists to prevent regressions. Each run reuses the rag eval set, scores land as one row, and the rows form the trend. If a review ever lets dirty knowledge in and drags faithfulness down, this table flags it first."
      >
        {body}
      </Panel>
    );
  }

  private calibrationPanel(d: CalibrationBlock) {
    const w = d.weights;
    const wnote = (
      <NoteBox title="How confidence is computed">
        Weighted from four signals: Top1 rerank score {w.top1} / valid evidence
        count {w.valid_count} / Top1–Top2 margin {w.margin} / key-clause hit{" "}
        {w.key_clause}. The weights are constants in code; calibration decides
        where to draw the line.
      </NoteBox>
    );
    const body: unknown[] = [];
    if (!d.present) {
      body.push(<MissingBox>{d.hint}</MissingBox>);
      body.push(<div>{wnote}</div>);
    } else {
      const rec = d.recommended;
      const dist = d.distribution;
      body.push(
        Kpis({
          items: [
            {
              label: "Recommended threshold",
              val: rec.threshold.toFixed(2),
              sub:
                "Youden J " +
                fmt3(rec.youden_j) +
                " · the line that best separates the two groups",
            },
            {
              label: "Threshold in use",
              val: Number(d.in_use).toFixed(2),
              sub: d.in_sync
                ? "Matches the recommendation"
                : "Out of sync with the recommendation — backfill app/config.py",
            },
            {
              label: "Answerable pass rate",
              val: pctFmt(rec.pass_rate),
              sub: "Share the base can answer whose recall was strong enough",
            },
            {
              label: "Should-refuse leak rate",
              val: pctFmt(rec.leak_rate),
              sub: "Share of out-of-scope questions let through to be answered",
            },
          ],
        }),
      );
      body.push(<SectionHead>Evidence confidence distribution</SectionHead>);
      body.push(
        <TableScroll>
          <Tbl>
            <thead>
              <tr>
                <Th>Question type</Th>
                <Th>Count</Th>
                <Th>Min</Th>
                <Th>p25</Th>
                <Th>Median</Th>
                <Th>p75</Th>
                <Th>Max</Th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Answerable (buckets A/B/C)", s: dist.answerable },
                { name: "Should-refuse (bucket D)", s: dist.absent },
              ].map(({ name, s }) => (
                <Tr>
                  <Td>{name}</Td>
                  <Td num>{s.n}</Td>
                  <Td num>{fmt3(s.min)}</Td>
                  <Td num>{fmt3(s.p25)}</Td>
                  <Td num>{fmt3(s.p50)}</Td>
                  <Td num>{fmt3(s.p75)}</Td>
                  <Td num>{fmt3(s.max)}</Td>
                </Tr>
              ))}
            </tbody>
          </Tbl>
        </TableScroll>,
      );
      body.push(
        <SectionHead unit="0.05 → 0.95, step 0.01">Threshold scan</SectionHead>,
      );
      body.push(
        <div class="mt-2.5 mb-0.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {[
            { label: "Answerable pass rate", color: "bg-success" },
            { label: "Should-refuse leak rate", color: "bg-error" },
            { label: "Selected threshold", color: "bg-primary" },
            { label: "Threshold in use", color: "bg-tertiary" },
          ].map(({ label, color }) => (
            <span class="text-on-surface-variant inline-flex items-center gap-1.5">
              <i class={cn("h-3 w-3 rounded-full", color)} />
              {label}
            </span>
          ))}
        </div>,
      );
      body.push(
        <div>
          <scan-line-chart
            scan={d.scan}
            pick={rec.threshold}
            inUse={d.in_use}
          ></scan-line-chart>
        </div>,
      );
      body.push(
        <ReadNote
          note={d.read_note}
          fallback={
            <>
              The red line drops steeply, then flattens: raising the threshold
              to <b>{rec.threshold.toFixed(2)}</b> drives the should-refuse leak
              rate to zero — no out-of-scope question gets through — at the cost
              of <b>{pctFmt(1 - rec.pass_rate)}</b> of answerable questions
              wrongly blocked. Blocked ones fall back into the low-confidence
              pool, which is exactly flywheel fuel, so the trade pays off. To
              loosen it, move the line left — but accept that some out-of-scope
              questions will get answered anyway.
            </>
          }
        />,
      );
      body.push(
        <div class="mt-3.5 grid gap-3.5 md:grid-cols-2">
          {wnote}
          <NoteBox title='What "wrongly blocked answerable" means'>
            The base actually has the answer, but the evidence recalled that one
            time was too scattered (the base says "cat bed cleaning & care
            instructions" while the user asks "can I toss it in the washing
            machine?"), so the rerank score stays low and computed confidence
            falls under the line. The gate only sees evidence scores, not that
            the base has an answer, so it treats the question as unanswerable.
            The question lands in the pool, gets merged, reviewed, and added to
            the Knowledge Base — next time the same phrasing recalls fine.
          </NoteBox>
        </div>,
      );
    }
    body.push(this.jobFoot(d));
    return (
      <Panel
        title="Confidence threshold calibration"
        pill={
          <span class="bg-secondary-container text-on-secondary-container inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap">
            Live run on rag eval set
          </span>
        }
        lede="Where the fallback gate draws the line is not guesswork. Evidence confidence is computed for both the answerable and should-refuse groups in the eval set, then thresholds are scanned to find the line that separates the two best."
      >
        {body}
      </Panel>
    );
  }

  protected override render() {
    return (
      <PageShell
        title="Observability"
        sub="Where spend goes by question type · whether metrics are regressing · how the fallback threshold is set"
        active="/observability"
        actions={this.refreshBtn()}
      >
        {this.loadError ? (
          <MissingBox class="mt-4">
            Failed to load data: {this.loadError}
          </MissingBox>
        ) : this.data ? (
          <>
            {this.costPanel(this.data.cost)}
            {this.trendPanel(this.data.trend)}
            {this.calibrationPanel(this.data.calibration)}
          </>
        ) : (
          <PageLoading />
        )}
      </PageShell>
    );
  }
}
