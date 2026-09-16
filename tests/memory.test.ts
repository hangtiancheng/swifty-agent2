import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  buildWindow,
  charsToTokens,
  compressReply,
  compressToolResult,
  contentToString,
  countTokens,
  summarySystem,
  toLayer2,
  tokensToChars,
} from "../src/core/memory.ts";

describe("memory", () => {
  it("converts between chars and tokens with the calibrated ratio", () => {
    expect(charsToTokens(120)).toBe(100);
    expect(tokensToChars(100)).toBe(120);
  });

  it("counts tokens monotonically", () => {
    const one = countTokens([new HumanMessage("你好,请问退货运费谁出")]);
    const two = countTokens([new HumanMessage("你好,请问退货运费谁出"), new HumanMessage("另外订单 1001 到哪了")]);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
  });

  it("compresses long replies and large tool results only", () => {
    expect(compressReply("很短")).toBe("很短");
    expect(compressReply("长".repeat(200))).toContain("…(略)");
    expect(compressToolResult("query_order", "小结果")).toBe("小结果");
    expect(compressToolResult("query_faq", "长".repeat(2000))).toBe("(已调用 query_faq,结果从略)");
  });

  it("keeps tool_calls when rendering layer 2", () => {
    const ai = new AIMessage({ content: "查一下", tool_calls: [{ name: "query_order", args: { order_id: "1001" }, id: "call-1", type: "tool_call" }] });
    const tool = new ToolMessage({ content: "结果", tool_call_id: "call-1", name: "query_order" });
    const rendered = toLayer2([ai, tool]);
    expect(rendered).toHaveLength(2);
    const renderedAi = rendered[0];
    expect(renderedAi).toBeInstanceOf(AIMessage);
    if (renderedAi instanceof AIMessage) {
      expect(renderedAi.tool_calls?.[0]?.id).toBe("call-1");
    }
  });

  it("wraps the summary as a system message", () => {
    expect(summarySystem(null)).toBeNull();
    expect(summarySystem("用户问过运费")?.content).toContain("早前对话摘要");
  });

  it("slices the window after the summary anchor", () => {
    const messages = [
      new HumanMessage({ content: "老问题", id: "db-1" }),
      new AIMessage({ content: "老回答" }),
      new HumanMessage({ content: "新问题", id: "db-2" }),
      new AIMessage({ content: "新回答" }),
    ];
    const window = buildWindow(messages, 1, 0, 100_000);
    expect(window).toHaveLength(2);
    expect(contentToString(window[0].content)).toBe("新问题");
  });
});
