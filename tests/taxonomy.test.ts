import { describe, expect, it } from "vitest";

import { ID2LABEL, LABEL2ID, NUM_CLASSES, SEVERITY, TOPIC_NAMES, terminologyTable } from "../src/core/taxonomy.ts";

describe("taxonomy", () => {
  it("keeps label ids in tuple order", () => {
    expect(NUM_CLASSES).toBe(17);
    expect(LABEL2ID["退换货"]).toBe(0);
    expect(ID2LABEL[16]).toBe("其他");
    expect(TOPIC_NAMES).toHaveLength(17);
  });

  it("assigns a severity to every class", () => {
    for (const name of TOPIC_NAMES) {
      expect(["严", "中", "宽"]).toContain(SEVERITY[name]);
    }
  });

  it("renders the terminology table", () => {
    expect(terminologyTable()).toContain("- 价保:");
  });
});
