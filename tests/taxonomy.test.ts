import { describe, expect, it } from "vitest";

import {
  ID2LABEL,
  LABEL2ID,
  NUM_CLASSES,
  SEVERITY,
  TOPIC_NAMES,
  terminologyTable,
} from "#/core/taxonomy.ts";

describe("taxonomy", () => {
  it("keeps label ids in tuple order", () => {
    expect(NUM_CLASSES).toBe(17);
    expect(LABEL2ID.returns_refunds).toBe(0);
    expect(ID2LABEL[16]).toBe("other");
    expect(TOPIC_NAMES).toHaveLength(17);
  });

  it("assigns a severity to every class", () => {
    for (const name of TOPIC_NAMES) {
      expect(["strict", "medium", "lenient"]).toContain(SEVERITY[name]);
    }
  });

  it("renders the terminology table", () => {
    expect(terminologyTable()).toContain("- price_protection:");
  });
});
