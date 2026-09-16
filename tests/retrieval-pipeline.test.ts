import { describe, expect, it, vi } from "vitest";

import { settings } from "#/config.ts";
import { searchKnowledge } from "#/core/retrieval.ts";
import type { KnowledgeHit } from "#/kb/store.ts";

const mocks = vi.hoisted(() => ({
  embedQuery: vi.fn(),
  rerank: vi.fn(),
  hybridSearch: vi.fn(),
  bm25Search: vi.fn(),
  denseSearch: vi.fn(),
}));

vi.mock("#/core/embeddings.ts", () => ({ embedQuery: mocks.embedQuery }));
vi.mock("#/core/rerank.ts", () => ({ rerank: mocks.rerank }));
vi.mock("#/kb/store.ts", () => ({
  hybridSearch: mocks.hybridSearch,
  bm25Search: mocks.bm25Search,
  denseSearch: mocks.denseSearch,
}));

describe("hybrid rerank retrieval", () => {
  it("reranks the recall pool before truncating to top K", async () => {
    const candidateCount = Math.max(2, settings.recallTopK);
    const hits: KnowledgeHit[] = Array.from(
      { length: candidateCount },
      (_, index) => ({
        id: index + 1,
        score: 1 / (index + 1),
        question: `question-${index}`,
        answer: `answer-${index}`,
        section_path: `section-${index}`,
        content_type: "faq",
        category: "test",
      }),
    );
    mocks.embedQuery.mockResolvedValue([1, 0]);
    mocks.hybridSearch.mockResolvedValue(hits);
    mocks.rerank.mockResolvedValue([
      [candidateCount - 1, 0.9],
      [0, 0.8],
    ]);

    const result = await searchKnowledge("query", {
      strategy: "hybrid_rerank",
      topK: 2,
      split: false,
    });

    expect(mocks.hybridSearch).toHaveBeenCalledWith(
      [1, 0],
      "query",
      candidateCount,
      settings.recallTopK,
      null,
    );
    expect(mocks.rerank).toHaveBeenCalledWith(
      "query",
      expect.arrayContaining([
        `question-${candidateCount - 1} answer-${candidateCount - 1}`,
      ]),
      2,
    );
    expect(result.map((hit) => hit.id)).toEqual([candidateCount, 1]);
  });
});
