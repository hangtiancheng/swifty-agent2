// ch10 corpus pipeline: fetch pool -> desensitize/dedup -> LLM typo fix -> LLM pre-label ->
// simulate to fill -> export human spot-review. Run: make ch10-corpus (requires DB + chat upstream).
// Artifacts land in data/train/; the spot-review file is reviewed in the conversation.
// Also writes data/train/taxonomy.json so the vendored Python training side reads the same
// authoritative taxonomy (single source of truth = src/core/taxonomy.ts).
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { prelabelBatch } from "./prelabel.ts";

import { settings } from "#/config.ts";
import { getChatModel, structured } from "#/core/llm.ts";
import { contentToString } from "#/core/memory.ts";
import { LABEL2ID, SEVERITY, TOPIC_CLASSES, TOPIC_NAMES, terminologyTable } from "#/core/taxonomy.ts";
import { closeDb } from "#/db/client.ts";
import * as repository from "#/db/repository.ts";
import { mapPool } from "#/train/concurrency.ts";
import { type CorpusSample, dedupe, desensitize } from "#/train/corpus-lib.ts";

const OUT = path.join(settings.root, "data/train");
const TARGET_PER_CLASS = 100;
const SIM_BATCH = 20; // items per simulation call; small batches, many calls, to control quality

const CLEAN_PROMPT = (text: string): string =>
  `Fix the typos and broken formatting in this user question: do not change the meaning, the colloquial style, or add/remove any asks. If there is nothing wrong, return it unchanged. Output only the sentence itself.\n\n${text}`;

const SIMULATE_PROMPT = (n: number, name: string): string =>
  `You are a corpus data generator for an e-commerce customer service system. For the cat-supplies store "MeowMeow Select" (selling cat food, freeze-dried food, cat treats, litter boxes, scratchers, cat beds, cat trees, cat bowls, teaser wands, collars, etc.), generate ${n} simulated user questions that all hit the topic class "${name}".

Authoritative 17-class terminology table:
${terminologyTable()}

Requirements:
1. Each item is a standalone, semantically complete, colloquial user question; vary length and tone, keep them close to real customer-service questions, and do not repeat each other.
2. About 15% use dialect/slang, 10% intentionally contain typos, and 15% are multi-ask sentences — besides "${name}", literally mention one ask from another class, and put both classes in labels.
3. The remaining items contain only the "${name}" ask, so labels holds just it.
4. Label rule: label exactly as many asks as are literally mentioned, no more, no less; labels must be the exact class names from the terminology table.`;

const simBatchSchema = z.object({
  items: z.array(z.object({ text: z.string(), labels: z.array(z.string()) })),
});

function dump(file: string, samples: CorpusSample[]): void {
  fs.writeFileSync(
    path.join(OUT, file),
    samples.map((s) => JSON.stringify(s)).join("\n"),
    "utf8",
  );
}

async function cleanTexts(texts: string[], concurrency = 8): Promise<string[]> {
  const model = getChatModel();
  return mapPool(texts, concurrency, async (t) => {
    try {
      const r = await model.invoke(CLEAN_PROMPT(t));
      const out = contentToString(r.content).trim();
      return out || t;
    } catch (error) {
      console.log(`[clean] call failed, keeping as-is: ${t.slice(0, 30)}… (${error instanceof Error ? error.constructor.name : "Error"})`);
      return t;
    }
  });
}

async function simulate(name: string, need: number): Promise<CorpusSample[]> {
  const model = structured(simBatchSchema);
  const out: CorpusSample[] = [];
  let misses = 0;
  while (out.length < need && misses < 5) {
    const n = Math.min(SIM_BATCH, need - out.length);
    let r: z.infer<typeof simBatchSchema>;
    try {
      r = await model.invoke(SIMULATE_PROMPT(n, name));
    } catch (error) {
      console.log(`[simulate] ${name} batch failed (${error instanceof Error ? error.constructor.name : "Error"}), retrying (misses=${misses + 1})`);
      misses += 1;
      continue;
    }
    let got = 0;
    for (const it of r.items) {
      const labels = it.labels.filter((lb) => lb in LABEL2ID);
      if (!labels.includes(name)) {
        labels.unshift(name);
      }
      if (it.text.trim()) {
        out.push({ text: it.text.trim(), labels, origin: "simulated" });
        got += 1;
      }
    }
    misses = got === 0 ? misses + 1 : 0;
  }
  return out.slice(0, need);
}

