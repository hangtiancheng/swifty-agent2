// Data access layer. JSON-ish columns are stored as text and validated on read.
import { z } from "zod";

import { prisma } from "./client.ts";
import {
  numberArraySchema,
  parseWith,
  stringArraySchema,
  toJson,
} from "./json.ts";

import { settings } from "#/config.ts";

const metricRecordSchema = z.record(z.string(), z.number());

let ticketSeq = 0;

function genTicketNo(): string {
  ticketSeq += 1;
  const now = new Date();
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `T${stamp}${pad(ticketSeq, 3)}`;
}

export interface AppendMessageOptions {
  content?: string | null;
  toolCalls?: unknown;
  toolCallId?: string | null;
}

// ---------- conversations / messages ----------

export async function createConversation(userId: string): Promise<number> {
  const conv = await prisma.conversation.create({ data: { userId } });
  return conv.id;
}

export async function getConversation(conversationId: number) {
  return prisma.conversation.findUnique({ where: { id: conversationId } });
}

export async function appendMessage(
  conversationId: number,
  role: string,
  options: AppendMessageOptions = {},
): Promise<number> {
  const msg = await prisma.message.create({
    data: {
      conversationId,
      role,
      content: options.content ?? null,
      toolCalls: toJson(options.toolCalls),
      toolCallId: options.toolCallId ?? null,
    },
  });
  return msg.id;
}

export async function listMessages(conversationId: number) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { id: "asc" },
  });
}

export async function createTicket(
  conversationId: number,
  description: string,
  ticketType: string,
): Promise<string> {
  const ticketNo = genTicketNo();
  await prisma.$transaction([
    prisma.ticket.create({
      data: { ticketNo, conversationId, description, ticketType },
    }),
    prisma.conversation.updateMany({
      where: { id: conversationId },
      data: { status: "transferred" },
    }),
  ]);
  return ticketNo;
}

export interface ConversationListItem {
  id: number;
  status: string;
  preview: string;
  has_summary: boolean;
  updated_at: string;
}

export async function listConversations(
  userId: string,
  limit = 50,
): Promise<ConversationListItem[]> {
  const convs = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { id: "desc" },
    take: limit,
  });
  const out: ConversationListItem[] = [];
  for (const c of convs) {
    const first = await prisma.message.findFirst({
      where: { conversationId: c.id, role: "user" },
      orderBy: { id: "asc" },
      select: { content: true },
    });
    out.push({
      id: c.id,
      status: c.status,
      preview: String(first?.content ?? "(empty conversation)").slice(0, 40),
      has_summary: Boolean(c.summary),
      updated_at: c.updatedAt.toISOString(),
    });
  }
  return out;
}

// ---------- conversation context (sliding window / summaries) ----------

export async function countMessagesAfter(
  conversationId: number,
  afterId: number | null,
): Promise<number> {
  return prisma.message.count({
    where: { conversationId, ...(afterId ? { id: { gt: afterId } } : {}) },
  });
}

export async function listDialogMessages(conversationId: number) {
  return prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { id: "asc" },
  });
}

export async function updateConversationSummary(
  conversationId: number,
  summary: string,
  uptoMsgId: number,
): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId },
    data: { summary, summaryUptoMsgId: uptoMsgId },
  });
}

export async function updateLayer1From(
  conversationId: number,
  msgId: number,
): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId },
    data: { layer1FromMsgId: msgId },
  });
}

export async function appendSummarySegment(
  conversationId: number,
  fromMsgId: number,
  uptoMsgId: number,
  content: string,
): Promise<number> {
  const prev = await prisma.conversationSummary.findMany({
    where: { conversationId },
    orderBy: { seq: "desc" },
    take: Math.max(settings.summaryInjectSegments - 1, 0),
    select: { seq: true, content: true },
  });
  const seq = (prev[0]?.seq ?? 0) + 1;
  const projection = [...prev.map((r) => r.content).reverse(), content].join(
    "\n",
  );
  await prisma.$transaction([
    prisma.conversationSummary.create({
      data: { conversationId, seq, fromMsgId, uptoMsgId, content },
    }),
    prisma.conversation.updateMany({
      where: { id: conversationId },
      data: { summary: projection, summaryUptoMsgId: uptoMsgId },
    }),
  ]);
  return seq;
}

