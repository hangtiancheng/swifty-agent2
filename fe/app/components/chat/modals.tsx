import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { useToast } from "~/components/toast";
import { Btn } from "~/components/ui";
import { api, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import { EASE_DECEL } from "~/lib/motion";

/* The create-ticket / refund form modals (from the original index.html).
   On success, onSuccess(ticketNo) is called; the page then disables the trigger
   button and appends a system message. */

const FIELD_LABEL = "text-label-medium text-on-surface-variant mb-1.5 block";
const FIELD_INPUT =
  "border-outline text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-primary w-full rounded-sm border bg-transparent px-3.5 py-2.5 text-body-medium outline-none transition-[border-color,box-shadow] duration-200 focus:ring-1";

function ModalShell({
  open,
  title,
  sub,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  sub: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="bg-scrim/50 fixed inset-0 z-50 flex items-center justify-center p-5 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="scroll-slim bg-surface-container-high shadow-e5 max-h-[90dvh] w-full max-w-[440px] overflow-y-auto rounded-xl p-6"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.3, ease: EASE_DECEL }}
          >
            <h3 className="text-headline-small text-on-surface font-medium">
              {title}
            </h3>
            <p className="text-body-medium text-on-surface-variant mt-2 mb-5 leading-6">
              {sub}
            </p>
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function FieldError({ text }: { text: string }) {
  return (
    <div className="text-error text-label-medium -mt-1 mb-2.5 min-h-4">
      {text}
    </div>
  );
}

export function TicketModal({
  open,
  conversationId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  conversationId: number | null;
  onClose: () => void;
  onSuccess: (ticketNo: string) => void;
}) {
  const [type, setType] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset on every open: no preselected category, empty description — the user fills it in.
  // The modal animates out, so we can't rely on unmount to reset; clear state synchronously
  // when open turns true
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the form the moment it opens is an intentional synchronous step
      setType("");
      setDesc("");
      setErr("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    if (!type) {
      setErr("Please select a category");
      return;
    }
    if (!desc.trim()) {
      setErr("Please enter a description");
      return;
    }
    setErr("");
    setSubmitting(true);
    try {
      const d = await api<{ ticket_no: string }>(
        "/api/actions/create-ticket",
        jsonPost({
          conversation_id: conversationId,
          description: desc.trim(),
          ticket_type: type,
        }),
      );
      onSuccess(d.ticket_no);
    } catch {
      setErr("Failed to create the ticket, please try again later");
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      open={open}
      title="Create ticket"
      sub="Meow will log the issue as a ticket and follow up on it"
      onClose={onClose}
    >
      <div className="mb-3.5">
        <label className={FIELD_LABEL} htmlFor="ticketType">
          Category <span className="text-error">*</span>
        </label>
        <select
          id="ticketType"
          className={FIELD_INPUT}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
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
      <div className="mb-3.5">
        <label className={FIELD_LABEL} htmlFor="ticketDesc">
          Description <span className="text-error">*</span>
        </label>
        <textarea
          id="ticketDesc"
          className={FIELD_INPUT + " min-h-22 resize-y"}
          placeholder="Describe the issue you're facing…"
          value={desc}
          onChange={(e) => {
            setDesc(e.target.value);
          }}
        />
      </div>
      <FieldError text={err} />
      <div className="mt-1.5 flex justify-end gap-2">
        <Btn variant="text" onClick={onClose}>
          Cancel
        </Btn>
        <Btn
          variant="go"
          disabled={submitting}
          onClick={() => {
            void submit();
          }}
        >
          {submitting ? "Submitting…" : "Create ticket"}
        </Btn>
      </div>
    </ModalShell>
  );
}

export function RefundModal({
  open,
  order,
  conversationId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  order: string;
  conversationId: number | null;
  onClose: () => void;
  onSuccess: (ticketNo: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  // Same as TicketModal: reset the moment it opens — can't unmount during the exit animation
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the form the moment it opens is an intentional synchronous step
      setReason("");
      setErr("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    if (!reason) {
      setErr("Please select a refund reason");
      return;
    }
    setErr("");
    setSubmitting(true);
    try {
      const d = await api<{ ticket_no: string }>(
        "/api/actions/create-refund",
        jsonPost({ conversation_id: conversationId, order_id: order, reason }),
      );
      onSuccess(d.ticket_no);
    } catch {
      setErr("Failed to submit the refund, please try again later");
      setSubmitting(false);
      toast("Failed to submit the refund, please try again later", true);
    }
  };

  return (
    <ModalShell
      open={open}
      title="Submit refund ticket"
      sub="Review the order and refund reason, then submit — Meow will register the refund request for you"
      onClose={onClose}
    >
      <div className="mb-3.5">
        <label className={FIELD_LABEL} htmlFor="refundOrder">
          Order number
        </label>
        <input
          id="refundOrder"
          type="text"
          readOnly
          value={order}
          className={cn(
            FIELD_INPUT,
            "bg-surface-container-high text-on-surface-variant cursor-not-allowed border-transparent",
          )}
        />
      </div>
      <div className="mb-3.5">
        <label className={FIELD_LABEL} htmlFor="refundReason">
          Refund reason <span className="text-error">*</span>
        </label>
        <select
          id="refundReason"
          className={FIELD_INPUT}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
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
      <FieldError text={err} />
      <div className="mt-1.5 flex justify-end gap-2">
        <Btn variant="text" onClick={onClose}>
          Cancel
        </Btn>
        <Btn
          variant="go"
          disabled={submitting}
          onClick={() => {
            void submit();
          }}
        >
          {submitting ? "Submitting…" : "Submit refund"}
        </Btn>
      </div>
    </ModalShell>
  );
}
