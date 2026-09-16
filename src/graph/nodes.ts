// Graph nodes: reference resolution, intent routing, retrieval, the ReAct loop and the
// deterministic exits (complaint / script / fallback) plus audit logging.
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, isAIMessage, isHumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";

import { INTENT_TO_ROUTE } from "./routing.ts";
import type { Citation, GraphState, GraphUpdate, OrderData, SuggestedAction } from "./state.ts";

import { settings } from "@/config.ts";
import { computeEvidenceConfidence, snapshotFromHits } from "@/core/confidence.ts";
import * as coref from "@/core/coref.ts";
import * as intentMod from "@/core/intent.ts";
import { getChatModel } from "@/core/llm.ts";
import * as memory from "@/core/memory.ts";
import {
  AGENT_SYSTEM,
  COMPLAINT_REPLY_TEXT,
  FALLBACK_REPLY_TEXT,
  REFUND_JUDGE_HINT,
  SCRIPT_REPLY_CHITCHAT,
  SCRIPT_REPLY_OTHER,
} from "@/core/prompts.ts";
import * as queryUnderstanding from "@/core/query-understanding.ts";
import * as retrieval from "@/core/retrieval.ts";
import * as selfcheck from "@/core/selfcheck.ts";
import * as repository from "@/db/repository.ts";
import { childLogger } from "@/logger.ts";
import * as business from "@/tools/business.ts";
import * as engine from "@/tools/engine.ts";
import * as registry from "@/tools/registry.ts";

const log = childLogger("graph.nodes");

export const COMPLAINT_REPLY = COMPLAINT_REPLY_TEXT;
export const FALLBACK_REPLY = FALLBACK_REPLY_TEXT;

function userText(state: GraphState): string {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (isHumanMessage(m)) {
      return memory.contentToString(m.content);
    }
  }
  return "";
}

function historyText(state: GraphState, maxTurns = 6): string {
  // Summary line + the last turns of the sliding window (excluding the current message).
  const msgs = memory.buildWindow(
    state.messages,
    state.summaryUptoMsgId ?? 0,
    state.layer1FromMsgId ?? 0,
  );
  const prior = msgs.slice(0, -1);
  const lines = prior.slice(-maxTurns).map((m) => {
    const role = isHumanMessage(m) ? "User" : "Agent";
    const text = memory.contentToString(m.content);
    return text ? `${role}: ${text}` : "";
  });
  const body = lines.filter((l) => l).join("\n");
  const head = memory.summaryLine(state.summary ?? "");
  return head ? `${head}\n${body}`.trim() : body;
}

// A run of 4+ digits is treated as an order id; lookarounds because CJK and digits are both \w.
const ORDER_RE = /(?<!\d)(\d{4,})(?!\d)/;

function extractOrderId(text: string): string | null {
  const m = ORDER_RE.exec(text ?? "");
  return m ? m[1] : null;
}

export function fetchOrder(state: GraphState): GraphUpdate {
  // Refund flow step 1: resolve the order id, asking the UI for a selection when needed.
  // Only read-only work happens before interrupt; the node restarts from the top on resume.
  const uid = state.userId ?? "";
  let oid: string | null = state.orderId || extractOrderId(state.resolvedQuery || userText(state));
  for (;;) {
    if (oid !== null && business.ownsOrder(uid, oid)) {
      break;
    }
    const orders = business.listUserOrders(uid);
    const resumed = interrupt<{ type: string; orders: business.UserOrder[] }, unknown>({
      type: "select_order",
      orders,
    });
    oid = typeof resumed === "string" ? resumed : null;
  }
  const data = business.orderSnapshot(oid);
  const trace: Record<string, unknown> = { fetch_order: { order_id: oid } };
  return { orderId: oid, orderData: data, trace };
}

