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
} from "@/core/memory.ts";

describe("memory", () => {
  it("converts between chars and tokens with the calibrated ratio", () => {
    expect(charsToTokens(120)).toBe(30);
    expect(tokensToChars(30)).toBe(120);
  });

  it("counts tokens monotonically", () => {
    const one = countTokens([
      new HumanMessage("Hi, who pays the return shipping fee"),
    ]);
    const two = countTokens([
      new HumanMessage("Hi, who pays the return shipping fee"),
      new HumanMessage("Also, where is order 1001"),
    ]);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
  });

  it("compresses long replies and large tool results only", () => {
    expect(compressReply("short")).toBe("short");
    expect(compressReply("x".repeat(200))).toContain("… (truncated)");
    expect(compressToolResult("query_order", "small result")).toBe(
      "small result",
    );
    expect(compressToolResult("query_faq", "x".repeat(2000))).toBe(
      "(Called query_faq; result omitted)",
    );
  });

  it("keeps tool_calls when rendering layer 2", () => {
    const ai = new AIMessage({
      content: "Let me look that up",
      tool_calls: [
        {
          name: "query_order",
          args: { order_id: "1001" },
          id: "call-1",
          type: "tool_call",
        },
      ],
    });
    const tool = new ToolMessage({
      content: "result",
      tool_call_id: "call-1",
      name: "query_order",
    });
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
    expect(summarySystem("The user asked about shipping fees")?.content).toContain(
      "Summary of earlier conversation",
    );
  });

  it("slices the window after the summary anchor", () => {
    const messages = [
      new HumanMessage({ content: "old question", id: "db-1" }),
      new AIMessage({ content: "old answer" }),
      new HumanMessage({ content: "new question", id: "db-2" }),
      new AIMessage({ content: "new answer" }),
    ];
    const window = buildWindow(messages, 1, 0, 100_000);
    expect(window).toHaveLength(2);
    expect(contentToString(window[0].content)).toBe("new question");
  });
});
