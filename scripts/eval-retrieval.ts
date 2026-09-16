// Vector recall acceptance: paraphrased questions should retrieve the expected content.
import fs from "node:fs";
import path from "node:path";

import { settings } from "../src/config.ts";
import * as retrieval from "../src/core/retrieval.ts";

interface Sample {
  query: string;
  expect_answer_contains: string;
}

const samples = JSON.parse(fs.readFileSync(path.join(settings.root, "tests/data/retrieval_samples.json"), "utf8")) as Sample[];
let failures = 0;
for (const sample of samples) {
  const hits = await retrieval.searchKnowledge(sample.query, { strategy: "vector" });
  const top = hits[0];
  const ok = top !== undefined && top.answer.includes(sample.expect_answer_contains);
  if (!ok) {
    failures += 1;
  }
  const detail = top ? `${top.question} | ${top.answer.slice(0, 30)}` : "(空)";
  console.log(`${ok ? "✅" : "❌"} ${JSON.stringify(sample.query)} -> ${detail}`);
}
console.log(`\n召回正确 ${samples.length - failures}/${samples.length}`);
process.exitCode = failures > 0 ? 1 : 0;
