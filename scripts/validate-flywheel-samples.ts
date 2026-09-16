// observability prompt labeled-sample validation (working requirement: for a pure-prompt task, run the
// labeled samples once instead of TDD).
// Scoring: matched_question_id equals expect_match = dedup correct; normalized_question contains all
// expect_keywords = normalization correct (keywords are only checked on the create-new samples).
// Both must pass; a pass rate >= 80% counts as usable. Requires chat upstream.
// Run: node scripts/validate-flywheel-samples.ts
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "#/config.ts";
import { structured } from "#/core/llm.ts";
import { FLYWHEEL_NORMALIZE_PROMPT } from "#/core/prompts.ts";

const THRESHOLD = 0.8;

// Same schema and prompt the flywheel pipeline uses (src/core/flywheel.ts inlines this call inside
// processPending and does not export it, so the validation replicates the exact same chain).
const normalizeSchema = z.object({
  normalized_question: z.string().describe("FAQ-style standard question"),
  matched_question_id: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe("Matched candidate id; null when no candidate is the same kind"),
  ai_suggested_answer: z
    .string()
    .default("")
    .describe("Sample answer for reference"),
});

const candidateSchema = z.object({
  id: z.number(),
  normalized_question: z.string(),
});
const sampleSchema = z.object({
  raw_question: z.string(),
  candidates: z.array(candidateSchema),
  expect_match: z.number().nullable(),
  expect_keywords: z.array(z.string()),
});
type Candidate = z.infer<typeof candidateSchema>;

async function normalizeAndMatch(rawQuestion: string, candidates: Candidate[]) {
  const candidateText =
    candidates
      .map((c) => `- id=${c.id}: ${c.normalized_question}`)
      .join("\n") || "(no candidates)";
  const model = structured(normalizeSchema);
  return FLYWHEEL_NORMALIZE_PROMPT.pipe(model).invoke({
    raw_question: rawQuestion,
    candidates: candidateText,
  });
}

async function main(): Promise<number> {
  const file = path.join(settings.root, "tests/data/flywheel_samples.json");
  const samples = z
    .array(sampleSchema)
    .parse(JSON.parse(fs.readFileSync(file, "utf8")));
  let passed = 0;
  for (const s of samples) {
    let r: z.infer<typeof normalizeSchema>;
    try {
      r = await normalizeAndMatch(s.raw_question, s.candidates);
    } catch (error) {
      console.log(
        `✗ ${s.raw_question.slice(0, 24)}… call failed ${error instanceof Error ? error.constructor.name : "Error"}`,
      );
      continue;
    }
    const matchOk = r.matched_question_id === s.expect_match;
    const kwOk = s.expect_keywords.every((k) =>
      r.normalized_question.includes(k),
    );
    const ok = matchOk && kwOk;
    passed += ok ? 1 : 0;
    console.log(
      `${ok ? "✓" : "✗"} ${s.raw_question.slice(0, 24)}… → ${r.normalized_question} match=${r.matched_question_id} (expected ${s.expect_match})`,
    );
  }
  const rate = samples.length > 0 ? passed / samples.length : 0;
  console.log(
    `\nPassed ${passed}/${samples.length} = ${(rate * 100).toFixed(0)}% (line ${(THRESHOLD * 100).toFixed(0)}%)`,
  );
  return rate >= THRESHOLD ? 0 : 1;
}

process.exitCode = await main();
