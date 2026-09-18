import { customElement, state } from "@swifty.js/lit-jsx";

import "~/components/job-row";
import { toast } from "~/components/toast";
import {
  Btn,
  BtnLink,
  GateBar,
  MissingBox,
  PageLoading,
  PageShell,
  Panel,
  Pill,
  ScoreCell,
  Stat,
  TableScroll,
  Tbl,
  Td,
  Th,
  Tip,
  Tr,
  type PillTone,
} from "~/components/ui";
import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtTime } from "~/lib/format";
import { growOnce } from "~/lib/motion";
import { DataLoaderElement } from "~/lib/page-element";
import type { JobSpec } from "~/lib/types";

/* Classifier eval detail: per-class P/R/F1, tolerance red lines, confusion matrix, threshold. */

interface ClassMetric {
  name: string;
  severity: string; // backend enum: strict | medium | lenient
  p: number;
  r: number;
  f1: number;
  support: number;
  red_line: number | null;
  passed: boolean;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
}

interface EvalReport {
  present: boolean;
  hint?: string;
  test_size?: number;
  threshold?: number;
  ran_at?: string;
  micro?: { p: number; r: number; f1: number };
  macro?: { p: number; r: number; f1: number };
  classes?: ClassMetric[];
  red_line_passed?: boolean;
  total_fp?: number;
  total_fn?: number;
  total_cells?: number;
}

interface ScanReport {
  present: boolean;
  hint?: string;
  scan?: { threshold: number; micro_f1: number }[];
  best_threshold?: number;
  best_micro_f1?: number;
  in_use_threshold?: number | null;
  consistent?: boolean;
  val_size?: number;
  ran_at?: string;
}

interface EvalData {
  eval: EvalReport;
  scan: ScanReport;
  threshold_in_use: number | null;
  severity: Record<string, string>;
  classifier: { online: boolean; detail?: unknown };
}

interface ClassifyResult {
  text: string;
  threshold: number | null;
  labels: string[];
  scores: { label: string; score: number; hit: boolean }[];
  fallback: boolean;
}

interface PageData {
  d: EvalData;
  jobs: JobSpec[];
}

// Keys are backend enum values (severity from taxonomy.ts) and must match the API
// exactly; tones and labels are display-only.
const SEV_TONE: Record<string, PillTone> = {
  strict: "sev-strict",
  medium: "sev-medium",
  lenient: "sev-lenient",
};

const SEV_LABEL: Record<string, string> = {
  strict: "Strict",
  medium: "Medium",
  lenient: "Lenient",
};

@customElement("acceptance-eval-page")
export class AcceptanceEvalPage extends DataLoaderElement<PageData> {
  @state() private tryText = "Bought too big, want to return";
  @state() private tryResult: ClassifyResult | null = null;
  @state() private trying = false;
  private autoRan = false;

  protected override pageTitle = "MeowMeow Select · Acceptance Eval";

  protected override async load(): Promise<PageData> {
    const [d, j] = await Promise.all([api<EvalData>("/api/acceptance/eval"), api<{ jobs: JobSpec[] }>("/api/jobs")]);
    return { d, jobs: j.jobs };
  }

