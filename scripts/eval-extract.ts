// Run labeled samples against /api/extract; check order_id and request_type
// (expected_solution is eyeballed by a human). Requires the app running.
// Run: node scripts/eval-extract.ts
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "#/config.ts";

const BASE = `http://localhost:${settings.port ?? 8000}`;

const sampleSchema = z.object({
  text: z.string(),
  expected: z.object({
    order_id: z.string().nullable(),
    request_type: z.string(),
  }),
});
const extractResponseSchema = z.object({
  order_id: z.string().nullable(),
  request_type: z.string(),
  expected_solution: z.string(),
});

async function main(): Promise<number> {
  const file = path.join(settings.root, "tests/data/extract_samples.json");
  const samples = z
    .array(sampleSchema)
    .parse(JSON.parse(fs.readFileSync(file, "utf8")));
  let failures = 0;
  let i = 0;
  for (const s of samples) {
    i += 1;
    const resp = await fetch(`${BASE}/api/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: s.text }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    }
    const got = extractResponseSchema.parse(await resp.json());
    const exp = s.expected;
    const ok =
      got.order_id === exp.order_id && got.request_type === exp.request_type;
    failures += ok ? 0 : 1;
    console.log(`[${ok ? "PASS" : "FAIL"}] #${i} ${s.text.slice(0, 24)}...`);
    console.log(
      `       expected order_id=${exp.order_id} type=${exp.request_type}`,
    );
    console.log(
      `       actual   order_id=${got.order_id} type=${got.request_type} solution=${got.expected_solution}`,
    );
  }
  console.log(`\n${samples.length - failures}/${samples.length} passed`);
  return failures > 0 ? 1 : 0;
}

process.exitCode = await main();
