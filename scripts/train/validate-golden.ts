// train pre-label quality gate: the label set must match exactly on >= 80% of golden samples
// before batch pre-labeling is released. Run: make train-golden (requires chat upstream).
// If it falls below the line, fix the prompt — do not edit the golden samples to inflate the score.
// Writes reports/golden_report.json for the acceptance page (/acceptance); failures carry gold/pred contrast.
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { prelabelBatch } from "./prelabel.ts";

import { settings } from "#/config.ts";

const GOLDEN = path.join(settings.root, "scripts/train/golden_samples.jsonl");
const REPORTS = path.join(settings.root, "data/train/reports");
const PASS_RATE = 0.8;

const goldenSampleSchema = z.object({
  text: z.string(),
  labels: z.array(z.string()),
});
type GoldenSample = z.infer<typeof goldenSampleSchema>;

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length &&
  [...a].sort().every((v, i) => v === [...b].sort()[i]);

async function main(): Promise<number> {
  const samples: GoldenSample[] = fs
    .readFileSync(GOLDEN, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => goldenSampleSchema.parse(JSON.parse(l)));

  const predicted = await prelabelBatch(samples.map((s) => s.text));
  let hits = 0;
  const failures: { text: string; gold: string[]; pred: string[] }[] = [];
  samples.forEach((s, i) => {
    const pred = predicted[i];
    const ok = sameSet(pred, s.labels);
    if (ok) {
      hits += 1;
    } else {
      console.log(
        `✗ ${s.text}\n    gold: ${s.labels.join(",")}  pred: ${pred.join(",")}`,
      );
      failures.push({ text: s.text, gold: [...s.labels], pred: [...pred] });
    }
  });

  const rate = samples.length > 0 ? hits / samples.length : 0;
  console.log(
    `\nGolden samples ${samples.length}, fully correct ${hits}, pass rate ${(rate * 100).toFixed(0)}% (gate line ${(PASS_RATE * 100).toFixed(0)}%)`,
  );

  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(
    path.join(REPORTS, "golden_report.json"),
    `${JSON.stringify(
      {
        ran_at: new Date().toISOString().slice(0, 19),
        total: samples.length,
        hits,
        rate: Number(rate.toFixed(4)),
        pass_line: PASS_RATE,
        passed: rate >= PASS_RATE,
        failures,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return rate >= PASS_RATE ? 0 : 1;
}

process.exitCode = await main();
