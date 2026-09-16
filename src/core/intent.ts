// Intent classification: nine classes + confidence, with a conservative fallback.
import { z } from "zod";


import { structured } from "./llm.ts";
import { INTENT_CLASSIFY_PROMPT } from "./prompts.ts";

import { childLogger } from "#/logger.ts";

const log = childLogger("intent");

export const INTENTS = [
  "logistics",
  "order",
  "product_inquiry",
  "refund_return",
  "after_sales",
  "complaint",
  "human_agent",
  "chitchat",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

const intentSchema = z.object({
  intent: z.enum(INTENTS).describe("One of the nine intent labels"),
  confidence: z.number().min(0).max(1).default(0.5).describe("Confidence in the judgment, 0-1"),
});

export interface IntentResult {
  intent: Intent;
  confidence: number;
}

export async function classify(query: string, history = ""): Promise<IntentResult> {
  // Flat fields avoid upstream 502s on nested schemas. Parse failure falls back to other.
  const model = structured(intentSchema, { slot: "intent" });
  try {
    const result = await INTENT_CLASSIFY_PROMPT.pipe(model).invoke({
      query,
      history: history || "(none)",
    });
    return { intent: result.intent, confidence: Number(result.confidence) };
  } catch (error) {
    log.warn({ err: error, query }, "intent classification failed; falling back to other");
    return { intent: "other", confidence: 0 };
  }
}
