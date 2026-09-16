// Smoke: call the embedding upstream directly and verify connectivity and that the vectors are
// well-formed. Requires EMBED_BASE_URL / EMBED_API_KEY in .env. Run: node scripts/smoke-embed.ts
//
// The expected dimension is model-dependent (the Python original pinned 1024 for bge-m3); this
// checks the model-agnostic invariants instead — every text yields a vector, all vectors share one
// dimension, and that dimension is non-zero — then reports it.
import { settings } from "#/config.ts";
import { embedTexts } from "#/core/embeddings.ts";

async function main(): Promise<void> {
  const vectors = await embedTexts([
    "how much is the shipping fee",
    "how is the shipping fee calculated",
  ]);
  const dims = vectors.map((v) => v.length);
  console.log(
    `model=${settings.embedModel} returned ${vectors.length} vectors, dims=${JSON.stringify(dims)}`,
  );
  if (vectors.length !== 2) {
    throw new Error(`expected 2 vectors, got ${vectors.length}`);
  }
  if (dims[0] === 0 || dims.some((d) => d !== dims[0])) {
    throw new Error(
      `inconsistent or empty embedding dims: ${JSON.stringify(dims)}`,
    );
  }
  console.log(`✅ Smoke passed: embedding upstream reachable, dim ${dims[0]}`);
}

await main();
