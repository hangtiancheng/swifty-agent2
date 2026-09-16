// Offline build: chunk data/kb/*.md into knowledge_chunks as pending rows.
import fs from "node:fs";
import path from "node:path";

import { closeDb } from "../src/db/client.ts";
import * as repository from "../src/db/repository.ts";
import * as documents from "../src/kb/documents.ts";
import * as dualwrite from "../src/kb/dualwrite.ts";
import { KB_DIR, SOURCE_TYPES } from "../src/kb/sources.ts";

async function main(): Promise<void> {
  // Non-idempotent inserts: skip when document chunks already exist; rebuild via kb-reset.
  const existing = await repository.countChunksByContentTypes(Object.values(SOURCE_TYPES));
  if (existing > 0) {
    console.log(`⚠️ 已存在 ${existing} 条文档块,跳过以防重复插入。重建请先跑 kb-reset`);
    return;
  }
  let total = 0;
  for (const [fname, ctype] of Object.entries(SOURCE_TYPES)) {
    const md = fs.readFileSync(path.join(KB_DIR, fname), "utf8");
    const chunks = await documents.buildChunks(md, ctype);
    const ids = await dualwrite.writePending(chunks);
    total += ids.length;
    console.log(`  ${fname}: ${ids.length} 块`);
  }
  console.log(`✅ 建库(pending):共 ${total} 块。下一步:vectorize-kb`);
}

await main();
await closeDb();
