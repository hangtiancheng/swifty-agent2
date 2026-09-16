import { describe, expect, it } from "vitest";

import { dedupe, dedupeFingerprint, normalizeQuestion } from "../src/kb/dedup.ts";

describe("dedup", () => {
  it("normalizes whitespace and punctuation but keeps CJK", () => {
    expect(normalizeQuestion("  满 99 元 包邮? ")).toBe("满99元包邮");
    expect(normalizeQuestion("Refund-Policy!")).toBe("refundpolicy");
  });

  it("builds a fingerprint from both question and answer", () => {
    expect(dedupeFingerprint("怎么退", "七天无理由")).toBe("怎么退|七天无理由");
  });

  it("drops duplicates against existing questions and inside the batch", () => {
    const items = [
      { question: "怎么退", answer: "a" },
      { question: "怎么退?", answer: "b" },
      { question: "运费怎么算", answer: "c" },
    ];
    const { kept, discarded } = dedupe(items, ["怎么退"]);
    expect(kept.map((k) => k.question)).toEqual(["运费怎么算"]);
    expect(discarded).toHaveLength(2);
  });
});
