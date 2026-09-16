// query_faq: RAG pipeline (rewrite + hybrid retrieval + rerank + self-check) exposed as a tool.
import { z } from "zod";

import { settings } from "@/config.ts";
import * as queryUnderstanding from "@/core/query-understanding.ts";
import * as retrieval from "@/core/retrieval.ts";
import * as selfcheck from "@/core/selfcheck.ts";
import type { KnowledgeHit } from "@/kb/store.ts";
import { defineTool, register } from "@/tools/registry.ts";

const faqInputSchema = z.object({
  keyword: z.string().describe("The policy/rule/procedure question the user is asking (the original wording is fine)"),
  category: z.string().nullable().optional().describe("Optional: filter by category, e.g. 'shipping fee', 'returns', 'product manual'"),
});

export interface FaqArgs {
  keyword: string;
  category?: string | null;
}

export interface FaqCitation {
  n: number;
  id: number;
  section_path: string;
  question: string;
  answer: string;
  content_type: string;
}

export interface FaqResult {
  sufficient: boolean;
  source?: string;
  reason?: string;
  evidence?: string;
  citations: FaqCitation[];
}

export async function queryFaq(args: FaqArgs): Promise<FaqResult> {
  const u = await queryUnderstanding.understand(args.keyword);
  const query = u.standard;
  const bm25Text = u.expanded.length > 0 ? `${query} ${u.expanded.join(" ")}` : query;
  const category = args.category ?? null;

  let hits = await retrieval.searchKnowledge(query, {
    strategy: "hybrid_rerank",
    category,
    bm25Text,
  });

  // Category is model-generated and often wrong; a bad filter must not cause refusal.
  if (category && (hits.length === 0 || (hits[0].rerank_score ?? 0) < settings.rerankMinScore)) {
    hits = await retrieval.searchKnowledge(query, {
      strategy: "hybrid_rerank",
      category: null,
      bm25Text,
    });
  }

  return evaluateHits(query, hits);
}

export async function evaluateHits(query: string, hits: KnowledgeHit[]): Promise<FaqResult> {
  const top = hits.length > 0 ? (hits[0].rerank_score ?? 0) : 0;
  if (hits.length === 0 || top < settings.rerankMinScore) {
    return {
      sufficient: false,
      source: "retrieval_low_conf",
      reason: `Retrieved evidence insufficient (top=${top.toFixed(3)})`,
      citations: [],
    };
  }

  const evidenceTexts = hits.map((h) => `${h.question} ${h.answer}`);
  const check = await selfcheck.checkSufficient(query, evidenceTexts);
  if (!check.useful) {
    return { sufficient: false, source: "self_check", reason: check.reason, citations: [] };
  }

  const arranged = retrieval.arrangeHeadTail(hits);
  const citations = arranged.map((h, i) => ({
    n: i + 1,
    id: h.id,
    section_path: h.section_path,
    question: h.question,
    answer: h.answer,
    content_type: h.content_type,
  }));
  const evidence = citations.map((c) => `[${c.n}] ${c.question}: ${c.answer}`).join("\n");
  return { sufficient: true, evidence, citations };
}

register(
  defineTool({
    name: "query_faq",
    description:
      "Search the FAQ/policy knowledge base (hybrid retrieval + rerank). Use it for general questions about policies, rules, timeframes, fees, and product manuals. " +
      "Returns numbered evidence to cite when answering; when the evidence is insufficient it returns sufficient=False, and you must decline to answer the user accordingly.",
    schema: faqInputSchema,
    // The RAG pipeline is slow by nature; a timeout is usually upstream slowness, so no retry.
    timeout: 30.0,
    maxRetries: 0,
    handler: async (args) => {
      const parsed = faqInputSchema.parse(args);
      return queryFaq({ keyword: parsed.keyword, category: parsed.category ?? null });
    },
  }),
);
