// Data flywheel batch pipeline: normalize + dedup low-confidence questions into the review queue.
//
// Cursor = low_confidence_questions.matched_review_id IS NULL, so the job is idempotent.
// Items are processed serially so same-batch synonyms merge into the row created moments ago.
import { z } from "zod";

import { structured } from "./llm.ts";
import { FLYWHEEL_NORMALIZE_PROMPT } from "./prompts.ts";

import * as repository from "#/db/repository.ts";
import { childLogger } from "#/logger.ts";


const log = childLogger("flywheel");

const normalizeSchema = z.object({
  normalized_question: z.string().describe("FAQ-style standard question"),
  matched_question_id: z.number().int().nullable().default(null).describe("Matched candidate id; null when no candidate is the same kind"),
  ai_suggested_answer: z.string().default("").describe("Sample answer for reference"),
});

export interface ProcessStats {
  processed: number;
  merged: number;
  created: number;
  skipped: number;
}

export async function processPending(limit = 50): Promise<ProcessStats> {
  const rows = await repository.fetchUnmatchedLowConf(limit);
  const stats: ProcessStats = { processed: 0, merged: 0, created: 0, skipped: 0 };
  for (const row of rows) {
    // Fetch per row so rows created in this batch are candidate matches.
    const fetched = await repository.listReviewCandidates(201);
    const truncated = fetched.length > 200;
    const candidates = fetched.slice(0, 200);
    const candidateText =
      candidates.map((c) => `- id=${c.id}: ${c.normalized_question}`).join("\n") || "(no candidates)";
    let result: z.infer<typeof normalizeSchema>;
    try {
      const model = structured(normalizeSchema);
      result = await FLYWHEEL_NORMALIZE_PROMPT.pipe(model).invoke({
        raw_question: row.rawQuestion,
        candidates: candidateText,
      });
    } catch (error) {
      log.warn({ err: error, lcq: row.id }, "flywheel normalization failed; retrying next round");
      stats.skipped += 1;
      continue;
    }
    const matchedId = result.matched_question_id;
    let reviewId: number;
    if (matchedId !== null) {
      if (!candidates.some((c) => c.id === matchedId)) {
        log.warn({ matched_id: matchedId, lcq: row.id }, "flywheel hallucinated id; retrying next round");
        stats.skipped += 1;
        continue;
      }
      await repository.incrementOccurrence(matchedId);
      reviewId = matchedId;
      stats.merged += 1;
    } else {
      reviewId = await repository.insertReviewItem(result.normalized_question, result.ai_suggested_answer || null);
      stats.created += 1;
    }
    await repository.setMatchedReview(row.id, reviewId);
    stats.processed += 1;
    log.info(
      { lcq: row.id, review: reviewId, merged: matchedId !== null, truncated },
      "flywheel item processed",
    );
  }
  return stats;
}
