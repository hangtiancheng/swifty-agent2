// Mine reusable Q&A pairs from historical conversations into the staging table.
import { z } from "zod";

import { dedupe, normalizeQuestion } from "./dedup.ts";

import { structured } from "#/core/llm.ts";
import { MINING_PROMPT } from "#/core/prompts.ts";
import {
  insertStaging,
  listAllQuestions,
  listConversationsWithMessages,
  listStagingByStatus,
  setStagingStatus,
} from "#/db/repository.ts";
import { childLogger } from "#/logger.ts";

const log = childLogger("kb.mining");

export interface QaPair {
  question: string;
  answer: string;
}

// Flat parallel arrays avoid nested object arrays, which some compatible upstreams reject.
const qaExtractionSchema = z.object({
  questions: z
    .array(z.string())
    .describe(
      "Question list, one-to-one with answers; empty when there is no reusable Q&A",
    ),
  answers: z
    .array(z.string())
    .describe("Answer list, one-to-one with questions"),
});

export async function extractQa(
  conversationTexts: string[],
): Promise<QaPair[]> {
  const chain = MINING_PROMPT.pipe(structured(qaExtractionSchema));
  const result = await chain.invoke({
    conversations: conversationTexts.join("\n---\n"),
  });
  const qs = result.questions;
  const ans = result.answers;
  if (qs.length !== ans.length) {
    log.warn(
      { questions: qs.length, answers: ans.length },
      "mining arrays length mismatch, aligning to the shorter one",
    );
  }
  const n = Math.min(qs.length, ans.length);
  return Array.from({ length: n }, (_, i) => ({
    question: qs[i],
    answer: ans[i],
  }));
}

async function loadConversationTexts(): Promise<[string, string][]> {
  const convs = await listConversationsWithMessages();
  const out: [string, string][] = [];
  for (const { id, messages } of convs) {
    const lines = messages
      .filter((m) => m.content)
      .map((m) => `${m.role}: ${m.content}`);
    if (lines.length > 0) {
      out.push([`conv:${id}`, lines.join("\n")]);
    }
  }
  return out;
}

export interface MiningStats {
  sources: number;
  extracted: number;
  kept: number;
  discarded: number;
}

export async function mine(batchSize = 20): Promise<MiningStats> {
  // Extract -> staging -> global dedup -> kept (human review gate before write-back).
  const sources = await loadConversationTexts();
  const batchNo = `mine-${formatStamp(new Date())}`;
  for (let start = 0; start < sources.length; start += batchSize) {
    const batch = sources.slice(start, start + batchSize);
    const pairs = await extractQa(batch.map(([, text]) => text));
    for (const p of pairs) {
      await insertStaging(batchNo, batch[0][0], p.question, p.answer);
    }
  }
  const staged = (await listStagingByStatus("extracted")).filter(
    (s) => s.batchNo === batchNo,
  );
  const existing = await listAllQuestions();
  const { kept, discarded } = dedupe(
    staged.map((s) => ({ id: s.id, question: s.question, answer: s.answer })),
    existing,
  );
  await setStagingStatus(
    kept.map((s) => s.id),
    "kept",
  );
  await setStagingStatus(
    discarded.map((s) => s.id),
    "discarded",
  );
  return {
    sources: sources.length,
    extracted: staged.length,
    kept: kept.length,
    discarded: discarded.length,
  };
}

export function formatStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export { normalizeQuestion };
