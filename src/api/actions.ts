// User-action endpoints: create ticket / refund form submission and interrupt resume (SSE).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import { parseJsonBody } from "./http.ts";
import { createRefundRequestSchema, createTicketRequestSchema, resumeRequestSchema } from "./schemas.ts";

import * as repository from "#/db/repository.ts";
import * as runtime from "#/graph/runtime.ts";
import { childLogger } from "#/logger.ts";


const log = childLogger("api.actions");
export const actionsRouter = new Hono();

actionsRouter.post("/api/actions/create-ticket", async (c) => {
  const req = await parseJsonBody(c, createTicketRequestSchema);
  try {
    const ticketNo = await repository.createTicket(req.conversation_id, req.description, req.ticket_type);
    return c.json({ ticket_no: ticketNo, status: "transferred" });
  } catch (error) {
    log.error({ err: error, conv: req.conversation_id }, "create ticket failed");
    throw new HTTPException(503, { message: "The ticket system is temporarily unavailable; please try again later" });
  }
});

actionsRouter.post("/api/actions/create-refund", async (c) => {
  const req = await parseJsonBody(c, createRefundRequestSchema);
  const description = `Refund request order_id=${req.order_id} reason=${req.reason}`;
  try {
    const ticketNo = await repository.createTicket(req.conversation_id, description, "refund");
    return c.json({ ticket_no: ticketNo, status: "Refund request submitted" });
  } catch (error) {
    log.error({ err: error, conv: req.conversation_id }, "create refund failed");
    throw new HTTPException(503, { message: "The refund system is temporarily unavailable; please try again later" });
  }
});

actionsRouter.post("/api/actions/resume", async (c) => {
  const req = await parseJsonBody(c, resumeRequestSchema);
  if (req.order_id === null && req.confirmed === null) {
    throw new HTTPException(400, { message: "Provide at least one of order_id and confirmed" });
  }
  const resumeValue: unknown = req.order_id !== null ? req.order_id : { confirmed: Boolean(req.confirmed) };

  return streamSSE(c, async (stream) => {
    try {
      for await (const ev of runtime.streamResume(req.conversation_id, resumeValue)) {
        if (ev.type === "tool") {
          await stream.writeSSE({ data: JSON.stringify({ event: "tool", name: ev.name }) });
        } else if (ev.type === "delta") {
          await stream.writeSSE({ data: JSON.stringify({ delta: ev.text }) });
        } else if (ev.type === "citations") {
          await stream.writeSSE({ data: JSON.stringify({ event: "citations", items: ev.items }) });
        } else if (ev.type === "actions") {
          await stream.writeSSE({ data: JSON.stringify({ event: "actions", items: ev.items }) });
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
        } else if (ev.type === "done") {
          await stream.writeSSE({
            data: JSON.stringify({ event: "done", conversation_id: ev.conversation_id }),
          });
        }
      }
    } catch (error) {
      log.error({ err: error, conv: req.conversation_id }, "resume failed");
      const message = error instanceof runtime.ConversationNotFound ? "Conversation not found" : "The upstream is temporarily unavailable; please try again later";
      await stream.writeSSE({ event: "error", data: JSON.stringify({ message }) });
      return;
    }
    await stream.writeSSE({ data: "[DONE]" });
  });
});
