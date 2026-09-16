import {
  Cat,
  CircleCheck,
  ClipboardList,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useState } from "react";

import type { BotMsg, Msg } from "./use-chat";

import { Btn } from "~/components/ui";
import { cn } from "~/lib/cn";
import { Markdown } from "~/lib/markdown";
import { EASE_DECEL, springTransition } from "~/lib/motion";
import type { Citation, Order, TicketPreview } from "~/lib/types";

/* ticket_type arrives as the backend enum value (after_sales/complaint/inquiry);
   render a friendly label, falling back to the raw value for anything unknown. */
const TICKET_TYPE_LABEL: Record<string, string> = {
  after_sales: "After-sales",
  complaint: "Complaint",
  inquiry: "Inquiry",
};

export interface BubbleCallbacks {
  onCite: (c: Citation, el: HTMLElement) => void;
  onFeedback: (id: number, rating: "up" | "down") => void;
  onTransfer: () => void;
  onCreateTicket: (msgId: number) => void;
  onRefund: (msgId: number, draft: { order_id?: string }) => void;
  onPickOrderResume: (msgId: number, o: Order) => void;
  onPickOrderAsk: (msgId: number, o: Order) => void;
  onConfirmTicket: (msgId: number, confirmed: boolean) => void;
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1.5 py-1.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="bg-primary h-2 w-2 rounded-full"
          animate={{ opacity: [0.35, 1, 0.35], y: [0, -3, 0] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.16,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

/* ---------- Per-reply satisfaction feedback (thumbs up/down; one-shot, one click highlights + confirms) ---------- */

function FbBtn({
  down,
  active,
  dim,
  disabled,
  label,
  onClick,
}: {
  down?: boolean;
  active: boolean;
  dim: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={active || disabled ? undefined : { scale: 0.85 }}
      className={cn(
        "grid h-8 w-8 cursor-pointer place-items-center rounded-full transition-colors duration-200",
        active
          ? "bg-primary-container text-primary hover:bg-primary-container-hover"
          : "text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface",
        dim && "opacity-40",
        disabled && !active && "cursor-default",
      )}
    >
      {down ? (
        <ThumbsDown className="h-4.5 w-4.5" aria-hidden />
      ) : (
        <ThumbsUp className="h-4.5 w-4.5" aria-hidden />
      )}
    </motion.button>
  );
}

function FeedbackBar({
  msg,
  onFeedback,
}: {
  msg: BotMsg;
  onFeedback: BubbleCallbacks["onFeedback"];
}) {
  const given = msg.feedback;
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <FbBtn
        active={given === "up"}
        dim={given === "down"}
        disabled={given !== undefined}
        label="This reply was helpful"
        onClick={() => {
          onFeedback(msg.id, "up");
        }}
      />
      <FbBtn
        down
        active={given === "down"}
        dim={given === "up"}
        disabled={given !== undefined}
        label="This reply was not helpful"
        onClick={() => {
          onFeedback(msg.id, "down");
        }}
      />
      <AnimatePresence>
        {given ? (
          <motion.span
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, ease: EASE_DECEL }}
            className="text-on-surface-variant text-label-small ml-1"
          >
            Thanks for your feedback!
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Order picker cards (interrupt missing order id → pick in the chat flow; also offered after a rejection so the user can re-ask) ---------- */

export function OrderCards({
  orders,
  decided,
  onPick,
}: {
  orders: Order[];
  decided?: boolean;
  onPick: (o: Order) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const locked = decided || picked !== null;
  return (
    <div>
      <div className="text-body-medium text-on-surface">
        {orders.length
          ? "Please select the order you'd like to handle:"
          : "No selectable orders found. Please provide the order number directly."}
      </div>
      {orders.length ? (
        <div className="mt-2.5 flex flex-col gap-2">
          {orders.map((o) => (
            <motion.button
              key={o.order_id}
              type="button"
              disabled={locked}
              whileHover={locked ? undefined : { y: -1 }}
              whileTap={locked ? undefined : { scale: 0.985 }}
              className={cn(
                "cursor-pointer rounded-lg border px-4 py-3 text-left transition-all duration-200",
                picked === o.order_id
                  ? "border-primary bg-primary-container/45 shadow-e1"
                  : "border-outline-variant bg-card hover:border-primary hover:shadow-e1",
                locked && picked !== o.order_id && "opacity-50",
                locked && "cursor-not-allowed",
              )}
              onClick={() => {
                setPicked(o.order_id);
                onPick(o);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-title-small text-on-surface">
                  Order {o.order_id}
                </span>
                {picked === o.order_id ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={springTransition}
                    className="text-primary grid place-items-center"
                  >
                    <CircleCheck className="h-5 w-5" aria-hidden />
                  </motion.span>
                ) : null}
              </div>
              <div className="text-body-small text-on-surface mt-0.5">
                {o.product ?? ""}
              </div>
              <div className="text-label-small text-on-surface-variant mt-0.5">
                {(o.status ?? "") + " · ¥" + String(o.amount ?? "")}
              </div>
            </motion.button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Ticket preview confirm card (interrupt confirm_ticket → Confirm/Cancel → resume) ---------- */

function TicketConfirm({
  preview,
  decided,
  onDecide,
}: {
  preview: TicketPreview;
  decided?: boolean;
  onDecide: (confirmed: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "border-outline-variant bg-card mt-3 rounded-lg border p-4 transition-opacity",
        decided && "opacity-70",
      )}
    >
      <div className="text-title-small text-on-surface mb-2 flex items-center gap-2">
        <span className="bg-primary-container text-primary grid h-7 w-7 place-items-center rounded-full">
          <ClipboardList className="h-4 w-4" aria-hidden />
        </span>
        Ticket preview
      </div>
      <div className="text-body-small flex gap-2">
        <span className="text-on-surface-variant shrink-0">Ticket type</span>
        <span className="text-on-surface">
          {preview.ticket_type
            ? (TICKET_TYPE_LABEL[preview.ticket_type] ?? preview.ticket_type)
            : "Inquiry"}
        </span>
      </div>
      <div className="text-body-small mt-1.5 flex gap-2">
        <span className="text-on-surface-variant shrink-0">Description</span>
        <span className="text-on-surface wrap-break-word">
          {preview.description ?? ""}
        </span>
      </div>
      <div className="mt-3.5 flex gap-2">
        <Btn
          size="sm"
          variant="go"
          disabled={decided}
          onClick={() => {
            onDecide(true);
          }}
        >
          Confirm & submit
        </Btn>
        <Btn
          size="sm"
          variant="text"
          disabled={decided}
          onClick={() => {
            onDecide(false);
          }}
        >
          Cancel
        </Btn>
      </div>
    </div>
  );
}

/* ---------- Actions frame: transfer to human / create ticket / refund / order picker ---------- */

function ActionBar({ msg, cb }: { msg: BotMsg; cb: BubbleCallbacks }) {
  const [transferred, setTransferred] = useState(false);
  const buttons: React.ReactNode[] = [];
  const extras: React.ReactNode[] = [];
  for (const a of msg.actions) {
    if (a.type === "select_order") {
      // The user quoted an order number that isn't theirs and got rejected; list the orders
      // under their name to pick from. A rejection needs a way forward, otherwise they can't
      // look anything up and don't even know their own order number
      extras.push(
        <OrderCards
          key="select_order"
          orders={a.orders ?? []}
          decided={msg.decided}
          onPick={(o) => {
            cb.onPickOrderAsk(msg.id, o);
          }}
        />,
      );
      continue;
    }
    if (a.type === "transfer_human") {
      buttons.push(
        <Btn
          key="transfer"
          size="sm"
          variant="tonal"
          disabled={transferred}
          onClick={() => {
            setTransferred(true);
            cb.onTransfer();
          }}
        >
          Transfer to a human agent
        </Btn>,
      );
    } else if (a.type === "create_ticket") {
      buttons.push(
        <Btn
          key="ticket"
          size="sm"
          variant="tonal"
          disabled={msg.acted}
          onClick={() => {
            cb.onCreateTicket(msg.id);
          }}
        >
          Create ticket
        </Btn>,
      );
    } else if (a.type === "refund_form") {
      buttons.push(
        <Btn
          key="refund"
          size="sm"
          variant="tonal"
          disabled={msg.acted}
          onClick={() => {
            cb.onRefund(msg.id, a.draft ?? {});
          }}
        >
          Submit refund ticket
        </Btn>,
      );
    }
  }
  return (
    <>
      {extras}
      {buttons.length ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_DECEL }}
          className="mt-3 flex flex-wrap gap-2"
        >
          {buttons}
        </motion.div>
      ) : null}
    </>
  );
}

/* ---------- Message bubble ---------- */

export const MessageBubble = memo(function MessageBubble({
  msg,
  cb,
}: {
  msg: Msg;
  cb: BubbleCallbacks;
}) {
  if (msg.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: EASE_DECEL }}
        className="flex items-end justify-end"
      >
        <div className="bg-primary-container text-on-primary-container max-w-[85%] rounded-lg rounded-br-md px-4 py-2.5 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap sm:max-w-[74%]">
          {msg.text}
        </div>
      </motion.div>
    );
  }
  const m = msg;
  const citeMap =
    !m.streaming && m.citations.length
      ? new Map(m.citations.map((c) => [String(c.n), c]))
      : undefined;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_DECEL }}
      className="flex items-start justify-start gap-2.5"
    >
      <div className="bg-primary-container hidden h-9 w-9 shrink-0 place-items-center rounded-full sm:grid">
        <Cat className="text-primary h-5 w-5" strokeWidth={1.5} />
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-lg rounded-bl-md px-4 py-3 text-[14.5px] leading-relaxed sm:max-w-[78%]",
          m.error
            ? "bg-error-container text-on-error-container"
            : "bg-surface-container-low text-on-surface",
        )}
      >
        {m.error ??
          (m.plain ? (
            <span className="wrap-break-word whitespace-pre-wrap">{m.raw}</span>
          ) : (
            <>
              {m.tools.length ? (
                <div className="mb-2 flex flex-col items-start gap-1.5">
                  {m.tools.map((t, i) => (
                    <motion.span
                      key={i}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2, ease: EASE_DECEL }}
                      className="bg-surface-container-high text-on-surface-variant text-label-small inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                    >
                      <Wrench className="h-3 w-3" aria-hidden />
                      Called {t}
                    </motion.span>
                  ))}
                </div>
              ) : null}
              {m.interrupt ? (
                m.interrupt.kind === "confirm_ticket" ? (
                  <TicketConfirm
                    preview={m.interrupt.preview ?? {}}
                    decided={m.decided}
                    onDecide={(confirmed) => {
                      cb.onConfirmTicket(m.id, confirmed);
                    }}
                  />
                ) : (
                  <OrderCards
                    orders={m.interrupt.orders ?? []}
                    decided={m.decided}
                    onPick={(o) => {
                      cb.onPickOrderResume(m.id, o);
                    }}
                  />
                )
              ) : (
                <>
                  {m.streaming && m.raw === "" ? (
                    <TypingDots />
                  ) : m.raw === "" ? (
                    <span className="text-on-surface-variant">(No reply)</span>
                  ) : (
                    <Markdown
                      text={m.raw}
                      citations={citeMap}
                      onCite={cb.onCite}
                    />
                  )}
                  {!m.streaming && m.actions.length ? (
                    <ActionBar msg={m} cb={cb} />
                  ) : null}
                  {!m.streaming && m.raw !== "" ? (
                    <FeedbackBar msg={m} onFeedback={cb.onFeedback} />
                  ) : null}
                </>
              )}
            </>
          ))}
      </div>
    </motion.div>
  );
});
