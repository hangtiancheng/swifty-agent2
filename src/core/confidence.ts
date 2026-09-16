// Evidence confidence: quantify how well retrieved evidence matches the user question.
// Signals (all from retrieval/rerank results, zero extra model calls):
//   top1_score      best rerank score
//   valid_count     evidence above VALID_SCORE_FLOOR
//   margin          top1 - top2 (focus of the evidence)
//   key_clause_hit  any of the top-3 hits contains a key-clause term
import { KEY_TERMS } from "#/kb/documents.ts";
import type { KnowledgeHit } from "#/kb/store.ts";

export const VALID_SCORE_FLOOR = 0.3;
export const VALID_COUNT_CAP = 3;
export const W_TOP1 = 0.5;
export const W_VALID = 0.2;
export const W_MARGIN = 0.2;
export const W_KEY = 0.1;

export interface EvidenceConfidence {
  score: number;
  signals: {
    top1_score: number;
    valid_count: number;
    margin: number;
    key_clause_hit: boolean;
  };
}

function clip01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function computeEvidenceConfidence(
  hits: KnowledgeHit[],
): EvidenceConfidence {
  if (hits.length === 0) {
    return {
      score: 0,
      signals: {
        top1_score: 0,
        valid_count: 0,
        margin: 0,
        key_clause_hit: false,
      },
    };
  }
  const scores = hits.map((h) => Number(h.rerank_score ?? 0));
  const top1 = scores[0];
  const margin = scores.length > 1 ? top1 - scores[1] : top1;
  const validCount = scores.filter((s) => s >= VALID_SCORE_FLOOR).length;
  const keyHit = hits
    .slice(0, 3)
    // Case-insensitive: the KB uses Title Case headings and sentence-case bodies.
    .some((h) => {
      const text = `${h.question}${h.answer}`.toLowerCase();
      return KEY_TERMS.some((t) => text.includes(t));
    });
  const score =
    W_TOP1 * clip01(top1) +
    W_VALID * (Math.min(validCount, VALID_COUNT_CAP) / VALID_COUNT_CAP) +
    W_MARGIN * clip01(margin) +
    W_KEY * (keyHit ? 1 : 0);
  return {
    score: Number(clip01(score).toFixed(4)),
    signals: {
      top1_score: top1,
      valid_count: validCount,
      margin: Number(margin.toFixed(4)),
      key_clause_hit: keyHit,
    },
  };
}

export interface RetrievalSnapshot {
  question: string;
  answer: string;
  rerank_score: number;
  section_path: string;
}

export function snapshotFromHits(
  hits: KnowledgeHit[],
  topN = 3,
): RetrievalSnapshot[] {
  return hits.slice(0, topN).map((h) => ({
    question: h.question,
    answer: h.answer,
    rerank_score: Number(h.rerank_score ?? 0),
    section_path: h.section_path,
  }));
}