  protected override updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    // Auto-run once when the classifier is online so the multi-label behavior is visible right away
    if (changed.has("data") && this.data && !this.autoRan && this.data.d.classifier.online) {
      this.autoRan = true;
      void this.tryIt("Bought too big, want to return");
    }
  }

  private async tryIt(text: string): Promise<void> {
    const t = text.trim();
    if (!t) {
      toast("Type a sentence first", true);
      return;
    }
    this.trying = true;
    try {
      this.tryResult = await api<ClassifyResult>("/api/acceptance/classify", jsonPost({ text: t }));
    } catch (e) {
      toast("Classify failed: " + errMsg(e), true);
      this.tryResult = null;
    } finally {
      this.trying = false;
    }
  }

  protected override render() {
    if (this.loadError) {
      return (
        <PageShell title="Acceptance Eval" active="/acceptance/eval">
          <MissingBox class="mt-4">Failed to load data: {this.loadError}</MissingBox>
        </PageShell>
      );
    }
    if (!this.data) {
      return (
        <PageShell title="Acceptance Eval" active="/acceptance/eval">
          <PageLoading />
        </PageShell>
      );
    }
    const { d, jobs } = this.data;
    const ev = d.eval;
    const scan = d.scan;
    const jobSpecs = Object.fromEntries(jobs.map((j) => [j.name, j]));
    const gap = ev.present && ev.micro && ev.macro ? Math.abs(ev.micro.f1 - ev.macro.f1) : 0;

    return (
      <PageShell
        title="Acceptance Eval"
        sub="Per-class P/R/F1 · tolerance red lines · confusion matrix · threshold"
        active="/acceptance/eval"
        actions={this.refreshBtn()}
      >
        <GateBar>
          {ev.present ? (
            <>
              <Stat label="Test set" value={String(ev.test_size ?? 0) + " rows"} />
              <Stat label="Decision threshold" value={String(ev.threshold ?? "—")} />
              <Stat label="micro-F1" value={ev.micro?.f1.toFixed(3) ?? "—"} tone={ev.red_line_passed ? "pass" : undefined} />
              <Stat label="macro-F1" value={ev.macro?.f1.toFixed(3) ?? "—"} />
              <Stat
                label="Tolerance red line"
                value={ev.red_line_passed ? "All pass" : "Some fail"}
                tone={ev.red_line_passed ? "pass" : "fail"}
              />
              <Stat label="Evaluated at" value={fmtTime(ev.ran_at).slice(5, 16)} small />
            </>
          ) : (
            <Stat label="Eval artifact" value="Not generated" tone="fail" />
          )}
        </GateBar>

        {/* ① micro vs macro */}
        <Panel
          title="Overall scores: micro and macro side by side"
          lede="micro ignores classes — every right and wrong call across all 17 classes goes into one big bucket, so large classes dominate. macro scores per class — each of the 17 classes gets its own F1, then a plain average, so small classes weigh the same as large ones. When the two numbers are close, performance is even across classes and no small class is hidden by a big class's good score."
        >
          {!ev.present ? (
            <MissingBox>{ev.hint}</MissingBox>
          ) : (
            <>
              <div class="flex flex-wrap gap-3.5">
                {[
                  { key: "micro", way: "No per-class split: all calls in one bucket", nums: ev.micro },
                  { key: "macro", way: "Per class: F1 for each of the 17, then averaged", nums: ev.macro },
                ].map(({ key, way, nums }) => (
                  <div class="bg-card border-outline-variant shadow-e1 min-w-65 flex-1 rounded-lg border p-3">
                    <h3 class="text-title-small text-on-surface">{key}</h3>
                    <div class="text-on-surface-variant text-[11px]">{way}</div>
                    <div class="mt-2 flex gap-3.5 text-[13px]">
                      {nums
                        ? (["p", "r", "f1"] as const).map((k) => (
                            <div>
                              <b class="block text-[17px] font-medium tabular-nums">{nums[k].toFixed(3)}</b>
                              {k.toUpperCase()}
                            </div>
                          ))
                        : null}
                    </div>
                  </div>
                ))}
              </div>
              <Tip>
                The two differ by {gap.toFixed(3)}:
                {gap <= 0.02
                  ? " scores are even across classes — no class is misbehaving behind the overall number."
                  : " the gap is large — micro high and macro low means some small class is being sacrificed; check the per-class table below to find which one."}
              </Tip>
            </>
          )}
          {jobSpecs["train-eval"] ? (
            <job-row
              specs={[jobSpecs["train-eval"]]}
              onFinish={() => {
                void this.reload();
              }}
              note={"Eval set: " + (ev.present ? String(ev.test_size ?? 0) + " rows" : "test.jsonl")}
            ></job-row>
          ) : null}
        </Panel>

        {/* ② per-class metrics + tolerance red lines */}
        <Panel
          title="Per-class metrics and tolerance red lines"
          pill={
            ev.present ? (
              ev.red_line_passed ? (
                <Pill tone="pass">All red lines passed</Pill>
              ) : (
                <Pill tone="fail">Red line breached</Pill>
              )
            ) : undefined
          }
          lede="The red line is not one per class but set by severity tier: the 17 classes are ranked Strict/Medium/Lenient by how much a misroute would skew the priority of downstream knowledge work. Strict needs F1 ≥ 0.9, Medium ≥ 0.8; Lenient errors hurt little, so no line is set (shown as — instead of ✅). support is how many test questions the class has, and it matches the confusion matrix: support = TP + FN."
        >
          {!ev.present ? (
            <MissingBox>{ev.hint}</MissingBox>
          ) : (
            <TableScroll>
              <Tbl>
                <thead>
                  <tr>
                    <Th>Class</Th>
                    <Th>Severity</Th>
                    <Th>P</Th>
                    <Th>R</Th>
                    <Th>F1</Th>
                    <Th>support</Th>
                    <Th>Red line</Th>
                  </tr>
                </thead>
                <tbody>
                  {(ev.classes ?? []).map((c) => (
                    <Tr bad={!c.passed}>
                      <Td>{c.name}</Td>
                      <Td>
                        <Pill tone={SEV_TONE[c.severity] ?? "plain"}>{SEV_LABEL[c.severity] ?? c.severity}</Pill>
                      </Td>
                      {ScoreCell({ v: c.p })}
                      {ScoreCell({ v: c.r })}
                      {ScoreCell({ v: c.f1, redLine: c.red_line })}
                      <Td num>{c.support}</Td>
                      <Td>
                        {c.red_line === null ? (
                          "—"
                        ) : (
                          <Pill tone={c.passed ? "pass" : "fail"}>
                            {String(c.red_line) + (c.passed ? " ✅" : " 🔴 needs data work")}
                          </Pill>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Tbl>
            </TableScroll>
          )}
        </Panel>

        {/* ③ threshold scan: nine candidate lines */}
        <Panel
          title="Decision threshold: nine-candidate scan replay"
          pill={
            scan.present ? (
              scan.consistent ? (
                <Pill tone="pass">Matches threshold in use</Pill>
              ) : (
                <Pill tone="fail">Differs from threshold in use</Pill>
              )
            ) : undefined
          }
          lede="The model scores each sentence against all 17 classes from 0 to 1; a class only counts as a hit above the line — that line is the decision threshold. Too low and labels get wrongly added; too high and real ones get missed. The validation set is scored once and the score table is fixed; nine candidates (0.30–0.70 in steps of 0.05) each replay the same table and the highest micro-F1 wins. On a tie the earlier candidate stays, so 0.45 beats 0.50."
        >
          {!scan.present ? (
            <MissingBox>{scan.hint}</MissingBox>
          ) : (
            <>
              <div class="flex flex-col gap-1.5">
                {(scan.scan ?? []).map((s) => {
                  const lo = Math.min(...(scan.scan ?? []).map((x) => x.micro_f1));
                  const hi = Math.max(...(scan.scan ?? []).map((x) => x.micro_f1));
                  const win = Math.abs(s.threshold - (scan.best_threshold ?? -1)) < 1e-9;
                  const inuse = Math.abs(s.threshold - (scan.in_use_threshold ?? -1)) < 1e-9;
                  return (
                    <div class="flex items-center gap-2.5 text-[12.5px]">
                      <span class={cn("w-14 text-right font-medium tabular-nums", inuse && "text-primary")}>
                        {s.threshold.toFixed(2)}
                        {inuse ? " ◀" : ""}
                      </span>
                      <span class="bg-surface-container-highest h-4.5 flex-1 overflow-hidden rounded-full">
                        <span
                          ref={(el: Element | undefined) => {
                            // Scores cluster in the third decimal; stretch across min~max so differences are visible
                            growOnce(
                              el,
                              `${String(hi > lo ? 8 + (92 * (s.micro_f1 - lo)) / (hi - lo) : 100)}%`,
                              { duration: 0.4 },
                            );
                          }}
                          class={cn("block h-full rounded-full", win ? "bg-success" : "bg-primary-container")}
                        />
                      </span>
                      <span class="w-18 tabular-nums">{s.micro_f1.toFixed(4)}</span>
                      <span class="text-on-surface-variant w-40 text-[11px]">
                        {(win ? "winner" : "") +
                          (inuse ? (win ? " · threshold.json in use" : "threshold.json in use") : "")}
                      </span>
                    </div>
                  );
                })}
              </div>
              <Tip>
                The replay picks {scan.best_threshold?.toFixed(2)} (validation micro-F1{" "}
                {scan.best_micro_f1?.toFixed(4)}); threshold.json in use: {scan.in_use_threshold}
                {scan.consistent
                  ? " — they match ✅, so the scan is reproducible, not hand-picked."
                  : " — mismatch 🔴: re-export or re-run the scan."}{" "}
                Validation set: {scan.val_size} rows, run at {fmtTime(scan.ran_at)}.
              </Tip>
            </>
          )}
          {jobSpecs["train-threshold-scan"] ? (
            <job-row
              specs={[jobSpecs["train-threshold-scan"]]}
              onFinish={() => {
                void this.reload();
              }}
              note={d.classifier.online ? ":8110 online" : ":8110 offline — start the service from the overview page first"}
            ></job-row>
          ) : null}
        </Panel>

        {/* ④ confusion matrix */}
        <Panel
          title="Per-class confusion matrix: the mistake book"
          lede="P/R/F1 are the scores; the confusion matrix is the mistake book — scores say how well the test went, the mistake book says which direction the errors lean and what to fix. TP: should label, labeled correctly. TN: should not label, not labeled. FP: false alarm (labeled when it should not be). FN: missed (should have been labeled but was not). What matters is not how many errors there are, but which way they lean."
        >
          {!ev.present ? (
            <MissingBox>{ev.hint}</MissingBox>
          ) : (
            <>
              <Tip class="mt-0">
                The full table has {ev.total_cells} yes/no questions ({ev.test_size} rows × 17 classes) with{" "}
                {String((ev.total_fp ?? 0) + (ev.total_fn ?? 0))} wrong: {ev.total_fp} false alarms and{" "}
                {ev.total_fn} misses.
              </Tip>
              <div class="mt-3 grid [grid-template-columns:repeat(auto-fill,minmax(158px,1fr))] gap-2.5">
                {(ev.classes ?? []).map((c) => (
                  <div class="bg-card border-outline-variant shadow-e1 overflow-hidden rounded-lg border">
                    <div
                      class={cn(
                        "border-outline-variant flex items-center gap-1.5 border-b px-2 py-1 text-[12.5px] font-medium",
                        (c.fp > 0 || c.fn > 0) && "bg-error-container text-on-error-container",
                      )}
                    >
                      {c.name}
                      <span class="flex-1" />
                      <Pill tone={SEV_TONE[c.severity] ?? "plain"}>{SEV_LABEL[c.severity] ?? c.severity}</Pill>
                    </div>
                    <div class="grid grid-cols-2">
                      {(
                        [
                          { k: "tn", label: "TN correctly skipped", cls: "text-on-surface-variant" },
                          { k: "fp", label: "FP false alarm", cls: "text-error" },
                          { k: "fn", label: "FN missed", cls: "text-error" },
                          { k: "tp", label: "TP correctly labeled", cls: "text-success" },
                        ] satisfies { k: keyof ClassMetric; label: string; cls: string }[]
                      ).map(({ k, label, cls }) => (
                        <div class="border-outline-variant border-r border-b px-2 py-1.5 text-[11.5px] whitespace-nowrap [&:nth-child(2n)]:border-r-0 [&:nth-child(n+3)]:border-b-0">
                          <b class={cn("block text-[15px] font-medium tabular-nums", cls)}>{String(c[k])}</b>
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div class="mt-3">
                <BtnLink to="/acceptance/errors" size="sm">
                  See the Error Analysis page for what exactly went wrong →
                </BtnLink>
              </div>
            </>
          )}
        </Panel>

        {/* ⑤ single-sentence classify demo */}
        <Panel
          title="Try a sentence: multi-label labeling live"
          pill={d.classifier.online ? <Pill tone="pass">:8110 online</Pill> : <Pill tone="missing">:8110 offline</Pill>}
          lede="Each of the 17 classes clears the line on its own — however many pass, that many labels get applied. That is where multi-label comes from. If none of the 17 scores passes, the highest-scoring class is used as a fallback so every question gets at least one label."
        >
          <div class="flex flex-wrap gap-2">
            <input
              type="text"
              class="border-outline text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-primary text-body-medium min-w-60 flex-1 rounded-sm border bg-transparent px-3.5 py-2.5 transition-[border-color,box-shadow] duration-200 outline-none focus:ring-1"
              placeholder="Type a user question, e.g. Bought too big, want to return"
              value={this.tryText}
              onInput={(e: Event) => {
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                this.tryText = (e.target as HTMLInputElement).value;
              }}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  void this.tryIt(this.tryText);
                }
              }}
            />
            <Btn
              variant="go"
              disabled={this.trying}
              onClick={() => {
                void this.tryIt(this.tryText);
              }}
            >
              {this.trying ? "Scoring…" : "Classify"}
            </Btn>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            {[
              "Bought too big, want to return",
              "Are the kibble pieces big — can a cat with bad teeth chew them?",
              "Can points cover shipping? And who pays return shipping?",
              "Do you take back old cat cages?",
            ].map((t) => (
              <Btn
                size="sm"
                title={t}
                onClick={() => {
                  this.tryText = t;
                  void this.tryIt(t);
                }}
              >
                {t.length > 14 ? t.slice(0, 14) + "…" : t}
              </Btn>
            ))}
          </div>
          {this.tryResult ? (
            <div>
              <div class="bg-surface-container-low mt-3 rounded-lg px-2.5 py-2 text-[13px] leading-7">
                <b class="font-medium">Matched labels: {this.tryResult.labels.join(" + ") || "(none)"}</b>
                <div>
                  Decision threshold: {this.tryResult.threshold}
                  {this.tryResult.fallback
                    ? "; no class cleared the line — fell back to the highest score"
                    : "; every class above the line was labeled"}
                </div>
              </div>
              <div class="mt-3 flex flex-col gap-1">
                {this.tryResult.scores.map((s) => (
                  <div class={cn("flex items-center gap-2 text-[12.5px]", !s.hit && "opacity-60")}>
                    <span class={cn("w-24 shrink-0 text-right", s.hit && "font-medium")}>{s.label}</span>
                    <span class="bg-surface-container-highest relative h-4 flex-1 rounded-full">
                      <span
                        class={cn("block h-full rounded-full", s.hit ? "bg-success" : "bg-on-surface/25")}
                        style={{ width: `${String(Math.max(1, Math.round(s.score * 100)))}%` }}
                      />
                      {this.tryResult?.threshold !== null && this.tryResult?.threshold !== undefined ? (
                        <span
                          class="bg-primary absolute -top-0.75 -bottom-0.75 w-0.75 rounded-full"
                          style={{ left: (this.tryResult.threshold * 100).toFixed(1) + "%" }}
                          title={"Decision threshold " + String(this.tryResult.threshold)}
                        />
                      ) : null}
                    </span>
                    <span class="w-14 tabular-nums">{s.score.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>
      </PageShell>
    );
  }
}
