// Coreference resolution + colloquial normalization. Failure returns the original query.
import { getChatModel } from "./llm.ts";
import { contentToString } from "./memory.ts";
import { COREF_REWRITE_PROMPT } from "./prompts.ts";

export async function resolve(query: string, history = ""): Promise<string> {
  try {
    const model = getChatModel();
    const result = await COREF_REWRITE_PROMPT.pipe(model).invoke({
      query,
      history: history || "(none)",
    });
    const text = contentToString(result.content).trim();
    return text || query;
  } catch {
    return query;
  }
}
