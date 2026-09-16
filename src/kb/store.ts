// Knowledge vector store: dense retrieval over the Milvus bridge, BM25 in-process.
//
// The Python original (~/Downloads/python app/kb/milvus_client.py) ran Milvus Standalone and
// pushed dense + sparse(BM25 Function) + hybrid(RRFRanker) all inside Milvus. This port keeps
// the same four strategies (vector / bm25 / hybrid / hybrid_rerank) but splits the backends:
//   - dense ANN goes to Milvus Lite through the Python gRPC bridge (src/milvus/server.py)
//     when MILVUS_RPC_URL is set, and Milvus is then the authoritative vector store;
//   - BM25 is always computed in-process over the knowledge_chunks text (CJK-aware bigrams);
//   - hybrid fuses the two with the existing reciprocal-rank-fusion code below.
// With MILVUS_RPC_URL empty, dense falls back to the legacy in-process cosine over SQLite
// embeddings, so the server still runs without the bridge. See src/milvus/kb_store.proto.
import * as milvus from "./milvus-rpc.ts";

import { settings } from "#/config.ts";
import { listVectorizedChunks } from "#/db/repository.ts";

export const COLLECTION = settings.milvusCollection;

const K1 = 1.5;
const B = 0.75;

export interface KnowledgeHit {
  id: number;
  score: number;
  question: string;
  answer: string;
  section_path: string;
  content_type: string;
  category: string;
  rerank_score?: number;
}

interface StoreDoc {
  id: number;
  question: string;
  answer: string;
  section_path: string;
  content_type: string;
  category: string;
  embedding: number[];
  tokens: string[];
  tf: Map<string, number>;
}

interface StoreCache {
  docs: StoreDoc[];
  df: Map<string, number>;
}

// Tokenizer: CJK runs become character bigrams; ASCII words/numbers stay whole.
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = String(text ?? "").toLowerCase();
  const re = /[a-z0-9]+|[\u4e00-\u9fff]+/g;
  for (const match of normalized.matchAll(re)) {
    const seg = match[0];
    if (/^[a-z0-9]+$/.test(seg)) {
      tokens.push(seg);
    } else if (seg.length === 1) {
      tokens.push(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i += 1) {
        tokens.push(seg.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

let cache: StoreCache | null = null;

export function invalidateVectorCache(): void {
  cache = null;
}

async function loadChunks(): Promise<StoreCache> {
  if (cache === null) {
    const rows = await listVectorizedChunks();
    const docs: StoreDoc[] = rows.map((row) => {
      const text = `${row.question}\n${row.answer}`;
      const tokens = tokenize(text);
      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }
      return { ...row, tokens, tf };
    });
    const df = new Map<string, number>();
    for (const doc of docs) {
      for (const term of doc.tf.keys()) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
    cache = { docs, df };
  }
  return cache;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function toHit(doc: StoreDoc, score: number): KnowledgeHit {
  return {
    id: doc.id,
    score,
    question: doc.question,
    answer: doc.answer,
    section_path: doc.section_path,
    content_type: doc.content_type,
    category: doc.category,
  };
}

export async function denseSearch(
  vector: number[],
  topK: number,
  category: string | null = null,
): Promise<KnowledgeHit[]> {
  // Milvus is the authoritative dense store when the bridge is configured; the gRPC error
  // propagates (no in-process fallback) so a down bridge surfaces instead of silently
  // degrading. MilvusHit is structurally a KnowledgeHit (rerank_score is filled later).
  if (milvus.milvusEnabled()) {
    return milvus.search(vector, topK, category);
  }
  const { docs } = await loadChunks();
  const scored = docs
    .filter((d) => !category || d.category === category)
    .map((d): [StoreDoc, number] => [d, cosine(vector, d.embedding)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);
  return scored.map(([doc, score]) => toHit(doc, score));
}

export async function bm25Search(
  text: string,
  topK: number,
  category: string | null = null,
): Promise<KnowledgeHit[]> {
  const { docs, df } = await loadChunks();
  const pool = docs.filter((d) => !category || d.category === category);
  const queryTerms = [...new Set(tokenize(text))];
  const avgdl =
    pool.reduce((sum, d) => sum + d.tokens.length, 0) / (pool.length || 1);
  const N = pool.length || 1;
  const scored = pool.map((doc): [StoreDoc, number] => {
    let score = 0;
    for (const term of queryTerms) {
      const tf = doc.tf.get(term) ?? 0;
      if (tf === 0) {
        continue;
      }
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score +=
        (idf * (tf * (K1 + 1))) /
        (tf + K1 * (1 - B + (B * doc.tokens.length) / avgdl));
    }
    return [doc, score];
  });
  scored.sort((a, b) => b[1] - a[1]);
  return scored
    .filter(([, score]) => score > 0)
    .slice(0, topK)
    .map(([doc, score]) => toHit(doc, score));
}

export async function hybridSearch(
  vector: number[],
  text: string,
  topK: number,
  recall = 50,
  category: string | null = null,
): Promise<KnowledgeHit[]> {
  // Reciprocal Rank Fusion over dense and BM25 recall lists.
  const [dense, sparse] = await Promise.all([
    denseSearch(vector, recall, category),
    bm25Search(text, recall, category),
  ]);
  const K = 60;
  const fused = new Map<number, KnowledgeHit>();
  for (const list of [dense, sparse]) {
    list.forEach((hit, rank) => {
      const prev = fused.get(hit.id);
      const score = 1 / (K + rank + 1);
      if (prev) {
        prev.score += score;
      } else {
        fused.set(hit.id, { ...hit, score });
      }
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

export async function count(): Promise<number> {
  // In Milvus mode this is the authoritative vector count (used by the kb overview
  // dual-write consistency check: SQLite done-count === Milvus vector-count).
  if (milvus.milvusEnabled()) {
    return milvus.count();
  }
  const { docs } = await loadChunks();
  return docs.length;
}

export async function drop(): Promise<void> {
  if (milvus.milvusEnabled()) {
    await milvus.drop();
  }
  const { prisma } = await import("../db/client.ts");
  await prisma.knowledgeChunk.updateMany({
    data: { embedding: null, vectorId: null, vectorizeStatus: "pending" },
  });
  invalidateVectorCache();
}
