// Four-strategy RAG evaluation (vector / bm25 / hybrid / hybrid+rerank) over the rag dataset.
// Deterministic retrieval metrics always run; the generation segment can be skipped with --skip-gen.
import fs from "node:fs";
import path from "node:path";

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

import { settings } from "#/config.ts";
import { getChatModel, structured } from "#/core/llm.ts";
import { contentToString } from "#/core/memory.ts";
import * as modelGuard from "#/core/model-guard.ts";
import { FAITHFULNESS_PROMPT, RAG_ANSWER_PROMPT } from "#/core/prompts.ts";
import * as readNotes from "#/core/read-notes.ts";
import * as retrieval from "#/core/retrieval.ts";
import { closeDb } from "#/db/client.ts";
import * as repository from "#/db/repository.ts";
import type { KnowledgeHit } from "#/kb/store.ts";
import * as store from "#/kb/store.ts";
import { queryFaq } from "#/tools/builtin/faq.ts";

const ROOT = settings.root;
const OUT_DIR = path.join(ROOT, "data/rag/reports");
const OUT_JSON = path.join(OUT_DIR, "rag_eval.json");
const OUT_TXT = path.join(OUT_DIR, "rag_eval.txt");

const STRATEGIES = ["vector", "bm25", "hybrid", "hybrid_rerank"] as const;
type Strategy = (typeof STRATEGIES)[number];
const GRADED_BUCKETS = ["A_policy", "B_model", "C_colloquial", "E_multi"];
const STRATEGY_LABEL: Record<string, string> = {
  vector: "Vector only",
  bm25: "BM25 only",
  hybrid: "Hybrid",
  hybrid_rerank: "Hybrid + rerank",
};
const BUCKET_LABEL: Record<string, string> = {
  A_policy: "Policy",
  B_model: "Model numbers",
  C_colloquial: "Colloquial",
  E_multi: "Cross-document",
  overall: "Overall",
};
const SKIP_GEN = process.argv.includes("--skip-gen");
const K = 10;
const RECALL_K = 5;
const RETR_CONCURRENCY = 5;
const GEN_CONCURRENCY = 5;
const CALL_TIMEOUT = 45_000;

const sampleSchema = z.object({
  id: z.string(),
  bucket: z.string(),
  query: z.string(),
  expect_section: z.array(z.string()).optional(),
  expect_sections_all: z
    .array(z.union([z.string(), z.array(z.string())]))
    .optional(),
  expect_points: z.array(z.string()).optional(),
  should_refuse: z.boolean().optional(),
});
type Sample = z.infer<typeof sampleSchema>;

const faithSchema = z.object({
  faithful: z.boolean().describe("Whether the answer is faithful to the evidence"),
  reason: z.string().default(""),
});
const covSchema = z.object({
  covered_count: z.number().int().describe("Number of key points the agent answer correctly covers"),
});

const COVERAGE_SYS =
  "You are an answer-coverage reviewer. You are given the user question, the standard answer's list of key points, and the agent's answer.\n" +
  "Count how many key points the agent's answer covers correctly: a point counts only when its information is correctly reflected in the answer; omissions, fabrications, and wrong answers do not count.\n" +
  "Return only the number of covered points (an integer), never more than the total number of points.";

const COVERAGE_PROMPT = ChatPromptTemplate.fromMessages([
  ["system", COVERAGE_SYS],
  [
    "human",
    "User question: {query}\n\nStandard answer key points ({n} in total):\n{points}\n\nAgent answer:\n{answer}",
  ],
]);

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
const retrSem = new Semaphore(RETR_CONCURRENCY);
const genSem = new Semaphore(GEN_CONCURRENCY);
const errors: string[] = [];

function loadSamples(): Sample[] {
  const raw = fs.readFileSync(
    path.join(ROOT, "tests/data/eval_rag.jsonl"),
    "utf8",
  );
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => sampleSchema.parse(JSON.parse(line)));
}

function mean(xs: (number | null)[]): number {
  const values = xs.filter((x): x is number => x !== null);
  return values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;
}