export async function listSummarySegments(
  conversationId: number,
  limit?: number,
): Promise<string[]> {
  const n = limit ?? settings.summaryInjectSegments;
  const rows = await prisma.conversationSummary.findMany({
    where: { conversationId },
    orderBy: { seq: "desc" },
    take: n,
    select: { content: true },
  });
  return rows.map((r) => r.content).reverse();
}

// ---------- knowledge chunks / staging ----------

export interface InsertChunkInput {
  category: string;
  questions: string;
  answer: string;
  sectionPath?: string | null;
  contentType?: string | null;
  isKeyClause?: number;
}

export async function insertKnowledgeChunk(
  input: InsertChunkInput,
): Promise<number> {
  const row = await prisma.knowledgeChunk.create({
    data: {
      category: input.category,
      questions: input.questions,
      answer: input.answer,
      sectionPath: input.sectionPath ?? null,
      contentType: input.contentType ?? null,
      isKeyClause: input.isKeyClause ?? 0,
    },
  });
  return row.id;
}

export async function listPendingChunks() {
  return prisma.knowledgeChunk.findMany({
    where: { vectorizeStatus: "pending" },
    orderBy: { id: "asc" },
  });
}

export async function markChunkVectorized(
  chunkId: number,
  vectorId: string,
  embedding: number[],
): Promise<void> {
  await prisma.knowledgeChunk.updateMany({
    where: { id: chunkId },
    data: { vectorId, vectorizeStatus: "done", embedding: toJson(embedding) },
  });
}

// Milvus-bridge variant: the dense vector lives in Milvus, so only the vector id and status
// are recorded here and the embedding column is left null (see src/kb/milvus-rpc.ts).
export async function markChunkVectorizedExternal(
  chunkId: number,
  vectorId: string,
): Promise<void> {
  await prisma.knowledgeChunk.updateMany({
    where: { id: chunkId },
    data: { vectorId, vectorizeStatus: "done" },
  });
}

export async function setChunkNeighbors(
  chunkId: number,
  prevId: number | null,
  nextId: number | null,
): Promise<void> {
  await prisma.knowledgeChunk.updateMany({
    where: { id: chunkId },
    data: { prevChunkId: prevId, nextChunkId: nextId },
  });
}

export async function listChunksByContentTypes(contentTypes: Iterable<string>) {
  return prisma.knowledgeChunk.findMany({
    where: { contentType: { in: [...contentTypes] } },
    orderBy: { id: "asc" },
  });
}

export async function rependChunkText(
  chunkId: number,
  questions: string,
  answer: string,
): Promise<void> {
  await prisma.knowledgeChunk.updateMany({
    where: { id: chunkId },
    data: {
      questions,
      answer,
      vectorizeStatus: "pending",
      embedding: null,
      vectorId: null,
    },
  });
}

export async function countChunksByStatus(status: string): Promise<number> {
  return prisma.knowledgeChunk.count({ where: { vectorizeStatus: status } });
}

export async function listAllQuestions(): Promise<string[]> {
  const rows = await prisma.knowledgeChunk.findMany({
    select: { questions: true },
  });
  return rows.map((r) => r.questions);
}

export async function countChunksByContentTypes(
  contentTypes: Iterable<string>,
): Promise<number> {
  return prisma.knowledgeChunk.count({
    where: { contentType: { in: [...contentTypes] } },
  });
}

export interface KnowledgeStats {
  total: number;
  pending: number;
  done: number;
  by_content_type: Record<string, number>;
  key_clause: number;
}

