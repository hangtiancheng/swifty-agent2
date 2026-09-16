import { describe, expect, it } from "vitest";

import { dedupe, dedupeFingerprint, normalizeQuestion } from "@/kb/dedup.ts";

describe("dedup", () => {
  it("normalizes whitespace and punctuation", () => {
    expect(normalizeQuestion("  Free shipping over 99 yuan? ")).toBe(
      "freeshippingover99yuan",
    );
    expect(normalizeQuestion("Refund-Policy!")).toBe("refundpolicy");
  });

  it("builds a fingerprint from both question and answer", () => {
    expect(dedupeFingerprint("How to return", "7-day no reason")).toBe(
      "howtoreturn|7daynoreason",
    );
  });

  it("drops duplicates against existing questions and inside the batch", () => {
    const items = [
      { question: "How to return", answer: "a" },
      { question: "How to return?", answer: "b" },
      { question: "How is shipping calculated", answer: "c" },
    ];
    const { kept, discarded } = dedupe(items, ["How to return"]);
    expect(kept.map((k) => k.question)).toEqual(["How is shipping calculated"]);
    expect(discarded).toHaveLength(2);
  });
});
