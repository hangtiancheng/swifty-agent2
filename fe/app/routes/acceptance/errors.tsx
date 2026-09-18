import { customElement } from "@swifty.js/lit-jsx";

import "~/components/job-row";
import {
  GateBar,
  MissingBox,
  PageLoading,
  PageShell,
  Panel,
  Pill,
  Stat,
  TableScroll,
  Tbl,
  Td,
  Th,
  Tip,
  Tr,
  type PillTone,
} from "~/components/ui";
import { api } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtTime } from "~/lib/format";
import { enterOnce } from "~/lib/motion";
import { DataLoaderElement } from "~/lib/page-element";
import type { JobSpec } from "~/lib/types";

/* Error Analysis: which class erred · false alarm or missed · whether the gold labels are at fault. */

interface ErrorItem {
  text: string;
  gold: string[];
  pred: string[];
  missed: string[];
  extra: string[];
  kind: string; // backend enum: missed | misplaced | extra
  matrix_entries: number;
}

interface ErrorsData {
  eval: {
    present: boolean;
    hint?: string;
    ran_at?: string;
    test_size?: number;
    threshold?: number;
  };
  errors: ErrorItem[];
  kinds: Record<string, number>;
  matrix_entries: number;
  total_fp: number;
  total_fn: number;
  pairs: {
    missed: string;
    grabbed: string;
    count: number;
    severity: string | null;
  }[];
  recipes: Record<string, string>;
}

interface JobsData {
  jobs: JobSpec[];
}

interface PageData {
  d: ErrorsData;
  jobs: JobSpec[];
}

// Keys are backend enum values (error direction from eval_report.json; severity from
// taxonomy.ts) and must match the API exactly; tones and labels are display-only.
const KIND_PILL: Record<string, PillTone> = {
  missed: "info",
  misplaced: "fail",
  extra: "running",
};

const KIND_LABEL: Record<string, string> = {
  missed: "Missed",
  misplaced: "Misplaced",
  extra: "Extra",
};

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

/** Label legend: standard-missed → red, prediction-extra → amber, matched → green. */
function LabelRow({
  kind,
  labels,
  marks,
}: {
  kind: string;
  labels: string[];
  marks: Record<string, string>;
}) {
  return (
    <div class="flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span class="text-on-surface-variant">{kind}</span>
      {labels.length ? (
        labels.map((l) => (
          <span
            class={cn(
              "rounded-full px-2 py-0.5 text-xs",
              marks[l] === "missed" &&
                "bg-error-container text-on-error-container",
              marks[l] === "extra" &&
                "bg-warning-container text-on-warning-container",
              !marks[l] && "bg-success-container text-on-success-container",
              marks[l] &&
                marks[l] !== "missed" &&
                marks[l] !== "extra" &&
                "bg-surface-container-high text-on-surface",
            )}
          >
            {l}
          </span>
        ))
      ) : (
        <span class="bg-surface-container-high text-on-surface-variant rounded-full px-2 py-0.5 text-xs">
          (none)
        </span>
      )}
    </div>
  );
}

@customElement("acceptance-errors-page")
export class AcceptanceErrorsPage extends DataLoaderElement<PageData> {
  protected override pageTitle = "MeowMeow Select · Error Analysis";

  protected override async load(): Promise<PageData> {
    const [d, j] = await Promise.all([
      api<ErrorsData>("/api/acceptance/errors"),
      api<JobsData>("/api/jobs"),
    ]);
    return { d, jobs: j.jobs };
  }

