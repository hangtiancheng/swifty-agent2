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
} from "~/components/ui";
import { api } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtBytes, fmtTime } from "~/lib/format";
import { enterOnce, growOnce } from "~/lib/motion";
import { DataLoaderElement } from "~/lib/page-element";
import type { JobSpec } from "~/lib/types";

/* Acceptance Data: corpus lineage · the three exam papers · training and ONNX artifact inventory. */

interface FileStat {
  path: string;
  present: boolean;
  bytes?: number | null;
  mtime?: string | null;
  lines?: number | null;
}

interface LineageStep extends FileStat {
  file: string;
  stage: string;
  desc: string;
  make: string;
}

interface SplitStat {
  desc: string;
  size: number;
  multi_label: number;
  counts: Record<string, number>;
  file: FileStat;
}

interface ExportReport {
  present: boolean;
  hint?: string;
  passed?: boolean;
  checked?: number;
  mismatch?: number;
  opset?: number;
  onnx_bytes?: number;
  ran_at?: string;
}

interface DataDetail {
  lineage: LineageStep[];
  dataset: {
    splits: Record<"train" | "val" | "test", SplitStat>;
    leaks: { train_val: number; train_test: number; val_test: number };
    clean: boolean;
  };
  sample_review: FileStat;
  model: {
    files: FileStat[];
    threshold: number | null;
    threshold_file: FileStat;
    trio_ok: boolean;
  };
  onnx: { files: FileStat[]; report: ExportReport };
  topic_names: string[];
}

interface PageData {
  d: DataDetail;
  jobs: JobSpec[];
}

const SPLIT_KEYS = ["train", "val", "test"] as const;
const SPLIT_LABEL: Record<string, string> = {
  train: "Training set",
  val: "Validation set",
  test: "Test set",
};

