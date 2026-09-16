// train classifier acceptance API: the nine evidence checks moved onto the page.
// Read-only + job triggering; never mutates an artifact.
//
// Data comes in two kinds:
//   1. On-disk artifacts (reports/*.json, dataset/*.jsonl, model/, onnx/) produced by the
//      make targets. This API only reads them — the numbers on the page and in the terminal
//      must be the same artifact, never recomputed here into a second source of truth.
//   2. Live probes (:8110 healthz, single-sentence classify, file stat): fetched on request.
// A missing artifact is not an error: return present=false plus which make target to run, so
// the page grows a "re-run" button instead of a blank screen.
import fs from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { parseJsonBody } from "./http.ts";

import { settings } from "#/config.ts";
import * as jobs from "#/core/jobs.ts";
import { SEVERITY, TOPIC_NAMES } from "#/core/taxonomy.ts";
import * as repository from "#/db/repository.ts";

export const acceptanceRouter = new Hono();

const TRAIN = path.join(settings.root, "data/train");
const REPORTS = path.join(TRAIN, "reports");
const DATASET = path.join(TRAIN, "dataset");
const MODEL = path.join(TRAIN, "model");
const ONNX = path.join(TRAIN, "onnx");
const CLASSIFIER = "http://127.0.0.1:8110";

// The four-stage corpus lineage: fetch pool -> desensitize/dedup -> pre-label/simulate -> split.
// Each stage carries a one-line "what this step does" so the page shows it without reading the script.
const LINEAGE = [
  {
    file: "corpus_raw.jsonl",
    stage: "Pool fetch",
    desc: "Raw phrasings from the low-confidence pool (normalized phrasing preferred)",
    make: "train-corpus",
  },
  {
    file: "corpus_clean.jsonl",
    stage: "Desensitize & dedup",
    desc: "Strip contacts/order numbers -> dedup -> LLM typo fix -> dedup again",
    make: "train-corpus",
  },
  {
    file: "corpus_labeled.jsonl",
    stage: "Pre-label + simulate",
    desc: "LLM pre-labels real questions, then simulates up to 100 per class",
    make: "train-corpus",
  },
] as const;
const SPLITS = [
  {
    key: "train",
    desc: "Training set (with augmentation and targeted supplements)",
  },
  { key: "val", desc: "Validation set (epoch selection + threshold tuning)" },
  { key: "test", desc: "Test set (held-out exam, used once for evaluation)" },
] as const;
const MODEL_TRIO = [
  "model.safetensors",
  "tokenizer.json",
  "threshold.json",
] as const;

// ---------- artifact schemas (parsed with zod; no type assertions at the boundary) ----------

const goldenReportSchema = z.object({
  ran_at: z.string().optional(),
  total: z.number().default(0),
  hits: z.number().default(0),
  rate: z.number().default(0),
  pass_line: z.number().default(0),
  passed: z.boolean().default(false),
  failures: z
    .array(
      z.object({
        text: z.string(),
        gold: z.array(z.string()),
        pred: z.array(z.string()),
      }),
    )
    .default([]),
});

const prfSchema = z.object({ p: z.number(), r: z.number(), f1: z.number() });
const classMetricSchema = z.object({
  name: z.string(),
  severity: z.string(),
  p: z.number(),
  r: z.number(),
  f1: z.number(),
  support: z.number(),
  red_line: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  tn: z.number(),
  fp: z.number(),
  fn: z.number(),
  tp: z.number(),
});
const errorItemSchema = z.object({
  text: z.string(),
  gold: z.array(z.string()),
  pred: z.array(z.string()),
  missed: z.array(z.string()),
  extra: z.array(z.string()),
  kind: z.string(),
  matrix_entries: z.number(),
});
const evalReportSchema = z.object({
  ran_at: z.string().optional(),
  test_size: z.number().default(0),
  threshold: z.number().optional(),
  red_lines: z.record(z.string(), z.number()).optional(),
  micro: prfSchema.optional(),
  macro: prfSchema.optional(),
  classes: z.array(classMetricSchema).default([]),
  errors: z.array(errorItemSchema).default([]),
  total_cells: z.number().default(0),
  total_fp: z.number().default(0),
  total_fn: z.number().default(0),
  red_line_passed: z.boolean().optional(),
});

