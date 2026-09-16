// Vectorize all pending chunks (idempotent, re-runnable).
import { closeDb } from "../src/db/client.ts";
import * as dualwrite from "../src/kb/dualwrite.ts";
import * as store from "../src/kb/store.ts";

async function main(): Promise<void> {
  const n = await dualwrite.vectorizePending();
  console.log(`✅ 本次向量化 ${n} 块;向量库现有 ${await store.count()} 条`);
}

await main();
await closeDb();
