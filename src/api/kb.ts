// Knowledge base API: material overview, chunk preview, ingest, vectorize, search, staging review.
import fs from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { parseJsonBody } from "./http.ts";
import {
  ingestRequestSchema,
  previewRequestSchema,
  searchRequestSchema,
  stagingReviewRequestSchema,
} from "./schemas.ts";

import { status as jobStatus } from "#/core/jobs.ts";
import * as retrieval from "#/core/retrieval.ts";
import * as repository from "#/db/repository.ts";
import * as chunking from "#/kb/chunking.ts";
import { dedupeFingerprint } from "#/kb/dedup.ts";
import * as documents from "#/kb/documents.ts";
import * as dualwrite from "#/kb/dualwrite.ts";
import { CONTENT_TYPE_DESC, CONTENT_TYPES, KB_DIR, SOURCE_TYPES } from "#/kb/sources.ts";
import * as store from "#/kb/store.ts";
import { childLogger } from "#/logger.ts";


const log = childLogger("api.kb");
export const kbRouter = new Hono();

const MAX_TEXT_CHARS = 40_000;
const STRATEGIES = ["vector", "bm25", "hybrid", "hybrid_rerank"] as const;
const KB_JOBS = ["kb-preview", "kb-build", "kb-repatch", "kb-mine", "kb-vectorize", "seed-conv", "kb-reset"];

function fingerprint(questions: string, answer: string): string {
  return dedupeFingerprint(questions, answer);
}

interface ChunkViewInput {
  seq: number;
  chunk: documents.Chunk;
  duplicate: boolean | null;
}

function chunkView({ seq, chunk, duplicate }: ChunkViewInput): Record<string, unknown> {
  return {
    seq,
    section_path: chunk.sectionPath || "(no heading hierarchy)",
    category: chunk.category,
    questions: chunk.questions,
    answer: chunk.answer,
    chars: chunk.answer.length,
    is_key_clause: Boolean(chunk.isKeyClause),
    is_table: chunking.isTableBlock(chunk.answer),
    duplicate,
  };
}

function features(chunks: documents.Chunk[]): Record<string, unknown> {
  const groups = new Map<string, documents.Chunk[]>();
  for (const c of chunks) {
    const list = groups.get(c.sectionPath) ?? [];
    list.push(c);
    groups.set(c.sectionPath, list);
  }
  const values = [...groups.values()];
  return {
    sections: groups.size,
    table_split: values.some((g) => g.length > 1 && chunking.isTableBlock(g[0].answer)),
    overlap: values.some((g) => g.length > 1 && !chunking.isTableBlock(g[0].answer)),
    multi_piece_sections: [...groups.entries()].filter(([, g]) => g.length > 1).map(([p]) => p),
  };
}

async function existingFingerprints(): Promise<Set<string> | null> {
  try {
    const pairs = await repository.listChunkPairs();
    return new Set(pairs.map(([q, a]) => fingerprint(q, a)));
  } catch {
    return null;
  }
}

export async function milvusState(): Promise<Record<string, unknown>> {
  // The local store has no separate service to probe: "offline" here means the DB read failed.
  try {
    return { online: true, count: await store.count(), collection: store.COLLECTION };
  } catch (error) {
    return {
      online: false,
      count: null,
      detail: `${error instanceof Error ? error.constructor.name : "Error"}: ${String(error)}`,
    };
  }
}

async function sources(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const [fname, ctype] of Object.entries(SOURCE_TYPES)) {
    const file = path.join(KB_DIR, fname);
    const item: Record<string, unknown> = {
      file: fname,
      content_type: ctype,
      present: fs.existsSync(file),
      path: `data/kb/${fname}`,
    };
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      const chunks = await documents.buildChunks(raw, ctype);
      const stat = fs.statSync(file);
      item.chars = raw.length;
      item.lines = raw.split("\n").length;
      item.mtime = stat.mtime.toISOString().slice(0, 19);
      item.chunks = chunks.length;
      item.key_clause = chunks.filter((c) => c.isKeyClause).length;
      item.features = features(chunks);
    }
    out.push(item);
  }
  return out;
}