const scanReportSchema = z.object({
  ran_at: z.string().optional(),
  val_size: z.number().default(0),
  scan: z
    .array(z.object({ threshold: z.number(), micro_f1: z.number() }))
    .default([]),
  best_threshold: z.number().default(0),
  best_micro_f1: z.number().default(0),
  in_use_threshold: z.number().nullable().optional(),
  consistent: z.boolean().optional(),
});

const exportReportSchema = z.object({
  ran_at: z.string().optional(),
  checked: z.number().default(0),
  mismatch: z.number().default(0),
  passed: z.boolean().default(false),
  onnx_path: z.string().optional(),
  onnx_bytes: z.number().default(0),
  opset: z.number().optional(),
});

const classifyRunSchema = z.object({
  ran_at: z.string().optional(),
  status: z.string().optional(),
  pending: z.number().default(0),
  written: z.number().default(0),
  counts: z.record(z.string(), z.number()).default({}),
});

// An artifact is either present (parsed payload) or missing (a hint telling which make target to run).
type Artifact<T> =
  | ({ present: true; make: string } & T)
  | { present: false; make: string; hint: string };

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadReport<S extends z.ZodType<object>>(
  name: string,
  make: string,
  schema: S,
): Artifact<z.infer<S>> {
  const file = path.join(REPORTS, name);
  if (!fs.existsSync(file)) {
    return {
      present: false,
      make,
      hint: `Artifact not generated yet; run make ${make} first`,
    };
  }
  try {
    const data = schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    return { present: true, make, ...data };
  } catch (error) {
    return {
      present: false,
      make,
      hint: `Artifact failed to parse: ${errMsg(error)}`,
    };
  }
}

// Uniform file inventory: presence + bytes + mtime + line count. Lines are only counted for
// jsonl/md, where a line equals a record; counting lines of config.json/tokenizer.json is noise.
interface FileStat {
  path: string;
  present: boolean;
  bytes?: number;
  mtime?: string;
  lines?: number;
}

function stat(file: string): FileStat {
  if (!fs.existsSync(file)) {
    return { path: file, present: false };
  }
  const st = fs.statSync(file);
  const out: FileStat = {
    path: file,
    present: true,
    bytes: st.size,
    mtime: st.mtime.toISOString().slice(0, 19),
  };
  const ext = path.extname(file);
  if (ext === ".jsonl" || ext === ".md") {
    out.lines = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim()).length;
  }
  return out;
}

const datasetRowSchema = z.object({
  text: z.string(),
  labels: z.array(z.string()),
});

function readJsonl(file: string): z.infer<typeof datasetRowSchema>[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => datasetRowSchema.parse(JSON.parse(l)));
}

interface SplitStat {
  desc: string;
  size: number;
  multi_label: number;
  counts: Record<string, number>;
  file: FileStat;
}

// The three exam papers: size + per-class label counts + a "did exam questions leak into practice" check.
// Overlap must be zero: once validation/test are seen by training, every downstream score is void.
function splitStats(): {
  splits: Record<string, SplitStat>;
  leaks: Record<string, number>;
  clean: boolean;
} {
  const texts: Record<string, Set<string>> = {};
  const splits: Record<string, SplitStat> = {};
  for (const { key, desc } of SPLITS) {
    const rows = readJsonl(path.join(DATASET, `${key}.jsonl`));
    const counts: Record<string, number> = Object.fromEntries(
      TOPIC_NAMES.map((n) => [n, 0]),
    );
    let multi = 0;
    for (const r of rows) {
      if (r.labels.length > 1) {
        multi += 1;
      }
      for (const lb of r.labels) {
        if (lb in counts) {
          counts[lb] += 1;
        }
      }
    }
    texts[key] = new Set(rows.map((r) => r.text));
    splits[key] = {
      desc,
      size: rows.length,
      multi_label: multi,
      counts,
      file: stat(path.join(DATASET, `${key}.jsonl`)),
    };
  }
  const overlap = (a: string, b: string): number => {
    const sa = texts[a] ?? new Set<string>();
    const sb = texts[b] ?? new Set<string>();
    return [...sa].filter((x) => sb.has(x)).length;
  };
  const leaks = {
    train_val: overlap("train", "val"),
    train_test: overlap("train", "test"),
    val_test: overlap("val", "test"),
  };
  return {
    splits,
    leaks,
    clean: leaks.train_val + leaks.train_test + leaks.val_test === 0,
  };
}