function hitRank(hits: KnowledgeHit[], aliases: string[]): number {
  for (let i = 0; i < hits.length; i += 1) {
    const sp = hits[i].section_path ?? "";
    if (aliases.some((w) => sp.includes(w))) {
      return i + 1;
    }
  }
  return 0;
}

function groups(sample: Sample): string[][] {
  const multi = sample.expect_sections_all;
  if (multi && multi.length > 0) {
    return multi.map((g) => (Array.isArray(g) ? g : [g]));
  }
  return [sample.expect_section ?? []];
}

function ranksPerGroup(hits: KnowledgeHit[], sample: Sample): number[] {
  return groups(sample).map((g) => hitRank(hits, g));
}

function recallAt(ranks: number[], k: number): number {
  return mean(ranks.map((r) => (r > 0 && r <= k ? 1 : 0)));
}

function reciprocalRank(ranks: number[]): number {
  return mean(ranks.map((r) => (r > 0 ? 1 / r : 0)));
}

function normText(s: string): string {
  return (s ?? "").split(/\s+/).join("");
}

function evidenceText(hits: KnowledgeHit[]): string {
  return hits.map((h) => `${h.question}:${h.answer}`).join("\n");
}

function coverageMech(
  points: string[] | undefined,
  hits: KnowledgeHit[],
): number | null {
  if (!points || points.length === 0) {
    return null;
  }
  const ev = normText(evidenceText(hits));
  return points.filter((p) => ev.includes(normText(p))).length / points.length;
}

