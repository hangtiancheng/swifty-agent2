// Conversation list + history reload (read-only).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { parseParamInt } from "./http.ts";

import * as repository from "#/db/repository.ts";

export const conversationsRouter = new Hono();

conversationsRouter.get("/api/conversations", async (c) => {
  const userId = c.req.query("user_id");
  if (!userId) {
    throw new HTTPException(400, { message: "user_id must not be empty" });
  }
  const items = await repository.listConversations(userId);
  return c.json({ items });
});

conversationsRouter.get(
  "/api/conversations/:conversation_id/messages",
  async (c) => {
    const conversationId = parseParamInt(
      c.req.param("conversation_id"),
      "conversation_id",
    );
    if ((await repository.getConversation(conversationId)) === null) {
      throw new HTTPException(404, { message: "Conversation not found" });
    }
    const msgs = await repository.listDialogMessages(conversationId);
    return c.json({
      items: msgs.map((m) => ({
        role: m.role,
        content: m.content ?? "",
        created_at: m.createdAt.toISOString(),
      })),
    });
  },
);