// Deterministic seeded sample for the spot-review export (mulberry32 + partial Fisher-Yates).
function seededSample<T>(items: T[], k: number, seed: number): T[] {
  const arr = [...items];
  let a = seed >>> 0;
  const rng = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < k && i < arr.length; i += 1) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k);
}

function writeTaxonomy(): void {
  // The vendored Python training side (train/evaluate/export_onnx) reads this so the label ids,
  // names and severity all come from src/core/taxonomy.ts — one source of truth, no drift.
  fs.writeFileSync(
    path.join(OUT, "taxonomy.json"),
    `${JSON.stringify(
      { names: TOPIC_NAMES, severity: SEVERITY, label2id: LABEL2ID, classes: TOPIC_CLASSES },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  writeTaxonomy();

  // 1) Fetch pool (normalized phrasing preferred)
  const pool = await repository.listPoolTexts();
  const raw: CorpusSample[] = pool.map((p) => ({ text: p.text, labels: [], origin: "pool" }));
  dump("corpus_raw.jsonl", raw);
  console.log(`Fetched ${raw.length} from the pool`);

  // 2) Clean: desensitize -> dedup -> LLM typo fix -> dedup again
  let cleaned = dedupe(raw.map((s) => ({ ...s, text: desensitize(s.text) })));
  const fixed = await cleanTexts(cleaned.map((s) => s.text));
  cleaned = dedupe(cleaned.map((s, i) => ({ ...s, text: fixed[i] })));
  dump("corpus_clean.jsonl", cleaned);
  console.log(`After cleaning ${cleaned.length}`);

  // 3) Pre-label the real questions
  const labels = await prelabelBatch(cleaned.map((s) => s.text));
  let labeled: CorpusSample[] = cleaned.map((s, i) => ({ ...s, labels: labels[i] }));

  // 4) Simulate to fill: top up each class to TARGET_PER_CLASS (multi-ask sentences count for every hit class)
  const counts: Record<string, number> = Object.fromEntries(TOPIC_CLASSES.map((c) => [c.name, 0]));
  for (const s of labeled) {
    for (const lb of s.labels) {
      if (lb in counts) {
        counts[lb] += 1;
      }
    }
  }
  for (const c of TOPIC_CLASSES) {
    const need = TARGET_PER_CLASS - counts[c.name];
    if (need <= 0) {
      continue;
    }
    const sims = await simulate(c.name, need);
    labeled.push(...sims);
    for (const s of sims) {
      for (const lb of s.labels) {
        if (lb in counts) {
          counts[lb] += 1;
        }
      }
    }
    console.log(`${c.name}: simulated ${sims.length} (now ${counts[c.name]})`);
  }
  labeled = dedupe(labeled);
  dump("corpus_labeled.jsonl", labeled);
  console.log(`Corpus total ${labeled.length}; per class: ${JSON.stringify(counts)}`);

  // 5) Spot-review export: all real pool questions + 5 simulated per class
  const lines = [
    "# ch10 corpus human spot-review (pre-label + simulation)",
    "",
    "> Format: question -> labels. Point out the original sentence for any mislabel.",
    "",
    "## Real pool questions (all)",
    "",
  ];
  for (const s of labeled) {
    if (s.origin === "pool") {
      lines.push(`- ${s.text} -> ${s.labels.join(", ")}`);
    }
  }
  lines.push("", "## Simulated questions (5 per class)", "");
  for (const c of TOPIC_CLASSES) {
    const sims = labeled.filter((s) => s.origin === "simulated" && s.labels.includes(c.name));
    lines.push(`### ${c.name}`);
    for (const s of seededSample(sims, Math.min(5, sims.length), 42)) {
      lines.push(`- ${s.text} -> ${s.labels.join(", ")}`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(OUT, "sample_review.md"), lines.join("\n"), "utf8");
  console.log(`Spot-review file exported: ${path.join(OUT, "sample_review.md")}`);
}

await main();
await closeDb();
