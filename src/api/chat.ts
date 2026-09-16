// Chat SSE endpoint.
import { HumanMessage } from "@langchain/core/messages";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import { parseJsonBody } from "./http.ts";
import { chatRequestSchema } from "./schemas.ts";

import { settings } from "#/config.ts";
import * as memory from "#/core/memory.ts";
import * as runtime from "#/graph/runtime.ts";
import { childLogger } from "#/logger.ts";

const log = childLogger("api.chat");
export const chatRouter = new Hono();

function errorMessage(error: unknown): string {
  if (error instanceof runtime.ConversationNotFound) {
    return "Conversation not found";
  }
  const name = error instanceof Error ? error.constructor.name : "";
  if (name.startsWith("Prisma")) {
    return "The database is temporarily unavailable; please try again later";
  }
  return "The upstream model is temporarily unavailable; please try again later";
}

chatRouter.post("/api/chat", async (c) => {
  const req = await parseJsonBody(c, chatRequestSchema);
  const tokens = memory.countTokens([new HumanMessage(req.message)]);
  if (tokens > settings.maxUserInputTokens) {
    throw new HTTPException(400, {
      message:
        `This message is too long (the limit is about ${memory.tokensToChars(settings.maxUserInputTokens)} characters); ` +
        "please split it into several messages, or keep only the key information",
    });
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const ev of runtime.streamTurn(
        req.user_id,
        req.message,
        req.conversation_id,
      )) {
        if (ev.type === "tool") {
          await stream.writeSSE({
            data: JSON.stringify({ event: "tool", name: ev.name }),
          });
        } else if (ev.type === "delta") {
          await stream.writeSSE({ data: JSON.stringify({ delta: ev.text }) });
        } else if (ev.type === "citations") {
          await stream.writeSSE({
            data: JSON.stringify({ event: "citations", items: ev.items }),
          });
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
          await stream.writeSSE({
            data: JSON.stringify({ event: "actions", items: ev.items }),
          });
        } else if (ev.type === "done") {
          await stream.writeSSE({
            data: JSON.stringify({
              event: "done",
              conversation_id: ev.conversation_id,
            }),
          });
        }
      }
    } catch (error) {
      log.error({ err: error, user_id: req.user_id }, "chat stream failed");
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: errorMessage(error) }),
      });
      return;
    }
    await stream.writeSSE({ data: "[DONE]" });
  });
});
