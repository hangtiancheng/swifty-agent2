import { describe, expect, it } from "vitest";

import { arrangeHeadTail, splitClauses } from "../src/core/retrieval.ts";

describe("retrieval helpers", () => {
  it("splits multi-intent questions into clauses", () => {
    expect(splitClauses("我在新疆下单 80 块钱,运费怎么算,会员的免运费能不能抵")).toHaveLength(3);
    expect(splitClauses("退货运费谁出")).toEqual(["退货运费谁出"]);
  });

  it("keeps short fragments out of the clause list", () => {
    expect(splitClauses("运费怎么算,怎么办")).toEqual(["运费怎么算,怎么办"]);
  });

  it("puts the second best hit at the tail", () => {
    expect(arrangeHeadTail(["a", "b", "c", "d"])).toEqual(["a", "c", "d", "b"]);
    expect(arrangeHeadTail(["a", "b"])).toEqual(["a", "b"]);
  });
});
