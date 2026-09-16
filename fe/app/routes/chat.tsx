import { Cat, Menu, Plus, Send } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CitePopover, type CiteTarget } from "~/components/chat/cite-popover";
import {
  MessageBubble,
  type BubbleCallbacks,
} from "~/components/chat/message-bubble";
import { RefundModal, TicketModal } from "~/components/chat/modals";
import { MobileDrawer, Sidebar } from "~/components/chat/sidebar";
import { SUGGESTIONS, useChat } from "~/components/chat/use-chat";
import { ThemeToggle } from "~/components/theme-toggle";
import { EASE_DECEL } from "~/lib/motion";

export function meta() {
  return [
    { title: "MeowMeow Select · AI Assistant" },
    {
      name: "description",
      content:
        "MeowMeow Select AI Assistant Meow: ask about products, orders, and after-sales support",
    },
  ];
}

function EmptyState({ onChip }: { onChip: (s: string) => void }) {
  return (
    <div className="m-auto flex flex-col items-center px-3 py-6 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: EASE_DECEL }}
        className="bg-primary-container shadow-e2 mb-5 grid h-24 w-24 place-items-center rounded-3xl"
      >
        <Cat className="text-primary h-14 w-14" strokeWidth={1.5} />
      </motion.div>
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.4, ease: EASE_DECEL }}
        className="text-headline-small text-on-surface font-medium"
      >
        Hi, I'm Meow
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.4, ease: EASE_DECEL }}
        className="text-body-medium text-on-surface-variant mt-2 max-w-sm leading-6"
      >
        MeowMeow Select's AI Assistant — ask me about products, orders, and
        after-sales support.
      </motion.p>
      <div className="mt-6 flex max-w-110 flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s}
            type="button"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.18 + 0.06 * i,
              duration: 0.35,
              ease: EASE_DECEL,
            }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface text-body-small shadow-e1 cursor-pointer rounded-xl px-4 py-2.5 transition-colors duration-200"
            onClick={() => {
              onChip(s);
            }}
          >
            {s}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const {
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
  } = useChat();

  const [input, setInput] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [cite, setCite] = useState<CiteTarget | null>(null);
  const [ticketFor, setTicketFor] = useState<number | null>(null);
  const [refundFor, setRefundFor] = useState<{
    msgId: number;
    order: string;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to the bottom after every update
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Focus the input when idle (after sending, switching conversations, or starting a new chat)
  useEffect(() => {
    if (!busy) {
      inputRef.current?.focus();
    }
  }, [busy]);

  // Auto-grow the textarea to fit its content
  useEffect(() => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const submit = useCallback(
    (preset?: string) => {
      const message = (preset ?? input).trim();
      if (!message || busy) {
        return;
      }
      setInput("");
      void send(message);
    },
    [input, busy, send],
  );

  const cb = useMemo<BubbleCallbacks>(
    () => ({
      onCite: (c, el) => {
        setCite({ c, rect: el.getBoundingClientRect() });
      },
      onFeedback: giveFeedback,
      onTransfer: transferHuman,
      onCreateTicket: (msgId) => {
        setTicketFor(msgId);
      },
      onRefund: (msgId, draft) => {
        setRefundFor({ msgId, order: draft.order_id ?? "" });
      },
      onPickOrderResume: (msgId, o) => {
        markDecided(msgId);
        void resume("I choose order " + o.order_id, { order_id: o.order_id });
      },
      onPickOrderAsk: (msgId, o) => {
        markDecided(msgId);
        void send("Look up order " + o.order_id);
      },
      onConfirmTicket: (msgId, confirmed) => {
        markDecided(msgId);
        void resume(
          confirmed ? "Confirm ticket submission" : "Cancel ticket creation",
          {
            confirmed,
          },
        );
      },
    }),
    [giveFeedback, transferHuman, markDecided, resume, send],
  );

  return (
    <div className="bg-card flex h-dvh w-full overflow-hidden">
      <Sidebar
        className="max-md:hidden"
        items={conversations}
        current={conversationId}
        busy={busy}
        onSwitch={(id) => {
          void switchConversation(id);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-outline-variant flex items-center gap-3 border-b px-3 py-3 sm:px-5">
          <button
            type="button"
            className="text-on-surface-variant hover:bg-on-surface/8 active:bg-on-surface/12 grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-200 md:hidden"
            onClick={() => {
              setDrawer(true);
            }}
            aria-label="Open conversation list"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <div className="bg-primary-container grid h-11 w-11 shrink-0 place-items-center rounded-2xl">
            <Cat className="text-primary h-6.5 w-6.5" strokeWidth={1.5} />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-title-medium text-on-surface truncate">
              Meow · AI Assistant
            </span>
            <span className="text-label-small text-on-surface-variant flex items-center gap-1.5">
              <span className="bg-success h-2 w-2 rounded-full" />
              Online · MeowMeow Select
            </span>
          </div>
          <div className="flex-1" />
          <ThemeToggle />
          <button
            type="button"
            className="bg-secondary-container text-on-secondary-container hover:bg-secondary-container-hover text-label-large flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 transition-all duration-200 active:scale-[0.97] max-sm:px-3"
            onClick={newChat}
          >
            <Plus className="h-4.5 w-4.5" aria-hidden />
            <span className="max-sm:hidden">New chat</span>
          </button>
        </header>

        <div ref={listRef} className="scroll-slim flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-3 pt-5 pb-2 sm:px-5">
            {messages.length === 0 ? (
              <EmptyState
                onChip={(s) => {
                  if (!busy) {
                    submit(s);
                  }
                }}
              />
            ) : (
              messages.map((m) => <MessageBubble key={m.id} msg={m} cb={cb} />)
            )}
          </div>
        </div>

        <footer className="border-outline-variant border-t p-3 sm:p-4">
          <div className="mx-auto w-full max-w-3xl">
            <div className="bg-surface-container-high focus-within:shadow-e2 flex items-end gap-2 rounded-2xl px-4 py-2.5 transition-shadow duration-200">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                disabled={busy}
                placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
                onChange={(e) => {
                  setInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                className="placeholder:text-on-surface-variant text-on-surface max-h-32 flex-1 resize-none border-none bg-transparent p-1.5 text-[15px] leading-normal outline-none disabled:opacity-60"
              />
              <button
                type="button"
                aria-label="Send"
                disabled={busy}
                onClick={() => {
                  submit();
                }}
                className="bg-primary text-on-primary hover:bg-primary-hover hover:shadow-e1 disabled:bg-on-surface/12 disabled:text-on-surface-variant grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <Send className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="text-on-surface-variant text-label-small mt-2.5 text-center">
              Meow is an AI assistant. For questions about specific orders,
              we'll transfer you to a human agent to verify.
            </p>
          </div>
        </footer>
      </div>

      <MobileDrawer
        open={drawer}
        onClose={() => {
          setDrawer(false);
        }}
        items={conversations}
        current={conversationId}
        busy={busy}
        onSwitch={(id) => {
          void switchConversation(id);
        }}
        onNewChat={newChat}
      />
      <CitePopover
        target={cite}
        onClose={() => {
          setCite(null);
        }}
      />
      <TicketModal
        open={ticketFor !== null}
        conversationId={conversationId}
        onClose={() => {
          setTicketFor(null);
        }}
        onSuccess={(no) => {
          if (ticketFor !== null) {
            markActed(ticketFor);
          }
          setTicketFor(null);
          pushSystem("Ticket created: " + no);
        }}
      />
      <RefundModal
        open={refundFor !== null}
        order={refundFor?.order ?? ""}
        conversationId={conversationId}
        onClose={() => {
          setRefundFor(null);
        }}
        onSuccess={(no) => {
          if (refundFor) {
            markActed(refundFor.msgId);
          }
          setRefundFor(null);
          pushSystem("Refund request submitted: " + no);
        }}
      />
    </div>
  );
}