kbRouter.get("/api/kb/overview", async () => {
  const milvus = await milvusState();
  let stats: repository.KnowledgeStats | null = null;
  let recent: Record<string, unknown>[] = [];
  let staging: repository.StagingStats | null = null;
  let dbError: string | null = null;
  try {
    stats = await repository.knowledgeStats();
    recent = (await repository.listRecentChunks(12)).map((r) => ({
      id: r.id,
      questions: r.questions,
      answer: r.answer.slice(0, 120),
      category: r.category,
      section_path: r.sectionPath,
      content_type: r.contentType,
      is_key_clause: Boolean(r.isKeyClause),
      status: r.vectorizeStatus,
      created_at: r.createdAt.toISOString(),
    }));
    staging = await repository.stagingStats();
  } catch (error) {
    dbError = `${error instanceof Error ? error.constructor.name : "Error"}: ${String(error)}`;
  }

  // Dual-write consistency = nothing pending and the vector count matches the done count.
  let consistent: boolean | null = null;
  if (dbError === null && stats !== null && milvus.online === true) {
    consistent = stats.pending === 0 && stats.done === milvus.count;
  }

  return Response.json({
    chunks: stats ?? { total: null, pending: null, done: null, by_content_type: {}, key_clause: null },
    recent,
    staging,
    db_error: dbError,
    milvus,
    consistent,
    sources: await sources(),
    content_types: CONTENT_TYPES.map((k) => ({ key: k, desc: CONTENT_TYPE_DESC[k] })),
    jobs: KB_JOBS.map((n) => jobStatus(n)),
  });
});

function resolvePreview(body: { text: string | null; file: string | null; content_type: string }): [string, string, string] {
  if (body.file) {
    if (!(body.file in SOURCE_TYPES)) {
      throw new HTTPException(400, { message: `Not in the KB material list: ${body.file}` });
    }
    const file = path.join(KB_DIR, body.file);
    if (!fs.existsSync(file)) {
      throw new HTTPException(404, { message: `Material file not found: data/kb/${body.file}` });
    }
    return [fs.readFileSync(file, "utf8"), SOURCE_TYPES[body.file], `data/kb/${body.file}`];
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    throw new HTTPException(400, { message: "The text is empty; paste some Markdown before previewing" });
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new HTTPException(400, {
      message: `The text is ${text.length} characters, over the single-ingest limit of ${MAX_TEXT_CHARS}; split it up`,
    });
  }
  if (!Array.isArray(CONTENT_TYPES) || !CONTENT_TYPES.some((t) => t === body.content_type)) {
    throw new HTTPException(400, { message: `content_type must be one of ${CONTENT_TYPES.join("/")}` });
  }
  return [text, body.content_type, "manual entry"];
}

kbRouter.post("/api/kb/preview", async (c) => {
  const body = await parseJsonBody(c, previewRequestSchema);
  const [text, ctype, source] = resolvePreview(body);
  const chunks = await documents.buildChunks(text, ctype);
  const seen = await existingFingerprints();
  const views: Record<string, unknown>[] = [];
  let dups = 0;
  const batch = new Set<string>();
  chunks.forEach((chunk, i) => {
    const fp = fingerprint(chunk.questions, chunk.answer);
    const duplicate = seen === null ? null : seen.has(fp) || batch.has(fp);
    if (duplicate) {
      dups += 1;
    }
    batch.add(fp);
    views.push(chunkView({ seq: i + 1, chunk, duplicate }));
  });
  return Response.json({
    source,
    content_type: ctype,
    chars: text.length,
    total: chunks.length,
    duplicates: dups,
    key_clause: chunks.filter((c) => c.isKeyClause).length,
    features: features(chunks),
    chunks: views,
    dedup_known: seen !== null,
  });
});

kbRouter.post("/api/kb/ingest", async (c) => {
  const body = await parseJsonBody(c, ingestRequestSchema);
  const [text, ctype] = resolvePreview({ text: body.text, file: null, content_type: body.content_type });
  const chunks = await documents.buildChunks(text, ctype);
  if (chunks.length === 0) {
    throw new HTTPException(400, { message: "This text produced no chunks; check whether it has headings but no body" });
  }
  const seen = await existingFingerprints();
  if (seen === null) {
    throw new HTTPException(503, { message: "Cannot reach the local DB, so ingestion is impossible (both dedup and persistence need it)" });
  }

  const kept: documents.Chunk[] = [];
  const skipped: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    const fp = fingerprint(chunk.questions, chunk.answer);
    if (seen.has(fp)) {
      skipped.push({ questions: chunk.questions, answer: chunk.answer.slice(0, 80) });
      continue;
    }
    seen.add(fp);
    kept.push(chunk);
  }

  const ids = kept.length > 0 ? await dualwrite.writePending(kept) : [];
  let vectorized: number | null = null;
  if (body.vectorize && ids.length > 0) {
    try {
      vectorized = await dualwrite.vectorizePending();
    } catch (error) {
      const detail = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);
      throw new HTTPException(502, {
        message: `${ids.length} chunks stored (pending), but vectorization failed: ${detail}. After fixing the embedding service, run "Vectorize pending chunks" to catch up; no need to re-ingest`,
      });
    }
  }
  return Response.json({
    content_type: ctype,
    chunks: chunks.length,
    inserted: ids.length,
    skipped: skipped.length,
    skipped_samples: skipped.slice(0, 5),
    ids,
    vectorized,
    milvus: await milvusState(),
    chunk_stats: await repository.knowledgeStats(),
  });
});

