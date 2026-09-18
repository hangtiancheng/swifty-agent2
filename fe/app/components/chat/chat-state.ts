import type { ActionItem, Citation, InterruptFrame } from "~/lib/types";

/* Chat domain state shared by the chat page and its bubble components
   (ported from the React useChat hook; the logic now lives in <chat-page>). */

export const SESSION_KEY = "swifty_agent2_session_id"; // Stable identifier used as user_id
export const CONV_KEY = "swifty_agent2_conversation_id"; // Current conversation id, returned by the backend done frame

export const SUGGESTIONS = [
  "What is the return & exchange policy?",
  "How do I track my order?",
  "How do I choose cat food?",
  "What membership benefits are there?",
];

/** Re-attach buttons when replaying history: suggested_actions are not persisted,
    but these two replies are fixed copy, and the transfer/ticket buttons don't depend
    on the current turn (transfer is simulated client-side; the ticket form is filled
    in fresh), so rebuilding them by exact copy match is enough. If the wording changes,
    update here too (single source of truth lives in backend src/core/prompts.ts).
    NOTE: the `text` values below are matched byte-for-byte against backend history
    content (m.content.trim() === ra.text), so they must equal FALLBACK_REPLY_TEXT and
    COMPLAINT_REPLY_TEXT in prompts.ts exactly. */
export const REPLAY_ACTIONS: { text: string; actions: ActionItem[] }[] = [
  {
    text: "Sorry, I couldn't find definitive information on this question for now, so I don't dare answer blindly. We suggest contacting human customer service to confirm further, so you don't get wrong guidance.",
    actions: [{ type: "transfer_human" }],
  },
  {
    text: "We're very sorry for the bad experience, and we understand how you feel. You can choose to be transferred to human customer service, or let me register a ticket to follow up for you.",
    actions: [{ type: "transfer_human" }, { type: "create_ticket", draft: {} }],
  },
];

export interface UserMsg {
  id: number;
  role: "user";
  text: string;
}

export interface BotMsg {
  id: number;
  role: "bot";
  /** Accumulated markdown source (plain text for plain messages) */
  raw: string;
  tools: string[];
  citations: Citation[];
  actions: ActionItem[];
  interrupt?: InterruptFrame;
  error?: string;
  /** Still receiving SSE frames */
  streaming: boolean;
  /** 👍/👎 already given on this message */
  feedback?: "up" | "down";
  /** Interrupt/order card already answered; grey it out */
  decided?: boolean;
  /** Ticket/refund submitted successfully; grey out the matching button */
  acted?: boolean;
  /** Plain-text system message (simulated transfer, ticket created, etc.): no markdown, no feedback bar */
  plain?: boolean;
}

export type Msg = UserMsg | BotMsg;

export function getUserId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
