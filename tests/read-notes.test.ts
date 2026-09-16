import { describe, expect, it } from "vitest";

import { tidy, verify } from "../src/core/read-notes.ts";

describe("read notes", () => {
  it("normalizes punctuation, spacing and the final period", () => {
    expect(tidy("混合+重排最稳，MRR 0.710")).toBe("混合+重排最稳,MRR 0.710。");
    expect(tidy("先补口语类!! ")).toBe("先补口语类。");
  });

  it("keeps numbers that exist in the payload", () => {
    const payload = { mrr: 0.71, rows: [{ share: 0.15 }] };
    expect(verify("重排 MRR 0.71,占 15%。", payload)).toBe(true);
  });

  it("rejects fabricated numbers", () => {
    const payload = { mrr: 0.71 };
    expect(verify("重排 MRR 0.72。", payload)).toBe(false);
  });

  it("ignores numbers embedded in identifiers", () => {
    expect(verify("Recall@10 与 bge-m3 都不算结论。", {})).toBe(true);
  });
});
