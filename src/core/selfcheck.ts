// Pre-generation evidence self-check. A model failure is treated as "insufficient"
// (never as "sufficient"), because the gate exists to stop unsupported answers.
import { z } from "zod";


import { structured } from "./llm.ts";
import { SELF_CHECK_PROMPT } from "./prompts.ts";

import { childLogger } from "@/logger.ts";

const log = childLogger("selfcheck");

const checkSchema = z.object({
  useful: z.boolean().describe("Whether the evidence is sufficient to answer"),
  reason: z.string().default("").describe("Basis of the judgment"),
});

export interface CheckResult {
  useful: boolean;
  reason: string;
}

export async function checkSufficient(query: string, evidenceTexts: string[]): Promise<CheckResult> {
  const evidence =
    evidenceTexts.map((t, i) => `[${i + 1}] ${t}`).join("\n") || "(no evidence)";
  try {
    const model = structured(checkSchema);
    const result = await SELF_CHECK_PROMPT.pipe(model).invoke({ query, evidence });
    return { useful: Boolean(result.useful), reason: result.reason || "" };
  } catch (error) {
    log.warn({ err: error, query }, "evidence self-check failed; treating evidence as insufficient");
    return { useful: false, reason: "Evidence self-check failed" };
  }
}