export async function knowledgeStats(): Promise<KnowledgeStats> {
  const [total, statusRows, typeRows, keyClause] = await Promise.all([
    prisma.knowledgeChunk.count(),
    prisma.knowledgeChunk.groupBy({
      by: ["vectorizeStatus"],
      _count: { _all: true },
    }),
    prisma.knowledgeChunk.groupBy({
      by: ["contentType"],
      _count: { _all: true },
    }),
    prisma.knowledgeChunk.count({ where: { isKeyClause: 1 } }),
  ]);
  const byStatus = Object.fromEntries(
    statusRows.map((r) => [r.vectorizeStatus, r._count._all]),
  );
  const byType = Object.fromEntries(
    typeRows.map((r) => [r.contentType ?? "untagged", r._count._all]),
  );
  return {
    total,
    pending: byStatus.pending ?? 0,
    done: byStatus.done ?? 0,
    by_content_type: byType,
    key_clause: keyClause,
  };
}

export async function listRecentChunks(limit = 20) {
  return prisma.knowledgeChunk.findMany({
    orderBy: { id: "desc" },
    take: limit,
  });
}

export async function listChunkPairs(): Promise<[string, string][]> {
  const rows = await prisma.knowledgeChunk.findMany({
    select: { questions: true, answer: true },
  });
  return rows.map((r) => [r.questions, r.answer]);
}

export interface VectorizedChunk {
  id: number;
  question: string;
  answer: string;
  section_path: string;
  content_type: string;
  category: string;
  embedding: number[];
}

export async function listVectorizedChunks(): Promise<VectorizedChunk[]> {
  // No `embedding != null` filter: when the Milvus bridge is enabled the dense vectors live
  // in Milvus and this column stays null, but the in-process BM25 index still needs the text.
  const rows = await prisma.knowledgeChunk.findMany({
    where: { vectorizeStatus: "done" },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    question: r.questions,
    answer: r.answer,
    section_path: r.sectionPath ?? "",
    content_type: r.contentType ?? "",
    category: r.category,
    embedding: parseWith(numberArraySchema, r.embedding) ?? [],
  }));
}

export interface StagingStats {
  counts: { extracted: number; kept: number; discarded: number };
  total: number;
  batches: number;
  latest_batch: string | null;
}

export async function stagingStats(): Promise<StagingStats> {
  const rows = await prisma.qaExtractionStaging.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  const batches = await prisma.qaExtractionStaging.findMany({
    distinct: ["batchNo"],
    select: { batchNo: true },
  });
  const latest = await prisma.qaExtractionStaging.findFirst({
    orderBy: { id: "desc" },
    select: { batchNo: true },
  });
  return {
    counts: {
      extracted: counts.extracted ?? 0,
      kept: counts.kept ?? 0,
      discarded: counts.discarded ?? 0,
    },
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    batches: batches.length,
    latest_batch: latest?.batchNo ?? null,
  };
}

export async function insertStaging(
  batchNo: string,
  sourceRef: string | null,
  question: string,
  answer: string,
): Promise<number> {
  const row = await prisma.qaExtractionStaging.create({
    data: { batchNo, sourceRef, question, answer },
  });
  return row.id;
}

export async function listStagingByStatus(status: string) {
  return prisma.qaExtractionStaging.findMany({
    where: { status },
    orderBy: { id: "asc" },
  });
}

export async function listStagingByIds(
  ids: number[],
  status: string | null = null,
) {
  if (ids.length === 0) {
    return [];
  }
  return prisma.qaExtractionStaging.findMany({
    where: { id: { in: ids }, ...(status ? { status } : {}) },
    orderBy: { id: "asc" },
  });
}

export async function setStagingStatus(
  ids: number[],
  status: string,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await prisma.qaExtractionStaging.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });
}

// ---------- low confidence pool ----------

export async function insertLowConfidence(
  conversationId: number | null,
  rawQuestion: string,
  source: string,
  reason: string | null,
  retrievedChunks?: unknown,
): Promise<number> {
  const row = await prisma.lowConfidenceQuestion.create({
    data: {
      conversationId,
      rawQuestion,
      source,
      reason,
      retrievedChunks:
        retrievedChunks === undefined ? null : toJson(retrievedChunks),
    },
  });
  return row.id;
}

export async function listConversationsWithMessages() {
  const convIds = await prisma.conversation.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const out: {
    id: number;
    messages: Awaited<ReturnType<typeof listMessages>>;
  }[] = [];
  for (const { id } of convIds) {
    out.push({ id, messages: await listMessages(id) });
  }
  return out;
}

