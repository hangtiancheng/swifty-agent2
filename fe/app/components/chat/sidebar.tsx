import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "~/lib/cn";
import type { ConversationItem } from "~/lib/types";

/* Conversation sidebar: fixed column on desktop, drawer on mobile. List item = #id + summarized badge + preview. */

function ConvList({
  items,
  current,
  busy,
  onSwitch,
}: {
  items: ConversationItem[];
  current: number | null;
  busy: boolean;
  onSwitch: (id: number) => void;
}) {
  if (!items.length) {
    return (
      <div className="px-1.5 py-4 text-center text-[11.5px] text-muted">
        No conversations yet. Send a message to get started!
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <motion.button
          key={it.id}
          type="button"
          disabled={busy}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "press-sm cursor-pointer border-3 border-ink bg-cream px-2.5 py-2 text-left shadow-hard-xs hover:bg-fur-hover",
            "disabled:cursor-not-allowed",
            current === it.id &&
              "translate-x-0.5 translate-y-0.5 bg-fur shadow-none hover:bg-fur",
          )}
          onClick={() => { onSwitch(it.id); }}
        >
          <div className="flex items-center gap-1.5 text-xs font-bold">
            #{it.id}
            {it.has_summary ? (
              <span className="border border-ink bg-coral px-1 text-[9px] font-bold tracking-wider text-white">
                Summarized
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-[11px] text-muted">
            {it.preview ?? ""}
          </div>
        </motion.button>
      ))}
    </div>
  );
}

export function Sidebar({
  items,
  current,
  busy,
  onSwitch,
  className,
}: {
  items: ConversationItem[];
  current: number | null;
  busy: boolean;
  onSwitch: (id: number) => void;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "flex w-56 shrink-0 flex-col border-r-4 border-ink bg-paper",
        className,
      )}
    >
      <div className="border-b-4 border-ink bg-fur px-3 py-3.5 text-[13px] font-bold tracking-wider">
        History
      </div>
      <div className="scroll-cat flex-1 overflow-y-auto p-2.5">
        <ConvList
          items={items}
          current={current}
          busy={busy}
          onSwitch={onSwitch}
        />
      </div>
    </aside>
  );
}

export function MobileDrawer({
  open,
  onClose,
  items,
  current,
  busy,
  onSwitch,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  items: ConversationItem[];
  current: number | null;
  busy: boolean;
  onSwitch: (id: number) => void;
  onNewChat: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 bg-ink/45 md:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className="flex h-full w-[280px] flex-col border-r-4 border-ink bg-paper"
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: "tween", duration: 0.22 }}
            onClick={(e) => { e.stopPropagation(); }}
            role="dialog"
            aria-label="Conversation history"
          >
            <div className="flex items-center justify-between border-b-4 border-ink bg-fur px-3 py-3">
              <span className="text-[13px] font-bold tracking-wider">
                History
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close conversation list"
                className="press-sm grid h-7 w-7 cursor-pointer place-items-center border-2 border-ink bg-paper shadow-hard-xs"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="scroll-cat flex-1 overflow-y-auto p-2.5">
              <ConvList
                items={items}
                current={current}
                busy={busy}
                onSwitch={(id) => {
                  onSwitch(id);
                  onClose();
                }}
              />
            </div>
            <div className="border-t-4 border-ink p-2.5">
              <button
                type="button"
                className="press flex w-full cursor-pointer items-center justify-center gap-1.5 border-3 border-ink bg-cream px-3 py-2 text-xs font-bold shadow-hard-sm hover:bg-fur-hover"
                onClick={() => {
                  onNewChat();
                  onClose();
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                New chat
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
