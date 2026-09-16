// Graph wiring: skeleton (resolve -> classify -> route), refund sub-flow, evidence gate,
// ReAct loop and deterministic exits.
import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import * as nodes from "./nodes.ts";
import { confidenceGate, routeByIntent, shouldContinue } from "./routing.ts";
import { ConversationState } from "./state.ts";

export function buildGraph(checkpointer?: BaseCheckpointSaver) {
  const builder = new StateGraph(ConversationState)
    .addNode("resolve_reference", nodes.resolveReference)
    .addNode("classify_intent", nodes.classifyIntent)
    .addNode("retrieve_knowledge", nodes.retrieveKnowledge)
    .addNode("confidence_check", nodes.confidenceCheck)
    .addNode("main_agent", nodes.mainAgent)
    .addNode("agent_tools", nodes.agentTools)
    .addNode("complaint_reply", nodes.complaintReply)
    .addNode("script_reply", nodes.scriptReply)
    .addNode("fallback_reply", nodes.fallbackReply)
    .addNode("fetch_order", nodes.fetchOrder)
    .addNode("retrieve_policy", nodes.retrievePolicy)
    .addNode("log", nodes.logNode)
    .addEdge(START, "resolve_reference")
    .addEdge("resolve_reference", "classify_intent")
    .addConditionalEdges("classify_intent", routeByIntent, {
      escalate: "complaint_reply",
      fallback_script: "script_reply",
      knowledge: "retrieve_knowledge",
      refund_flow: "fetch_order",
      business: "main_agent",
    })
    .addEdge("fetch_order", "retrieve_policy")
    .addEdge("retrieve_policy", "main_agent")
    .addEdge("retrieve_knowledge", "confidence_check")
    .addConditionalEdges("confidence_check", confidenceGate, {
      strong: "main_agent",
      weak: "fallback_reply",
    })
    .addConditionalEdges("main_agent", shouldContinue, {
      continue: "agent_tools",
      stop: "log",
    })
    .addEdge("agent_tools", "main_agent")
    .addEdge("complaint_reply", "log")
    .addEdge("script_reply", "log")
    .addEdge("fallback_reply", "log")
    .addEdge("log", END);
  return builder.compile(checkpointer === undefined ? {} : { checkpointer });
}
