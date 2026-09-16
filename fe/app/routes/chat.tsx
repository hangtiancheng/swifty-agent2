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
    <div className="animate-pop-in m-auto flex flex-col items-center gap-1.5 px-3 py-5 text-center">
      <div className="border-ink bg-paper shadow-hard mb-3 border-4 p-2.5">
        <Cat className="h-24 w-24" strokeWidth={1.5} />
      </div>
      <h1 className="text-lg font-bold tracking-widest">Hi, I'm Meow</h1>
      <p className="text-muted text-[13px]">
        MeowMeow Select's AI Assistant — ask me about products, orders, and
        after-sales support.
      </p>
      <div className="mt-4 flex max-w-110 flex-wrap justify-center gap-2.5">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 * i, duration: 0.18 }}
            className="press border-ink bg-paper shadow-hard-sm hover:bg-fur-hover cursor-pointer border-3 px-3.5 py-2 text-[12.5px]"
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
    <div className="md:grid md:min-h-dvh md:place-items-center">
      <div className="bg-cream md:border-ink md:shadow-hard-lg mx-auto flex h-dvh w-full max-w-[980px] overflow-hidden md:h-[min(90dvh,860px)] md:border-4">
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
          <header className="border-ink bg-fur flex items-center gap-3 border-b-4 px-3 py-3 sm:px-4">
            <button
              type="button"
              className="press-sm border-ink bg-paper shadow-hard-xs grid h-9 w-9 shrink-0 cursor-pointer place-items-center border-3 md:hidden"
              onClick={() => {
                setDrawer(true);
              }}
              aria-label="Open conversation list"
            >
              <Menu className="h-4 w-4" aria-hidden />
            </button>
            <div className="border-ink bg-paper shadow-hard-sm shrink-0 border-3 p-1">
              <Cat
                className="h-[38px] w-[38px] sm:h-[46px] sm:w-[46px]"
                strokeWidth={1.5}
              />
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[15px] font-bold tracking-wide">
                Meow · AI Assistant
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-[#6b5b48]">
                <span className="border-ink bg-online h-2 w-2 border-2" />
                ONLINE · MeowMeow Select
              </span>
            </div>
            <div className="flex-1" />
            <ThemeToggle />
            <button
              type="button"
              className="press border-ink bg-paper shadow-hard-sm hover:bg-fur-hover flex shrink-0 cursor-pointer items-center gap-1 border-3 px-3 py-2 text-xs font-bold"
              onClick={newChat}
            >
              <Plus className="h-4 w-4" aria-hidden />
              New chat
            </button>
          </header>

          <div
            ref={listRef}
            className="scroll-cat flex flex-1 flex-col gap-4 overflow-y-auto px-3 pt-5 pb-1.5 sm:px-4"
          >
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

          <footer className="border-ink bg-cream border-t-4 p-3 sm:p-3.5">
            <div className="border-ink bg-paper shadow-hard flex items-end gap-2.5 border-3 py-2 pr-2 pl-3.5">
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
                className="placeholder:text-muted max-h-32 flex-1 resize-none border-none bg-transparent p-1.5 text-[14.5px] leading-normal outline-none disabled:opacity-60"
              />
              <button
                type="button"
                aria-label="Send"
                disabled={busy}
                onClick={() => {
                  submit();
                }}
                className="press border-ink bg-coral shadow-hard-sm hover:bg-coral-hover disabled:bg-track disabled:text-muted grid h-11 w-11 shrink-0 cursor-pointer place-items-center border-3 text-white disabled:cursor-not-allowed disabled:shadow-none"
              >
                <Send className="h-[22px] w-[22px]" aria-hidden />
              </button>
            </div>
            <p className="text-muted mt-2.5 text-center text-[11px] tracking-wide">
              Meow is an AI assistant. For questions about specific orders,
              we'll transfer you to a human agent to verify.
            </p>
          </footer>
        </div>
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
