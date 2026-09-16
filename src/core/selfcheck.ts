// Pre-generation evidence self-check. A model failure is treated as "insufficient"
// (never as "sufficient"), because the gate exists to stop unsupported answers.
import { z } from "zod";

import { childLogger } from "../logger.ts";

import { structured } from "./llm.ts";
import { SELF_CHECK_PROMPT } from "./prompts.ts";

const log = childLogger("selfcheck");

const checkSchema = z.object({
  useful: z.boolean().describe("证据是否足以回答"),
  reason: z.string().default("").describe("判断依据"),
});

export interface CheckResult {
  useful: boolean;
  reason: string;
}

export async function checkSufficient(query: string, evidenceTexts: string[]): Promise<CheckResult> {
  const evidence =
    evidenceTexts.map((t, i) => `[${i + 1}] ${t}`).join("\n") || "(无证据)";
  try {
    const model = structured(checkSchema);
    const result = await SELF_CHECK_PROMPT.pipe(model).invoke({ query, evidence });
    return { useful: Boolean(result.useful), reason: result.reason || "" };
  } catch (error) {
    log.warn({ err: error, query }, "evidence self-check failed; treating evidence as insufficient");
    return { useful: false, reason: "证据自评失败" };
  }
}
