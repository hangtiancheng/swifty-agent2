import { describe, expect, it } from "vitest";

import { tidy, verify } from "#/core/read-notes.ts";

describe("read notes", () => {
  it("normalizes punctuation, spacing and the final period", () => {
    expect(tidy("Hybrid + rerank is steadiest; MRR 0.710")).toBe(
      "Hybrid + rerank is steadiest, MRR 0.710.",
    );
    expect(tidy("Top up the Colloquial bucket!! ")).toBe(
      "Top up the Colloquial bucket.",
    );
  });

  it("keeps numbers that exist in the payload", () => {
    const payload = { mrr: 0.71, rows: [{ share: 0.15 }] };
    expect(verify("Rerank MRR 0.71, 15% of spend.", payload)).toBe(true);
  });

  it("rejects fabricated numbers", () => {
    const payload = { mrr: 0.71 };
    expect(verify("Rerank MRR 0.72.", payload)).toBe(false);
  });

  it("ignores numbers embedded in identifiers", () => {
    expect(verify("Recall@10 and bge-m3 are not conclusions.", {})).toBe(true);
  });
});