kbRouter.post("/api/kb/vectorize", async () => {
  try {
    const n = await dualwrite.vectorizePending();
    return Response.json({ vectorized: n, chunk_stats: await repository.knowledgeStats(), milvus: await milvusState() });
  } catch (error) {
    const detail = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);
    throw new HTTPException(502, { message: `Vectorization failed: ${detail}` });
  }
});

kbRouter.post("/api/kb/search", async (c) => {
  const body = await parseJsonBody(c, searchRequestSchema);
  const q = body.q.trim();
  if (!q) {
    throw new HTTPException(400, { message: "Enter a question before searching" });
  }
  if (!STRATEGIES.some((s) => s === body.strategy)) {
    throw new HTTPException(400, { message: `strategy must be one of ${STRATEGIES.join("/")}` });
  }
  try {
    const hits = await retrieval.searchKnowledge(q, { strategy: body.strategy, topK: body.top_k });
    return Response.json({
      q,
      strategy: body.strategy,
      top_k: body.top_k,
      hits: hits.map((h) => ({
        id: h.id,
        question: h.question,
        answer: h.answer,
        score: h.score,
        rerank_score: h.rerank_score ?? null,
        section_path: h.section_path,
        content_type: h.content_type,
        category: h.category,
      })),
    });
  } catch (error) {
    const detail = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);
    throw new HTTPException(502, { message: `Retrieval failed (${detail}); both the embedding upstream and the vector store must be up` });
  }
});

kbRouter.get("/api/kb/staging", async (c) => {
  const limit = Math.max(1, Number(c.req.query("limit") ?? "30") || 30);
  const stats = await repository.stagingStats();
  const rows: Record<string, unknown[]> = {};
  for (const st of ["extracted", "kept", "discarded", "approved", "rejected"]) {
    rows[st] = (await repository.listStagingByStatus(st)).slice(0, limit).map((r) => ({
      id: r.id,
      batch_no: r.batchNo,
      source_ref: r.sourceRef,
      question: r.question,
      answer: r.answer.slice(0, 160),
    }));
  }
  return Response.json({ stats, rows });
});

kbRouter.post("/api/kb/staging/approve", async (c) => {
  const body = await parseJsonBody(c, stagingReviewRequestSchema);
  const rows = await repository.listStagingByIds(body.ids, "kept");
  if (rows.length === 0) {
    throw new HTTPException(409, { message: "These rows are not in the pending-review state (they may have been processed already)" });
  }
  const chunks: documents.Chunk[] = rows.map((r) => ({
    category: "conversation_history",
    questions: r.question,
    answer: r.answer,
    sectionPath: "mined",
    contentType: "mined",
    isKeyClause: documents.isKey(r.question, r.answer),
  }));
  let ids: number[] = [];
  try {
    ids = await dualwrite.writePending(chunks);
    await dualwrite.vectorizePending();
  } catch (error) {
    log.error({ err: error, staging: rows.map((r) => r.id) }, "staging approval write-back failed; status unchanged");
    if (ids.length > 0) {
      try {
        await repository.deleteKnowledgeChunks(ids);
      } catch (rollbackError) {
        log.error({ err: rollbackError, ids }, "pending chunk rollback failed (manual cleanup needed)");
      }
    }
    throw new HTTPException(502, {
      message: `Write-back to the knowledge base failed (${error instanceof Error ? error.constructor.name : "Error"}); these rows are still pending review — fix the embedding service/vector store and click again`,
    });
  }
  await repository.setStagingStatus(rows.map((r) => r.id), "approved");
  log.info({ staging: rows.map((r) => r.id), chunks: ids }, "staging approved into knowledge base");
  return Response.json({ approved: rows.length, chunk_ids: ids });
});

kbRouter.post("/api/kb/staging/reject", async (c) => {
  const body = await parseJsonBody(c, stagingReviewRequestSchema);
  const rows = await repository.listStagingByIds(body.ids, "kept");
  if (rows.length === 0) {
    throw new HTTPException(409, { message: "These rows are not in the pending-review state (they may have been processed already)" });
  }
  await repository.setStagingStatus(rows.map((r) => r.id), "rejected");
  return Response.json({ rejected: rows.length });
});
