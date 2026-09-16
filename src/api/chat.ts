// Chat SSE endpoint.
import { HumanMessage } from "@langchain/core/messages";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import { settings } from "../config.ts";
import * as memory from "../core/memory.ts";
import * as runtime from "../graph/runtime.ts";
import { childLogger } from "../logger.ts";

import { parseJsonBody } from "./http.ts";
import { chatRequestSchema } from "./schemas.ts";

const log = childLogger("api.chat");
export const chatRouter = new Hono();

function errorMessage(error: unknown): string {
  if (error instanceof runtime.ConversationNotFound) {
    return "会话不存在";
  }
  const name = error instanceof Error ? error.constructor.name : "";
  if (name.startsWith("Prisma")) {
    return "数据库暂时不可用,请稍后重试";
  }
  return "上游模型暂时不可用,请稍后重试";
}

chatRouter.post("/api/chat", async (c) => {
  const req = await parseJsonBody(c, chatRequestSchema);
  const tokens = memory.countTokens([new HumanMessage(req.message)]);
  if (tokens > settings.maxUserInputTokens) {
    throw new HTTPException(400, {
      message:
        `这条消息太长了(上限约 ${memory.tokensToChars(settings.maxUserInputTokens)} 字),` +
        "麻烦分几次说,或者只留关键信息",
    });
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const ev of runtime.streamTurn(req.user_id, req.message, req.conversation_id)) {
        if (ev.type === "tool") {
          await stream.writeSSE({ data: JSON.stringify({ event: "tool", name: ev.name }) });
        } else if (ev.type === "delta") {
          await stream.writeSSE({ data: JSON.stringify({ delta: ev.text }) });
        } else if (ev.type === "citations") {
          await stream.writeSSE({ data: JSON.stringify({ event: "citations", items: ev.items }) });
        } else if (ev.type === "interrupt") {
          await stream.writeSSE({
            data: JSON.stringify({
              event: "interrupt",
              kind: ev.kind,
              conversation_id: ev.conversation_id,
              ...(ev.orders !== undefined ? { orders: ev.orders } : {}),
              ...(ev.preview !== undefined ? { preview: ev.preview } : {}),
            }),
          });
        } else if (ev.type === "actions") {
          await stream.writeSSE({ data: JSON.stringify({ event: "actions", items: ev.items }) });
        } else if (ev.type === "done") {
          await stream.writeSSE({
            data: JSON.stringify({ event: "done", conversation_id: ev.conversation_id }),
          });
        }
      }
    } catch (error) {
      log.error({ err: error, user_id: req.user_id }, "chat stream failed");
      await stream.writeSSE({ event: "error", data: JSON.stringify({ message: errorMessage(error) }) });
      return;
    }
    await stream.writeSSE({ data: "[DONE]" });
  });
});
