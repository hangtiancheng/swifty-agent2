import { useCallback, useEffect, useRef, useState } from "react";

import { api, jsonPost } from "~/lib/api";
import { readSSEStream } from "~/lib/sse";
import type {
  ActionItem,
  Citation,
  ConversationItem,
  HistoryMessage,
  InterruptFrame,
} from "~/lib/types";

const SESSION_KEY = "mewhelp_session_id"; // Stable identifier used as user_id
const CONV_KEY = "mewhelp_conversation_id"; // Current conversation id, returned by the backend done frame

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
const REPLAY_ACTIONS: { text: string; actions: ActionItem[] }[] = [
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

function getUserId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function useChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  // Chat page renders client-side only (SPA); restore the current conversation id from localStorage
  const [conversationId, setConvId] = useState<number | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const v = localStorage.getItem(CONV_KEY);
    return v ? Number(v) : null;
  });
  const nextId = useRef(1);
  const busyRef = useRef(false);
  const messagesRef = useRef(messages);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    messagesRef.current = messages;
    conversationIdRef.current = conversationId;
  });

  const persistConvId = useCallback((id: number | null) => {
    if (id === null) {
      localStorage.removeItem(CONV_KEY);
    } else {
      localStorage.setItem(CONV_KEY, String(id));
    }
    setConvId(id);
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const d = await api<{ items: ConversationItem[] }>(
        "/api/conversations?user_id=" + encodeURIComponent(getUserId()),
      );
      setConversations(d.items ?? []);
    } catch {
      /* A sidebar failure should not break the chat */
    }
  }, []);

  // On mount: make sure user_id exists, then load the conversation list
  useEffect(() => {
    getUserId();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversations();
  }, [loadConversations]);

  const updateBot = useCallback((id: number, fn: (m: BotMsg) => BotMsg) => {
    setMessages((xs) =>
      xs.map((m) => (m.id === id && m.role === "bot" ? fn(m) : m)),
    );
  }, []);

  const mkBot = useCallback((): BotMsg => {
    return {
      id: nextId.current++,
      role: "bot",
      raw: "",
      tools: [],
      citations: [],
      actions: [],
      streaming: true,
    };
  }, []);

  /** Render one SSE stream into the given bot message; on interrupt, store the conversation id so it can be resumed */
  const streamInto = useCallback(
    async (botId: number, doFetch: () => Promise<Response>) => {
      try {
        const resp = await doFetch();
        await readSSEStream(resp, {
          delta: (d) => {
            updateBot(botId, (m) => ({ ...m, raw: m.raw + d }));
          },
          tool: (name) => {
            updateBot(botId, (m) => ({ ...m, tools: [...m.tools, name] }));
          },
          citations: (items) => {
            updateBot(botId, (m) => ({ ...m, citations: items }));
          },
          actions: (items) => {
            updateBot(botId, (m) => ({ ...m, actions: items }));
          },
          interrupt: (data) => {
            // Interrupts send no done frame, so capture the conversation id here for resume
            if (data.conversation_id) {
              persistConvId(data.conversation_id);
            }
            updateBot(botId, (m) => ({
              ...m,
              interrupt: data,
              streaming: false,
            }));
          },
          done: (cid) => {
            persistConvId(cid);
          },
        });
        updateBot(botId, (m) => ({ ...m, streaming: false }));
      } catch {
        updateBot(botId, (m) => ({
          ...m,
          streaming: false,
          error: "Reply failed, please try again",
          raw: "",
          tools: [],
        }));
      }
    },
    [persistConvId, updateBot],
  );

  /** Send a message and stream the reply */
  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const userMsg: UserMsg = {
        id: nextId.current++,
        role: "user",
        text: message,
      };
      const botMsg = mkBot();
      const bid = botMsg.id;
      setMessages((xs) => [...xs, userMsg, botMsg]);
      try {
        await streamInto(bid, () =>
          fetch(
            "/api/chat",
            jsonPost({
              user_id: getUserId(),
              message,
              conversation_id: conversationIdRef.current,
            }),
          ),
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
        void loadConversations(); // Refresh the sidebar after each turn (new conversations listed / summary badges updated)
      }
    },
    [loadConversations, mkBot, streamInto],
  );

  /** Resume the graph suspended by an interrupt (pick order / confirm ticket) */
  const resume = useCallback(
    async (userText: string, payload: Record<string, unknown>) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const userMsg: UserMsg = {
        id: nextId.current++,
        role: "user",
        text: userText,
      };
      const botMsg = mkBot();
      const bid = botMsg.id;
      setMessages((xs) => [...xs, userMsg, botMsg]);
      try {
        await streamInto(bid, () =>
          fetch(
            "/api/actions/resume",
            jsonPost({
              conversation_id: conversationIdRef.current,
              ...payload,
            }),
          ),
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [mkBot, streamInto],
  );

  /** Client-side simulation of transferring to a human agent: shows a transferred notice + a greeting from Meow (no real agent system) */
  const transferHuman = useCallback(() => {
    const sys: BotMsg = {
      id: nextId.current++,
      role: "bot",
      raw: "Transferred to a human agent",
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    const greet: BotMsg = {
      id: nextId.current++,
      role: "bot",
      raw: "Hi, I'm Meow from customer support. How can I help you?",
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    setMessages((xs) => [...xs, sys, greet]);
  }, []);

  /** Plain-text system message (ticket created / refund submitted) */
  const pushSystem = useCallback((text: string) => {
    const sys: BotMsg = {
      id: nextId.current++,
      role: "bot",
      raw: text,
      tools: [],
      citations: [],
      actions: [],
      streaming: false,
      plain: true,
    };
    setMessages((xs) => [...xs, sys]);
  }, []);

  /** One-shot 👍/👎 feedback: 👎 sends the question to the low-confidence pool for the flywheel, 👍 is only logged by the backend; fail silently */
  const giveFeedback = useCallback(
    (botId: number, rating: "up" | "down") => {
      const xs = messagesRef.current;
      const idx = xs.findIndex((m) => m.id === botId);
      const target = xs[idx];
      if (target?.role !== "bot" || target.feedback) {
        return;
      }
      // Find the nearest user bubble above this reply and pass that turn's original question to the backend (needed for the 👎 pool)
      let question = "";
      for (let i = idx - 1; i >= 0; i--) {
        const m = xs[i];
        if (m?.role === "user") {
          question = m.text;
          break;
        }
      }
      updateBot(botId, (m) => ({ ...m, feedback: rating }));
      void fetch(
        "/api/feedback",
        jsonPost({
          conversation_id: conversationIdRef.current,
          rating,
          question,
        }),
      ).catch(() => undefined);
    },
    [updateBot],
  );

  const markDecided = useCallback(
    (botId: number) => {
      updateBot(botId, (m) => ({ ...m, decided: true }));
    },
    [updateBot],
  );
  const markActed = useCallback(
    (botId: number) => {
      updateBot(botId, (m) => ({ ...m, acted: true }));
    },
    [updateBot],
  );

  const switchConversation = useCallback(
    async (cid: number) => {
      if (busyRef.current) {
        return;
      }
      // Skip only when this is already the current conversation with content loaded; right after a refresh the list is empty, so clicking the current conversation must still reload it
      if (cid === conversationIdRef.current && messagesRef.current.length > 0) {
        return;
      }
      persistConvId(cid);
      setMessages([]);
      try {
        const d = await api<{ items: HistoryMessage[] }>(
          "/api/conversations/" + String(cid) + "/messages",
        );
        const msgs: Msg[] = [];
        for (const m of d.items ?? []) {
          if (!m.content) {
            continue;
          }
          if (m.role === "user") {
            msgs.push({ id: nextId.current++, role: "user", text: m.content });
          } else {
            const hit = REPLAY_ACTIONS.find(
              (ra) => m.content.trim() === ra.text,
            );
            msgs.push({
              id: nextId.current++,
              role: "bot",
              raw: m.content,
              tools: [],
              citations: [],
              actions: hit ? hit.actions : [],
              streaming: false,
            });
          }
        }
        setMessages(msgs);
      } catch {
        /* The chat can continue even if history fails to load */
      }
      void loadConversations(); // Refresh the active highlight
    },
    [loadConversations, persistConvId],
  );

  const newChat = useCallback(() => {
    persistConvId(null); // Start a new chat: drop the current conversation_id (the old one remains reachable in the sidebar)
    setMessages([]);
    void loadConversations(); // Clear the active highlight
  }, [loadConversations, persistConvId]);

  return {
    messages,
    busy,
    conversations,
    conversationId,
    send,
    resume,
    transferHuman,
    pushSystem,
    giveFeedback,
    markDecided,
    markActed,
    switchConversation,
    newChat,
  };
}

export type ChatApi = ReturnType<typeof useChat>;
