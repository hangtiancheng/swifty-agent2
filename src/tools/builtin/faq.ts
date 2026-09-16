// query_faq: RAG pipeline (rewrite + hybrid retrieval + rerank + self-check) exposed as a tool.
import { z } from "zod";

import { settings } from "../../config.ts";
import * as queryUnderstanding from "../../core/query-understanding.ts";
import * as retrieval from "../../core/retrieval.ts";
import * as selfcheck from "../../core/selfcheck.ts";
import type { KnowledgeHit } from "../../kb/store.ts";
import { defineTool, register } from "../registry.ts";

const faqInputSchema = z.object({
  keyword: z.string().describe("用户咨询的政策/规则/操作类问题(可用原话)"),
  category: z.string().nullable().optional().describe("可选:按品类过滤,如『运费』『退货』『商品手册』"),
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
      reason: `检索证据不足(top=${top.toFixed(3)})`,
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
      "查询常见问题/政策知识库(混合检索+重排)。用于政策、规则、时效、费用、商品手册等通用问题。" +
      "返回带编号证据供作答引用;证据不足时返回 sufficient=False,请据此向用户拒答。",
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