export async function retrievePolicy(state: GraphState): Promise<GraphUpdate> {
  // Refund flow forced retrieval: expand into 3 queries, merge by chunk id, keep best score.
  const base = state.resolvedQuery || userText(state);
  const orderData = state.orderData ?? {};
  const seed = `${base} ${orderData.status ?? ""}`.trim();
  const queries = await queryUnderstanding.expandQueries(seed);

  const merged = new Map<number, Awaited<ReturnType<typeof retrieval.searchKnowledge>>[number]>();
  for (const q of queries) {
    for (const hit of await retrieval.searchKnowledge(q, { strategy: "hybrid_rerank", bm25Text: q })) {
      const current = merged.get(hit.id);
      if (current === undefined || (hit.rerank_score ?? 0) > (current.rerank_score ?? 0)) {
        merged.set(hit.id, hit);
      }
    }
  }
  const ranked = [...merged.values()].sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0));
  const arranged = retrieval.arrangeHeadTail(ranked);
  const citations: Citation[] = arranged.map((h, i) => ({
    n: i + 1,
    id: h.id,
    section_path: h.section_path,
    question: h.question,
    answer: h.answer,
    content_type: h.content_type,
  }));
  const evidence = citations.map((c) => `[${c.n}] ${c.question}: ${c.answer}`).join("\n");
  const trace: Record<string, unknown> = { retrieve_policy: { queries, hits: ranked.length } };
  return { evidence, citations, trace };
}

export function scriptReply(state: GraphState): GraphUpdate {
  // Deterministic exit for chitchat / other intents: pick the script by intent.
  const text = state.intent === "other" ? SCRIPT_REPLY_OTHER : SCRIPT_REPLY_CHITCHAT;
  const trace: Record<string, unknown> = { route: "fallback_script" };
  return { answer: text, trace };
}

export function complaintReply(state: GraphState): GraphUpdate {
  const actions: SuggestedAction[] = [
    { type: "transfer_human" },
    { type: "create_ticket", draft: { description: userText(state), ticket_type: "complaint" } },
  ];
  const trace: Record<string, unknown> = { route: "complaint" };
  return { answer: COMPLAINT_REPLY, suggestedActions: actions, trace };
}

export async function fallbackReply(state: GraphState): Promise<GraphUpdate> {
  // Weak evidence: reply with the fallback script and add the question to the flywheel pool.
  const source = state.fallbackSource || "retrieval_low_conf";
  const signals = state.trace?.confidence_signals ?? {};
  let reason = `evidence_confidence=${(state.evidenceConfidence ?? 0).toFixed(3)} signals=${JSON.stringify(signals)}`;
  if (source === "self_check") {
    const selfCheck = state.trace?.self_check;
    reason += ` self_check=${typeof selfCheck === "string" ? selfCheck : ""}`;
  }
  // Snapshot tri-state: retrieved with hits = list; retrieved with zero hits = []; no retrieval = null.
  const walkedRetrieval = Boolean(state.fallbackSource);
  const snapshot = state.retrievedSnapshot ?? (walkedRetrieval ? [] : null);
  await repository.insertLowConfidence(
    state.conversationId,
    userText(state),
    source,
    reason,
    snapshot,
  );
  const trace: Record<string, unknown> = { route: "fallback" };
  return { answer: FALLBACK_REPLY, suggestedActions: [{ type: "transfer_human" }], trace };
}

export async function resolveReference(state: GraphState): Promise<GraphUpdate> {
  const query = userText(state);
  const history = historyText(state);
  // Observable per turn: the summary line plus the sliding window.
  log.info({ conv: state.conversationId, history: history || "(no history)" }, "history_ctx");
  const resolved = await coref.resolve(query, history);
  const trace: Record<string, unknown> = { coref: resolved !== query ? "rewrite" : "passthrough" };
  return { resolvedQuery: resolved, trace };
}

