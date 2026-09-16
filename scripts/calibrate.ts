// Confidence threshold calibration: run the eval set through hybrid_rerank and scan thresholds.
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "@/config.ts";
import { computeEvidenceConfidence } from "@/core/confidence.ts";
import * as readNotes from "@/core/read-notes.ts";
import * as retrieval from "@/core/retrieval.ts";

const ROOT = settings.root;
const OUT_DIR = path.join(ROOT, "data/ch09/reports");
const OUT = path.join(OUT_DIR, "confidence_calibration.txt");
const OUT_JSON = path.join(OUT_DIR, "confidence_calibration.json");
const ANSWERABLE = new Set(["A_policy", "B_model", "C_colloquial"]);
const SEM = 8;

const sampleSchema = z.object({
  id: z.string(),
  bucket: z.string(),
  query: z.string(),
});
type Sample = z.infer<typeof sampleSchema>;

const lines: string[] = [];
function logLine(msg = ""): void {
  console.log(msg);
  lines.push(msg);
}

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}
const sem = new Semaphore(SEM);

interface DistStat {
  n: number;
  min: number;
  p25: number;
  p50: number;
  p75: number;
  max: number;
}

function dist(name: string, xs: number[]): DistStat | null {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const p = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const stat = {
    n: sorted.length,
    min: Number(sorted[0].toFixed(3)),
    p25: Number(p(0.25).toFixed(3)),
    p50: Number(p(0.5).toFixed(3)),
    p75: Number(p(0.75).toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
  };
  logLine(
    `${name.padEnd(12)} n=${String(stat.n).padStart(3)} min=${stat.min.toFixed(3)} p25=${stat.p25.toFixed(3)} p50=${stat.p50.toFixed(3)} p75=${stat.p75.toFixed(3)} max=${stat.max.toFixed(3)}`,
  );
  return stat;
}

async function main(): Promise<void> {
  const raw = fs.readFileSync(
    path.join(ROOT, "tests/data/eval_rag.jsonl"),
    "utf8",
  );
  const samples: Sample[] = raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => sampleSchema.parse(JSON.parse(line)));

  const results = await Promise.all(
    samples.map((s) =>
      sem.use(async () => {
        const hits = await retrieval.searchKnowledge(s.query, {
          strategy: "hybrid_rerank",
        });
        return {
          bucket: s.bucket,
          score: computeEvidenceConfidence(hits).score,
        };
      }),
    ),
  );
  const answerable = results
    .filter((r) => ANSWERABLE.has(r.bucket))
    .map((r) => r.score);
  const absent = results
    .filter((r) => r.bucket === "D_absent")
    .map((r) => r.score);

  logLine("=== evidence_confidence distribution (hybrid_rerank) ===");
  const distribution = {
    answerable: dist("answerable", answerable),
    absent: dist("refuse (D)", absent),
  };

  logLine(
    "\n=== Threshold scan (pass rate = share of answerable with conf>=t; leak rate = share of should-refuse with conf>=t) ===",
  );
  logLine(
    `${"t".padStart(6)} ${"pass rate".padStart(10)} ${"leak rate".padStart(10)} ${"YoudenJ".padStart(8)}`,
  );
  const scan: {
    t: number;
    pass_rate: number;
    leak_rate: number;
    youden_j: number;
  }[] = [];
  let bestT = 0;
  let bestJ = -1;
  for (let i = 5; i <= 95; i += 1) {
    const t = i / 100;
    const tpr = answerable.filter((c) => c >= t).length / answerable.length;
    const fpr = absent.filter((c) => c >= t).length / absent.length;
    const j = tpr - fpr;
    scan.push({
      t: Number(t.toFixed(2)),
      pass_rate: Number(tpr.toFixed(3)),
      leak_rate: Number(fpr.toFixed(3)),
      youden_j: Number(j.toFixed(3)),
    });
    if (i % 5 === 0 || j > bestJ) {
      logLine(
        `${t.toFixed(2).padStart(6)} ${tpr.toFixed(3).padStart(10)} ${fpr.toFixed(3).padStart(10)} ${j.toFixed(3).padStart(8)}`,
      );
    }
    if (j > bestJ) {
      bestT = t;
      bestJ = j;
    }
  }
  logLine(
    `\nRecommended threshold evidence_confidence_threshold = ${bestT.toFixed(2)} (Youden J=${bestJ.toFixed(3)})`,
  );
  logLine("Backfill EVIDENCE_CONFIDENCE_THRESHOLD in .env.");

  const pick = scan.find((r) => r.t === Number(bestT.toFixed(2)));
  const recommended = {
    threshold: Number(bestT.toFixed(2)),
    youden_j: Number(bestJ.toFixed(3)),
    pass_rate: pick?.pass_rate ?? null,
    leak_rate: pick?.leak_rate ?? null,
  };
  const statRow = (stat: DistStat | null): Record<string, number> | null =>
    stat === null
      ? null
      : {
          n: stat.n,
          min: stat.min,
          p25: stat.p25,
          median: stat.p50,
          p75: stat.p75,
          max: stat.max,
        };
  const note = await readNotes.generate("confidence_calibration", {
    evidence_confidence_distribution: {
      "answerable (policy/model/colloquial)": statRow(distribution.answerable),
      "should refuse (out of KB)": statRow(distribution.absent),
    },
    chosen_line: {
      threshold: recommended.threshold,
      answerable_pass_rate: recommended.pass_rate,
      should_refuse_leak_rate: recommended.leak_rate,
      YoudenJ: recommended.youden_j,
    },
    threshold_scan: scan
      .filter(
        (r) =>
          Math.round(r.t * 10) === Math.round(Number((r.t * 10).toFixed(3))),
      )
      .map((r) => ({
        threshold: r.t,
        answerable_pass_rate: r.pass_rate,
        should_refuse_leak_rate: r.leak_rate,
      })),
  });
  logLine("\nRead note: " + (note ?? "none this round (the page uses its fallback sentence)"));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
  fs.writeFileSync(
    OUT_JSON,
    `${JSON.stringify(
      {
        meta: {
          generated_at: new Date().toISOString().slice(0, 16).replace("T", " "),
          strategy: "hybrid_rerank",
          dataset: "tests/data/eval_rag.jsonl",
          n_answerable: answerable.length,
          n_absent: absent.length,
        },
        distribution,
        scan,
        recommended,
        read_notes: note ? { confidence_calibration: note } : {},
      },
      null,
      1,
    )}\n`,
    "utf8",
  );
  logLine("Report written to data/ch09/reports/confidence_calibration.txt and .json");
}

await main();
