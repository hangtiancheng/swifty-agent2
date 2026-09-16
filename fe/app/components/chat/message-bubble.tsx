import { Cat, ClipboardList, ThumbsDown, ThumbsUp, Wrench } from "lucide-react";
import { memo, useState } from "react";

import type { BotMsg, Msg } from "./use-chat";

import { Btn } from "~/components/ui";
import { cn } from "~/lib/cn";
import { Markdown } from "~/lib/markdown";
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
    <span className="inline-flex gap-1.5 px-0.5 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 animate-blink bg-coral"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

/* ---------- Per-reply satisfaction feedback (👍/👎; one-shot, one click highlights + confirms) ---------- */

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
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "press-sm grid h-7 w-8 cursor-pointer place-items-center border-2 border-ink bg-paper text-ink shadow-hard-xs hover:bg-fur-hover",
        active && "translate-x-0.5 translate-y-0.5 bg-coral text-white shadow-none hover:bg-coral",
        dim && "opacity-40",
        disabled && "cursor-default",
      )}
    >
      {down ? (
        <ThumbsDown className="h-[18px] w-[18px]" aria-hidden />
      ) : (
        <ThumbsUp className="h-[18px] w-[18px]" aria-hidden />
      )}
    </button>
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
    <div className="mt-2.5 flex items-center gap-2">
      <FbBtn
        active={given === "up"}
        dim={given === "down"}
        disabled={given !== undefined}
        label="This reply was helpful"
        onClick={() => { onFeedback(msg.id, "up"); }}
      />
      <FbBtn
        down
        active={given === "down"}
        dim={given === "up"}
        disabled={given !== undefined}
        label="This reply was not helpful"
        onClick={() => { onFeedback(msg.id, "down"); }}
      />
      {given ? (
        <span className="text-[11px] tracking-wide text-muted">
          Thanks for your feedback!
        </span>
      ) : null}
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
      <div className="text-sm">
        {orders.length
          ? "Please select the order you'd like to handle:"
          : "No selectable orders found. Please provide the order number directly."}
      </div>
      {orders.length ? (
        <div className="mt-2.5 flex flex-col gap-2">
          {orders.map((o) => (
            <button
              key={o.order_id}
              type="button"
              disabled={locked}
              className={cn(
                "press-sm cursor-pointer border-3 border-ink bg-cream px-3 py-2 text-left shadow-hard-sm hover:bg-fur-hover",
                "disabled:cursor-not-allowed disabled:opacity-55",
                picked === o.order_id &&
                  "bg-picked opacity-100 hover:bg-picked",
              )}
              onClick={() => {
                setPicked(o.order_id);
                onPick(o);
              }}
            >
              <div className="text-[13px] font-bold">Order {o.order_id}</div>
              <div className="mt-0.5 text-[12.5px]">{o.product ?? ""}</div>
              <div className="mt-0.5 text-[11.5px] text-muted">
                {(o.status ?? "") + " · ¥" + String(o.amount ?? "")}
              </div>
            </button>
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
        "mt-2.5 border-3 border-ink bg-cream p-3 shadow-hard-sm",
        decided && "opacity-75",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold">
        <ClipboardList className="h-4 w-4" aria-hidden />
        Ticket preview
      </div>
      <div className="mt-1 flex gap-1.5 text-[12.5px]">
        <span className="shrink-0 text-muted">Ticket type</span>
        <span>
          {preview.ticket_type
            ? (TICKET_TYPE_LABEL[preview.ticket_type] ?? preview.ticket_type)
            : "Inquiry"}
        </span>
      </div>
      <div className="mt-1 flex gap-1.5 text-[12.5px]">
        <span className="shrink-0 text-muted">Description</span>
        <span className="break-words">{preview.description ?? ""}</span>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Btn size="sm" variant="go" disabled={decided} onClick={() => { onDecide(true); }}>
          Confirm & submit
        </Btn>
        <Btn size="sm" disabled={decided} onClick={() => { onDecide(false); }}>
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
          onPick={(o) => { cb.onPickOrderAsk(msg.id, o); }}
        />,
      );
      continue;
    }
    if (a.type === "transfer_human") {
      buttons.push(
        <Btn
          key="transfer"
          size="sm"
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
          disabled={msg.acted}
          onClick={() => { cb.onCreateTicket(msg.id); }}
        >
          Create ticket
        </Btn>,
      );
    } else if (a.type === "refund_form") {
      buttons.push(
        <Btn
          key="refund"
          size="sm"
          disabled={msg.acted}
          onClick={() => { cb.onRefund(msg.id, a.draft ?? {}); }}
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
        <div className="mt-3 flex flex-wrap gap-2.5">{buttons}</div>
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
      <div className="flex animate-pop-in items-end justify-end gap-2.5">
        <div className="max-w-[85%] border-3 border-ink bg-coral px-3.5 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap break-words text-white shadow-hard-sm sm:max-w-[74%]">
          {msg.text}
        </div>
      </div>
    );
  }
  const m = msg;
  const citeMap =
    !m.streaming && m.citations.length
      ? new Map(m.citations.map((c) => [String(c.n), c]))
      : undefined;
  return (
    <div className="flex animate-pop-in items-end justify-start gap-2.5">
      <div className="hidden shrink-0 border-3 border-ink bg-paper p-1 shadow-hard-xs sm:block">
        <Cat className="h-[34px] w-[34px]" strokeWidth={1.5} />
      </div>
      <div
        className={cn(
          "max-w-[85%] border-3 border-ink px-3.5 py-2.5 text-[14.5px] leading-relaxed shadow-hard-sm sm:max-w-[74%]",
          m.error ? "bg-error-bg text-error" : "bg-paper text-ink",
        )}
      >
        {m.error ? (
          m.error
        ) : m.plain ? (
          <span className="whitespace-pre-wrap break-words">{m.raw}</span>
        ) : (
          <>
            {m.tools.length ? (
              <div className="mb-1.5 flex flex-col items-start gap-1">
                {m.tools.map((t, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted bg-ink/5 px-2 py-px text-xs text-muted"
                  >
                    <Wrench className="h-3 w-3" aria-hidden />
                    Called {t}
                  </span>
                ))}
              </div>
            ) : null}
            {m.interrupt ? (
              m.interrupt.kind === "confirm_ticket" ? (
                <TicketConfirm
                  preview={m.interrupt.preview ?? {}}
                  decided={m.decided}
                  onDecide={(confirmed) => { cb.onConfirmTicket(m.id, confirmed); }}
                />
              ) : (
                <OrderCards
                  orders={m.interrupt.orders ?? []}
                  decided={m.decided}
                  onPick={(o) => { cb.onPickOrderResume(m.id, o); }}
                />
              )
            ) : (
              <>
                {m.streaming && m.raw === "" ? (
                  <TypingDots />
                ) : m.raw === "" ? (
                  <span>(No reply)</span>
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
        )}
      </div>
    </div>
  );
});
