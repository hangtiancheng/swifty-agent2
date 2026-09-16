// Smoke the local BM25 + hybrid retrieval path. A failure is a red line: stop.
//
// The Python project smoked Milvus Standalone's native BM25 + hybrid_search. This stack has no
// Milvus: the same four strategies run over the knowledge_chunks table (see src/kb/store.ts), with
// BM25 computed in-process using CJK-aware bigram tokenization. So this smoke covers the local
// store's tokenize / bm25Search / hybridSearch instead of a vector database.
// Run: node scripts/smoke-bm25.ts (requires a built + vectorized KB)
import { closeDb } from "#/db/client.ts";
import { bm25Search, count, hybridSearch, tokenize } from "#/kb/store.ts";

async function main(): Promise<void> {
  // tokenize is pure and always checkable, even with an empty KB.
  const tokens = tokenize("How is the shipping fee calculated 运费怎么算");
  console.log("tokenize:", JSON.stringify(tokens));
  if (tokens.length === 0) {
    throw new Error("tokenize returned no tokens");
  }

  const total = await count();
  console.log(`knowledge store count=${total}`);
  if (total === 0) {
    console.log(
      "KB is empty — nothing to smoke. Run `make kb-build && make kb-vectorize` first.",
    );
    return;
  }

  // Pure BM25: a keyword query should recall at least one chunk.
  const bm25 = await bm25Search("shipping fee", 2);
  console.log(
    "bm25:",
    JSON.stringify(bm25.map((h) => [h.id, Number(h.score.toFixed(3))])),
  );
  if (bm25.length === 0) {
    throw new Error("BM25 returned no results for a keyword present in the KB");
  }

  // Hybrid RRF: dense + sparse fused; needs an embedding, so reuse the first BM25 hit's text.
  const { embedQuery } = await import("#/core/embeddings.ts");
  const vec = await embedQuery("shipping fee");
  const hybrid = await hybridSearch(vec, "shipping fee", 2);
  console.log(
    "hybrid:",
    JSON.stringify(hybrid.map((h) => [h.id, Number(h.score.toFixed(3))])),
  );
  if (hybrid.length === 0) {
    throw new Error("hybridSearch returned no results");
  }

  console.log("GO: local BM25 + hybrid retrieval path is live");
}

try {
  await main();
} finally {
  await closeDb();
}
