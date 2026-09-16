import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "~/lib/cn";
import { EASE_DECEL, softSpring } from "~/lib/motion";
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
      <div className="text-on-surface-variant text-label-small px-2 py-6 text-center">
        No conversations yet. Send a message to get started!
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {items.map((it, i) => (
        <motion.button
          key={it.id}
          type="button"
          disabled={busy}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            delay: Math.min(i * 0.03, 0.3),
            duration: 0.3,
            ease: EASE_DECEL,
          }}
          className={cn(
            "w-full cursor-pointer rounded-lg px-3 py-2.5 text-left transition-colors duration-200",
            current === it.id
              ? "bg-secondary-container hover:bg-secondary-container-hover"
              : "hover:bg-on-surface/8",
            busy && "cursor-not-allowed opacity-60",
          )}
          onClick={() => {
            onSwitch(it.id);
          }}
        >
          <div
            className={cn(
              "text-label-large flex items-center gap-2",
              current === it.id
                ? "text-on-secondary-container"
                : "text-on-surface",
            )}
          >
            <span className="tabular-nums">#{it.id}</span>
            {it.has_summary ? (
              <span className="bg-tertiary-container text-on-tertiary-container rounded-full px-2 py-px text-[10px] font-medium">
                Summarized
              </span>
            ) : null}
          </div>
          <div
            className={cn(
              "text-body-small mt-0.5 truncate",
              current === it.id
                ? "text-on-secondary-container/75"
                : "text-on-surface-variant",
            )}
          >
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
        "border-outline-variant bg-surface-container-low flex w-64 shrink-0 flex-col border-r",
        className,
      )}
    >
      <div className="text-title-small text-on-surface flex items-center gap-2 px-4 pt-4 pb-3">
        History
      </div>
      <div className="scroll-slim flex-1 overflow-y-auto px-2 pb-2.5">
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
          className="bg-scrim/45 fixed inset-0 z-50 md:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-surface-container-low shadow-e5 flex h-full w-[300px] flex-col rounded-r-xl"
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={softSpring}
            onClick={(e) => {
              e.stopPropagation();
            }}
            role="dialog"
            aria-label="Conversation history"
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <span className="text-title-small text-on-surface">History</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close conversation list"
                className="text-on-surface-variant hover:bg-on-surface/8 grid h-9 w-9 cursor-pointer place-items-center rounded-full transition-colors duration-200"
              >
                <X className="h-4.5 w-4.5" aria-hidden />
              </button>
            </div>
            <div className="scroll-slim flex-1 overflow-y-auto px-2 pb-2.5">
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
            <div className="p-3">
              <button
                type="button"
                className="border-outline text-primary hover:bg-primary/8 text-label-large flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border transition-all duration-200 active:scale-[0.98]"
                onClick={() => {
                  onNewChat();
                  onClose();
                }}
              >
                <Plus className="h-4.5 w-4.5" aria-hidden />
                New chat
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
