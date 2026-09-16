// Structured extraction from an after-sales description (function-calling schema).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { parseJsonBody } from "./http.ts";
import { afterSalesTicketSchema, extractRequestSchema, normalizeOrderId } from "./schemas.ts";

import { structured } from "#/core/llm.ts";
import { EXTRACT_PROMPT } from "#/core/prompts.ts";
import { childLogger } from "#/logger.ts";


const log = childLogger("api.extract");
export const extractRouter = new Hono();

extractRouter.post("/api/extract", async (c) => {
  const req = await parseJsonBody(c, extractRequestSchema);
  try {
    const extractor = EXTRACT_PROMPT.pipe(structured(afterSalesTicketSchema));
    const result = await extractor.invoke({ text: req.text });
    return c.json({ ...result, order_id: normalizeOrderId(result.order_id) });
  } catch (error) {
    log.error({ err: error }, "structured extraction failed");
    throw new HTTPException(502, { message: "The upstream model is temporarily unavailable; please try again later" });
  }
});
