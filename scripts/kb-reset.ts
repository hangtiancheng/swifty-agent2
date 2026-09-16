// Reset the knowledge base: clear chunks + staging and drop stored vectors.
import { closeDb, prisma } from "../src/db/client.ts";
import * as store from "../src/kb/store.ts";

await prisma.knowledgeChunk.deleteMany();
await prisma.qaExtractionStaging.deleteMany();
await store.drop();
console.log("✅ KB 已重置(本地向量与知识表已清空)。重跑:kb-build && kb-vectorize");
await closeDb();
