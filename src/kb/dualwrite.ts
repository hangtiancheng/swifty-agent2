// Dual write: MySQL-equivalent rows first (pending), then embeddings, then mark done.
import type { Chunk } from "./documents.ts";
import { invalidateVectorCache } from "./store.ts";

import { embedTexts } from "@/core/embeddings.ts";
import {
  insertKnowledgeChunk,
  listPendingChunks,
  markChunkVectorized,
  setChunkNeighbors,
} from "@/db/repository.ts";


export async function writePending(chunks: Chunk[]): Promise<number[]> {
  const ids: number[] = [];
  for (const c of chunks) {
    const id = await insertKnowledgeChunk({
      category: c.category,
      questions: c.questions,
      answer: c.answer,
      sectionPath: c.sectionPath,
      contentType: c.contentType,
      isKeyClause: c.isKeyClause,
    });
    ids.push(id);
  }
  for (let i = 0; i < ids.length; i += 1) {
    const prevId = i > 0 ? ids[i - 1] : null;
    const nextId = i < ids.length - 1 ? ids[i + 1] : null;
    await setChunkNeighbors(ids[i], prevId, nextId);
  }
  return ids;
}

function* batches<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

export async function vectorizePending(batchSize = 64): Promise<number> {
  // Idempotent: read pending -> embed -> store dense vector -> mark done.
  const pending = await listPendingChunks();
  let done = 0;
  for (const batch of batches(pending, batchSize)) {
    const texts = batch.map((r) => `${r.category}\n${r.questions}\n${r.answer}`);
    const vectors = await embedTexts(texts);
    for (let i = 0; i < batch.length; i += 1) {
      const row = batch[i];
      await markChunkVectorized(row.id, String(row.id), vectors[i]);
      done += 1;
    }
  }
  if (done > 0) {
    invalidateVectorCache();
  }
  return done;
}
