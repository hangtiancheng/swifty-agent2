// Replays the train-time threshold scan (teaching demo): the validation set is scored once by the
// ONNX service, then nine candidate lines (0.30~0.70 step 0.05) each replay the same score table and
// the highest micro-F1 wins. Prereq: make classifier-up (:8110 online).
// Writes reports/threshold_scan.json for the acceptance page (/acceptance/eval).
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "#/config.ts";

const VAL = path.join(settings.root, "data/train/dataset/val.jsonl");
const MODEL_THRESHOLD = path.join(
  settings.root,
  "data/train/model/threshold.json",
);
const REPORTS = path.join(settings.root, "data/train/reports");
const SERVICE = "http://127.0.0.1:8110/classify";

const valRowSchema = z.object({
  text: z.string(),
  labels: z.array(z.string()),
});
const classifyResponseSchema = z.object({
  results: z.array(
    z.object({
      labels: z.array(z.string()),
      scores: z.record(z.string(), z.number()),
    }),
  ),
});
const thresholdSchema = z.object({ threshold: z.number() });

async function main(): Promise<void> {
  const rows = fs
    .readFileSync(VAL, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => valRowSchema.parse(JSON.parse(l)));
  console.log(
    `Validation set ${rows.length} rows; scored once, score table fixed`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 120_000);
  let results: z.infer<typeof classifyResponseSchema>["results"];
  try {
    const resp = await fetch(SERVICE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: rows.map((r) => r.text) }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    results = classifyResponseSchema.parse(await resp.json()).results;
  } finally {
    clearTimeout(timer);
  }

  const names = Object.keys(results[0]?.scores ?? {});
  const probs = results.map((r) => names.map((n) => r.scores[n]));
  const gold = rows.map((r) =>
    names.map((n) => (r.labels.includes(n) ? 1 : 0)),
  );

  console.log(`${"line".padStart(6)} ${"micro-F1".padStart(10)}`);
  let bestT = 0;
  let bestF1 = -1;
  const scan: {
    threshold: number;
    micro_f1: number;
    tp: number;
    fp: number;
    fn: number;
  }[] = [];
  for (let i = 0; i < 9; i += 1) {
    const t = 0.3 + i * 0.05;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    probs.forEach((pRow, ri) => {
      const gRow = gold[ri];
      pRow.forEach((p, ci) => {
        const hit = p >= t;
        const g = gRow[ci];
        if (hit && g) {
          tp += 1;
        } else if (hit) {
          fp += 1;
        } else if (g) {
          fn += 1;
        }
      });
    });
    const f1 = (2 * tp) / (2 * tp + fp + fn);
    // Strictly greater to change the winner: on a 0.50 vs 0.45 tie, the earlier 0.45 stays.
    if (f1 > bestF1) {
      bestT = t;
      bestF1 = f1;
    }
    scan.push({
      threshold: Number(t.toFixed(2)),
      micro_f1: Number(f1.toFixed(4)),
      tp,
      fp,
      fn,
    });
    console.log(`${t.toFixed(2).padStart(6)} ${f1.toFixed(4).padStart(10)}`);
  }
  console.log(
    `\nElected: threshold ${bestT.toFixed(2)} (val micro-F1 ${bestF1.toFixed(4)}) -> compare against threshold.json`,
  );

  let inUse: number | null = null;
  if (fs.existsSync(MODEL_THRESHOLD)) {
    try {
      inUse = thresholdSchema.parse(
        JSON.parse(fs.readFileSync(MODEL_THRESHOLD, "utf8")),
      ).threshold;
    } catch {
      inUse = null;
    }
  }
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(
    path.join(REPORTS, "threshold_scan.json"),
    `${JSON.stringify(
      {
        ran_at: new Date().toISOString().slice(0, 19),
        val_size: rows.length,
        scan,
        best_threshold: Number(bestT.toFixed(2)),
        best_micro_f1: Number(bestF1.toFixed(4)),
        in_use_threshold: inUse,
        // consistent = the replayed winner is the same line as the one in use in threshold.json
        consistent: inUse !== null && Math.abs(inUse - bestT) < 1e-9,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

try {
  await main();
} catch (error) {
  console.error(
    `Threshold scan failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error("Is the classifier service running? make classifier-up");
  process.exitCode = 1;
}
