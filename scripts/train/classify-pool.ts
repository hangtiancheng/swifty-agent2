// train bypass batch classification: low-confidence questions accumulate, and once a batch is full they
// are grouped in one pass and the results written to topic_classifications. Not called from the live
// conversation path. Run: make classify-pool (requires DB + classifier service :8110).
// Idempotent: rows already classified (LEFT JOIN hit) are not re-classified. Cron example:
//   0 3 * * * cd /path/to/repo && make classify-pool >> log/classify-pool.log 2>&1
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "#/config.ts";
import { closeDb } from "#/db/client.ts";
import * as repository from "#/db/repository.ts";

const classifyResponseSchema = z.object({
  results: z.array(z.object({ labels: z.array(z.string()) })),
});

const SERVICE = "http://127.0.0.1:8110";
const REPORTS = path.join(settings.root, "data/train/reports");

function writeReport(
  status: string,
  pending: number,
  written: number,
  counts: Record<string, number>,
): void {
  // Each run leaves a conclusion for the acceptance page (/acceptance): a second run returning
  // status=empty is the idempotency evidence.
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(
    path.join(REPORTS, "classify_run.json"),
    `${JSON.stringify(
      {
        ran_at: new Date().toISOString().slice(0, 19),
        status,
        pending,
        written,
        counts: Object.fromEntries(
          Object.entries(counts).sort((a, b) => b[1] - a[1]),
        ),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function parseArgs(): { minBatch: number; force: boolean } {
  const args = process.argv.slice(2);
  let minBatch = 10;
  let force = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--min-batch" && args[i + 1]) {
      minBatch = Number(args[i + 1]);
      i += 1;
    } else if (args[i] === "--force") {
      force = true;
    }
  }
  return { minBatch, force };
}

async function main(): Promise<void> {
  const { minBatch, force } = parseArgs();
  const rows = await repository.listUnclassifiedQuestions(500);
  if (rows.length === 0) {
    console.log("No pending questions in the pool");
    writeReport("empty", 0, 0, {});
    return;
  }
  if (rows.length < minBatch && !force) {
    console.log(
      `${rows.length} pending, below one batch (${minBatch}); --force to run anyway`,
    );
    writeReport("below_batch", rows.length, 0, {});
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 300_000);
  let results: { labels: string[] }[];
  try {
    const resp = await fetch(`${SERVICE}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: rows.map((x) => x.text) }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const payload = classifyResponseSchema.parse(await resp.json());
    results = payload.results;
  } finally {
    clearTimeout(timer);
  }

  // strict: question_id <-> labels line up purely by position; if the service returns one too few or
  // too many it must fail loudly, otherwise misaligned labels would be permanently cemented by idempotency.
  if (results.length !== rows.length) {
    throw new Error(
      `classifier returned ${results.length} results for ${rows.length} inputs; refusing to write misaligned labels`,
    );
  }
  const n = await repository.insertTopicClassifications(
    rows.map((x, i) => ({
      question_id: x.question_id,
      labels: results[i].labels,
    })),
  );

  const counts: Record<string, number> = {};
  for (const res of results) {
    for (const lb of res.labels) {
      counts[lb] = (counts[lb] ?? 0) + 1;
    }
  }
  console.log(
    `Classified: wrote ${n} rows to topic_classifications; ` +
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );
  writeReport("done", rows.length, n, counts);
}

try {
  await main();
} catch (error) {
  console.error(
    `Bypass classification failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error("Is the classifier service running? make classifier-up");
  process.exitCode = 1;
} finally {
  await closeDb();
}