function formatEvidence(hits: KnowledgeHit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${h.question}:${h.answer}`).join("\n");
}

async function tryCall<T>(
  factory: () => Promise<T>,
  label: string,
): Promise<T | null> {
  for (let i = 0; i < 2; i += 1) {
    try {
      return await withTimeout(factory(), CALL_TIMEOUT);
    } catch (error) {
      if (i === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      errors.push(
        `${label}: ${error instanceof Error ? error.constructor.name : "Error"}`,
      );
    }
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error("call timeout")); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

type HitsByStrategy = Record<string, Record<string, KnowledgeHit[]>>;

async function deterministic(samples: Sample[]): Promise<{
  retrieval: Record<string, Record<string, { recall: number; mrr: number }>>;
  coverage: Record<string, Record<string, number>>;
  hits: HitsByStrategy;
}> {
  const graded = samples.filter((s) => GRADED_BUCKETS.includes(s.bucket));
  const retrievalOut: Record<
    string,
    Record<string, { recall: number; mrr: number }>
  > = {};
  const coverageOut: Record<string, Record<string, number>> = {};
  const hitsByStrategy: HitsByStrategy = {};
  logLine(`=== Stage 1 retrieval: four strategies × buckets, Recall@${RECALL_K} / MRR ===`);
  for (const strat of STRATEGIES) {
    const hitsList = await Promise.all(
      graded.map((s) =>
        retrSem.use(() =>
          retrieval.searchKnowledge(s.query, { strategy: strat, topK: K }),
        ),
      ),
    );
    hitsByStrategy[strat] = Object.fromEntries(
      graded.map((s, i) => [s.id, hitsList[i]]),
    );
    const byBucket: Record<string, { recall: number; mrr: number }> = {};
    const covBucket: Record<string, number> = {};
    const allRec: number[] = [];
    const allRr: number[] = [];
    const allCov: number[] = [];
    for (const bucket of GRADED_BUCKETS) {
      const idx = graded
        .map((s, i) => (s.bucket === bucket ? i : -1))
        .filter((i) => i >= 0);
      const ranks = idx.map((i) => ranksPerGroup(hitsList[i], graded[i]));
      const covs = idx.map((i) =>
        coverageMech(graded[i].expect_points, hitsList[i]),
      );
      const rec = mean(ranks.map((r) => recallAt(r, RECALL_K)));
      const mrr = mean(ranks.map((r) => reciprocalRank(r)));
      byBucket[bucket] = {
        recall: Number(rec.toFixed(3)),
        mrr: Number(mrr.toFixed(3)),
      };
      covBucket[bucket] = Number(mean(covs).toFixed(3));
      allRec.push(...ranks.map((r) => recallAt(r, RECALL_K)));
      allRr.push(...ranks.map((r) => reciprocalRank(r)));
      allCov.push(...covs.filter((c): c is number => c !== null));
    }
    byBucket.overall = {
      recall: Number(mean(allRec).toFixed(3)),
      mrr: Number(mean(allRr).toFixed(3)),
    };
    covBucket.overall = Number(mean(allCov).toFixed(3));
    retrievalOut[strat] = byBucket;
    coverageOut[strat] = covBucket;
    logLine(
      `${strat.padEnd(16)}${GRADED_BUCKETS.map((b) => `  R${byBucket[b].recall.toFixed(2)}/M${byBucket[b].mrr.toFixed(2)}`.padStart(16)).join("")}  R${byBucket.overall.recall.toFixed(2)}/M${byBucket.overall.mrr.toFixed(2)}`,
    );
  }
  logLine(
    `\n=== Stage 2 evidence coverage (share of standard key points covered by the top-${K} evidence; mechanical matching, deterministic) ===`,
  );
  for (const strat of STRATEGIES) {
    logLine(
      `${strat.padEnd(16)}${GRADED_BUCKETS.map((b) => coverageOut[strat][b].toFixed(2).padStart(12)).join("")}${coverageOut[strat].overall.toFixed(2).padStart(12)}`,
    );
  }
  return {
    retrieval: retrievalOut,
    coverage: coverageOut,
    hits: hitsByStrategy,
  };
}

interface FaithDetail {
  id: string;
  bucket: string;
  query: string;
  answer: string;
  reason: string;
  citations: Record<string, unknown>[];
}

interface GenResult {
  strat: string;
  bucket: string;
  coverage: number | null;
  faithful: boolean | null;
  faithDetail: FaithDetail | null;
  guardHits: Record<string, unknown>[];
}

async function genOne(
  strat: Strategy,
  sample: Sample,
  hits: HitsByStrategy,
): Promise<GenResult> {
  const sampleHits = hits[strat]?.[sample.id] ?? [];
  const evidence = formatEvidence(sampleHits);
  const model = getChatModel();
  return genSem.use(async () => {
    const ans = await tryCall(
      () =>
        RAG_ANSWER_PROMPT.pipe(model).invoke({ query: sample.query, evidence }),
      `gen:${strat}:${sample.id}`,
    );
    if (ans === null) {
      return {
        strat,
        bucket: sample.bucket,
        coverage: null,
        faithful: null,
        faithDetail: null,
        guardHits: [],
      };
    }
    let text = contentToString(ans.content);
    const guardHits: Record<string, unknown>[] = [];
    const bad = modelGuard.unsupportedModels(text, evidence);
    if (bad.length > 0) {
      guardHits.push({ id: sample.id, strat, models: bad, fixed: false });
      const retry = await tryCall(
        () =>
          RAG_ANSWER_PROMPT.pipe(model).invoke({
            query: sample.query,
            evidence: `${evidence}\n\n${modelGuard.repairHint(bad)}`,
          }),
        `guard-retry:${strat}:${sample.id}`,
      );
      if (
        retry !== null &&
        modelGuard.unsupportedModels(contentToString(retry.content), evidence)
          .length === 0
      ) {
        text = contentToString(retry.content);
        guardHits[guardHits.length - 1].fixed = true;
      }
    }
    const points = sample.expect_points ?? [];
    let coverage: number | null = null;
    if (points.length > 0) {
      const covJudge = structured(covSchema, { temperature: 0 });
      const cov = await tryCall(
        () =>
          COVERAGE_PROMPT.pipe(covJudge).invoke({
            query: sample.query,
            n: points.length,
            points: points.map((p, i) => `${i + 1}. ${p}`).join("\n"),
            answer: text,
          }),
        `cov:${strat}:${sample.id}`,
      );
      if (cov !== null) {
        coverage = Math.min(cov.covered_count, points.length) / points.length;
      }
    }
    let faithful: boolean | null = null;
    let faithDetail: FaithDetail | null = null;
    if (strat === "hybrid_rerank") {
      const judge = structured(faithSchema, { temperature: 0 });
      const fa = await tryCall(
        () =>
          FAITHFULNESS_PROMPT.pipe(judge).invoke({ evidence, answer: text }),
        `faith:${sample.id}`,
      );
      if (fa !== null) {
        faithful = fa.faithful;
        if (!faithful) {
          faithDetail = {
            id: sample.id,
            bucket: sample.bucket,
            query: sample.query,
            answer: text,
            reason: fa.reason,
            citations: sampleHits.map((h, i) => ({
              n: i + 1,
              chunk_id: h.id,
              section_path: h.section_path,
              question: h.question,
              answer: h.answer,
            })),
          };
        }
      }
    }
    return {
      strat,
      bucket: sample.bucket,
      coverage,
      faithful,
      faithDetail,
      guardHits,
    };
  });
}

async function ledger(cases: FaithDetail[]): Promise<void> {
  if (cases.length === 0) {
    logLine("\n-- Fabrication case ledger: 0 cases this round, nothing to write --");
    return;
  }
  try {
    let reopened = 0;
    for (const c of cases) {
      const [, wasResolved] = await repository.upsertFaithCase(
        c.id,
        c.bucket,
        c.query,
        c.answer,
        c.reason,
        {
          citations: c.citations,
          judgeModel: settings.chatModel,
        },
      );
      if (wasResolved) {
        reopened += 1;
      }
    }
    const { total, counts } = await repository.listFaithCases(null, 1, 1);
    logLine(
      `\n-- Fabrication case ledger: ${cases.length} cases written this round, ${total} entries in total` +
        ` (unresolved ${counts.unresolved} · resolved ${counts.resolved} · dismissed ${counts.dismissed})` +
        (reopened > 0 ? `; ${reopened} of them recurred after being handled` : "") +
        " --",
    );
  } catch (error) {
    logLine(
      `\n-- Fabrication case ledger write failed (${error instanceof Error ? error.constructor.name : "Error"}); the report is unaffected --`,
    );
  }
}

async function refusalOne(
  sample: Sample,
): Promise<{
  refused: boolean;
  detail: Record<string, unknown> | null;
} | null> {
  const out = await genSem.use(() =>
    tryCall(() => queryFaq({ keyword: sample.query }), `refuse:${sample.id}`),
  );
  if (out === null) {
    return null;
  }
  const refused = !out.sufficient;
  let detail: Record<string, unknown> | null = null;
  if (!refused) {
    const top = out.citations[0];
    detail = {
      id: sample.id,
      query: sample.query,
      section_path: top?.section_path ?? "",
      evidence: `${top?.question ?? ""}:${top?.answer ?? ""}`.slice(0, 220),
    };
  }
  return { refused, detail };
}

async function generation(
  samples: Sample[],
  hits: HitsByStrategy,
): Promise<Record<string, unknown>> {
  const graded = samples.filter((s) => GRADED_BUCKETS.includes(s.bucket));
  const absent = samples.filter((s) => s.bucket === "D_absent");
  logLine("\n=== Stage 3 generation: four-strategy answer coverage (graded) + Faithfulness + bucket-D refusal ===");
  const tasks: Promise<
      | GenResult
      | { refused: boolean; detail: Record<string, unknown> | null }
      | null
    >[] = [];
  for (const strat of STRATEGIES) {
    for (const sample of graded) {
      tasks.push(genOne(strat, sample, hits));
    }
  }
  tasks.push(...absent.map((s) => refusalOne(s)));
  const results = await Promise.all(tasks);
  const genResults = results
    .slice(0, STRATEGIES.length * graded.length)
    .filter((r): r is GenResult => r !== null && "strat" in r);
  const rawRefusals = results.slice(STRATEGIES.length * graded.length);
  const refusals = rawRefusals.filter(
    (r): r is { refused: boolean; detail: Record<string, unknown> | null } =>
      r !== null && "refused" in r,
  );
  const refusalSkipped = absent
    .filter((_, i) => rawRefusals[i] === null)
    .map((s) => s.id);

  if (
    refusals.length === 0 &&
    !genResults.some((r) => r.coverage !== null || r.faithful !== null)
  ) {
    throw new Error(
      `All ${errors.length} calls in the generation stage failed (upstream unavailable); refusing to record zero scores`,
    );
  }

  const answerCov: Record<string, Record<string, number | null>> = {};
  logLine("\n-- Answer coverage (share of standard key points covered by the generated answer) --");
  for (const strat of STRATEGIES) {
    const by: Record<string, number | null> = {};
    const allc: number[] = [];
    for (const bucket of GRADED_BUCKETS) {
      const cs = genResults
        .filter(
          (r): r is GenResult & { coverage: number } =>
            r.strat === strat && r.bucket === bucket && r.coverage !== null,
        )
        .map((r) => r.coverage);
      by[bucket] = cs.length > 0 ? Number(mean(cs).toFixed(3)) : null;
      allc.push(...cs);
    }
    by.overall = allc.length > 0 ? Number(mean(allc).toFixed(3)) : null;
    answerCov[strat] = by;
    logLine(
      `${strat.padEnd(16)}${[...GRADED_BUCKETS, "overall"].map((b) => (by[b] === null ? "     not graded" : by[b].toFixed(2).padStart(12))).join("")}`,
    );
  }

  const faithfulness: Record<string, { v: number | null; answered: number }> =
    {};
  logLine("\n-- Faithfulness (hybrid_rerank production pipeline; the answer fabricates nothing) --");
  for (const bucket of GRADED_BUCKETS) {
    const fsVals = genResults
      .filter(
        (r) =>
          r.strat === "hybrid_rerank" &&
          r.bucket === bucket &&
          r.faithful !== null,
      )
      .map((r) => (r.faithful ? 1 : 0));
    faithfulness[bucket] = {
      v: fsVals.length > 0 ? Number(mean(fsVals).toFixed(3)) : null,
      answered: fsVals.length,
    };
    logLine(
      `${bucket.padEnd(14)} faithfulness=${fsVals.length === 0 ? "not graded" : (faithfulness[bucket].v ?? 0).toFixed(3)} (${fsVals.length} questions graded)`,
    );
  }

  const faithCases = genResults
    .map((r) => r.faithDetail)
    .filter((c): c is FaithDetail => c !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  logLine(
    faithCases.length > 0
      ? `\n-- Cases judged unfaithful (fabricated): ${faithCases.length} → ${faithCases.map((c) => c.id).join(", ")} --`
      : "\n-- Cases judged unfaithful (fabricated): 0 --",
  );

  const correct = refusals.filter((r) => r.refused).length;
  const rate = refusals.length > 0 ? correct / refusals.length : null;
  logLine(
    `\n-- Bucket-D refusal rate (production pipeline) = ${rate === null ? "not graded" : rate.toFixed(3)} (${correct}/${refusals.length} correctly refused; ${refusals.length}/${absent.length} questions graded) --`,
  );
  const missCases = refusals
    .map((r) => r.detail)
    .filter((d): d is Record<string, unknown> => d !== null)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const c of missCases) {
    logLine(
      `   should have refused but did not: ${String(c.id)} "${String(c.query)}" ← evidence mistaken for an answer: ${String(c.section_path)}`,
    );
  }
  if (refusalSkipped.length > 0) {
    logLine(`   not graded (call failed/timed out): ${refusalSkipped.join(", ")}`);
  }

  const guardHits = genResults.flatMap((r) => r.guardHits);
  const guard = {
    hits: guardHits.length,
    fixed: guardHits.filter((h) => h.fixed === true).length,
    cases: guardHits,
  };
  logLine(
    `\n-- Model-number mechanical gate: ${guard.hits} hits, ${guard.fixed} rescued by rewriting --`,
  );

  await ledger(faithCases);

  return {
    answer_coverage: answerCov,
    faithfulness,
    faithfulness_cases: faithCases,
    model_guard: guard,
    refusal: {
      rate: rate === null ? null : Number(rate.toFixed(3)),
      total: refusals.length,
      correct,
      cases: missCases,
      skipped_ids: refusalSkipped,
    },
    skipped: errors.length,
  };
}

function labeled<T>(
  data: Record<string, Record<string, T>>,
  pick?: (d: T) => unknown,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const strat of STRATEGIES) {
    const row: Record<string, unknown> = {};
    for (const bucket of [...GRADED_BUCKETS, "overall"]) {
      const raw = data[strat]?.[bucket];
      row[BUCKET_LABEL[bucket]] = pick ? pick(raw) : raw;
    }
    out[STRATEGY_LABEL[strat]] = row;
  }
  return out;
}

function isNestedRecord(
  value: unknown,
): value is Record<string, Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (inner) => typeof inner === "object" && inner !== null,
    )
  );
}

async function buildReadNotes(
  retrievalData: Record<
    string,
    Record<string, { recall: number; mrr: number }>
  >,
  coverageData: Record<string, Record<string, number>>,
  generationData: Record<string, unknown> | null,
): Promise<Record<string, string>> {
  const jobs: Record<string, unknown> = {
    rag_mrr: labeled(retrievalData, (d) => d.mrr),
    rag_recall: labeled(retrievalData, (d) => d.recall),
    rag_coverage: labeled(coverageData),
  };
  if (generationData) {
    const answerCov = generationData.answer_coverage;
    if (isNestedRecord(answerCov)) {
      jobs.rag_answer_coverage = labeled(answerCov);
    }
  }
  const notes = await readNotes.generateAll(jobs);
  logLine(
    `\nRead notes: generated ${Object.keys(notes).length}/${Object.keys(jobs).length}` +
      (Object.keys(notes).length === Object.keys(jobs).length
        ? ""
        : " (the missing ones fall back to the page's default sentence)"),
  );
  return notes;
}

async function main(): Promise<void> {
  const samples = loadSamples();
  const per = new Map<string, number>();
  for (const s of samples) {
    per.set(s.bucket, (per.get(s.bucket) ?? 0) + 1);
  }
  logLine(
    `Eval set: ${samples.length} questions (${[...per.entries()].map(([b, n]) => `${BUCKET_LABEL[b] ?? b} ${n}`).join(", ")}), strategies ${STRATEGIES.join(",")}`,
  );
  logLine(
    `Retrieval concurrency ${RETR_CONCURRENCY} · generation concurrency ${GEN_CONCURRENCY} · per-call timeout ${CALL_TIMEOUT / 1000}s\n`,
  );
  const {
    retrieval: retrievalData,
    coverage: coverageData,
    hits,
  } = await deterministic(samples);
  let generationData: Record<string, unknown> | null = null;
  if (SKIP_GEN) {
    logLine("\n[Generation stage skipped] --skip-gen: only the two deterministic stages ran this round.");
  } else {
    try {
      generationData = await generation(samples, hits);
    } catch (error) {
      logLine(
        `\n[Generation stage incomplete] ${error instanceof Error ? error.message.slice(0, 140) : "Error"}`,
      );
      logLine("The retrieval stage and evidence coverage are done; re-run to complete it once the upstream recovers.");
    }
  }
  if (errors.length > 0) {
    logLine(
      `\nNote: ${errors.length} calls in the generation stage timed out/failed and were skipped (unstable upstream); scores use the available samples.`,
    );
  }
  const knowledgeCount = await store.count().catch(() => "—");
  const meta = {
    n_samples: samples.length,
    kb_chunks: knowledgeCount,
    recall_k: RECALL_K,
    retrieve_k: K,
    concurrency: GEN_CONCURRENCY,
    chat_model: settings.chatModel,
    generated_at: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
  const notes = SKIP_GEN
    ? {}
    : await buildReadNotes(retrievalData, coverageData, generationData);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_TXT, `${lines.join("\n")}\n`, "utf8");
  const report = {
    meta,
    retrieval: retrievalData,
    evidence_coverage: coverageData,
    generation: generationData,
    read_notes: notes,
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 1)}\n`, "utf8");
  logLine(
    `\nGenerated: data/rag/reports/rag_eval.json · data/rag/reports/rag_eval.txt`,
  );
  logLine(
    generationData !== null
      ? "Done."
      : "Done (retrieval stage + evidence coverage only; re-run the generation stage once the upstream recovers).",
  );
}

try {
  await main();
} finally {
  await closeDb();
}
