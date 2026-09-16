// Vector recall acceptance: paraphrased questions should retrieve the expected content.
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "@/config.ts";
import * as retrieval from "@/core/retrieval.ts";

const sampleSchema = z.object({
  query: z.string(),
  expect_answer_contains: z.string(),
});

const samples = z
  .array(sampleSchema)
  .parse(
    JSON.parse(
      fs.readFileSync(
        path.join(settings.root, "tests/data/retrieval_samples.json"),
        "utf8",
      ),
    ),
  );
let failures = 0;
for (const sample of samples) {
  const hits = await retrieval.searchKnowledge(sample.query, {
    strategy: "vector",
  });
  const top = hits[0];
  const ok =
    top !== undefined && top.answer.includes(sample.expect_answer_contains);
  if (!ok) {
    failures += 1;
  }
  const detail = top ? `${top.question} | ${top.answer.slice(0, 30)}` : "(empty)";
  console.log(
    `${ok ? "✅" : "❌"} ${JSON.stringify(sample.query)} -> ${detail}`,
  );
}
console.log(`\nCorrect recalls ${samples.length - failures}/${samples.length}`);
process.exitCode = failures > 0 ? 1 : 0;