export async function classifyIntent(state: GraphState): Promise<GraphUpdate> {
  const query = state.resolvedQuery || userText(state);
  const result = await intentMod.classify(query, historyText(state));
  const route = INTENT_TO_ROUTE[result.intent] ?? "business";
  const trace: Record<string, unknown> = { intent: result.intent, intent_confidence: result.confidence, route };
  return { intent: result.intent, intentConfidence: result.confidence, route, trace };
}

export async function retrieveKnowledge(state: GraphState): Promise<GraphUpdate> {
  // Knowledge-intent forced retrieval with the calibrated confidence gate.
  const queryRaw = userText(state);
  const u = await queryUnderstanding.understand(queryRaw);
  const query = u.standard;
  const bm25Text = u.expanded.length > 0 ? `${query} ${u.expanded.join(" ")}` : query;

  const hits = await retrieval.searchKnowledge(query, { strategy: "hybrid_rerank", bm25Text });
  const conf = computeEvidenceConfidence(hits);
  const base: GraphUpdate = {
    evidenceConfidence: conf.score,
    retrievedSnapshot: snapshotFromHits(hits),
  };

  if (conf.score < settings.evidenceConfidenceThreshold) {
    const trace: Record<string, unknown> = { forced_rag: true, evidence_confidence: conf.score, confidence_signals: conf.signals };
    return { ...base, evidenceStrong: false, fallbackSource: "retrieval_low_conf", trace };
  }

  const evTexts = hits.map((h) => `${h.question} ${h.answer}`);
  const check = await selfcheck.checkSufficient(query, evTexts);
  if (!check.useful) {
    const trace: Record<string, unknown> = {
      forced_rag: true,
      evidence_confidence: conf.score,
      confidence_signals: conf.signals,
      self_check: check.reason,
    };
    return { ...base, evidenceStrong: false, fallbackSource: "self_check", trace };
  }

  const arranged = retrieval.arrangeHeadTail(hits);
  const citations: Citation[] = arranged.map((h, i) => ({
    n: i + 1,
    id: h.id,
    section_path: h.section_path,
    question: h.question,
    answer: h.answer,
    content_type: h.content_type,
  }));
  const evidence = citations.map((c) => `[${c.n}] ${c.question}: ${c.answer}`).join("\n");
  const trace: Record<string, unknown> = { forced_rag: true, evidence_confidence: conf.score, confidence_signals: conf.signals };
  return { ...base, evidenceStrong: true, evidence, citations, trace };
}

export function confidenceCheck(state: GraphState): GraphUpdate {
  // Entity node recording the gate decision; the actual split is the conditional edge.
  const trace: Record<string, unknown> = { confidence: state.evidenceStrong ? "strong" : "weak" };
  return { trace };
}

const KNOWLEDGE_EVIDENCE_HINT =
  "\n\n## Retrieved knowledge evidence (answer based on it; cite the source number such as [1] after each key conclusion;" +
  " the evidence is already provided, so do not call query_faq again; you may still call order/logistics tools as needed)\n" +
  "Copy model numbers verbatim as written in the evidence; do not write any model number absent from the evidence; state conditional conclusions together with their conditions.\n";

function turnContext(state: GraphState): string {
  // Per-turn material: summary + retrieved evidence + refund order data.
  const parts: string[] = [];
  const ss = memory.summarySystem(state.summary ?? "");
  if (ss !== null) {
    parts.push(`\n\n${memory.contentToString(ss.content)}`);
  }
  if (state.evidence) {
    parts.push(KNOWLEDGE_EVIDENCE_HINT + state.evidence);
  }
  if (state.route === "refund_flow") {
    parts.push(REFUND_JUDGE_HINT + JSON.stringify(state.orderData ?? {}));
  }
  return parts.join("");
}

export const TURN_CTX_ID = "turn-ctx";

function withTurnContext(window: BaseMessage[], turnCtx: string): BaseMessage[] {
  // Insert after the last user message so the ReAct steps keep a stable cacheable prefix.
  const msg = new HumanMessage({ content: turnCtx, id: TURN_CTX_ID });
  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (isHumanMessage(window[i])) {
      return [...window.slice(0, i + 1), msg, ...window.slice(i + 1)];
    }
  }
  return [...window, msg];
}