interface ClassifierProbe {
  online: boolean;
  detail?: unknown;
}

// :8110 liveness probe. Unreachable is not an error, it is a state — the page shows offline + a "start service" button.
async function probeClassifier(): Promise<ClassifierProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 2000);
  try {
    const resp = await fetch(`${CLASSIFIER}/healthz`, {
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { online: false, detail: `HTTP ${resp.status}` };
    }
    return { online: true, detail: await resp.json() };
  } catch (error) {
    return { online: false, detail: errMsg(error) };
  } finally {
    clearTimeout(timer);
  }
}

function thresholdInUse(): number | null {
  const file = path.join(MODEL, "threshold.json");
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return z
      .object({ threshold: z.number() })
      .parse(JSON.parse(fs.readFileSync(file, "utf8"))).threshold;
  } catch {
    return null;
  }
}

type GateStatus = "pass" | "fail" | "missing";

function gate(present: boolean, ok: boolean | null | undefined): GateStatus {
  if (!present) {
    return "missing";
  }
  return ok ? "pass" : "fail";
}

// When an artifact has not been run, do not show a fail-state conclusion — "not run" is not "failed the bar".
function note(
  present: boolean,
  ok: boolean | null | undefined,
  yes: string,
  no: string,
): string {
  if (!present) {
    return "Not run yet — press the button below to run it now";
  }
  return ok ? yes : no;
}

export interface AcceptanceBlock {
  key: string;
  no: number;
  title: string;
  page: string | null;
  status: GateStatus;
  headline: string;
  note: string;
  jobs: string[];
}

export interface AcceptanceOverview {
  blocks: AcceptanceBlock[];
  passed: number;
  total: number;
  all_pass: boolean;
  classifier: ClassifierProbe;
  jobs: jobs.JobStatusView[];
}

