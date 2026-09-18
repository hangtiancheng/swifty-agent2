import { customElement, nothing, property, state } from "@swifty.js/lit-jsx";

import type { BotMsg, Msg } from "./chat-state";

import { Btn } from "~/components/ui";
import { cn } from "~/lib/cn";
import { Icon } from "~/lib/icons";
import { LightElement } from "~/lib/light-element";
import { Markdown } from "~/lib/markdown";
import { enterOnce } from "~/lib/motion";
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
    <span class="flex items-center gap-1.5 py-1.5">
      {[0, 1, 2].map((i) => (
        <span class="typing-dot bg-primary h-2 w-2 rounded-full" style={{ animationDelay: `${String(i * 0.16)}s` }} />
      ))}
    </span>
  );
}

@customElement("message-bubble")
export class MessageBubble extends LightElement {
  @property({ attribute: false }) msg?: Msg;
  @property({ attribute: false }) cb?: BubbleCallbacks;

  /** Order card picked in this bubble (interrupt or select_order action) */
  @state() private pickedOrder: string | null = null;
  /** Transfer button already used in this bubble */
  @state() private transferred = false;

  override connectedCallback(): void {
    super.connectedCallback();
    enterOnce(this, { y: 12, duration: 0.3 });
  }

  /* ---------- Per-reply satisfaction feedback (one-shot thumbs up/down) ---------- */

