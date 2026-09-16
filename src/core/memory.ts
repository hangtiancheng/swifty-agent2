// Conversation memory: token counting, sliding-window anchors and layered compression.
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import * as budget from "./budget.ts";

import { settings } from "@/config.ts";


export function contentToString(content: BaseMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
    } else if (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
    }
  }
  return parts.join("");
}

export function countTokens(messages: BaseMessage[]): number {
  // Approximate token count calibrated for English: chars / en_chars_per_token plus a
  // small per-message overhead. All budgeting paths go through this one entry point.
  let chars = 0;
  for (const m of messages) {
    chars += contentToString(m.content).length;
    if (AIMessage.isInstance(m) && m.tool_calls && m.tool_calls.length > 0) {
      chars += JSON.stringify(m.tool_calls).length;
    }
  }
  return charsToTokens(chars) + messages.length * 4;
}

export function charsToTokens(nChars: number): number {
  return Math.floor(nChars / settings.enCharsPerToken);
}

export function tokensToChars(nTokens: number): number {
  return Math.floor(nTokens * settings.enCharsPerToken);
}

export function windowBudget(): number {
  // An explicit override wins (used for rollback); otherwise derive from the window budget.
  if (settings.contextWindowMaxTokens > 0) {
    return settings.contextWindowMaxTokens;
  }
  return budget.compute().sliding;
}

export function trimHistory(messages: BaseMessage[], maxTokens: number): BaseMessage[] {
  // Keep the last messages within budget, starting on a human message (drop leading
  // partial turns and tool results whose call was dropped).
  if (countTokens(messages) <= maxTokens) {
    return messages;
  }
  const out = [...messages];
  while (out.length > 0 && countTokens(out) > maxTokens) {
    out.shift();
  }
  while (out.length > 0 && !HumanMessage.isInstance(out[0])) {
    out.shift();
  }
  return out;
}

// ---- anchor-based window slicing + summary injection (ch07) ----

const DB_ID_PREFIX = "db-";

function dbMsgId(m: BaseMessage): number | null {
  // The entry point tags user messages with HumanMessage.id = "db-<msg_id>".
  const id = m.id;
  if (typeof id === "string" && id.startsWith(DB_ID_PREFIX)) {
    const parsed = Number.parseInt(id.slice(DB_ID_PREFIX.length), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function indexAfter(messages: BaseMessage[], msgId: number): number {
  if (!msgId) {
    return 0;
  }
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (HumanMessage.isInstance(m)) {
      const did = dbMsgId(m);
      if (did !== null && did > msgId) {
        return i;
      }
    }
  }
  return 0;
}

export function buildWindow(
  messages: BaseMessage[],
  summaryUptoMsgId: number,
  layer1FromMsgId = 0,
  maxTokens: number | null = null,
): BaseMessage[] {
  // Three layers by two anchors:
  //   id <= summaryUpto           already summarized, not rendered
  //   summaryUpto < id <= layer1  layer 2, half-compressed
  //   id > layer1                 layer 1, verbatim
  // Missing anchors degrade to a single verbatim layer plus token-based trimming.
  let window = messages.slice(indexAfter(messages, summaryUptoMsgId));
  if (layer1FromMsgId) {
    const split = indexAfter(window, layer1FromMsgId);
    if (split) {
      window = [...toLayer2(window.slice(0, split)), ...window.slice(split)];
    }
  }
  const trimmed = trimHistory(window, maxTokens ?? windowBudget());
  return trimmed.length > 0 ? trimmed : window;
}

export function layerTokens(messages: BaseMessage[], summaryUptoMsgId: number, layer1FromMsgId: number): [number, number] {
  const window = messages.slice(indexAfter(messages, summaryUptoMsgId));
  const split = layer1FromMsgId ? indexAfter(window, layer1FromMsgId) : 0;
  return [countTokens(toLayer2(window.slice(0, split))), countTokens(window.slice(split))];
}

export function nextLayer1From(messages: BaseMessage[], summaryUptoMsgId: number, layer1Budget: number): number {
  // Move the layer-1 boundary in one step (not per turn) so the rendered prefix stays
  // byte-stable between moves and the prompt cache survives.
  const window = messages.slice(indexAfter(messages, summaryUptoMsgId));
  let total = 0;
  for (let i = window.length - 1; i >= 0; i -= 1) {
    total += countTokens([window[i]]);
    if (total > layer1Budget) {
      for (let j = i; j >= 0; j -= 1) {
        const did = dbMsgId(window[j]);
        if (did !== null) {
          return did;
        }
      }
      return 0;
    }
  }
  return 0;
}

export function summaryLine(summary: string | null): string {
  return summary ? `(Summary of earlier conversation: ${summary})` : "";
}

export function summarySystem(summary: string | null): SystemMessage | null {
  // The summary travels as a user-side text block (never a second SystemMessage):
  // upstreams hoist system messages, which would push the tool schema out of the cacheable prefix.
  if (!summary) {
    return null;
  }
  return new SystemMessage(`## Summary of earlier conversation (earlier turns are compressed; the facts in it are trustworthy)\n${summary}`);
}

// ---- layer 2: half-compressed rendering ----

export function compressReply(text: string, keepChars: number | null = null): string {
  const n = keepChars ?? settings.layer2ReplyKeepChars;
  if (!text || text.length <= n) {
    return text;
  }
  return `${text.slice(0, n)}… (truncated)`;
}

export function compressToolResult(name: string, content: string): string {
  if (!content) {
    return content;
  }
  if (charsToTokens(content.length) <= settings.layer2ToolKeepTokens) {
    return content;
  }
  return `(Called ${name || "tool"}; result omitted)`;
}

export function toLayer2(messages: BaseMessage[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of messages) {
    if (HumanMessage.isInstance(m)) {
      out.push(m);
    } else if (AIMessage.isInstance(m)) {
      // tool_calls must survive: the following ToolMessage references its tool_call_id.
      const text = contentToString(m.content);
      out.push(
        new AIMessage({
          content: compressReply(text),
          ...(m.id !== undefined ? { id: m.id } : {}),
          tool_calls: (m.tool_calls ?? []).map((tc) => ({ ...tc })),
        }),
      );
    } else if (ToolMessage.isInstance(m)) {
      const text = contentToString(m.content);
      out.push(
        new ToolMessage({
          content: compressToolResult(m.name ?? "", text),
          tool_call_id: m.tool_call_id,
          ...(m.name !== undefined ? { name: m.name } : {}),
          ...(m.id !== undefined ? { id: m.id } : {}),
        }),
      );
    } else {
      out.push(m);
    }
  }
  return out;
}