export async function overview(): Promise<AcceptanceOverview> {
  const golden = loadReport(
    "golden_report.json",
    "train-golden",
    goldenReportSchema,
  );
  const evaluation = loadReport(
    "eval_report.json",
    "train-eval",
    evalReportSchema,
  );
  const scan = loadReport(
    "threshold_scan.json",
    "train-threshold-scan",
    scanReportSchema,
  );
  const exportReport = loadReport(
    "export_report.json",
    "train-export",
    exportReportSchema,
  );
  const classify = loadReport(
    "classify_run.json",
    "classify-pool",
    classifyRunSchema,
  );
  const ds = splitStats();
  const health = await probeClassifier();
  const trio = Object.fromEntries(
    MODEL_TRIO.map((n) => [n, stat(path.join(MODEL, n))]),
  );

  let distTotal: number | null = null;
  let distHit: number | null = null;
  let distErr: string | null = null;
  try {
    const dist = await repository.topicDistribution();
    distTotal = dist.total;
    distHit = dist.classes.filter((c) => c.count > 0).length;
  } catch (error) {
    // the DB being down must not spoil the whole page
    distErr = errMsg(error);
  }

  const corpusLines = Object.fromEntries(
    LINEAGE.map((l) => [l.file, stat(path.join(TRAIN, l.file)).lines ?? 0]),
  );

  const trioOk = MODEL_TRIO.every((n) => trio[n].present);
  const weightsMb = (trio["model.safetensors"].bytes ?? 0) / 1024 / 1024;

  let classifyHeadline: string;
  if (!classify.present) {
    classifyHeadline = classify.hint;
  } else if (classify.status === "done") {
    classifyHeadline = `Last run wrote ${classify.written} rows`;
  } else if (classify.status === "empty") {
    classifyHeadline =
      "Last batch run: no pending questions in the pool (idempotent)";
  } else {
    classifyHeadline = `${classify.pending} pending, below one batch`;
  }

  const blocks: AcceptanceBlock[] = [
    {
      key: "data",
      no: 1,
      title: "Corpus & dataset",
      page: "/acceptance/data",
      status: gate(ds.splits.test.size > 0, ds.clean),
      headline:
        `${corpusLines["corpus_raw.jsonl"]} fetched -> ${corpusLines["corpus_clean.jsonl"]} cleaned -> ` +
        `${corpusLines["corpus_labeled.jsonl"]} labeled -> ${ds.splits.train.size}/${ds.splits.val.size}/${ds.splits.test.size} train/val/test`,
      note: ds.clean
        ? "Exam and practice sets have zero overlap"
        : "Training set overlaps the exam — scores are void",
      jobs: ["train-corpus", "train-dataset"],
    },
    {
      key: "golden",
      no: 2,
      title: "Golden sample gate",
      page: null,
      status: gate(golden.present, golden.present ? golden.passed : null),
      headline: golden.present
        ? `Pass rate ${(golden.rate * 100).toFixed(0)}% (gate line ${(golden.pass_line * 100).toFixed(0)}%), ${golden.hits}/${golden.total} fully correct`
        : golden.hint,
      note: golden.present
        ? `${golden.failures.length} error cases; if below the line fix the prompt — do not edit the golden samples to inflate the score`
        : "Not run yet — press the button below to run it now",
      jobs: ["train-golden"],
    },
    {
      key: "train",
      no: 3,
      title: "Training artifacts",
      page: "/acceptance/data",
      status: gate(trioOk, trioOk),
      // Same byte format as the data page (1024-based), so one weight file is not shown as two numbers
      headline: `Weights ${weightsMb.toFixed(0)}MB · tokenizer · threshold ${thresholdInUse()}`,
      note: trioOk
        ? "All three artifacts present; evaluation and serving both read threshold.json"
        : "Weight trio incomplete",
      jobs: ["train-train"],
    },
    {
      key: "export",
      no: 4,
      title: "ONNX export & service",
      page: null,
      status: gate(
        exportReport.present,
        exportReport.present ? exportReport.passed && health.online : null,
      ),
      headline: exportReport.present
        ? `${exportReport.checked} predictions match torch (${exportReport.mismatch} mismatches) · :8110 ${health.online ? "online" : "offline"}`
        : exportReport.hint,
      note: "Export must align with torch prediction-by-prediction before it is released",
      jobs: ["train-export", "classifier-up", "classifier-down"],
    },
    {
      key: "eval",
      no: 5,
      title: "Test set evaluation",
      page: "/acceptance/eval",
      status: gate(
        evaluation.present,
        evaluation.present ? evaluation.red_line_passed : null,
      ),
      headline: evaluation.present
        ? `micro-F1 ${(evaluation.micro?.f1 ?? 0).toFixed(3)} · macro-F1 ${(evaluation.macro?.f1 ?? 0).toFixed(3)} · test set ${evaluation.test_size}`
        : evaluation.hint,
      note: note(
        evaluation.present,
        evaluation.present ? evaluation.red_line_passed : null,
        "Strict classes F1 >= 0.9 and medium >= 0.8 all met",
        "Some classes fell below the tolerance red line — go back and fix the data",
      ),
      jobs: ["train-eval"],
    },
    {
      key: "threshold",
      no: 6,
      title: "Threshold scan",
      page: "/acceptance/eval",
      status: gate(scan.present, scan.present ? scan.consistent : null),
      headline: scan.present
        ? `Nine candidate lines replayed, elected ${scan.best_threshold.toFixed(2)} (val micro-F1 ${scan.best_micro_f1.toFixed(4)})`
        : scan.hint,
      note: note(
        scan.present,
        scan.present ? scan.consistent : null,
        scan.present ? `Matches the in-use ${scan.in_use_threshold}` : "",
        "Replay result differs from the in-use threshold",
      ),
      jobs: ["train-threshold-scan"],
    },
    {
      key: "matrix",
      no: 7,
      title: "Confusion matrix",
      page: "/acceptance/eval",
      status: gate(evaluation.present, true),
      headline: evaluation.present
        ? `${evaluation.total_cells} true/false cells, ${evaluation.total_fp + evaluation.total_fn} wrong: ${evaluation.total_fp} false alarms · ${evaluation.total_fn} misses`
        : evaluation.hint,
      note: "What matters is not how many errors, but which direction they lean",
      jobs: ["train-eval"],
    },
    {
      key: "errors",
      no: 8,
      title: "Error review",
      page: "/acceptance/errors",
      status: gate(evaluation.present, true),
      headline: evaluation.present
        ? `${evaluation.errors.length} error cases, ${evaluation.errors.reduce((acc, e) => acc + e.matrix_entries, 0)} matrix entries`
        : evaluation.hint,
      note: "Error case count != matrix entries: a misplaced case counts twice",
      jobs: ["train-eval"],
    },
    {
      key: "classify",
      no: 9,
      title: "Bypass batch classification",
      page: "/topics",
      status: gate(
        classify.present,
        classify.present ? classify.status !== "failed" : null,
      ),
      headline: classifyHeadline,
      note:
        distTotal !== null
          ? `topic_classifications has ${distTotal} rows, hitting ${distHit}/17 classes`
          : `DB read failed: ${distErr}`,
      jobs: ["classify-pool", "classify-pool-force"],
    },
  ];

  const passed = blocks.filter((b) => b.status === "pass").length;
  return {
    blocks,
    passed,
    total: blocks.length,
    all_pass: passed === blocks.length,
    classifier: health,
    jobs: jobs.statusAll(),
  };
}

