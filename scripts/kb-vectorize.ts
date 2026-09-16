// Vectorize all pending chunks (idempotent, re-runnable).
import { closeDb } from "#/db/client.ts";
import * as dualwrite from "#/kb/dualwrite.ts";
import * as store from "#/kb/store.ts";

async function main(): Promise<void> {
  const n = await dualwrite.vectorizePending();
  console.log(`✅ Vectorized ${n} chunks this run; the vector store now holds ${await store.count()} entries`);
}

await main();
await closeDb();