  protected override render() {
    if (this.loadError) {
      return (
        <PageShell title="Error Analysis" active="/acceptance/errors">
          <MissingBox class="mt-4">
            Failed to load data: {this.loadError}
          </MissingBox>
        </PageShell>
      );
    }
    if (!this.data) {
      return (
        <PageShell title="Error Analysis" active="/acceptance/errors">
          <PageLoading />
        </PageShell>
      );
    }
    const { d, jobs } = this.data;
    const jobSpecs = Object.fromEntries(jobs.map((j) => [j.name, j]));

    return (
      <PageShell
        title="Error Analysis"
        sub="Which class erred · false alarm or missed · are the gold labels at fault"
        active="/acceptance/errors"
        actions={this.refreshBtn()}
      >
        <GateBar>
          {!d.eval.present ? (
            <Stat label="Eval artifact" value="Not generated" tone="fail" />
          ) : (
            <>
              <Stat
                label="Error cases"
                value={String(d.errors.length) + " cases"}
              />
              <Stat
                label="Matrix entries"
                value={String(d.matrix_entries) + " entries"}
              />
              <Stat label="False alarms (FP)" value={String(d.total_fp)} />
              <Stat label="Misses (FN)" value={String(d.total_fn)} />
              <Stat
                label="Test set"
                value={String(d.eval.test_size ?? 0) + " rows"}
              />
              <Stat
                label="Evaluated at"
                value={fmtTime(d.eval.ran_at).slice(5, 16)}
                small
              />
            </>
          )}
        </GateBar>

        {!d.eval.present ? (
          <Panel title="Error case review">
            <MissingBox>
              {d.eval.hint ??
                "Eval artifact not generated yet — run node main.js train-eval first"}
            </MissingBox>
            {jobSpecs["train-eval"] ? (
              <job-row
                specs={[jobSpecs["train-eval"]]}
                onFinish={() => {
                  void this.reload();
                }}
              ></job-row>
            ) : null}
          </Panel>
        ) : (
          <>
            {/* ① The tally: error cases ≠ matrix entries */}
            <Panel
              title="How the tally works: error cases ≠ matrix entries"
              lede="There are three kinds of errors. Missed: the required label was not applied — counts as 1 miss. Extra: an unneeded label was added — counts as 1 false alarm. Misplaced: the required label was not applied and a different class was labeled instead — counts as 2 entries (the missed class +1 miss, the grabbing class +1 false alarm). That is why the case list is shorter than the matrix tally — the difference is all misplaced errors."
            >
              <div class="flex flex-wrap gap-3">
                {Object.entries(d.kinds).map(([kind, n], i) => (
                  <div
                    ref={(el: Element | undefined) => {
                      enterOnce(el, { y: 8, duration: 0.35, delay: i * 0.05 });
                    }}
                    class="bg-card border-outline-variant shadow-e1 min-w-50 flex-1 rounded-lg border px-3 py-2"
                  >
                    <div>
                      <Pill tone={KIND_PILL[kind] ?? "info"}>
                        {KIND_LABEL[kind] ?? kind}
                      </Pill>{" "}
                      <span class="text-xl font-medium">{n} cases</span>
                    </div>
                    <div class="text-on-surface-variant mt-1 text-[11.5px] leading-6">
                      Fix: {d.recipes[kind] ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
              <Tip>
                {d.errors.length} error cases → {d.matrix_entries} matrix
                entries: {d.total_fp} false alarms, {d.total_fn} misses. With
                only a handful so far, this is not worth retraining for —
                collect more cases first; training has a cost.
              </Tip>
            </Panel>

            {/* ② Boundary-friction pairs */}
            <Panel
              title="Boundary friction: which two classes are fighting over labels"
              lede="Pairs are counted as “missed class ← grabbing class”. The same pair recurring means a word spans both classes and the sentence sits right on the boundary — the model thinks it fits either side. Fix these with contrastive sentence pairs, feeding both sides at once so it learns to read context."
            >
              {d.pairs.length ? (
                <>
                  <TableScroll>
                    <Tbl>
                      <thead>
                        <tr>
                          <Th>Missed class (should have been labeled)</Th>
                          <Th>Severity</Th>
                          <Th>Grabbing class (false alarm)</Th>
                          <Th>Count</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.pairs.map((p) => (
                          <Tr bad={p.count > 1}>
                            <Td>
                              <span class="bg-error-container text-on-error-container rounded-full px-2 py-0.5 text-xs">
                                {p.missed}
                              </span>
                            </Td>
                            <Td>
                              {p.severity ? (
                                <Pill tone={SEV_TONE[p.severity] ?? "plain"}>
                                  {SEV_LABEL[p.severity] ?? p.severity}
                                </Pill>
                              ) : null}
                            </Td>
                            <Td>
                              <span class="bg-warning-container text-on-warning-container rounded-full px-2 py-0.5 text-xs">
                                {p.grabbed}
                              </span>
                            </Td>
                            <Td num>×{p.count}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Tbl>
                  </TableScroll>
                  <Tip>
                    Pairs seen 2+ times are marked red — those are stable,
                    reproducible biases; add their contrastive sentences first.
                  </Tip>
                </>
              ) : (
                <MissingBox>
                  No misplaced errors this round — no classes are fighting over
                  labels
                </MissingBox>
              )}
            </Panel>

            {/* ③ Case-by-case errors */}
            <Panel
              title="Case by case: gold standard vs. model prediction"
              lede="Classes missed by the gold standard are red, extra classes added by the model are orange, and labels both sides agree on are green. The corpus deliberately mixes in typos and dialect to mimic real users' keyboards — errors under noise still count, no exemptions."
            >
              {d.errors.map((e, i) => {
                const marksGold: Record<string, string> = {};
                const marksPred: Record<string, string> = {};
                for (const l of e.missed) {
                  marksGold[l] = "missed";
                }
                for (const l of e.extra) {
                  marksPred[l] = "extra";
                }
                return (
                  <div
                    ref={(el: Element | undefined) => {
                      enterOnce(el, {
                        y: 8,
                        duration: 0.35,
                        delay: Math.min(i * 0.04, 0.25),
                      });
                    }}
                    class="bg-card border-outline-variant shadow-e1 mt-2.5 rounded-lg border px-3 py-2.5 first:mt-0"
                  >
                    <div class="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <Pill tone={KIND_PILL[e.kind] ?? "info"}>
                        {KIND_LABEL[e.kind] ?? e.kind}
                      </Pill>
                      <span class="text-on-surface-variant">
                        counts as {e.matrix_entries} matrix entries
                      </span>
                    </div>
                    <div class="mt-1.5 text-[13.5px] leading-7 font-medium">
                      “{e.text}”
                    </div>
                    <div class="mt-2 flex flex-col gap-1.5">
                      {LabelRow({
                        kind: "Gold standard",
                        labels: e.gold,
                        marks: marksGold,
                      })}
                      {LabelRow({
                        kind: "Prediction",
                        labels: e.pred,
                        marks: marksPred,
                      })}
                    </div>
                    <div class="text-on-surface-variant mt-2 text-xs leading-6">
                      {[
                        ...(e.missed.length
                          ? ["Missed: " + e.missed.join(", ")]
                          : []),
                        ...(e.extra.length
                          ? ["Extra: " + e.extra.join(", ")]
                          : []),
                        "Fix: " + (d.recipes[e.kind] ?? "—"),
                      ].join(" | ")}
                    </div>
                  </div>
                );
              })}
              {jobSpecs["train-eval"] ? (
                <job-row
                  specs={[jobSpecs["train-eval"]]}
                  onFinish={() => {
                    void this.reload();
                  }}
                  note="Re-running eval refreshes this error list"
                ></job-row>
              ) : null}
            </Panel>
          </>
        )}
      </PageShell>
    );
  }
}