acceptanceRouter.get("/api/acceptance/overview", async (c) =>
  c.json(await overview()),
);

// Evaluation detail page: per-class P/R/F1/support/red-line, confusion matrix, micro vs macro, nine-candidate scan.
acceptanceRouter.get("/api/acceptance/eval", async (c) => {
  const evaluation = loadReport(
    "eval_report.json",
    "train-eval",
    evalReportSchema,
  );
  const scan = loadReport(
    "threshold_scan.json",
    "train-threshold-scan",
    scanReportSchema,
  );
  return c.json({
    eval: evaluation,
    scan,
    threshold_in_use: thresholdInUse(),
    severity: SEVERITY,
    classifier: await probeClassifier(),
  });
});

// Data artifact page: four-stage corpus lineage + file inventory + three exam papers with leak check + training/ONNX artifacts.
acceptanceRouter.get("/api/acceptance/data", (c) => {
  const lineage = LINEAGE.map((l) => ({
    file: l.file,
    stage: l.stage,
    desc: l.desc,
    make: l.make,
    ...stat(path.join(TRAIN, l.file)),
  }));
  const modelFiles = fs.existsSync(MODEL)
    ? fs
        .readdirSync(MODEL)
        .filter((f) => fs.statSync(path.join(MODEL, f)).isFile())
        .sort()
    : [];
  const onnxFiles = fs.existsSync(ONNX)
    ? fs
        .readdirSync(ONNX)
        .filter((f) => fs.statSync(path.join(ONNX, f)).isFile())
        .sort()
    : [];
  return c.json({
    lineage,
    dataset: splitStats(),
    sample_review: stat(path.join(TRAIN, "sample_review.md")),
    model: {
      files: modelFiles.map((f) => stat(path.join(MODEL, f))),
      threshold: thresholdInUse(),
      threshold_file: stat(path.join(MODEL, "threshold.json")),
      trio_ok: MODEL_TRIO.every((n) => fs.existsSync(path.join(MODEL, n))),
    },
    onnx: {
      files: onnxFiles.map((f) => stat(path.join(ONNX, f))),
      report: loadReport(
        "export_report.json",
        "train-export",
        exportReportSchema,
      ),
    },
    topic_names: TOPIC_NAMES,
  });
});

