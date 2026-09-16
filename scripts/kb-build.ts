// Offline build: chunk data/kb/*.md into knowledge_chunks as pending rows.
import fs from "node:fs";
import path from "node:path";

import { closeDb } from "#/db/client.ts";
import * as repository from "#/db/repository.ts";
import * as documents from "#/kb/documents.ts";
import * as dualwrite from "#/kb/dualwrite.ts";
import { KB_DIR, SOURCE_TYPES } from "#/kb/sources.ts";

function chunkKey(chunk: {
  category: string;
  questions: string;
  answer: string;
  sectionPath: string | null;
  contentType: string | null;
}): string {
  return JSON.stringify([
    chunk.contentType,
    chunk.sectionPath,
    chunk.category,
    chunk.questions,
    chunk.answer,
  ]);
}

async function main(): Promise<void> {
  const existing = await repository.listChunksByContentTypes(
    Object.values(SOURCE_TYPES),
  );
  const existingCounts = new Map<string, number>();
  for (const row of existing) {
    const key = chunkKey(row);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  let total = 0;
  for (const [fname, contentType] of Object.entries(SOURCE_TYPES)) {
    const md = fs.readFileSync(path.join(KB_DIR, fname), "utf8");
    const chunks = await documents.buildChunks(md, contentType);
    let matched = 0;
    for (const chunk of chunks) {
      const key = chunkKey(chunk);
      const remaining = existingCounts.get(key) ?? 0;
      if (remaining > 0) {
        existingCounts.set(key, remaining - 1);
        matched += 1;
      }
    }
    if (matched === chunks.length) {
      console.log(`  ${fname}: already built`);
      continue;
    }
    if (matched > 0) {
      throw new Error(
        `${fname} is only partially present in the database; run kb-repatch to synchronize it`,
      );
    }
    const ids = await dualwrite.writePending(chunks);
    total += ids.length;
    console.log(`  ${fname}: ${ids.length} chunks`);
  }
  console.log(
    `✅ KB built (pending): ${total} new chunks. Next step: kb-vectorize`,
  );
}

await main();
await closeDb();
