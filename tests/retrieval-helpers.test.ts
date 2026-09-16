import { describe, expect, it } from "vitest";

import { arrangeHeadTail, splitClauses } from "@/core/retrieval.ts";

describe("retrieval helpers", () => {
  it("splits multi-intent questions into clauses", () => {
    expect(
      splitClauses(
        "I ordered 80 yuan worth from Xinjiang, how is the shipping fee calculated, can the member free shipping offset it",
      ),
    ).toHaveLength(3);
    expect(splitClauses("Who pays the return shipping fee")).toEqual([
      "Who pays the return shipping fee",
    ]);
  });

  it("keeps short fragments out of the clause list", () => {
    expect(splitClauses("How is shipping calculated, why")).toEqual([
      "How is shipping calculated, why",
    ]);
  });

  it("puts the second best hit at the tail", () => {
    expect(arrangeHeadTail(["a", "b", "c", "d"])).toEqual(["a", "c", "d", "b"]);
    expect(arrangeHeadTail(["a", "b"])).toEqual(["a", "b"]);
  });
});
