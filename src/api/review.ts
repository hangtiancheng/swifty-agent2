// Review queue API: list / detail / approve (write back to the knowledge base) / reject.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { parseJsonBody, parseParamInt } from "./http.ts";
import { approveRequestSchema } from "./schemas.ts";

import { parseJson } from "@/db/json.ts";
import * as repository from "@/db/repository.ts";
import { isKey } from "@/kb/documents.ts";
import type { Chunk } from "@/kb/documents.ts";
import * as dualwrite from "@/kb/dualwrite.ts";
import { childLogger } from "@/logger.ts";


const log = childLogger("api.review");
export const reviewRouter = new Hono();

interface ReviewItemViewInput {
  id: number;
  normalizedQuestion: string;
  aiSuggestedAnswer: string | null;
  occurrenceCount: number;
  reviewStatus: string;
  createdAt: Date;
}

function itemOut(r: ReviewItemViewInput): Record<string, unknown> {
  return {
    id: r.id,
    normalized_question: r.normalizedQuestion,
    ai_suggested_answer: r.aiSuggestedAnswer,
    occurrence_count: r.occurrenceCount,
    review_status: r.reviewStatus,
    created_at: r.createdAt.toISOString(),
  };
}

reviewRouter.get("/api/review/queue", async (c) => {
  const status = c.req.query("status") ?? null;
  const rows = await repository.listReviewQueue(status);
  return c.json({ items: rows.map((r) => itemOut(r)) });
});

reviewRouter.get("/api/review/:review_id", async (c) => {
  const reviewId = parseParamInt(c.req.param("review_id"), "review_id");
  const detail = await repository.getReviewDetail(reviewId);
  if (detail === null) {
    throw new HTTPException(404, { message: "Knowledge gap not found" });
  }
  const { item, raws } = detail;
  return c.json({
    ...itemOut(item),
    approved_answer: item.approvedAnswer,
    raws: raws.map((r) => ({
      raw_question: r.rawQuestion,
      source: r.source,
      reason: r.reason,
      created_at: r.createdAt.toISOString(),
      retrieved_chunks: parseJson(r.retrievedChunks),
    })),
  });
});

reviewRouter.post("/api/review/:review_id/approve", async (c) => {
  const reviewId = parseParamInt(c.req.param("review_id"), "review_id");
  const req = await parseJsonBody(c, approveRequestSchema);
  const detail = await repository.getReviewDetail(reviewId);
  if (detail === null) {
    throw new HTTPException(404, { message: "Knowledge gap not found" });
  }
  const { item } = detail;
  if (item.reviewStatus !== "pending_review") {
    throw new HTTPException(409, { message: `Current status is "${item.reviewStatus}"; it cannot be reviewed again` });
  }

  const chunk: Chunk = {
    category: "flywheel_review",
    questions: item.normalizedQuestion,
    answer: req.approved_answer,
    sectionPath: `flywheel_review / ${item.normalizedQuestion}`,
    contentType: "faq",
    isKeyClause: isKey(item.normalizedQuestion, req.approved_answer),
  };
  let chunkIds: number[] = [];
  try {
    chunkIds = await dualwrite.writePending([chunk]);
    await dualwrite.vectorizePending();
  } catch (error) {
    log.error({ err: error, review: reviewId }, "review write-back failed (status unchanged, retryable)");
    if (chunkIds.length > 0) {
      try {
        await repository.deleteKnowledgeChunks(chunkIds);
      } catch (rollbackError) {
        log.error({ err: rollbackError, ids: chunkIds }, "pending chunk rollback failed (manual cleanup needed)");
      }
    }
    throw new HTTPException(502, { message: "Write-back to the knowledge base failed (check the embedding upstream/vector store); the status is unchanged and it can be retried" });
  }

  if (!(await repository.updateReviewStatus(reviewId, "approved", req.approved_answer))) {
    log.warn({ review: reviewId, chunks: chunkIds }, "review status update lost (concurrent change); KB already written");
    throw new HTTPException(409, { message: "The status was changed by someone else; the knowledge was already written — please verify manually" });
  }
  log.info({ review: reviewId, chunks: chunkIds }, "review approved and vectorized");
  return c.json({ ok: true, chunk_ids: chunkIds });
});

reviewRouter.post("/api/review/:review_id/reject", async (c) => {
  const reviewId = parseParamInt(c.req.param("review_id"), "review_id");
  if (!(await repository.updateReviewStatus(reviewId, "rejected"))) {
    const detail = await repository.getReviewDetail(reviewId);
    if (detail === null) {
      throw new HTTPException(404, { message: "Knowledge gap not found" });
    }
    throw new HTTPException(409, { message: "Only pending-review items can be rejected" });
  }
  return c.json({ ok: true });
});