function agentMessages(state: GraphState): BaseMessage[] {
  // Exactly one SystemMessage (the persona): upstreams hoist system messages and would
  // break the cacheable prefix if the summary came as a second system message.
  let window = memory.buildWindow(
    state.messages,
    state.summaryUptoMsgId ?? 0,
    state.layer1FromMsgId ?? 0,
  );
  const ctx = turnContext(state);
  if (ctx) {
    window = withTurnContext(window, ctx);
  }
  return [new SystemMessage(AGENT_SYSTEM), ...window];
}

function logModelContext(state: GraphState, msgs: BaseMessage[]): void {
  const ctxBlock = msgs.find((m) => m.id === TURN_CTX_ID);
  const window = msgs.filter((m) => !(m instanceof SystemMessage) && m.id !== TURN_CTX_ID);
  const lines = window.map((m) => `  [${m.type}] ${memory.contentToString(m.content).slice(0, 40)}`);
  log.info(
    {
      conv: state.conversationId,
      step: state.steps ?? 0,
      summary: state.summary || "(none)",
      window: window.length,
      turn_material: ctxBlock ? `${memory.contentToString(ctxBlock.content).length} chars` : "none",
      tokens: memory.countTokens(msgs),
    },
    `model_ctx\n${lines.join("\n")}`,
  );
}

export async function mainAgent(state: GraphState, config: LangGraphRunnableConfig): Promise<GraphUpdate> {
  // ReAct reasoning step: bind tools and invoke. Token usage is accumulated step by step.
  const specs = await registry.getAllSpecs();
  const toolDefs = specs.map((s) => ({
    type: "function" as const,
    function: { name: s.name, description: s.description, parameters: s.jsonSchema },
  }));
  const model = getChatModel({ streaming: true }).bindTools(toolDefs);
  const msgs = agentMessages(state);
  logModelContext(state, msgs);
  const ai = await model.invoke(msgs, config);
  const usageParsed = isAIMessage(ai) ? usageSchema.safeParse(ai.usage_metadata) : undefined;
  const usage = usageParsed?.success === true ? usageParsed.data : undefined;
  const used = usage?.total_tokens ?? 0;
  const cached = usage?.input_token_details?.cache_read ?? 0;
  log.info(
    {
      conv: state.conversationId,
      step: (state.steps ?? 0) + 1,
      input: usage?.input_tokens ?? 0,
      cache_read: cached,
      total: used,
    },
    "agent_step",
  );
  return {
    messages: [ai],
    steps: (state.steps ?? 0) + 1,
    tokensUsed: (state.tokensUsed ?? 0) + used,
  };
}

const confirmResumeSchema = z.object({ confirmed: z.boolean() });

// usage_metadata is not statically typed through the bound-tool runnable; validate at runtime.
const usageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  input_token_details: z.object({ cache_read: z.number().optional() }).optional(),
});

