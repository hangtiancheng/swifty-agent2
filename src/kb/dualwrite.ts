// Dual write: relational rows first (pending), then dense vectors, then mark done.
//
// Legacy mode (MILVUS_RPC_URL empty) stores the embedding on the SQLite row. Milvus mode
// upserts the dense vector into Milvus through the gRPC bridge and records only the vector
// id + status on the row (the embedding column stays null). See src/kb/milvus-rpc.ts.
import type { Chunk } from "./documents.ts";
import * as milvus from "./milvus-rpc.ts";
import { invalidateVectorCache } from "./store.ts";

import { embedTexts } from "#/core/embeddings.ts";
import {
  insertKnowledgeChunk,
  listPendingChunks,
  markChunkVectorized,
  markChunkVectorizedExternal,
  setChunkNeighbors,
} from "#/db/repository.ts";

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
  const useMilvus = milvus.milvusEnabled();
  let done = 0;
  for (const batch of batches(pending, batchSize)) {
    const texts = batch.map(
      (r) => `${r.category}\n${r.questions}\n${r.answer}`,
    );
    const vectors = await embedTexts(texts);
    if (useMilvus) {
      // Milvus is authoritative: upsert the dense vector + scalars, then record only the
      // vector id + status on the row (embedding column stays null).
      const rows = batch.map((r, i): milvus.MilvusRow => ({
        id: r.id,
        dense: vectors[i],
        question: r.questions,
        answer: r.answer,
        section_path: r.sectionPath ?? "",
        content_type: r.contentType ?? "",
        category: r.category ?? "",
      }));
      await milvus.upsert(rows);
      for (const r of batch) {
        await markChunkVectorizedExternal(r.id, String(r.id));
        done += 1;
      }
    } else {
      for (let i = 0; i < batch.length; i += 1) {
        const row = batch[i];
        await markChunkVectorized(row.id, String(row.id), vectors[i]);
        done += 1;
      }
    }
  }
  if (done > 0) {
    if (useMilvus) {
      // Flush so the freshly upserted vectors are visible to search (matches the Python path).
      await milvus.flush();
    }
    invalidateVectorCache();
  }
  return done;
}
