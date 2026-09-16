// Faithfulness judge regression: replay human-reviewed fabrication cases and compare verdicts.
import { z } from "zod";

import { structured } from "../src/core/llm.ts";
import { FAITHFULNESS_PROMPT } from "../src/core/prompts.ts";
import { closeDb } from "../src/db/client.ts";
import { citationSchema, parseWith } from "../src/db/json.ts";
import * as repository from "../src/db/repository.ts";

const CONCURRENCY = 5;

const faithSchema = z.object({
  faithful: z.boolean().describe("是否忠实于证据"),
  reason: z.string().default("").describe("一句话理由"),
});

function evidenceFromCitations(citations: unknown): string {
  const parsed = parseWith(citationSchema, JSON.stringify(citations)) ?? [];
  return parsed
    .map((c, i) => `[${c.n ?? i + 1}] ${c.question ?? ""}:${c.answer ?? ""}`)
    .join("\n");
}

function expectedFaithful(status: string): boolean | null {
  if (status === "已解决") {
    return false;
  }
  if (status === "无需解决") {
    return true;
  }
  return null;
}

const { rows, total, counts } = await repository.listFaithCases(null, 1, 200);
const cases = rows.filter((r) => expectedFaithful(r.status) !== null && (r.citations ?? "").length > 0);
if (cases.length === 0) {
  console.log(`台账 ${total} 条,没有「已处置 + 有角标原文」的个案,考不了。先在 RAG 评估页处置几条。`);
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
      return { id: row.evalId, status: row.status, expected, actual, agree: actual === expected, reason: fa.reason };
    } catch (error) {
      if (attempt === 2) {
        return {
          id: row.evalId,
          status: row.status,
          expected,
          actual: null,
          agree: false,
          reason: `裁判调用失败:${error instanceof Error ? error.constructor.name : "Error"}`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return { id: row.evalId, status: row.status, expected, actual: null, agree: false, reason: "unreachable" };
}

const outs: Verdict[] = [];
for (let i = 0; i < cases.length; i += CONCURRENCY) {
  const batch = cases.slice(i, i + CONCURRENCY);
  outs.push(...(await Promise.all(batch.map((row) => judgeOne(row)))));
}
outs.sort((a, b) => a.id.localeCompare(b.id));

const label = (v: boolean | null): string => (v === true ? "忠实" : v === false ? "编造" : "调用失败");
console.log(`裁判回归:台账 ${total} 条,能考 ${cases.length} 条(处置分布 ${JSON.stringify(counts)})\n`);
console.log(`${"个案".padEnd(6)} ${"人工处置".padEnd(8)} ${"人工期望".padEnd(6)} ${"裁判这次".padEnd(8)} 结果`);
for (const o of outs) {
  console.log(
    `${o.id.padEnd(6)} ${o.status.padEnd(8)} ${label(o.expected).padEnd(6)} ${label(o.actual).padEnd(8)} ${o.agree ? "一致" : "✗ 不一致"}`,
  );
}
const agree = outs.filter((o) => o.agree).length;
console.log(`\n一致 ${agree}/${outs.length}(${Math.round((agree / outs.length) * 100)}%)`);
for (const o of outs.filter((x) => !x.agree)) {
  console.log(`  ${o.id} 裁判理由:${o.reason}`);
}
await closeDb();
process.exitCode = agree === outs.length ? 0 : 1;
