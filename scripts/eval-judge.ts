// Faithfulness judge regression: replay human-reviewed fabrication cases and compare verdicts.
import { z } from "zod";

import { structured } from "@/core/llm.ts";
import { FAITHFULNESS_PROMPT } from "@/core/prompts.ts";
import { closeDb } from "@/db/client.ts";
import { citationSchema, parseWith } from "@/db/json.ts";
import * as repository from "@/db/repository.ts";

const CONCURRENCY = 5;

const faithSchema = z.object({
  faithful: z.boolean().describe("Whether the answer is faithful to the evidence"),
  reason: z.string().default("").describe("One-sentence justification"),
});

function evidenceFromCitations(citations: unknown): string {
  const parsed = parseWith(citationSchema, JSON.stringify(citations)) ?? [];
  return parsed
    .map((c, i) => `[${c.n ?? i + 1}] ${c.question ?? ""}:${c.answer ?? ""}`)
    .join("\n");
}

function expectedFaithful(status: string): boolean | null {
  if (status === "resolved") {
    return false;
  }
  if (status === "dismissed") {
    return true;
  }
  return null;
}

const { rows, total, counts } = await repository.listFaithCases(null, 1, 200);
const cases = rows.filter(
  (r) => expectedFaithful(r.status) !== null && (r.citations ?? "").length > 0,
);
if (cases.length === 0) {
  console.log(
    `The ledger has ${total} entries, but none is both handled and has cited source text, so there is nothing to test. Handle a few cases on the RAG evaluation page first.`,
  );
  await closeDb();
  process.exit(0);
}

const judge = structured(faithSchema, { temperature: 0 });

interface Verdict {
  id: string;
  status: string;
  expected: boolean | null;
  actual: boolean | null;
  agree: boolean;
  reason: string;
}

async function judgeOne(row: (typeof cases)[number]): Promise<Verdict> {
  const expected = expectedFaithful(row.status);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const fa = await FAITHFULNESS_PROMPT.pipe(judge).invoke({
        evidence: evidenceFromCitations(row.citations),
        answer: row.answer,
      });
      const actual = Boolean(fa.faithful);
      return {
        id: row.evalId,
        status: row.status,
        expected,
        actual,
        agree: actual === expected,
        reason: fa.reason,
      };
    } catch (error) {
      if (attempt === 2) {
        return {
          id: row.evalId,
          status: row.status,
          expected,
          actual: null,
          agree: false,
          reason: `Judge call failed: ${error instanceof Error ? error.constructor.name : "Error"}`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return {
    id: row.evalId,
    status: row.status,
    expected,
    actual: null,
    agree: false,
    reason: "unreachable",
  };
}

const outs: Verdict[] = [];
for (let i = 0; i < cases.length; i += CONCURRENCY) {
  const batch = cases.slice(i, i + CONCURRENCY);
  outs.push(...(await Promise.all(batch.map((row) => judgeOne(row)))));
}
outs.sort((a, b) => a.id.localeCompare(b.id));

const label = (v: boolean | null): string =>
  v === true ? "faithful" : v === false ? "fabricated" : "call failed";
console.log(
  `Judge regression: ${total} ledger entries, ${cases.length} testable (handling distribution ${JSON.stringify(counts)})\n`,
);
console.log(
  `${"Case".padEnd(6)} ${"Human status".padEnd(12)} ${"Expected".padEnd(10)} ${"Judge now".padEnd(11)} Result`,
);
for (const o of outs) {
  console.log(
    `${o.id.padEnd(6)} ${o.status.padEnd(12)} ${label(o.expected).padEnd(10)} ${label(o.actual).padEnd(11)} ${o.agree ? "agree" : "✗ disagree"}`,
  );
}
const agree = outs.filter((o) => o.agree).length;
console.log(
  `\nAgreement ${agree}/${outs.length} (${Math.round((agree / outs.length) * 100)}%)`,
);
for (const o of outs.filter((x) => !x.agree)) {
  console.log(`  ${o.id} judge reason: ${o.reason}`);
}
await closeDb();
process.exitCode = agree === outs.length ? 0 : 1;
