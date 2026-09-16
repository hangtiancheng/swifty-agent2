import { describe, expect, it } from "vitest";

import {
  applySentenceOverlap,
  isTableBlock,
  splitSections,
  splitTableRows,
} from "@/kb/chunking.ts";

describe("chunking", () => {
  it("splits markdown by header level and keeps the path in metadata", () => {
    const sections = splitSections(
      "# Returns Policy\n\n7-day no-reason returns.\n\n## How to Apply\n\nTap refund under My Orders.",
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].metadata).toEqual({ h1: "Returns Policy" });
    expect(sections[0].pageContent).toBe("7-day no-reason returns.");
    expect(sections[1].metadata).toEqual({
      h1: "Returns Policy",
      h2: "How to Apply",
    });
    expect(sections[1].pageContent).toContain("Tap refund under My Orders");
  });

  it("detects markdown tables", () => {
    const table =
      "| Timeframe | Note |\n| --- | --- |\n| 7 days | No reason |";
    expect(isTableBlock(table)).toBe(true);
    expect(isTableBlock("A plain paragraph.")).toBe(false);
  });

  it("repeats the table header when splitting wide tables", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `| r${i} | v${i} |`).join(
      "\n",
    );
    const table = `| Column | Value |\n| --- | --- |\n${rows}`;
    const parts = splitTableRows(table, 2);
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.split("\n")[0]).toContain("| Column |");
    }
  });

  it("keeps whole trailing sentences as overlap", () => {
    const out = applySentenceOverlap(
      ["First sentence. Second sentence.", "Third sentence."],
      6,
    );
    expect(out[1]).toBe("Second sentence.Third sentence.");
  });
});