// The fix recipe for each of the three error directions (a course conclusion, not a per-case patch).
const RECIPES: Record<string, string> = {
  missed:
    "A secondary ask is drowned out by the main one -> add dual-label sentences with a primary + incidental ask",
  misplaced:
    "A word spans two classes -> add contrastive sentence pairs, feeding both sides so it learns to read context",
  extra:
    "The boundary is too wide and sweeps in a neighbor -> add counter-examples for that class (similar but not belonging)",
};

// Error review page: per-case gold/prediction contrast + error direction (missed/extra/misplaced) + boundary-friction pairs.
// Pair stats are machine-computed: count "class that should have been labeled <- class labeled instead" by pair; a pair that
// recurs means boundary friction between the two classes, so contrastive sentences should be added in pairs.
acceptanceRouter.get("/api/acceptance/errors", (c) => {
  const evaluation = loadReport(
    "eval_report.json",
    "train-eval",
    evalReportSchema,
  );
  if (!evaluation.present) {
    return c.json({
      eval: evaluation,
      errors: [],
      kinds: {},
      matrix_entries: 0,
      total_fp: 0,
      total_fn: 0,
      pairs: [],
      recipes: RECIPES,
    });
  }
  const errors = evaluation.errors;
  const kinds: Record<string, number> = {};
  const pairs = new Map<string, number>();
  for (const e of errors) {
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    for (const m of e.missed) {
      for (const x of e.extra) {
        const key = `${m}\u0000${x}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const pairList = [...pairs.entries()]
    .map(([key, count]) => {
      const [missed, grabbed] = key.split("\u0000");
      return { missed, grabbed, count, severity: SEVERITY[missed] ?? null };
    })
    .sort((a, b) => b.count - a.count);
  return c.json({
    eval: {
      present: true,
      ran_at: evaluation.ran_at ?? null,
      test_size: evaluation.test_size,
      threshold: evaluation.threshold ?? null,
    },
    errors,
    kinds,
    matrix_entries: errors.reduce((acc, e) => acc + e.matrix_entries, 0),
    total_fp: evaluation.total_fp,
    total_fn: evaluation.total_fn,
    pairs: pairList,
    recipes: RECIPES,
  });
});

acceptanceRouter.get("/api/acceptance/service", async (c) => {
  const probe = await probeClassifier();
  return c.json({
    ...probe,
    threshold: thresholdInUse(),
    onnx_present: fs.existsSync(path.join(ONNX, "model.onnx")),
  });
});

const classifyInSchema = z.object({ text: z.string() });
const classifyResponseSchema = z.object({
  results: z.array(
    z.object({
      labels: z.array(z.string()),
      scores: z.record(z.string(), z.number()),
    }),
  ),
});

// Single-sentence classify: feed one sentence to :8110, return 17-class scores + the labels above the line.
// The page uses it to demonstrate "each of the 17 classes clears the line independently — label as many as clear" (multi-label evidence).
acceptanceRouter.post("/api/acceptance/classify", async (c) => {
  const body = await parseJsonBody(c, classifyInSchema);
  const text = body.text.trim();
  if (!text) {
    throw new HTTPException(400, { message: "Please enter a sentence" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 20_000);
  let result: { labels: string[]; scores: Record<string, number> };
  try {
    const resp = await fetch(`${CLASSIFIER}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text] }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const parsed = classifyResponseSchema.parse(await resp.json());
    result = parsed.results[0] ?? { labels: [], scores: {} };
  } catch (error) {
    throw new HTTPException(502, {
      message: `Classifier service unavailable (${errMsg(error)}); start :8110 first`,
    });
  } finally {
    clearTimeout(timer);
  }
  const threshold = thresholdInUse();
  const scores = Object.entries(result.scores)
    .map(([label, score]) => ({
      label,
      score,
      hit: result.labels.includes(label),
    }))
    .sort((a, b) => b.score - a.score);
  return c.json({
    text,
    threshold,
    labels: result.labels,
    scores,
    // When no class clears the line, the top score is the fallback; the page marks whether this fallback fired
    fallback:
      threshold !== null && scores.length > 0 && scores[0].score < threshold,
  });
});

// The "re-run" buttons (start / status / stop) live in src/api/jobs.ts under /api/jobs:
// the KB build and the classifier acceptance share one job runner, so the endpoint belongs in one place.
