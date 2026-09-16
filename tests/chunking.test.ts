import { describe, expect, it } from "vitest";

import { applySentenceOverlap, isTableBlock, splitSections, splitTableRows } from "../src/kb/chunking.ts";

describe("chunking", () => {
  it("splits markdown by header level and keeps the path in metadata", () => {
    const sections = splitSections("# 退货政策\n\n七天无理由。\n\n## 如何申请\n\n我的订单里点退款。");
    expect(sections).toHaveLength(2);
    expect(sections[0].metadata).toEqual({ h1: "退货政策" });
    expect(sections[0].pageContent).toBe("七天无理由。");
    expect(sections[1].metadata).toEqual({ h1: "退货政策", h2: "如何申请" });
    expect(sections[1].pageContent).toContain("我的订单里点退款");
  });

  it("detects markdown tables", () => {
    const table = "| 时效 | 说明 |\n| --- | --- |\n| 7 天 | 无理由 |";
    expect(isTableBlock(table)).toBe(true);
    expect(isTableBlock("普通段落。")).toBe(false);
  });

  it("repeats the table header when splitting wide tables", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `| r${i} | v${i} |`).join("\n");
    const table = `| 列 | 值 |\n| --- | --- |\n${rows}`;
    const parts = splitTableRows(table, 2);
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.split("\n")[0]).toContain("| 列 |");
    }
  });

  it("keeps whole trailing sentences as overlap", () => {
    const out = applySentenceOverlap(["第一句。第二句。", "第三句。"], 6);
    expect(out[1]).toBe("第二句。第三句。");
  });
});