  private fbBtn(opts: {
    down?: boolean;
    active: boolean;
    dim: boolean;
    disabled: boolean;
    label: string;
    onClick: () => void;
  }) {
    const { down, active, dim, disabled, label, onClick } = opts;
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        class={cn(
          "grid h-8 w-8 cursor-pointer place-items-center rounded-full transition-colors duration-200 active:scale-[0.85]",
          active
            ? "bg-primary-container text-primary hover:bg-primary-container-hover"
            : "text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface",
          dim && "opacity-40",
          disabled && !active && "cursor-default",
        )}
      >
        <Icon name={down ? "thumbs-down" : "thumbs-up"} class="h-4.5 w-4.5" />
      </button>
    );
  }

  private feedbackBar(m: BotMsg) {
    const given = m.feedback;
    return (
      <div class="mt-2 flex items-center gap-1.5">
        {this.fbBtn({
          active: given === "up",
          dim: given === "down",
          disabled: given !== undefined,
          label: "This reply was helpful",
          onClick: () => {
            this.cb?.onFeedback(m.id, "up");
          },
        })}
        {this.fbBtn({
          down: true,
          active: given === "down",
          dim: given === "up",
          disabled: given !== undefined,
          label: "This reply was not helpful",
          onClick: () => {
            this.cb?.onFeedback(m.id, "down");
          },
        })}
        {given ? (
          <span
            ref={(el: Element | undefined) => {
              enterOnce(el, { x: -6, duration: 0.25 });
            }}
            class="text-on-surface-variant text-label-small ml-1"
          >
            Thanks for your feedback!
          </span>
        ) : null}
      </div>
    );
  }

  /* ---------- Order picker cards (interrupt missing order id → pick in the chat
     flow; also offered after a rejection so the user can re-ask) ---------- */

  private orderCards(orders: Order[], decided: boolean | undefined, onPick: (o: Order) => void) {
    const locked = decided || this.pickedOrder !== null;
    return (
      <div>
        <div class="text-body-medium text-on-surface">
          {orders.length
            ? "Please select the order you'd like to handle:"
            : "No selectable orders found. Please provide the order number directly."}
        </div>
        {orders.length ? (
          <div class="mt-2.5 flex flex-col gap-2">
            {orders.map((o) => (
              <button
                type="button"
                disabled={locked}
                class={cn(
                  "cursor-pointer rounded-lg border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-px active:scale-[0.985]",
                  this.pickedOrder === o.order_id
                    ? "border-primary bg-primary-container/45 shadow-e1"
                    : "border-outline-variant bg-card hover:border-primary hover:shadow-e1",
                  locked && this.pickedOrder !== o.order_id && "opacity-50",
                  locked && "cursor-not-allowed",
                )}
                onClick={() => {
                  this.pickedOrder = o.order_id;
                  onPick(o);
                }}
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-title-small text-on-surface">Order {o.order_id}</span>
                  {this.pickedOrder === o.order_id ? (
                    <span
                      ref={(el: Element | undefined) => {
                        enterOnce(el, { scale: 0, duration: 0.3 });
                      }}
                      class="text-primary grid place-items-center"
                    >
                      <Icon name="circle-check" class="h-5 w-5" />
                    </span>
                  ) : null}
                </div>
                <div class="text-body-small text-on-surface mt-0.5">{o.product ?? ""}</div>
                <div class="text-label-small text-on-surface-variant mt-0.5">
                  {(o.status ?? "") + " · ¥" + String(o.amount ?? "")}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  /* ---------- Ticket preview confirm card (interrupt confirm_ticket → resume) ---------- */

  private ticketConfirm(preview: TicketPreview, decided: boolean | undefined, m: BotMsg) {
    return (
      <div
        class={cn(
          "border-outline-variant bg-card mt-3 rounded-lg border p-4 transition-opacity",
          decided && "opacity-70",
        )}
      >
        <div class="text-title-small text-on-surface mb-2 flex items-center gap-2">
          <span class="bg-primary-container text-primary grid h-7 w-7 place-items-center rounded-full">
            <Icon name="clipboard-list" class="h-4 w-4" />
          </span>
          Ticket preview
        </div>
        <div class="text-body-small flex gap-2">
          <span class="text-on-surface-variant shrink-0">Ticket type</span>
          <span class="text-on-surface">
            {preview.ticket_type ? (TICKET_TYPE_LABEL[preview.ticket_type] ?? preview.ticket_type) : "Inquiry"}
          </span>
        </div>
        <div class="text-body-small mt-1.5 flex gap-2">
          <span class="text-on-surface-variant shrink-0">Description</span>
          <span class="text-on-surface wrap-break-word">{preview.description ?? ""}</span>
        </div>
        <div class="mt-3.5 flex gap-2">
          <Btn
            size="sm"
            variant="go"
            disabled={decided}
            onClick={() => {
              this.cb?.onConfirmTicket(m.id, true);
            }}
          >
            Confirm & submit
          </Btn>
          <Btn
            size="sm"
            variant="text"
            disabled={decided}
            onClick={() => {
              this.cb?.onConfirmTicket(m.id, false);
            }}
          >
            Cancel
          </Btn>
        </div>
      </div>
    );
  }

  /* ---------- Actions frame: transfer / ticket / refund / order picker ---------- */

  private actionBar(m: BotMsg) {
    const buttons: unknown[] = [];
    const extras: unknown[] = [];
    for (const a of m.actions) {
      if (a.type === "select_order") {
        // The user quoted an order number that isn't theirs and got rejected; list the
        // orders under their name to pick from. A rejection needs a way forward.
        extras.push(
          this.orderCards(a.orders ?? [], m.decided, (o) => {
            this.cb?.onPickOrderAsk(m.id, o);
          }),
        );
        continue;
      }
      if (a.type === "transfer_human") {
        buttons.push(
          <Btn
            size="sm"
            variant="tonal"
            disabled={this.transferred}
            onClick={() => {
              this.transferred = true;
              this.cb?.onTransfer();
            }}
          >
            Transfer to a human agent
          </Btn>,
        );
      } else if (a.type === "create_ticket") {
        buttons.push(
          <Btn
            size="sm"
            variant="tonal"
            disabled={m.acted}
            onClick={() => {
              this.cb?.onCreateTicket(m.id);
            }}
          >
            Create ticket
          </Btn>,
        );
      } else if (a.type === "refund_form") {
        buttons.push(
          <Btn
            size="sm"
            variant="tonal"
            disabled={m.acted}
            onClick={() => {
              this.cb?.onRefund(m.id, a.draft ?? {});
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
          <div
            ref={(el: Element | undefined) => {
              enterOnce(el, { y: 6, duration: 0.3 });
            }}
            class="mt-3 flex flex-wrap gap-2"
          >
            {buttons}
          </div>
        ) : null}
      </>
    );
  }

  protected override render() {
    const msg = this.msg;
    if (!msg) {
      return nothing;
    }
    if (msg.role === "user") {
      return (
        <div class="flex items-end justify-end">
          <div class="bg-primary-container text-on-primary-container max-w-[85%] rounded-lg rounded-br-md px-4 py-2.5 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap sm:max-w-[74%]">
            {msg.text}
          </div>
        </div>
      );
    }
    const m = msg;
    const citeMap =
      !m.streaming && m.citations.length ? new Map(m.citations.map((c) => [String(c.n), c])) : undefined;
    return (
      <div class="flex items-start justify-start gap-2.5">
        <div class="bg-primary-container hidden h-9 w-9 shrink-0 place-items-center rounded-full sm:grid">
          <Icon name="cat" class="text-primary h-5 w-5" strokeWidth={1.5} />
        </div>
        <div
          class={cn(
            "max-w-[85%] rounded-lg rounded-bl-md px-4 py-3 text-[14.5px] leading-relaxed sm:max-w-[78%]",
            m.error ? "bg-error-container text-on-error-container" : "bg-surface-container-low text-on-surface",
          )}
        >
          {m.error ??
            (m.plain ? (
              <span class="wrap-break-word whitespace-pre-wrap">{m.raw}</span>
            ) : (
              <>
                {m.tools.length ? (
                  <div class="mb-2 flex flex-col items-start gap-1.5">
                    {m.tools.map((t) => (
                      <span
                        ref={(el: Element | undefined) => {
                          enterOnce(el, { scale: 0.9, duration: 0.2 });
                        }}
                        class="bg-surface-container-high text-on-surface-variant text-label-small inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                      >
                        <Icon name="wrench" class="h-3 w-3" />
                        Called {t}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.interrupt ? (
                  m.interrupt.kind === "confirm_ticket"
                    ? this.ticketConfirm(m.interrupt.preview ?? {}, m.decided, m)
                    : this.orderCards(m.interrupt.orders ?? [], m.decided, (o) => {
                        this.cb?.onPickOrderResume(m.id, o);
                      })
                ) : (
                  <>
                    {m.streaming && m.raw === "" ? (
                      <TypingDots />
                    ) : m.raw === "" ? (
                      <span class="text-on-surface-variant">(No reply)</span>
                    ) : (
                      <Markdown
                        text={m.raw}
                        citations={citeMap}
                        onCite={(c, el) => {
                          this.cb?.onCite(c, el);
                        }}
                      />
                    )}
                    {!m.streaming && m.actions.length ? this.actionBar(m) : null}
                    {!m.streaming && m.raw !== "" ? this.feedbackBar(m) : null}
                  </>
                )}
              </>
            ))}
        </div>
      </div>
    );
  }
}
