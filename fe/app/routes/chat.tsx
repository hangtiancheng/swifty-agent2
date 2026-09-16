import { Menu, Plus, Send } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CatIcon } from "~/components/cat-icon";
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
    { title: "喵喵优选 · 智能客服" },
    {
      name: "description",
      content: "喵喵优选智能客服小喵:商品、订单、售后都能问",
    },
  ];
}

function EmptyState({ onChip }: { onChip: (s: string) => void }) {
  return (
    <div className="m-auto flex animate-pop-in flex-col items-center gap-1.5 px-3 py-5 text-center">
      <div className="mb-3 border-4 border-ink bg-paper p-2.5 shadow-hard">
        <CatIcon className="h-24 w-24" />
      </div>
      <h1 className="text-lg font-bold tracking-widest">你好,我是小喵</h1>
      <p className="text-[13px] text-muted">
        喵喵优选的智能客服,商品、订单、售后都能问~
      </p>
      <div className="mt-4 flex max-w-110 flex-wrap justify-center gap-2.5">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 * i, duration: 0.18 }}
            className="press cursor-pointer border-3 border-ink bg-paper px-3.5 py-2 text-[12.5px] shadow-hard-sm hover:bg-fur-hover"
            onClick={() => { onChip(s); }}
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

  // 每帧后滚到底
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // 不忙时聚焦输入框(发完/切会话/新对话后)
  useEffect(() => {
    if (!busy) {
      inputRef.current?.focus();
    }
  }, [busy]);

  // 输入框自适应高度
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
      onCite: (c, el) => { setCite({ c, rect: el.getBoundingClientRect() }); },
      onFeedback: giveFeedback,
      onTransfer: transferHuman,
      onCreateTicket: (msgId) => { setTicketFor(msgId); },
      onRefund: (msgId, draft) => { setRefundFor({ msgId, order: draft.order_id ?? "" }); },
      onPickOrderResume: (msgId, o) => {
        markDecided(msgId);
        void resume("选择订单 " + o.order_id, { order_id: o.order_id });
      },
      onPickOrderAsk: (msgId, o) => {
        markDecided(msgId);
        void send("查一下订单 " + o.order_id);
      },
      onConfirmTicket: (msgId, confirmed) => {
        markDecided(msgId);
        void resume(confirmed ? "确认提交工单" : "取消建单", { confirmed });
      },
    }),
    [giveFeedback, transferHuman, markDecided, resume, send],
  );

  return (
    <div className="md:grid md:min-h-dvh md:place-items-center">
      <div className="mx-auto flex h-dvh w-full max-w-[980px] overflow-hidden bg-cream md:h-[min(90dvh,860px)] md:border-4 md:border-ink md:shadow-hard-lg">
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
          <header className="flex items-center gap-3 border-b-4 border-ink bg-fur px-3 py-3 sm:px-4">
            <button
              type="button"
              className="press-sm grid h-9 w-9 shrink-0 cursor-pointer place-items-center border-3 border-ink bg-paper shadow-hard-xs md:hidden"
              onClick={() => { setDrawer(true); }}
              aria-label="打开会话列表"
            >
              <Menu className="h-4 w-4" aria-hidden />
            </button>
            <div className="shrink-0 border-3 border-ink bg-paper p-1 shadow-hard-sm">
              <CatIcon className="h-[38px] w-[38px] sm:h-[46px] sm:w-[46px]" />
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[15px] font-bold tracking-wide">
                小喵 · 智能客服
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-[#6b5b48]">
                <span className="h-2 w-2 border-2 border-ink bg-online" />
                ONLINE · 喵喵优选
              </span>
            </div>
            <div className="flex-1" />
            <ThemeToggle />
            <button
              type="button"
              className="press flex shrink-0 cursor-pointer items-center gap-1 border-3 border-ink bg-paper px-3 py-2 text-xs font-bold shadow-hard-sm hover:bg-fur-hover"
              onClick={newChat}
            >
              <Plus className="h-4 w-4" aria-hidden />
              新对话
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

          <footer className="border-t-4 border-ink bg-cream p-3 sm:p-3.5">
            <div className="flex items-end gap-2.5 border-3 border-ink bg-paper py-2 pr-2 pl-3.5 shadow-hard">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                disabled={busy}
                placeholder="输入消息,和小喵聊聊吧~(回车发送 / Shift+回车换行)"
                onChange={(e) => { setInput(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                className="max-h-32 flex-1 resize-none border-none bg-transparent p-1.5 text-[14.5px] leading-normal outline-none placeholder:text-muted disabled:opacity-60"
              />
              <button
                type="button"
                aria-label="发送"
                disabled={busy}
                onClick={() => { submit(); }}
                className="press grid h-11 w-11 shrink-0 cursor-pointer place-items-center border-3 border-ink bg-coral text-white shadow-hard-sm hover:bg-coral-hover disabled:cursor-not-allowed disabled:bg-track disabled:text-muted disabled:shadow-none"
              >
                <Send className="h-[22px] w-[22px]" aria-hidden />
              </button>
            </div>
            <p className="mt-2.5 text-center text-[11px] tracking-wide text-muted">
              小喵是 AI 助手,涉及具体订单会为你转接人工核实
            </p>
          </footer>
        </div>
      </div>

      <MobileDrawer
        open={drawer}
        onClose={() => { setDrawer(false); }}
        items={conversations}
        current={conversationId}
        busy={busy}
        onSwitch={(id) => {
          void switchConversation(id);
        }}
        onNewChat={newChat}
      />
      <CitePopover target={cite} onClose={() => { setCite(null); }} />
      <TicketModal
        open={ticketFor !== null}
        conversationId={conversationId}
        onClose={() => { setTicketFor(null); }}
        onSuccess={(no) => {
          if (ticketFor !== null) {
            markActed(ticketFor);
          }
          setTicketFor(null);
          pushSystem("工单已创建:" + no);
        }}
      />
      <RefundModal
        open={refundFor !== null}
        order={refundFor?.order ?? ""}
        conversationId={conversationId}
        onClose={() => { setRefundFor(null); }}
        onSuccess={(no) => {
          if (refundFor) {
            markActed(refundFor.msgId);
          }
          setRefundFor(null);
          pushSystem("退款申请已提交:" + no);
        }}
      />
    </div>
  );
}
