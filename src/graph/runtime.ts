// Graph runtime: checkpointer lifecycle, turn input/resume, streaming events and settlement.
import fs from "node:fs";
import path from "node:path";

import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";

import { buildGraph } from "./build.ts";
import type { GraphState, SuggestedAction } from "./state.ts";

import { settings } from "#/config.ts";
import * as budget from "#/core/budget.ts";
import * as memory from "#/core/memory.ts";
import { recordTurn } from "#/core/observability.ts";
import { maybeScheduleSummary } from "#/core/summarizer.ts";
import * as repository from "#/db/repository.ts";
import { childLogger } from "#/logger.ts";


const log = childLogger("graph.runtime");

const ANSWER_NODES = new Set(["main_agent"]);
const DETERMINISTIC_ANSWER_NODES = new Set(["script_reply", "complaint_reply", "fallback_reply"]);
const CITATION_NODES = new Set(["retrieve_knowledge", "retrieve_policy"]);

type Graph = ReturnType<typeof buildGraph>;
let graph: Graph | null = null;

export class ConversationNotFound extends Error {
  constructor(conversationId: number) {
    super(`conversation not found: ${conversationId}`);
    this.name = "ConversationNotFound";
  }
}

export function initGraph(): void {
  const dbPath = path.resolve(settings.root, settings.checkpointerDbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const saver = SqliteSaver.fromConnString(dbPath);
  graph = buildGraph(saver);
  log.info({ checkpointer: dbPath }, "graph compiled");
}

export function closeGraph(): void {
  graph = null;
}

function getGraph(): Graph {
  if (graph === null) {
    throw new Error("graph is not initialized; call initGraph() during startup");
  }
  return graph;
}

export interface StreamEvent {
  type: "delta" | "citations" | "tool" | "actions" | "interrupt" | "done";
  text?: string;
  items?: unknown;
  name?: string;
  kind?: string;
  conversation_id?: number;
  orders?: unknown;
  preview?: unknown;
}

const stateValuesSchema = z.object({
  messages: z.unknown().optional(),
  retrievedSnapshot: z.unknown().optional(),
  answer: z.string().optional(),
  intent: z.string().optional(),
  intentConfidence: z.number().optional(),
  tokensUsed: z.number().optional(),
});
type StateValues = z.infer<typeof stateValuesSchema>;

function parseStateValues(raw: unknown): StateValues {
  const parsed = stateValuesSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

function baseMessages(value: unknown): BaseMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((m): m is BaseMessage => BaseMessage.isInstance(m));
}

export async function getTurnSnapshot(conversationId: number): Promise<{ question: string; snapshot: unknown[] }> {
  // Best-effort snapshot for thumbs-down feedback; the caller only uses it on a question match.
  const state = await getGraph().getState({ configurable: { thread_id: String(conversationId) } });
  const values = parseStateValues(state.values);
  let question = "";
  const messages = baseMessages(values.messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (HumanMessage.isInstance(m)) {
      question = memory.contentToString(m.content);
      break;
    }
  }
  return { question, snapshot: Array.isArray(values.retrievedSnapshot) ? values.retrievedSnapshot : [] };
}

export function dedupActions(actions: SuggestedAction[]): SuggestedAction[] {
  const seen = new Set<string>();
  const out: SuggestedAction[] = [];
  for (const action of actions) {
    if (seen.has(action.type)) {
      continue;
    }
    seen.add(action.type);
    out.push(action);
  }
  return out;
}

async function ensureConversation(
  userId: string,
  conversationId: number | null,
): Promise<{ cid: number; summary: string; upto: number; layer1: number }> {
  if (conversationId === null) {
    const cid = await repository.createConversation(userId);
    return { cid, summary: "", upto: 0, layer1: 0 };
  }
  const conv = await repository.getConversation(conversationId);
  if (conv === null) {
    throw new ConversationNotFound(conversationId);
  }
  return {
    cid: conversationId,
    summary: conv.summary ?? "",
    upto: conv.summaryUptoMsgId ?? 0,
    layer1: conv.layer1FromMsgId ?? 0,
  };
}

function graphInput(
  userId: string,
  message: string,
  cid: number,
  msgId: number,
  summary: string,
  upto: number,
  layer1: number,
): GraphState {
  // Reset output channels every turn: the checkpointer persists state by thread id, so
  // scalar channels would otherwise leak the previous turn's values.
  return {
    messages: [new HumanMessage({ content: message, id: `db-${msgId}` })],
    userId,
    conversationId: cid,
    intent: "",
    route: "",
    steps: 0,
    tokensUsed: 0,
    answer: "",
    suggestedActions: [],
    evidence: "",
    evidenceStrong: false,
    citations: [],
    evidenceConfidence: 0,
    fallbackSource: "",
    retrievedSnapshot: [],
    resolvedQuery: "",
    intentConfidence: 0,
    orderId: "",
    orderData: {},
    summary,
    summaryUptoMsgId: upto,
    layer1FromMsgId: layer1,
    trace: null,
  };
}

const interruptValueSchema = z.object({
  type: z.string().optional(),
  orders: z.unknown().optional(),
  preview: z.unknown().optional(),
});
export type InterruptValue = z.infer<typeof interruptValueSchema>;

function interruptPayload(state: unknown): InterruptValue | null {
  if (!isInterrupted(state)) {
    return null;
  }
  const parsed = interruptValueSchema.safeParse(state[INTERRUPT][0]?.value);
  return parsed.success ? parsed.data : null;
}

async function finalState(cid: number): Promise<StateValues> {
  const snap = await getGraph().getState({ configurable: { thread_id: String(cid) } });
  return parseStateValues(snap.values);
}

function answerFromValues(values: StateValues): string {
  if (values.answer) {
    return values.answer;
  }
  const messages = baseMessages(values.messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (AIMessage.isInstance(m)) {
      return memory.contentToString(m.content);
    }
  }
  return "";
}

function recordFromValues(cid: number, input: unknown, values: StateValues, fallbackOutput = ""): void {
  recordTurn({
    sessionId: cid,
    input,
    intent: values.intent,
    intentConfidence: values.intentConfidence,
    output: values.answer || answerFromValues(values) || fallbackOutput,
    totalTokens: values.tokensUsed ?? 0,
  });
}

export async function settleLayers(
  cid: number,
  state: StateValues | null,
  summaryUpto: number,
  layer1From: number,
): Promise<void> {
  // Move the layer-1 boundary in one step when it exceeds its budget (pure computation).
  try {
    const values = state ?? (await finalState(cid));
    const msgs = baseMessages(values.messages);
    if (msgs.length === 0) {
      return;
    }
    const l1Budget = Math.floor(budget.compute().sliding * settings.layer1Ratio);
    const [, layer1Tok] = memory.layerTokens(msgs, summaryUpto, layer1From);
    if (layer1Tok <= l1Budget) {
      return;
    }
    const newFrom = memory.nextLayer1From(msgs, summaryUpto, l1Budget);
    if (newFrom > layer1From) {
      await repository.updateLayer1From(cid, newFrom);
      log.info({ conv: cid, from: layer1From, to: newFrom, layer1_tokens: layer1Tok, budget: l1Budget }, "layer 1 degraded");
    }
  } catch (error) {
    log.error({ conv: cid, err: error }, "layer settlement failed (reply unaffected)");
  }
}

export interface TurnResult {
  conversation_id: number;
  state: GraphState;
  interrupt: InterruptValue | null;
}

export async function runTurn(userId: string, message: string, conversationId: number | null): Promise<TurnResult> {
  const { cid, summary, upto, layer1 } = await ensureConversation(userId, conversationId);
  const msgId = await repository.appendMessage(cid, "user", { content: message });
  const config = {
    configurable: { thread_id: String(cid) },
    metadata: { langfuse_session_id: String(cid) },
  };
  const final = await getGraph().invoke(graphInput(userId, message, cid, msgId, summary, upto, layer1), config);
  recordFromValues(cid, { message }, final);
  await settleLayers(cid, final, upto, layer1);
  await maybeScheduleSummary(cid);
  return {
    conversation_id: cid,
    state: final,
    interrupt: interruptPayload(final),
  };
}

export async function resumeTurn(conversationId: number, resumeValue: unknown): Promise<TurnResult> {
  if ((await repository.getConversation(conversationId)) === null) {
    throw new ConversationNotFound(conversationId);
  }
  const config = {
    configurable: { thread_id: String(conversationId) },
    metadata: { langfuse_session_id: String(conversationId) },
  };
  const final = await getGraph().invoke(new Command({ resume: resumeValue }), config);
  recordFromValues(conversationId, { resume: true }, final);
  await maybeScheduleSummary(conversationId);
  return {
    conversation_id: conversationId,
    state: final,
    interrupt: interruptPayload(final),
  };
}

const streamTupleSchema = z.tuple([z.string(), z.unknown()]);
const messagesChunkSchema = z.tuple([z.unknown(), z.object({ langgraph_node: z.string().optional() })]);
const updatesChunkSchema = z.record(z.string(), z.unknown());
const actionSchema = z
  .object({
    type: z.string(),
    draft: z.record(z.string(), z.unknown()).optional(),
    orders: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose();

type StreamSource = Parameters<Graph["stream"]>[0];

async function* streamEvents(cid: number, source: StreamSource): AsyncGenerator<StreamEvent> {
  const streamModes: ("messages" | "updates")[] = ["messages", "updates"];
  const config = {
    configurable: { thread_id: String(cid) },
    metadata: { langfuse_session_id: String(cid) },
    streamMode: streamModes,
  };
  const actions: SuggestedAction[] = [];
  const stream = await getGraph().stream(source, config);
  for await (const chunk of stream) {
    const tuple = streamTupleSchema.safeParse(chunk);
    if (!tuple.success) {
      continue;
    }
    const [mode, payload] = tuple.data;
    if (mode === "messages") {
      const messageChunk = messagesChunkSchema.safeParse(payload);
      if (!messageChunk.success) {
        continue;
      }
      const [msg, meta] = messageChunk.data;
      if (ANSWER_NODES.has(meta.langgraph_node ?? "") && BaseMessage.isInstance(msg)) {
        const text = memory.contentToString(msg.content);
        if (text) {
          yield { type: "delta", text };
        }
      }
    } else if (mode === "updates") {
      const updateParsed = updatesChunkSchema.safeParse(payload);
      if (!updateParsed.success) {
        continue;
      }
      const update = updateParsed.data;
      if (isInterrupted(update)) {
        const parsedValue = interruptValueSchema.safeParse(update[INTERRUPT][0]?.value);
        const data = parsedValue.success ? parsedValue.data : {};
        const event: StreamEvent = {
          type: "interrupt",
          kind: data.type ?? "",
          conversation_id: cid,
        };
        if (data.orders !== undefined) {
          event.orders = data.orders;
        }
        if (data.preview !== undefined) {
          event.preview = data.preview;
        }
        yield event;
        return;
      }
      for (const [node, raw] of Object.entries(update)) {
        const upd = updatesChunkSchema.safeParse(raw);
        if (!upd.success) {
          continue;
        }
        const fields = upd.data;
        if (DETERMINISTIC_ANSWER_NODES.has(node) && typeof fields.answer === "string" && fields.answer) {
          yield { type: "delta", text: fields.answer };
        }
        if (CITATION_NODES.has(node) && Array.isArray(fields.citations) && fields.citations.length > 0) {
          yield { type: "citations", items: fields.citations };
        }
        if (node === "agent_tools" && Array.isArray(fields.messages)) {
          for (const m of fields.messages) {
            if (ToolMessage.isInstance(m)) {
              const name = m.name;
              // submit_refund is intercepted into a UI form; no tool frame for it.
              if (name && name !== "submit_refund") {
                yield { type: "tool", name };
              }
            }
          }
        }
        if (Array.isArray(fields.suggestedActions)) {
          for (const action of fields.suggestedActions) {
            const parsedAction = actionSchema.safeParse(action);
            if (parsedAction.success) {
              const item: SuggestedAction = { type: parsedAction.data.type };
              if (parsedAction.data.draft !== undefined) {
                item.draft = parsedAction.data.draft;
              }
              if (parsedAction.data.orders !== undefined) {
                item.orders = parsedAction.data.orders;
              }
              actions.push(item);
            }
          }
        }
      }
    }
  }
  if (actions.length > 0) {
    yield { type: "actions", items: dedupActions(actions) };
  }
  yield { type: "done", conversation_id: cid };
}

export async function* streamTurn(
  userId: string,
  message: string,
  conversationId: number | null,
): AsyncGenerator<StreamEvent> {
  const { cid, summary, upto, layer1 } = await ensureConversation(userId, conversationId);
  const msgId = await repository.appendMessage(cid, "user", { content: message });
  let answer = "";
  for await (const ev of streamEvents(cid, graphInput(userId, message, cid, msgId, summary, upto, layer1))) {
    if (ev.type === "delta" && ev.text) {
      answer += ev.text;
    }
    yield ev;
  }
  recordFromValues(cid, { message }, await finalState(cid), answer);
  await settleLayers(cid, null, upto, layer1);
  await maybeScheduleSummary(cid);
}

export async function* streamResume(conversationId: number, resumeValue: unknown): AsyncGenerator<StreamEvent> {
  if ((await repository.getConversation(conversationId)) === null) {
    throw new ConversationNotFound(conversationId);
  }
  let answer = "";
  for await (const ev of streamEvents(conversationId, new Command({ resume: resumeValue }))) {
    if (ev.type === "delta" && ev.text) {
      answer += ev.text;
    }
    yield ev;
  }
  recordFromValues(conversationId, { resume: true }, await finalState(conversationId), answer);
  await maybeScheduleSummary(conversationId);
}

export type { SuggestedAction };
