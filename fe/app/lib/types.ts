/** API data shapes shared across pages. Fields map one-to-one to the FastAPI backend
    response; the frontend only reads them, never computes. */

/* ---------- Job runner (/api/jobs) ---------- */
export type JobStatus = "idle" | "running" | "ok" | "failed" | "stopped";

export interface JobSpec {
  name: string;
  title: string;
  cmd: string;
  needs: string;
  heavy: boolean;
  status: JobStatus;
  log?: string;
  returncode?: number | null;
}

/* ---------- Chat page (SSE frames / citations / actions / interrupts) ---------- */
export interface Citation {
  n: number;
  section_path?: string;
  question?: string;
  answer?: string;
  content_type?: string;
}

export interface Order {
  order_id: string;
  product?: string;
  status?: string;
  amount?: number | string;
}

export type ActionItem =
  | { type: "transfer_human" }
  | { type: "create_ticket"; draft?: Record<string, unknown> }
  | { type: "refund_form"; draft?: { order_id?: string } }
  | { type: "select_order"; orders?: Order[] };

export interface TicketPreview {
  ticket_type?: string;
  description?: string;
}

export interface InterruptFrame {
  kind: string; // "select_order" | "confirm_ticket"
  conversation_id?: number;
  orders?: Order[];
  preview?: TicketPreview;
}

export interface ConversationItem {
  id: number;
  preview?: string;
  has_summary?: boolean;
}

export interface HistoryMessage {
  /** "user" | "assistant" etc.; passed through verbatim by the backend */
  role: string;
  content: string;
}
