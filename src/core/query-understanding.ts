// Query understanding: colloquial -> standard phrasing + synonym expansion, and query expansion.
// These steps only improve recall; failures degrade to the original query instead of failing the turn.
import { z } from "zod";

import { childLogger } from "../logger.ts";

import { structured } from "./llm.ts";
import { EXPAND_QUERIES_PROMPT, QUERY_REWRITE_PROMPT } from "./prompts.ts";

const log = childLogger("query-understanding");

const rewriteSchema = z.object({
  standard: z.string().describe("标准问法"),
  expanded: z.array(z.string()).default([]).describe("同义/近义扩展词"),
});

const expandedSchema = z.object({
  queries: z.array(z.string()).default([]).describe("严格3条检索友好查询"),
});

export interface UnderstandResult {
  standard: string;
  expanded: string[];
}

export async function understand(query: string): Promise<UnderstandResult> {
  const model = structured(rewriteSchema);
  try {
    const result = await QUERY_REWRITE_PROMPT.pipe(model).invoke({ query });
    return { standard: result.standard || query, expanded: [...(result.expanded ?? [])] };
  } catch (error) {
    log.warn({ err: error, query }, "query rewrite failed; using the original query");
    return { standard: query, expanded: [] };
  }
}

export async function expandQueries(query: string): Promise<string[]> {
  const model = structured(expandedSchema);
  try {
    const result = await EXPAND_QUERIES_PROMPT.pipe(model).invoke({ query });
    const queries = (result.queries ?? []).map((q) => q.trim()).filter((q) => q.length > 0).slice(0, 3);
    return queries.length > 0 ? queries : [query];
  } catch {
    return [query];
  }
}