// ---------- flywheel / review queue ----------

export async function fetchUnmatchedLowConf(limit: number) {
  return prisma.lowConfidenceQuestion.findMany({
    where: { matchedReviewId: null },
    orderBy: { id: "asc" },
    take: limit,
  });
}

export async function listReviewCandidates(
  limit = 200,
): Promise<{ id: number; normalized_question: string }[]> {
  const rows = await prisma.reviewQueue.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, normalizedQuestion: true },
  });
  return rows.map((r) => ({
    id: r.id,
    normalized_question: r.normalizedQuestion,
  }));
}

export async function insertReviewItem(
  normalizedQuestion: string,
  aiSuggestedAnswer: string | null,
): Promise<number> {
  const row = await prisma.reviewQueue.create({
    data: { normalizedQuestion, aiSuggestedAnswer },
  });
  return row.id;
}

export async function incrementOccurrence(reviewId: number): Promise<void> {
  await prisma.reviewQueue.updateMany({
    where: { id: reviewId },
    data: { occurrenceCount: { increment: 1 } },
  });
}

export async function setMatchedReview(
  lcqId: number,
  reviewId: number,
): Promise<void> {
  await prisma.lowConfidenceQuestion.updateMany({
    where: { id: lcqId },
    data: { matchedReviewId: reviewId },
  });
}

export async function listReviewQueue(status: string | null) {
  return prisma.reviewQueue.findMany({
    where: status ? { reviewStatus: status } : {},
    orderBy: [{ occurrenceCount: "desc" }, { id: "desc" }],
  });
}

export async function getReviewDetail(reviewId: number) {
  const item = await prisma.reviewQueue.findUnique({ where: { id: reviewId } });
  if (!item) {
    return null;
  }
  const raws = await prisma.lowConfidenceQuestion.findMany({
    where: { matchedReviewId: reviewId },
    orderBy: { id: "asc" },
  });
  return { item, raws };
}

export async function updateReviewStatus(
  reviewId: number,
  status: string,
  approvedAnswer: string | null = null,
): Promise<boolean> {
  const row = await prisma.reviewQueue.findUnique({ where: { id: reviewId } });
  if (row?.reviewStatus !== "pending_review") {
    return false;
  }
  await prisma.reviewQueue.update({
    where: { id: reviewId },
    data: {
      reviewStatus: status,
      ...(approvedAnswer !== null ? { approvedAnswer } : {}),
    },
  });
  return true;
}

export async function deleteKnowledgeChunks(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await prisma.knowledgeChunk.deleteMany({ where: { id: { in: ids } } });
}

// ---------- eval runs ----------

export interface EvalRunRow {
  id: number;
  triggeredBy: string;
  datasetSize: number;
  metrics: Record<string, number>;
  createdAt: Date;
}

export async function insertEvalRun(
  triggeredBy: string,
  datasetSize: number,
  metrics: Record<string, number>,
): Promise<number> {
  const row = await prisma.evalRun.create({
    data: { triggeredBy, datasetSize, metrics: toJson(metrics) ?? "" },
  });
  return row.id;
}

export async function listEvalRuns(limit = 10): Promise<EvalRunRow[]> {
  const rows = await prisma.evalRun.findMany({
    orderBy: { id: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    triggeredBy: r.triggeredBy,
    datasetSize: r.datasetSize,
    metrics: parseWith(metricRecordSchema, r.metrics) ?? {},
    createdAt: r.createdAt,
  }));
}

// ---------- tool audit ----------

export interface ToolAuditInput {
  conversationId: number | null;
  toolCallId: string | null;
  toolName: string;
  toolSource: string;
  mcpServer: string | null;
  arguments: unknown;
  resultSummary: string | null;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  durationMs: number | null;
}

export async function insertToolAudit(input: ToolAuditInput): Promise<void> {
  await prisma.toolAuditLog.create({
    data: {
      conversationId: input.conversationId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      toolSource: input.toolSource,
      mcpServer: input.mcpServer,
      arguments: toJson(input.arguments),
      resultSummary: input.resultSummary,
      status: input.status,
      errorMessage: input.errorMessage,
      retryCount: input.retryCount,
      durationMs: input.durationMs,
    },
  });
}

