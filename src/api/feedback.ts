// Flywheel entry point 3: user feedback pools unsolved questions (down-vote only).
import { Hono } from "hono";

import * as repository from "../db/repository.ts";
import * as runtime from "../graph/runtime.ts";
import { childLogger } from "../logger.ts";

import { parseJsonBody } from "./http.ts";
import { feedbackRequestSchema } from "./schemas.ts";

const log = childLogger("api.feedback");
export const feedbackRouter = new Hono();

function sameQuestion(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

feedbackRouter.post("/api/feedback", async (c) => {
  const req = await parseJsonBody(c, feedbackRequestSchema);
  if (req.rating === "up") {
    log.info({ conv: req.conversation_id, question: req.question.slice(0, 40) }, "feedback up (log only)");
    return c.json({ ok: true, pooled: false });
  }

  let snapshot: unknown[] | null = null;
  try {
    const turn = await runtime.getTurnSnapshot(req.conversation_id);
    if (turn.snapshot.length > 0 && sameQuestion(turn.question, req.question)) {
      snapshot = turn.snapshot;
    }
  } catch (error) {
    log.warn({ err: error, conv: req.conversation_id }, "feedback snapshot lookup failed (pooling anyway)");
  }

  await repository.insertLowConfidence(
    req.conversation_id,
    req.question,
    "user_feedback",
    "用户反馈未解决",
    snapshot ?? undefined,
  );
  log.info({ conv: req.conversation_id, snapshot: snapshot ? "yes" : "no" }, "feedback down pooled");
  return c.json({ ok: true, pooled: true });
});
