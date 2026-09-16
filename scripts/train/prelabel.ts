// train pre-labeling: the LLM assigns multi-labels to a question following the authoritative
// terminology table. First half of the compromise route — pre-label, then human spot-review.
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

import { structured } from "#/core/llm.ts";
import { LABEL2ID, terminologyTable } from "#/core/taxonomy.ts";
import { mapPool } from "#/train/concurrency.ts";

const labeledSchema = z.object({
  labels: z
    .array(z.string())
    .describe("Hit class names, taken verbatim from the terminology table"),
});

const PRELABEL_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "human",
    `You are a topic annotator for an e-commerce customer service system. Using the authoritative 17-class merged terminology table below, assign topic labels to the user question.

Terminology table (class: boundary description (examples)):
{terminology}

Annotation rules:
1. Label exactly as many asks as are literally mentioned — no more, no less. "bought it too big, want to return it" -> sizing + returns_refunds; "these shoes run a size too big" -> sizing only; do not invent returns_refunds just because they "might want to return it".
2. Neighboring boundaries: repairs go to warranty_repair, returns go to returns_refunds; shipping_fee is about the money, logistics is about the package; price_protection is a difference refund, promotions are coupons and spend-and-save.
3. See through dialect, slang and typos to the actual ask: "where's that thing i ordered, still ain't here" is logistics; "retrun" is a typo for "return".
4. If nothing matches, label "other"; labels must be the exact class names from the terminology table.

User question: {text}`,
  ],
]);

const FALLBACK = "other";

export async function prelabelOne(text: string): Promise<string[]> {
  const model = structured(labeledSchema);
  try {
    const r = await PRELABEL_PROMPT.pipe(model).invoke({
      terminology: terminologyTable(),
      text,
    });
    const labels = r.labels.filter((lb) => lb in LABEL2ID);
    return labels.length > 0 ? labels : [FALLBACK];
  } catch (error) {
    // Failures must be visible: silently labeling "other" pollutes the corpus and quietly
    // drags down the golden-sample gate pass rate.
    console.log(
      `[prelabel] call failed, falling back to "other": ${text.slice(0, 30)}… (${error instanceof Error ? error.constructor.name : "Error"})`,
    );
    return [FALLBACK];
  }
}

export async function prelabelBatch(
  texts: string[],
  concurrency = 8,
): Promise<string[][]> {
  return mapPool(texts, concurrency, (t) => prelabelOne(t));
}
