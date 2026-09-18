import { customElement, property, state } from "@swifty.js/lit-jsx";

import { ModalShell } from "~/components/modal-shell";
import { toast } from "~/components/toast";
import { Btn } from "~/components/ui";
import { api, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";

/* The create-ticket / refund form modals (from the original index.html).
   On success, onSuccess(ticketNo) is called; the page then disables the trigger
   button and appends a system message. */

const FIELD_LABEL = "text-label-medium text-on-surface-variant mb-1.5 block";
const FIELD_INPUT =
  "border-outline text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-primary w-full rounded-sm border bg-transparent px-3.5 py-2.5 text-body-medium outline-none transition-[border-color,box-shadow] duration-200 focus:ring-1";

function FieldError({ text }: { text: string }) {
  return <div class="text-error text-label-medium -mt-1 mb-2.5 min-h-4">{text}</div>;
}

@customElement("ticket-modal")
export class TicketModal extends ModalShell {
  @property({ attribute: false }) conversationId: number | null = null;
  @property({ attribute: false }) onSuccess?: (ticketNo: string) => void;

  @state() private type = "";
  @state() private desc = "";
  @state() private err = "";
  @state() private submitting = false;

  protected override updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    // Reset on every open: no preselected category, empty description — the user fills it in
    if (changed.has("open") && this.open) {
      this.type = "";
      this.desc = "";
      this.err = "";
      this.submitting = false;
    }
  }

  private async submit(): Promise<void> {
    if (!this.type) {
      this.err = "Please select a category";
      return;
    }
    if (!this.desc.trim()) {
      this.err = "Please enter a description";
      return;
    }
    this.err = "";
    this.submitting = true;
    try {
      const d = await api<{ ticket_no: string }>(
        "/api/actions/create-ticket",
        jsonPost({
          conversation_id: this.conversationId,
          description: this.desc.trim(),
          ticket_type: this.type,
        }),
      );
      this.onSuccess?.(d.ticket_no);
    } catch {
      this.err = "Failed to create the ticket, please try again later";
      this.submitting = false;
    }
  }

  protected override dialogTitle(): string {
    return "Create ticket";
  }
  protected override dialogSub(): string {
    return "Meow will log the issue as a ticket and follow up on it";
  }

  protected override dialogBody() {
    return (
      <>
        <div class="mb-3.5">
          <label class={FIELD_LABEL} htmlFor="ticketType">
            Category <span class="text-error">*</span>
          </label>
          <select
            id="ticketType"
            class={FIELD_INPUT}
            value={this.type}
            onChange={(e: Event) => {
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              this.type = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="" disabled>
              Select a category…
            </option>
            <option value="after_sales">After-sales</option>
            <option value="complaint">Complaint</option>
            <option value="inquiry">Inquiry</option>
          </select>
        </div>
        <div class="mb-3.5">
          <label class={FIELD_LABEL} htmlFor="ticketDesc">
            Description <span class="text-error">*</span>
          </label>
          <textarea
            id="ticketDesc"
            class={FIELD_INPUT + " min-h-22 resize-y"}
            placeholder="Describe the issue you're facing…"
            value={this.desc}
            onInput={(e: Event) => {
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              this.desc = (e.target as HTMLTextAreaElement).value;
            }}
          />
        </div>
        {FieldError({ text: this.err })}
        <div class="mt-1.5 flex justify-end gap-2">
          <Btn variant="text" onClick={() => this.onClose?.()}>
            Cancel
          </Btn>
          <Btn
            variant="go"
            disabled={this.submitting}
            onClick={() => {
              void this.submit();
            }}
          >
            {this.submitting ? "Submitting…" : "Create ticket"}
          </Btn>
        </div>
      </>
    );
  }
}

@customElement("refund-modal")
export class RefundModal extends ModalShell {
  @property() order = "";
  @property({ attribute: false }) conversationId: number | null = null;
  @property({ attribute: false }) onSuccess?: (ticketNo: string) => void;

  @state() private reason = "";
  @state() private err = "";
  @state() private submitting = false;

  protected override updated(changed: Map<string | number | symbol, unknown>): void {
    super.updated(changed);
    // Same as TicketModal: reset the moment it opens
    if (changed.has("open") && this.open) {
      this.reason = "";
      this.err = "";
      this.submitting = false;
    }
  }

  private async submit(): Promise<void> {
    if (!this.reason) {
      this.err = "Please select a refund reason";
      return;
    }
    this.err = "";
    this.submitting = true;
    try {
      const d = await api<{ ticket_no: string }>(
        "/api/actions/create-refund",
        jsonPost({ conversation_id: this.conversationId, order_id: this.order, reason: this.reason }),
      );
      this.onSuccess?.(d.ticket_no);
    } catch {
      this.err = "Failed to submit the refund, please try again later";
      this.submitting = false;
      toast("Failed to submit the refund, please try again later", true);
    }
  }

  protected override dialogTitle(): string {
    return "Submit refund ticket";
  }
  protected override dialogSub(): string {
    return "Review the order and refund reason, then submit — Meow will register the refund request for you";
  }

  protected override dialogBody() {
    return (
      <>
        <div class="mb-3.5">
          <label class={FIELD_LABEL} htmlFor="refundOrder">
            Order number
          </label>
          <input
            id="refundOrder"
            type="text"
            readOnly
            value={this.order}
            class={cn(
              FIELD_INPUT,
              "bg-surface-container-high text-on-surface-variant cursor-not-allowed border-transparent",
            )}
          />
        </div>
        <div class="mb-3.5">
          <label class={FIELD_LABEL} htmlFor="refundReason">
            Refund reason <span class="text-error">*</span>
          </label>
          <select
            id="refundReason"
            class={FIELD_INPUT}
            value={this.reason}
            onChange={(e: Event) => {
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              this.reason = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="" disabled>
              Select a refund reason…
            </option>
            <option value="no_reason_7_day">7-day no-reason return</option>
            <option value="quality_issue">Quality issue</option>
            <option value="wrong_item">Wrong item shipped</option>
            <option value="no_longer_wanted">Changed my mind</option>
            <option value="other">Other</option>
          </select>
        </div>
        {FieldError({ text: this.err })}
        <div class="mt-1.5 flex justify-end gap-2">
          <Btn variant="text" onClick={() => this.onClose?.()}>
            Cancel
          </Btn>
          <Btn
            variant="go"
            disabled={this.submitting}
            onClick={() => {
              void this.submit();
            }}
          >
            {this.submitting ? "Submitting…" : "Submit refund"}
          </Btn>
        </div>
      </>
    );
  }
}
