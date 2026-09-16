// LangGraph conversation state. Channels without a custom reducer keep the last value;
// `messages` appends and `trace` merges.
import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

import type { RetrievalSnapshot } from "@/core/confidence.ts";

export interface SuggestedAction {
  type: string;
  draft?: Record<string, unknown>;
  orders?: Record<string, unknown>[];
}

export interface Citation {
  n: number;
  id: number;
  section_path: string;
  question: string;
  answer: string;
  content_type: string;
}

export interface OrderData {
  order_id?: string;
  status?: string;
  amount?: number;
  created_at?: string;
  product?: string;
  tracking_no?: string;
}

export function mergeDict(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): Record<string, unknown> {
  // `None` is the entry-point reset sentinel: the merge channel cannot be cleared with {}.
  if (b === null || b === undefined) {
    return {};
  }
  return { ...(a ?? {}), ...b };
}

export const ConversationState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  summary: Annotation<string>(),
  summaryUptoMsgId: Annotation<number>(),
  layer1FromMsgId: Annotation<number>(),
  userId: Annotation<string>(),
  conversationId: Annotation<number>(),
  intent: Annotation<string>(),
  resolvedQuery: Annotation<string>(),
  intentConfidence: Annotation<number>(),
  orderId: Annotation<string>(),
  orderData: Annotation<OrderData>(),
  route: Annotation<string>(),
  evidence: Annotation<string>(),
  citations: Annotation<Citation[]>(),
  evidenceStrong: Annotation<boolean>(),
  evidenceConfidence: Annotation<number>(),
  fallbackSource: Annotation<string>(),
  retrievedSnapshot: Annotation<RetrievalSnapshot[] | null>(),
  answer: Annotation<string>(),
  steps: Annotation<number>(),
  tokensUsed: Annotation<number>(),
  suggestedActions: Annotation<SuggestedAction[]>(),
  // trace accepts null from the entry point as a reset sentinel; inside the graph it is a dict.
  trace: Annotation<Record<string, unknown> | null>({
    reducer: mergeDict,
    default: () => ({}),
  }),
});

export type GraphState = typeof ConversationState.State;
export type GraphUpdate = typeof ConversationState.Update;
