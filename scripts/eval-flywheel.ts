// Evaluation pipeline: run the ch04 dataset once, store a row in eval_runs, print the trend.
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "../src/config.ts";
import { getChatModel, structured } from "../src/core/llm.ts";
import { contentToString } from "../src/core/memory.ts";
import { FAITHFULNESS_PROMPT, RAG_ANSWER_PROMPT } from "../src/core/prompts.ts";
import * as readNotes from "../src/core/read-notes.ts";
import * as retrieval from "../src/core/retrieval.ts";
import { closeDb } from "../src/db/client.ts";
import * as repository from "../src/db/repository.ts";
import { queryFaq } from "../src/tools/builtin/faq.ts";

const ROOT = settings.root;
const OUT = path.join(ROOT, "data/ch09/reports/eval_trend.txt");
const NOTE = path.join(ROOT, "data/ch09/reports/eval_trend_note.json");
const GRADED_BUCKETS = ["A_policy", "B_model", "C_colloquial", "E_multi"];
const RECALL_K = 5;
const METRICS = ["recall_at_5", "mrr", "faithfulness", "refusal_rate"] as const;
const CALL_TIMEOUT = 45_000;

const sampleSchema = z.object({
  id: z.string(),
  bucket: z.string(),
  query: z.string(),
  expect_section: z.array(z.string()).optional(),
  expect_sections_all: z.array(z.union([z.string(), z.array(z.string())])).optional(),
});
type Sample = z.infer<typeof sampleSchema>;

const faithSchema = z.object({ faithful: z.boolean(), reason: z.string().default("") });

const lines: string[] = [];
function logLine(msg = ""): void {
  console.log(msg);
  lines.push(msg);
}

