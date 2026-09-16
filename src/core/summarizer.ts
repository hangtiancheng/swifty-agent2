// Background segmented summarization: triggered after a turn when layer 2 exceeds its budget.
// One batch produces one new segment; existing segments are never re-summarized.
import { z } from "zod";

import { settings } from "../config.ts";
import * as repository from "../db/repository.ts";
import { childLogger } from "../logger.ts";

import * as budget from "./budget.ts";
import { structured } from "./llm.ts";
import * as memory from "./memory.ts";
import { SUMMARY_PROMPT } from "./prompts.ts";

const log = childLogger("summarizer");

const summarySchema = z.object({
  summary: z.string().describe("早期对话滚动摘要,只含事实与诉求"),
});

const running = new Map<number, Promise<void>>();

export async function summarizeDialog(oldSummary: string, dialog: string): Promise<string> {
  // old_summary is background only: the output is a new segment, so order ids and
  // similar facts are compressed exactly once.
  const model = structured(summarySchema, { slot: "summary" });
  const result = await SUMMARY_PROMPT.pipe(model).invoke({
    old_summary: oldSummary || "(无)",
    dialog,
  });
  return (result.summary || "").trim();
}

export async function runSummary(conversationId: number): Promise<void> {
  const started = Date.now();
  const conv = await repository.getConversation(conversationId);
  if (conv === null) {
    return;
  }
  const msgs = await repository.listDialogMessages(conversationId);
  const oldUpto = conv.summaryUptoMsgId ?? 0;
  const boundary = conv.layer1FromMsgId ?? 0;
  if (boundary <= oldUpto) {
    log.info({ conv: conversationId, boundary, upto: oldUpto }, "summary skipped: layer 2 is empty");
    return;
  }
  const seg = msgs.filter((m) => m.id > oldUpto && m.id <= boundary);
  const dialog = seg
    .filter((m) => m.content)
    .map((m) => `${m.role === "user" ? "用户" : "客服"}:${m.content}`)
    .join("\n");
  log.info(
    { conv: conversationId, messages: seg.length, from: oldUpto, to: boundary },
    "summary started",
  );
  const summary = await summarizeDialog(conv.summary || "", dialog);
  if (!summary) {
    throw new Error("summary is empty; aborting update");
  }
  const seq = await repository.appendSummarySegment(conversationId, oldUpto + 1, boundary, summary);
  log.info(
    { conv: conversationId, seq, upto: boundary, length: summary.length, cost_ms: Date.now() - started },
    "summary done",
  );
}

async function shouldSummarize(conversationId: number, conv: NonNullable<Awaited<ReturnType<typeof repository.getConversation>>>): Promise<boolean> {
  const upto = conv.summaryUptoMsgId ?? 0;
  const layer1From = conv.layer1FromMsgId ?? 0;
  if (layer1From <= upto) {
    return false;
  }
  const msgs = await repository.listDialogMessages(conversationId);
  const layer2Tokens = memory.charsToTokens(
    msgs.filter((m) => m.id > upto && m.id <= layer1From).reduce((sum, m) => sum + (m.content?.length ?? 0), 0),
  );
  const l2Budget = Math.floor(budget.compute().sliding * (1 - settings.layer1Ratio));
  if (layer2Tokens <= l2Budget) {
    return false;
  }
  log.info({ conv: conversationId, layer2_tokens: layer2Tokens, budget: l2Budget }, "summary triggered");
  return true;
}

export async function maybeScheduleSummary(conversationId: number): Promise<void> {
  // Called after a turn; runs in the background and never blocks the reply.
  try {
    if (running.has(conversationId)) {
      return;
    }
    const conv = await repository.getConversation(conversationId);
    if (conv === null) {
      return;
    }
    if (!(await shouldSummarize(conversationId, conv))) {
      return;
    }
    if (running.has(conversationId)) {
      return; // re-check after awaits (TOCTOU)
    }
    const task = runSummary(conversationId);
    running.set(conversationId, task);
    void task
      .catch((error: unknown) => {
        log.error({ conv: conversationId, err: error }, "summary failed");
      })
      .finally(() => {
        if (running.get(conversationId) === task) {
          running.delete(conversationId);
        }
      });
  } catch (error) {
    log.error({ conv: conversationId, err: error }, "summary trigger check failed");
  }
}