export async function agentTools(state: GraphState): Promise<GraphUpdate> {
  // ReAct action step: every tool goes through the execution engine. create_ticket needs a
  // confirmation interrupt; submit_refund is intercepted and turned into a UI refund form.
  const last = state.messages[state.messages.length - 1];
  if (!(last instanceof AIMessage)) {
    return {};
  }
  const toolCalls = last.tool_calls ?? [];
  const cid = state.conversationId ?? 0;
  const uid = state.userId ?? "";
  const specs = new Map((await registry.getAllSpecs()).map((s) => [s.name, s]));

  const ticketCalls = toolCalls.filter((tc) => tc.name === "create_ticket");
  const tspec = specs.get("create_ticket");
  let decision: unknown = null;
  const firstTicket = ticketCalls[0];
  if (firstTicket && tspec && engine.validateArgs(tspec, { ...(firstTicket.args ?? {}) }) === null) {
    const args = firstTicket.args ?? {};
    decision = interrupt<{ type: string; preview: Record<string, string> }, unknown>({
      type: "confirm_ticket",
      preview: {
        ticket_type: typeof args.ticket_type === "string" ? args.ticket_type : "inquiry",
        description: typeof args.description === "string" ? args.description : "",
      },
    });
  }

  const toolMsgs: ToolMessage[] = [];
  const actions: SuggestedAction[] = [...(state.suggestedActions ?? [])];
  let notOwned = false;

  for (const tc of toolCalls) {
    const args = tc.args ?? {};
    if (tc.name === "submit_refund") {
      // Intercepted before the engine, so check ownership here or the refund path bypasses it.
      if (!business.ownsOrder(uid, String(args.order_id ?? ""))) {
        notOwned = true;
        toolMsgs.push(
          new ToolMessage({
            content:
              "No such order was found for this user; do not initiate a refund this time. Tell the user honestly that nothing was found, " +
              "ask them to pick one of the orders listed below, and do not call any more tools.",
            tool_call_id: tc.id ?? "",
            name: "submit_refund",
            status: "error",
          }),
        );
        continue;
      }
      actions.push({
        type: "refund_form",
        draft: { order_id: args.order_id ?? "", reason: args.reason ?? null },
      });
      toolMsgs.push(
        new ToolMessage({
          content: "The 'submit refund ticket' option has been handed to the user for confirmation. State in one sentence that this order can be refunded, then stop; do not call any more tools.",
          tool_call_id: tc.id ?? "",
          name: "submit_refund",
        }),
      );
    } else if (tc.name === "create_ticket" && decision !== null) {
      if (tc === firstTicket) {
        const parsed = confirmResumeSchema.safeParse(decision);
        const run =
          parsed.success && parsed.data.confirmed
            ? await engine.executeToolCall(tc, cid, specs, { confirmed: true, userId: uid })
            : await engine.executeToolCall(tc, cid, specs, {
                confirmed: false,
                userId: uid,
                denyNote: "The user clicked cancel on the ticket preview card; no ticket will be created this time. Do not initiate again unless the user explicitly asks.",
              });
        toolMsgs.push(run.toolMessage);
      } else {
        toolMsgs.push(
          new ToolMessage({
            content: "Only one ticket-creation request is handled at a time; this call was ignored.",
            tool_call_id: tc.id ?? "",
            name: "create_ticket",
            status: "error",
          }),
        );
      }
    } else {
      const run = await engine.executeToolCall(tc, cid, specs, { userId: uid });
      if (tc.name === "query_order" && !business.ownsOrder(uid, String(args.order_id ?? ""))) {
        notOwned = true;
      }
      toolMsgs.push(run.toolMessage);
    }
  }

  if (notOwned) {
    actions.push({
      type: "select_order",
      orders: business.listUserOrders(uid).map((o) => ({
        order_id: o.order_id,
        product: o.product,
        status: o.status,
        amount: o.amount,
      })),
    });
  }
  const out: GraphUpdate = { messages: toolMsgs };
  if (actions.length > 0) {
    out.suggestedActions = actions;
  }
  return out;
}

export function resolveAnswer(state: GraphState): string {
  if (state.answer) {
    return state.answer;
  }
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m instanceof AIMessage) {
      return memory.contentToString(m.content);
    }
  }
  return "";
}

export async function logNode(state: GraphState): Promise<GraphUpdate> {
  log.info(
    {
      conv: state.conversationId,
      intent: state.intent,
      route: state.route,
      resolved: state.resolvedQuery,
      trace: state.trace,
    },
    "turn",
  );
  const answer = resolveAnswer(state);
  if (state.conversationId) {
    await repository.appendMessage(state.conversationId, "assistant", { content: answer || null });
  }
  return {};
}

export type { OrderData };
