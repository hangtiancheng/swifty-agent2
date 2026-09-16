// Knowledge mining eval: run extraction over sample dialogs; what should be mined is mined, and what
// should not (pure one-off cases) is not force-mined. Requires chat upstream.
// Run: node scripts/eval-mining.ts
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "#/config.ts";
import { extractQa } from "#/kb/mining.ts";

const sampleSchema = z.object({
  conversation: z.string(),
  expect_question_contains: z.string().optional(),
  expect_empty: z.boolean().optional(),
});

async function main(): Promise<number> {
  const file = path.join(settings.root, "tests/data/mining_samples.json");
  const samples = z.array(sampleSchema).parse(JSON.parse(fs.readFileSync(file, "utf8")));
  let failures = 0;
  for (const s of samples) {
    const pairs = await extractQa([s.conversation]);
    let ok: boolean;
    if (s.expect_empty) {
      ok = pairs.length === 0;
    } else {
      ok = pairs.some((p) => p.question.includes(s.expect_question_contains ?? ""));
    }
    failures += ok ? 0 : 1;
    console.log(`${ok ? "✅" : "❌"} mined ${pairs.length} pairs: ${JSON.stringify(pairs.map((p) => p.question))}`);
  }
  console.log(`\nExtraction matches expectation ${samples.length - failures}/${samples.length}`);
  return failures > 0 ? 1 : 0;
}

process.exitCode = await main();
