// Offline build: chunk data/kb/*.md into knowledge_chunks as pending rows.
import fs from "node:fs";
import path from "node:path";

import { closeDb } from "#/db/client.ts";
import * as repository from "#/db/repository.ts";
import * as documents from "#/kb/documents.ts";
import * as dualwrite from "#/kb/dualwrite.ts";
import { KB_DIR, SOURCE_TYPES } from "#/kb/sources.ts";

async function main(): Promise<void> {
  // Non-idempotent inserts: skip when document chunks already exist; rebuild via kb-reset.
  const existing = await repository.countChunksByContentTypes(
    Object.values(SOURCE_TYPES),
  );
  if (existing > 0) {
    console.log(
      `⚠️ ${existing} document chunks already exist; skipping to avoid duplicate inserts. Run kb-reset first to rebuild`,
    );
    return;
  }
  let total = 0;
  for (const [fname, ctype] of Object.entries(SOURCE_TYPES)) {
    const md = fs.readFileSync(path.join(KB_DIR, fname), "utf8");
    const chunks = await documents.buildChunks(md, ctype);
    const ids = await dualwrite.writePending(chunks);
    total += ids.length;
    console.log(`  ${fname}: ${ids.length} chunks`);
  }
  console.log(
    `✅ KB built (pending): ${total} chunks in total. Next step: vectorize-kb`,
  );
}

await main();
await closeDb();
