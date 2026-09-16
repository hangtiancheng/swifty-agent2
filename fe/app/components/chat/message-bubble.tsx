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
          className="animate-blink bg-coral h-2 w-2"
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
        "press-sm border-ink bg-paper text-ink shadow-hard-xs hover:bg-fur-hover grid h-7 w-8 cursor-pointer place-items-center border-2",
        active &&
          "bg-coral hover:bg-coral translate-x-0.5 translate-y-0.5 text-white shadow-none",
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
      {given ? (
        <span className="text-muted text-[11px] tracking-wide">
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
                "press-sm border-ink bg-cream shadow-hard-sm hover:bg-fur-hover cursor-pointer border-3 px-3 py-2 text-left",
                "disabled:cursor-not-allowed disabled:opacity-55",
                picked === o.order_id &&
                  "bg-picked hover:bg-picked opacity-100",
              )}
              onClick={() => {
                setPicked(o.order_id);
                onPick(o);
              }}
            >
              <div className="text-[13px] font-bold">Order {o.order_id}</div>
              <div className="mt-0.5 text-[12.5px]">{o.product ?? ""}</div>
              <div className="text-muted mt-0.5 text-[11.5px]">
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
        "border-ink bg-cream shadow-hard-sm mt-2.5 border-3 p-3",
        decided && "opacity-75",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold">
        <ClipboardList className="h-4 w-4" aria-hidden />
        Ticket preview
      </div>
      <div className="mt-1 flex gap-1.5 text-[12.5px]">
        <span className="text-muted shrink-0">Ticket type</span>
        <span>
          {preview.ticket_type
            ? (TICKET_TYPE_LABEL[preview.ticket_type] ?? preview.ticket_type)
            : "Inquiry"}
        </span>
      </div>
      <div className="mt-1 flex gap-1.5 text-[12.5px]">
        <span className="text-muted shrink-0">Description</span>
        <span className="break-words">{preview.description ?? ""}</span>
      </div>
      <div className="mt-2.5 flex gap-2">
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
      <div className="animate-pop-in flex items-end justify-end gap-2.5">
        <div className="border-ink bg-coral shadow-hard-sm max-w-[85%] border-3 px-3.5 py-2.5 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap text-white sm:max-w-[74%]">
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
    <div className="animate-pop-in flex items-end justify-start gap-2.5">
      <div className="border-ink bg-paper shadow-hard-xs hidden shrink-0 border-3 p-1 sm:block">
        <Cat className="h-8.5 w-8.5" strokeWidth={1.5} />
      </div>
      <div
        className={cn(
          "border-ink shadow-hard-sm max-w-[85%] border-3 px-3.5 py-2.5 text-[14.5px] leading-relaxed sm:max-w-[74%]",
          m.error ? "bg-error-bg text-error" : "bg-paper text-ink",
        )}
      >
        {m.error ??
          (m.plain ? (
            <span className="break-words whitespace-pre-wrap">{m.raw}</span>
          ) : (
            <>
              {m.tools.length ? (
                <div className="mb-1.5 flex flex-col items-start gap-1">
                  {m.tools.map((t, i) => (
                    <span
                      key={i}
                      className="border-muted bg-ink/5 text-muted inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-px text-xs"
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
          ))}
      </div>
    </div>
  );
});
