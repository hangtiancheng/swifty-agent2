import { describe, expect, it } from "vitest";

import {
  computeEvidenceConfidence,
  snapshotFromHits,
} from "#/core/confidence.ts";
import type { KnowledgeHit } from "#/kb/store.ts";

function hit(
  score: number,
  overrides: Partial<KnowledgeHit> = {},
): KnowledgeHit {
  return {
    id: 1,
    score,
    question: "Who pays the return shipping fee",
    answer:
      "For exchanges not caused by quality issues, the buyer bears the shipping cost",
    section_path: "Shipping Fees / Return Shipping",
    content_type: "policy",
    category: "Shipping Fees",
    rerank_score: score,
    ...overrides,
  };
}

describe("evidence confidence", () => {
  it("returns zero with no evidence", () => {
    const conf = computeEvidenceConfidence([]);
    expect(conf.score).toBe(0);
    expect(conf.signals.valid_count).toBe(0);
  });

  it("scores strong, focused evidence highly", () => {
    const conf = computeEvidenceConfidence([
      hit(0.9),
      hit(0.6, { id: 2 }),
      hit(0.4, { id: 3 }),
    ]);
    expect(conf.score).toBeGreaterThan(0.7);
    expect(conf.signals.valid_count).toBe(3);
    expect(conf.signals.key_clause_hit).toBe(true);
  });

  it("scores a weak single hit below the calibration threshold", () => {
    const conf = computeEvidenceConfidence([hit(0.1)]);
    expect(conf.score).toBeLessThan(0.26);
  });

  it("snapshots the top N hits", () => {
    const snapshot = snapshotFromHits(
      [hit(0.9), hit(0.8, { id: 2 }), hit(0.7, { id: 3 }), hit(0.6, { id: 4 })],
      3,
    );
    expect(snapshot).toHaveLength(3);
    expect(snapshot[0].rerank_score).toBe(0.9);
  });
});
