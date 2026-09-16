// Hybrid retrieval pipeline: clause split -> dense/BM25 -> rerank -> head/tail arrangement.
import { embedQuery } from "./embeddings.ts";
import { rerank } from "./rerank.ts";

import { settings } from "#/config.ts";
import type { KnowledgeHit } from "#/kb/store.ts";
import * as store from "#/kb/store.ts";

const CLAUSE_RE = /[,，;；?？。]/;
const MIN_CLAUSE = 4;

export function splitClauses(query: string): string[] {
  // Split multi-intent questions on punctuation; a single clause returns the original query.
  const parts = String(query ?? "")
    .split(CLAUSE_RE)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CLAUSE);
  return parts.length >= 2 ? parts : [query];
}

function mergeRoundRobin(lists: KnowledgeHit[][]): KnowledgeHit[] {
  const out: KnowledgeHit[] = [];
  const seenId = new Set<string | number>();
  const seenSec = new Set<string>();
  const tail: KnowledgeHit[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i += 1) {
    for (const list of lists) {
      const hit = list[i];
      if (!hit) {
        continue;
      }
      const key = hit.id ?? `${hit.section_path}:${hit.question}`;
      if (seenId.has(key)) {
        continue;
      }
      seenId.add(key);
      const sec = hit.section_path;
      if (sec && seenSec.has(sec)) {
        tail.push(hit);
      } else {
        if (sec) {
          seenSec.add(sec);
        }
        out.push(hit);
      }
    }
  }
  return [...out, ...tail];
}

export function arrangeHeadTail<T>(items: T[]): T[] {
  if (items.length <= 2) {
    return items;
  }
  return [items[0], ...items.slice(2), items[1]];
}

export interface SearchOptions {
  strategy?: "vector" | "bm25" | "hybrid" | "hybrid_rerank";
  topK?: number | null;
  category?: string | null;
  bm25Text?: string | null;
  split?: boolean;
}

export async function searchKnowledge(
  query: string,
  options: SearchOptions = {},
): Promise<KnowledgeHit[]> {
  const {
    strategy = "hybrid_rerank",
    topK = null,
    category = null,
    bm25Text = null,
    split = true,
  } = options;
  const k = topK || settings.rerankTopK;
  const bm25Query = bm25Text || query;

  if (split && settings.subquerySplit) {
    const clauses = splitClauses(query);
    if (clauses.length >= 2) {
      const per = await Promise.all(
        clauses.map((clause) =>
          searchKnowledge(clause, {
            strategy,
            topK: k,
            category,
            split: false,
          }),
        ),
      );
      return mergeRoundRobin(per).slice(0, k);
    }
  }

  if (strategy === "bm25") {
    return store.bm25Search(bm25Query, k, category);
  }
  if (strategy === "vector") {
    const vector = await embedQuery(query);
    return store.denseSearch(vector, k, category);
  }

  const vector = await embedQuery(query);
  const candidateCount =
    strategy === "hybrid" ? k : Math.max(k, settings.recallTopK);
  const hits = await store.hybridSearch(
    vector,
    bm25Query,
    candidateCount,
    settings.recallTopK,
    category,
  );
  if (strategy === "hybrid") {
    return hits.slice(0, k);
  }

  const docs = hits.map((h) => `${h.question} ${h.answer}`);
  const ranked = await rerank(query, docs, k);
  return ranked.map(([index, score]) => ({
    ...hits[index],
    rerank_score: score,
  }));
}
