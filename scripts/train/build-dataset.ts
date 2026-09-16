// train dataset: stratified 80/10/10 split + training-set augmentation (synonym swap / phrasing tweak).
// Augmentation only expands the training set — validation/test are exam papers and must not change.
// Run: make train-dataset (requires chat upstream).
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "#/config.ts";
import { getChatModel } from "#/core/llm.ts";
import { contentToString } from "#/core/memory.ts";
import { TOPIC_NAMES } from "#/core/taxonomy.ts";
import { mapPool } from "#/train/concurrency.ts";
import { type CorpusSample, splitDataset } from "#/train/corpus-lib.ts";

const corpusSampleSchema = z.object({
  text: z.string(),
  labels: z.array(z.string()),
  origin: z.string().optional(),
});

const SRC = path.join(settings.root, "data/train/corpus_labeled.jsonl");
const OUT = path.join(settings.root, "data/train/dataset");
// Targeted supplement from the first evaluation failure: bare "bought it too big, want to return"
// short sentences (no product name, no "size" word) were under-covered, so sizing was not labeled.
// Supplements go only into the training set — the exam papers do not move.
const SUPPLEMENT = path.join(
  settings.root,
  "scripts/train/supplement_sizefit.jsonl",
);

const AUGMENT_PROMPT = (text: string): string =>
  `Rewrite a variant of this e-commerce customer-service user question: swap synonyms, tweak the phrasing (e.g. turn it into an "I'd like to ask…" tone), without changing the original meaning or adding/removing any asks. Output only the rewritten sentence.\n\n${text}`;

function readJsonl(file: string): CorpusSample[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => corpusSampleSchema.parse(JSON.parse(l)));
}

async function augment(
  samples: CorpusSample[],
  concurrency = 8,
): Promise<CorpusSample[]> {
  const model = getChatModel();
  const outs = await mapPool(
    samples,
    concurrency,
    async (s): Promise<CorpusSample | null> => {
      try {
        const r = await model.invoke(AUGMENT_PROMPT(s.text));
        const t = contentToString(r.content).trim();
        return t ? { text: t, labels: s.labels, origin: "augmented" } : null;
      } catch (error) {
        console.log(
          `[augment] rewrite failed, dropping variant: ${s.text.slice(0, 30)}… (${error instanceof Error ? error.constructor.name : "Error"})`,
        );
        return null;
      }
    },
  );
  return outs.filter((o): o is CorpusSample => o !== null);
}

// Dataset files carry only text + labels (origin is a corpus-stage field, dropped here).
function dump(file: string, samples: CorpusSample[]): void {
  fs.writeFileSync(
    path.join(OUT, file),
    samples
      .map((s) => JSON.stringify({ text: s.text, labels: s.labels }))
      .join("\n"),
    "utf8",
  );
}

function dist(name: string, samples: CorpusSample[]): void {
  const counts: Record<string, number> = Object.fromEntries(
    TOPIC_NAMES.map((n) => [n, 0]),
  );
  for (const s of samples) {
    for (const lb of s.labels) {
      if (lb in counts) {
        counts[lb] += 1;
      }
    }
  }
  console.log(
    `${name} (${samples.length}): ` +
      Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );
}

async function main(): Promise<void> {
  const samples = readJsonl(SRC);
  if (samples.length === 0) {
    console.error(`No corpus at ${SRC}; run make train-corpus first`);
    process.exitCode = 1;
    return;
  }
  // eslint-disable-next-line prefer-const
  let [train, val, test] = splitDataset(samples);
  const aug = await augment(train);
  const seen = new Set(samples.map((s) => s.text)); // a variant colliding with any original (incl. exam) is dropped
  train = train.concat(aug.filter((a) => !seen.has(a.text)));
  if (fs.existsSync(SUPPLEMENT)) {
    const sup = readJsonl(SUPPLEMENT);
    train = train.concat(
      sup
        .filter((s) => !seen.has(s.text))
        .map((s) => ({ ...s, origin: "supplement" })),
    );
  }
  fs.mkdirSync(OUT, { recursive: true });
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  for (const [name, ds] of [
    ["train", train],
    ["val", val],
    ["test", test],
  ] as [string, CorpusSample[]][]) {
    dump(`${name}.jsonl`, ds);
    dist(name, ds);
  }
}

await main();