function mean(xs: Array<number | null>): number {
  const values = xs.filter((x): x is number => x !== null);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function groups(sample: Sample): string[][] {
  const multi = sample.expect_sections_all;
  if (multi && multi.length > 0) {
    return multi.map((g) => (Array.isArray(g) ? g : [g]));
  }
  return [sample.expect_section ?? []];
}

function ranksPerGroup(hits: Awaited<ReturnType<typeof retrieval.searchKnowledge>>, sample: Sample): number[] {
  return groups(sample).map((aliases) => {
    for (let i = 0; i < hits.length; i += 1) {
      const sp = hits[i].section_path ?? "";
      if (aliases.some((w) => sp.includes(w))) {
        return i + 1;
      }
    }
    return 0;
  });
}

function recallAt(ranks: number[], k: number): number {
  return mean(ranks.map((r) => (r > 0 && r <= k ? 1 : 0)));
}

function reciprocalRank(ranks: number[]): number {
  return mean(ranks.map((r) => (r > 0 ? 1 / r : 0)));
}

function formatEvidence(hits: Awaited<ReturnType<typeof retrieval.searchKnowledge>>): string {
  return hits.map((h, i) => `[${i + 1}] ${h.question}:${h.answer}`).join("\n");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("call timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

async function tryCall<T>(factory: () => Promise<T>): Promise<T | null> {
  for (let i = 0; i < 2; i += 1) {
    try {
      return await withTimeout(factory(), CALL_TIMEOUT);
    } catch {
      if (i === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  return null;
}

async function genFaith(sample: Sample, hits: Awaited<ReturnType<typeof retrieval.searchKnowledge>>, judge: ReturnType<typeof structured<typeof faithSchema>>): Promise<boolean | null> {
  const evidence = formatEvidence(hits);
  const answer = await tryCall(() => RAG_ANSWER_PROMPT.pipe(getChatModel()).invoke({ query: sample.query, evidence }));
  if (answer === null) {
    return null;
  }
  const verdict = await tryCall(() => FAITHFULNESS_PROMPT.pipe(judge).invoke({ evidence, answer: contentToString(answer.content) }));
  return verdict === null ? null : verdict.faithful;
}

async function runOnce(): Promise<{ dataset_size: number; metrics: Record<string, number> }> {
  const raw = fs.readFileSync(path.join(ROOT, "tests/data/eval_ch04.jsonl"), "utf8");
  const samples: Sample[] = raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => sampleSchema.parse(JSON.parse(line)));
  const graded = samples.filter((s) => GRADED_BUCKETS.includes(s.bucket));
  const absent = samples.filter((s) => s.bucket === "D_absent");

  const hitsList = await Promise.all(graded.map((s) => retrieval.searchKnowledge(s.query, { strategy: "hybrid_rerank" })));
  const ranks = graded.map((s, i) => ranksPerGroup(hitsList[i], s));
  const recall = mean(ranks.map((r) => recallAt(r, RECALL_K)));
  const mrr = mean(ranks.map((r) => reciprocalRank(r)));

  const judge = structured(faithSchema, { temperature: 0 });
  const faiths = await Promise.all(graded.map((s, i) => genFaith(s, hitsList[i], judge)));
  const faithfulness = mean(faiths.map((f) => (f === null ? null : f ? 1 : 0)));

  const refusals = await Promise.all(
    absent.map(async (s) => {
      const out = await tryCall(() => queryFaq({ keyword: s.query }));
      return out === null ? null : !out.sufficient;
    }),
  );
  const got = refusals.filter((r): r is boolean => r !== null);
  const refusalRate = got.length > 0 ? got.filter(Boolean).length / got.length : 0;

  return {
    dataset_size: samples.length,
    metrics: {
      recall_at_5: Number(recall.toFixed(3)),
      mrr: Number(mrr.toFixed(3)),
      faithfulness: Number(faithfulness.toFixed(3)),
      refusal_rate: Number(refusalRate.toFixed(3)),
    },
  };
}

async function trendNote(runs: repository.EvalRunRow[]): Promise<void> {
  const latest = runs[0];
  const prev = runs.length > 1 ? runs[1] : null;
  const zh: Record<string, string> = { recall_at_5: "Recall@5", recall_at_10: "Recall@10", mrr: "MRR", faithfulness: "忠实度", refusal_rate: "库外拒答率" };
  const metricPick = (metrics: Record<string, number>): Record<string, number | undefined> =>
    Object.fromEntries(METRICS.map((n) => [zh[n], metrics[n]]));
  const payload = {
    本轮: { 轮次: latest.id, 触发: latest.triggeredBy, ...metricPick(latest.metrics) },
    上一轮: prev ? { 轮次: prev.id, ...metricPick(prev.metrics) } : null,
    涨跌: prev ? Object.fromEntries(METRICS.map((n) => [zh[n], Number(((latest.metrics[n] ?? 0) - (prev.metrics[n] ?? 0)).toFixed(3))])) : null,
  };
  const note = await readNotes.generate("eval_trend", payload);
  logLine("\n读图小注:" + (note ?? "本轮没有(页面用兜底句)"));
  fs.writeFileSync(NOTE, `${JSON.stringify({ run_id: latest.id, note }, null, 1)}\n`, "utf8");
}

function printTrend(runs: repository.EvalRunRow[]): void {
  logLine("\n=== 评估趋势(新在上)===");
  logLine(`${"轮次".padStart(4)} ${"时间".padEnd(14)} ${"触发".padEnd(4)}${METRICS.map((n) => n.padStart(18)).join("")}`);
  runs.forEach((r, i) => {
    const prev = i + 1 < runs.length ? runs[i + 1].metrics : null;
    let row = `#${String(r.id).padStart(3)} ${r.createdAt.toISOString().slice(5, 16).replace("T", " ")}  ${r.triggeredBy.padEnd(4)}`;
    for (const n of METRICS) {
      const v = r.metrics[n];
      let cell = v === undefined ? "—" : v.toFixed(3);
      if (prev && v !== undefined && prev[n] !== undefined) {
        const d = v - prev[n];
        cell += d > 0.005 ? " ↑" : d < -0.005 ? " ⚠↓" : " →";
      }
      row += cell.padStart(18);
    }
    logLine(row);
  });
  if (runs.length > 1) {
    const drops = METRICS.filter((n) => (runs[0].metrics[n] ?? 0) < (runs[1].metrics[n] ?? 0) - 0.005);
    logLine(drops.length > 0 ? `\n⚠ 下滑指标:${drops.join(", ")}` : "\n所有指标持平或上涨。");
  }
}

async function main(): Promise<void> {
  const triggeredBy = process.argv.includes("--triggered-by") ? (process.argv[process.argv.indexOf("--triggered-by") + 1] ?? "手动") : "手动";
  logLine(`=== 评估流水线(触发:${triggeredBy})===`);
  const result = await runOnce();
  const m = result.metrics;
  logLine(`本轮:Recall@5=${m.recall_at_5.toFixed(3)} MRR=${m.mrr.toFixed(3)} Faithfulness=${m.faithfulness.toFixed(3)} 拒答率=${m.refusal_rate.toFixed(3)}`);
  await repository.insertEvalRun(triggeredBy, result.dataset_size, m);
  const runs = await repository.listEvalRuns(10);
  printTrend(runs);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await trendNote(runs);
  fs.writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
  logLine("\n趋势报告已落 data/ch09/reports/eval_trend.txt");
}

try {
  await main();
} finally {
  await closeDb();
}
