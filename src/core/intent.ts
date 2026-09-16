// Intent classification: nine classes + confidence, with a conservative fallback.
import { z } from "zod";

import { childLogger } from "../logger.ts";

import { structured } from "./llm.ts";
import { INTENT_CLASSIFY_PROMPT } from "./prompts.ts";

const log = childLogger("intent");

export const INTENTS = ["物流", "订单", "商品咨询", "退款退货", "售后", "投诉", "人工", "闲聊", "其他"] as const;
export type Intent = (typeof INTENTS)[number];

const intentSchema = z.object({
  intent: z.enum(INTENTS).describe("九类意图之一"),
  confidence: z.number().min(0).max(1).default(0.5).describe("判断把握 0-1"),
});

export interface IntentResult {
  intent: Intent;
  confidence: number;
}

export async function classify(query: string, history = ""): Promise<IntentResult> {
  // Flat fields avoid upstream 502s on nested schemas. Parse failure falls back to 其他.
  const model = structured(intentSchema, { slot: "intent" });
  try {
    const result = await INTENT_CLASSIFY_PROMPT.pipe(model).invoke({
      query,
      history: history || "(无)",
    });
    return { intent: result.intent, confidence: Number(result.confidence) };
  } catch (error) {
    log.warn({ err: error, query }, "intent classification failed; falling back to 其他");
    return { intent: "其他", confidence: 0 };
  }
}
