// Smoke the in-process BM25 + hybrid retrieval path. A failure is a red line: stop.
//
// BM25 always runs in-process over the knowledge_chunks text (CJK-aware bigram tokenization),
// in both storage modes (see src/kb/store.ts): legacy SQLite embeddings or the Milvus Lite
// dense bridge. Hybrid fuses BM25 with dense via reciprocal-rank fusion on this side. The
// bridge itself has a dedicated smoke: scripts/smoke-milvus.ts.
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