function FileTable({ rows }: { rows: FileStat[] }) {
  return (
    <TableScroll class="mt-2.5">
      <Tbl>
        <thead>
          <tr>
            <Th>Artifact</Th>
            <Th>Rows</Th>
            <Th>Size</Th>
            <Th>Last written</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr bad={!r.present}>
              <Td class="break-all">{r.path}</Td>
              <Td num>{r.present ? String(r.lines ?? "—") : "Missing"}</Td>
              <Td num>{r.present ? fmtBytes(r.bytes) : "—"}</Td>
              <Td>{r.present ? fmtTime(r.mtime) : "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </Tbl>
    </TableScroll>
  );
}

@customElement("acceptance-data-page")
export class AcceptanceDataPage extends DataLoaderElement<PageData> {
  protected override pageTitle = "MeowMeow Select · Acceptance Data";

  protected override async load(): Promise<PageData> {
    const [d, j] = await Promise.all([api<DataDetail>("/api/acceptance/data"), api<{ jobs: JobSpec[] }>("/api/jobs")]);
    return { d, jobs: j.jobs };
  }

  protected override render() {
    if (this.loadError) {
      return (
        <PageShell title="Acceptance Data" active="/acceptance/data">
          <MissingBox class="mt-4">Failed to load data: {this.loadError}</MissingBox>
        </PageShell>
      );
    }
    if (!this.data) {
      return (
        <PageShell title="Acceptance Data" active="/acceptance/data">
          <PageLoading />
        </PageShell>
      );
    }
    const { d, jobs } = this.data;
    const jobSpecs = Object.fromEntries(jobs.map((j) => [j.name, j]));
    const pick = (names: string[]) => names.map((n) => jobSpecs[n]).filter((x): x is JobSpec => Boolean(x));
    const ds = d.dataset;
    const sp = ds.splits;
    const ex = d.onnx.report;
    const labeled = d.lineage.find((x) => x.file === "corpus_labeled.jsonl");

    return (
      <PageShell
        title="Acceptance Data"
        sub="Corpus lineage · the three exam papers · training and ONNX artifact inventory"
        active="/acceptance/data"
        actions={this.refreshBtn()}
      >
        <GateBar>
          <Stat label="Corpus total" value={(labeled?.present ? String(labeled.lines ?? "—") : "—") + " rows"} />
          {SPLIT_KEYS.map((k) => (
            <Stat label={SPLIT_LABEL[k]} value={String(sp[k].size) + " rows"} />
          ))}
          <Stat label="Exam leaks" value={ds.clean ? "0 rows" : "found"} tone={ds.clean ? "pass" : "fail"} />
          <Stat label="Threshold in use" value={String(d.model.threshold ?? "—")} />
        </GateBar>

        {/* ① Corpus lineage */}
        <Panel
          title="Corpus lineage: a question's walk from pool to exam paper"
          lede="Every stage maps to a real artifact file — the numbers are not hearsay. The pool draw takes normalized phrasings produced by the data flywheel's merge stage, not raw user words — the classifier must receive a semantically complete sentence."
        >
          <div class="flex flex-wrap items-stretch gap-1.5">
            {d.lineage.map((s, i) => (
              <div
                ref={(el: Element | undefined) => {
                  enterOnce(el, { x: -8, duration: 0.2, delay: i * 0.06 });
                }}
                class="flex flex-1 items-stretch gap-1.5"
              >
                <div
                  class={cn(
                    "bg-surface-container-high min-w-36 flex-1 rounded-md px-3 py-2",
                    !s.present && "text-on-surface-variant",
                  )}
                >
                  <div class="text-on-surface-variant text-[11.5px]">{s.stage}</div>
                  <b class="text-headline-small block font-medium tabular-nums">
                    {s.present ? String(s.lines ?? "—") : "Missing"}
                  </b>
                  <div class="mt-0.5 text-[11.5px] leading-5">{s.desc}</div>
                  <div class="text-on-surface-variant mt-1 text-[11px] break-all">{s.path}</div>
                </div>
                <div class="text-on-surface-variant self-center text-xl font-medium">→</div>
              </div>
            ))}
            <div class="bg-surface-container-high min-w-36 flex-1 rounded-md px-3 py-2">
              <div class="text-on-surface-variant text-[11.5px]">Stratified split 80/10/10</div>
              <b class="text-headline-small block font-medium tabular-nums">
                {SPLIT_KEYS.map((k) => String(sp[k].size)).join(" / ")}
              </b>
              <div class="mt-0.5 text-[11.5px] leading-5">
                Train / validation / test; the training set also gets augmentation and targeted additions
              </div>
              <div class="text-on-surface-variant mt-1 text-[11px] break-all">data/train/dataset/*.jsonl</div>
            </div>
          </div>
          {FileTable({ rows: [...d.lineage, d.sample_review] })}
          <Tip>
            The manual spot-check file sample_review.md is the human-readable copy (full real pool + 5 simulated
            samples per class). If you spot a wrong label, fix the corpus — never edit the exam papers to game the
            score.
          </Tip>
          <job-row
            specs={pick(["train-corpus", "train-dataset"])}
            onFinish={() => {
              void this.reload();
            }}
          ></job-row>
        </Panel>

        {/* ② Three exam papers + leak self-check */}
        <Panel
          title="The three exam papers and the leak self-check"
          pill={ds.clean ? <Pill tone="pass">Zero overlap</Pill> : <Pill tone="fail">Overlap found — scores void</Pill>}
          lede="Augmentation only expands the training set — validation/test are exam questions and must never change to match the practice material. Overlap must be 0: once the training set has seen an exam question, every score afterwards is void, so this check is a hard gate, not a hint."
        >
          <div class="flex flex-wrap gap-3">
            {(
              [
                { k: "train_val", label: "Train ∩ validation" },
                { k: "train_test", label: "Train ∩ test" },
                { k: "val_test", label: "Validation ∩ test" },
              ] satisfies { k: keyof typeof ds.leaks; label: string }[]
            ).map(({ k, label }) => (
              <Stat label={label} value={String(ds.leaks[k]) + " rows"} tone={ds.leaks[k] === 0 ? "pass" : "fail"} />
            ))}
            {SPLIT_KEYS.map((k) => (
              <Stat label={SPLIT_LABEL[k] + " multi-label"} value={String(sp[k].multi_label) + " rows"} />
            ))}
          </div>
          <TableScroll class="mt-3">
            <Tbl>
              <thead>
                <tr>
                  <Th>Class</Th>
                  {SPLIT_KEYS.map((k) => (
                    <Th>
                      {SPLIT_LABEL[k]}({sp[k].size})
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.topic_names.map((name) => (
                  <Tr>
                    <Td>{name}</Td>
                    {SPLIT_KEYS.map((k) => {
                      const maxOf = Math.max(1, ...Object.values(sp[k].counts));
                      const cnt = sp[k].counts[name] ?? 0;
                      return (
                        <Td class="p-0">
                          <div class="flex items-center gap-1.5 px-2 py-0.5">
                            <span class="bg-surface-container-highest h-2.25 min-w-10 flex-1 overflow-hidden rounded-full">
                              <span
                                ref={(el: Element | undefined) => {
                                  growOnce(el, `${String(Math.round((cnt / maxOf) * 100))}%`, { duration: 0.4 });
                                }}
                                class="bg-primary block h-full rounded-full"
                              />
                            </span>
                            <span class="w-10 text-right tabular-nums">{cnt}</span>
                          </div>
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
              </tbody>
            </Tbl>
          </TableScroll>
          <Tip>
            Label counts are hit-based: a multi-label sentence counts once for each class it hits, so column totals
            can exceed the row count.
          </Tip>
        </Panel>

        {/* ③ Training artifacts */}
        <Panel
          title="The training artifact trio"
          pill={d.model.trio_ok ? <Pill tone="pass">Trio complete</Pill> : <Pill tone="fail">Trio incomplete</Pill>}
          lede="Weights + tokenizer + threshold.json. The threshold and the validation-set score live in that few-dozen-byte file; both eval and service startup read it — it is the other half of the shipped classifier."
        >
          {FileTable({ rows: d.model.files })}
          <Tip>
            <b>threshold.json</b> holds the decision threshold in use: {String(d.model.threshold)}; written at{" "}
            {fmtTime(d.model.threshold_file.mtime)}, {fmtBytes(d.model.threshold_file.bytes)}.
          </Tip>
          <job-row
            specs={pick(["train-train"])}
            onFinish={() => {
              void this.reload();
            }}
            note="Training is a minutes-long heavy job and overwrites the current weights"
          ></job-row>
        </Panel>

        {/* ④ ONNX artifacts */}
        <Panel
          title="ONNX export artifacts and consistency check"
          pill={
            ex.present ? (
              ex.passed ? (
                <Pill tone="pass">Predictions fully match</Pill>
              ) : (
                <Pill tone="fail">Mismatches found</Pill>
              )
            ) : (
              <Pill tone="missing">Not exported</Pill>
            )
          }
          lede="After export, the full test set is replayed row by row against torch; labels above the line must match exactly to pass. The serving side carries only onnxruntime + tokenizers, not torch."
        >
          {FileTable({ rows: d.onnx.files })}
          {ex.present ? (
            <Tip>
              Checked {ex.checked} rows, {ex.mismatch} mismatches; opset {ex.opset}, model.onnx{" "}
              {fmtBytes(ex.onnx_bytes)}, exported at {fmtTime(ex.ran_at)}.
            </Tip>
          ) : (
            <MissingBox class="mt-2.5">{ex.hint}</MissingBox>
          )}
          <job-row
            specs={pick(["train-export", "classifier-up", "classifier-down"])}
            onFinish={() => {
              void this.reload();
            }}
          ></job-row>
        </Panel>
      </PageShell>
    );
  }
}
