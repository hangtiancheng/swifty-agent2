/** 跨页共享的接口数据形状。字段与 FastAPI 后端返回一一对应,前端只读不算。 */

/* ---------- 作业运行器(/api/jobs) ---------- */
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

/* ---------- 聊天页(SSE 帧 / 引用 / 动作 / 中断) ---------- */
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
  /** "user" | "assistant" 等,后端原样透传 */
  role: string;
  content: string;
}