// ---------- topics ----------

export interface PoolText {
  question_id: number;
  text: string;
}

export async function listPoolTexts(): Promise<PoolText[]> {
  const rows = await prisma.lowConfidenceQuestion.findMany({
    select: {
      id: true,
      rawQuestion: true,
      matchedReview: { select: { normalizedQuestion: true } },
    },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({
    question_id: r.id,
    text: r.matchedReview?.normalizedQuestion || r.rawQuestion,
  }));
}

export async function listUnclassifiedQuestions(
  limit = 500,
): Promise<PoolText[]> {
  const rows = await prisma.lowConfidenceQuestion.findMany({
    where: {
      matchedReviewId: { not: null },
      topicClassifications: { none: {} },
    },
    select: {
      id: true,
      rawQuestion: true,
      matchedReview: { select: { normalizedQuestion: true } },
    },
    orderBy: { id: "asc" },
    take: limit,
  });
  return rows.map((r) => ({
    question_id: r.id,
    text: r.matchedReview?.normalizedQuestion || r.rawQuestion,
  }));
}

export async function insertTopicClassifications(
  rows: { question_id: number; labels: string[] }[],
): Promise<number> {
  await prisma.topicClassification.createMany({
    data: rows.map((r) => ({
      questionId: r.question_id,
      labels: toJson(r.labels) ?? "",
    })),
  });
  return rows.length;
}

export interface TopicDistribution {
  total: number;
  latest: string | null;
  classes: { label: string; count: number; samples: string[] }[];
}

export async function topicDistribution(
  samplesPerClass = 3,
): Promise<TopicDistribution> {
  const { TOPIC_NAMES } = await import("../core/taxonomy.ts");
  const rows = await prisma.topicClassification.findMany({
    select: {
      labels: true,
      classifiedAt: true,
      question: {
        select: {
          rawQuestion: true,
          matchedReview: { select: { normalizedQuestion: true } },
        },
      },
    },
  });
  const counts: Record<string, number> = Object.fromEntries(
    TOPIC_NAMES.map((n) => [n, 0]),
  );
  const samples: Record<string, string[]> = Object.fromEntries(
    TOPIC_NAMES.map((n) => [n, []]),
  );
  let latest: Date | null = null;
  for (const row of rows) {
    const text =
      row.question.matchedReview?.normalizedQuestion ||
      row.question.rawQuestion;
    if (latest === null || row.classifiedAt > latest) {
      latest = row.classifiedAt;
    }
    for (const label of parseWith(stringArraySchema, row.labels) ?? []) {
      if (!(label in counts)) {
        continue;
      }
      counts[label] += 1;
      if (
        samples[label].length < samplesPerClass &&
        !samples[label].includes(text)
      ) {
        samples[label].push(text);
      }
    }
  }
  return {
    total: rows.length,
    latest: latest ? latest.toISOString() : null,
    classes: TOPIC_NAMES.map((n) => ({
      label: n,
      count: counts[n],
      samples: samples[n],
    })),
  };
}

export interface TopicQuestionItem {
  question_id: number;
  labels: string[];
  text: string;
  raw_question: string;
  normalized: boolean;
  source: string;
  occurrence_count: number | null;
  review_status: string | null;
  asked_at: string;
  classified_at: string;
}

export interface TopicQuestionsPage {
  label: string;
  total: number;
  page: number;
  size: number;
  pages: number;
  items: TopicQuestionItem[];
}

export async function topicQuestions(
  label: string,
  page = 1,
  size = 20,
): Promise<TopicQuestionsPage> {
  const rows = await prisma.topicClassification.findMany({
    select: {
      questionId: true,
      labels: true,
      classifiedAt: true,
      question: {
        select: {
          rawQuestion: true,
          source: true,
          createdAt: true,
          matchedReview: {
            select: {
              normalizedQuestion: true,
              occurrenceCount: true,
              reviewStatus: true,
            },
          },
        },
      },
    },
    orderBy: { questionId: "desc" },
  });
  const hit = rows.filter((r) =>
    (parseWith(stringArraySchema, r.labels) ?? []).includes(label),
  );
  const pageSize = Math.max(1, Math.min(size, 100));
  const pages = Math.max(1, Math.ceil(hit.length / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  const items = hit
    .slice((current - 1) * pageSize, current * pageSize)
    .map((r) => {
      const q = r.question;
      const norm = q.matchedReview?.normalizedQuestion ?? null;
      return {
        question_id: r.questionId,
        labels: parseWith(stringArraySchema, r.labels) ?? [],
        text: norm || q.rawQuestion,
        raw_question: q.rawQuestion,
        normalized: norm !== null,
        source: q.source,
        occurrence_count: q.matchedReview?.occurrenceCount ?? null,
        review_status: q.matchedReview?.reviewStatus ?? null,
        asked_at: q.createdAt.toISOString(),
        classified_at: r.classifiedAt.toISOString(),
      };
    });
  return {
    label,
    total: hit.length,
    page: current,
    size: pageSize,
    pages,
    items,
  };
}

// ---------- faith case ledger ----------

export interface UpsertFaithCaseOptions {
  citations?: unknown;
  strategy?: string;
  judgeModel?: string | null;
}

export async function upsertFaithCase(
  evalId: string,
  bucket: string,
  query: string,
  answer: string,
  reason: string,
  options: UpsertFaithCaseOptions = {},
): Promise<[number, boolean]> {
  const now = new Date();
  const row = await prisma.faithCase.findUnique({ where: { evalId } });
  if (!row) {
    const created = await prisma.faithCase.create({
      data: {
        evalId,
        bucket,
        query,
        answer,
        reason,
        citations: toJson(options.citations ?? null),
        strategy: options.strategy ?? "hybrid_rerank",
        judgeModel: options.judgeModel ?? null,
        status: "unresolved",
        seenCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    return [created.id, false];
  }
  const reopened = row.status !== "unresolved";
  await prisma.faithCase.update({
    where: { id: row.id },
    data: {
      bucket,
      query,
      answer,
      reason,
      strategy: options.strategy ?? "hybrid_rerank",
      judgeModel: options.judgeModel ?? null,
      ...(options.citations !== undefined
        ? { citations: toJson(options.citations) }
        : {}),
      seenCount: row.seenCount + 1,
      lastSeenAt: now,
      status: "unresolved",
    },
  });
  return [row.id, reopened];
}

export interface FaithCounts {
  unresolved: number;
  resolved: number;
  dismissed: number;
}

export async function listFaithCases(
  status: string | null = null,
  page = 1,
  size = 5,
) {
  const counts: FaithCounts = { unresolved: 0, resolved: 0, dismissed: 0 };
  const grouped = await prisma.faithCase.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  for (const g of grouped) {
    if (
      g.status === "unresolved" ||
      g.status === "resolved" ||
      g.status === "dismissed"
    ) {
      counts[g.status] = g._count._all;
    }
  }
  const where = status ? { status } : {};
  const total = await prisma.faithCase.count({ where });
  const rows = await prisma.faithCase.findMany({
    where,
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
    skip: Math.max(0, (page - 1) * size),
    take: size,
  });
  rows.sort((a, b) => {
    const rank = (s: string): number => (s === "unresolved" ? 0 : 1);
    if (rank(a.status) !== rank(b.status)) {
      return rank(a.status) - rank(b.status);
    }
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || b.id - a.id;
  });
  return { rows, total, counts };
}

export async function faithCaseStatusMap(): Promise<Record<string, string>> {
  const rows = await prisma.faithCase.findMany({
    select: { evalId: true, status: true },
  });
  return Object.fromEntries(rows.map((r) => [r.evalId, r.status]));
}

export async function setFaithCaseStatus(
  caseId: number,
  status: string,
  resolution: string | null = null,
) {
  const row = await prisma.faithCase.findUnique({ where: { id: caseId } });
  if (!row) {
    return null;
  }
  return prisma.faithCase.update({
    where: { id: caseId },
    data:
      status === "unresolved"
        ? { status, resolvedAt: null, resolution: null }
        : { status, resolvedAt: new Date(), resolution },
  });
}
