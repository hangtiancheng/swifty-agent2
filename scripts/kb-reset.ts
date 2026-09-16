// Reset the knowledge base: clear chunks + staging and drop stored vectors.
import { closeDb, prisma } from "#/db/client.ts";
import * as store from "#/kb/store.ts";

await prisma.knowledgeChunk.deleteMany();
await prisma.qaExtractionStaging.deleteMany();
await store.drop();
console.log(
  "✅ KB reset (local vectors and knowledge tables cleared). Re-run: kb-build && kb-vectorize",
);
await closeDb();
