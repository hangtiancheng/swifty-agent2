// Routing rules: intent -> exit, evidence gate, ReAct stop condition.
import { AIMessage } from "@langchain/core/messages";

import { settings } from "../config.ts";

import type { GraphState } from "./state.ts";

export type RouteKey = "escalate" | "fallback_script" | "knowledge" | "refund_flow" | "business";

// Nine intents -> five exits; single source shared with build.ts conditional edge keys.
export const INTENT_TO_ROUTE: Record<string, RouteKey> = {
  投诉: "escalate",
  闲聊: "fallback_script",
  其他: "fallback_script",
  商品咨询: "knowledge",
  退款退货: "refund_flow",
  售后: "refund_flow",
  人工: "business",
  物流: "business",
  订单: "business",
};

export function routeByIntent(state: GraphState): RouteKey {
  return INTENT_TO_ROUTE[state.intent] ?? "business";
}

export function confidenceGate(state: GraphState): "strong" | "weak" {
  return state.evidenceStrong ? "strong" : "weak";
}

export function shouldContinue(state: GraphState): "continue" | "stop" {
  // Stop when the model produced no tool calls, or the step cap is reached.
  const last = state.messages[state.messages.length - 1];
  const hasToolCalls = last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0;
  if (!hasToolCalls) {
    return "stop";
  }
  if ((state.steps ?? 0) >= settings.maxAgentSteps) {
    return "stop";
  }
  return "continue";
}
