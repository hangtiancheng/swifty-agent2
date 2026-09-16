// Request schemas shared by the HTTP routes.
import { z } from "zod";

export const chatRequestSchema = z.object({
  user_id: z.string().min(1, "user_id 不能为空"),
  message: z.string().min(1, "message 不能为空"),
  conversation_id: z.number().int().positive().nullable().default(null),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const agentRequestSchema = z.object({
  user_id: z.string().min(1, "user_id 不能为空"),
  message: z.string().min(1, "message 不能为空"),
  conversation_id: z.number().int().positive().nullable().default(null),
});
export type AgentRequest = z.infer<typeof agentRequestSchema>;

export const createTicketRequestSchema = z.object({
  conversation_id: z.number().int().positive(),
  description: z.string().min(1),
  ticket_type: z.enum(["售后", "投诉", "咨询"]),
});

export const createRefundRequestSchema = z.object({
  conversation_id: z.number().int().positive(),
  order_id: z.string().min(1),
  reason: z.enum(["七天无理由", "质量问题", "发错货", "不想要了", "其他"]),
});

export const resumeRequestSchema = z.object({
  conversation_id: z.number().int().positive(),
  order_id: z.string().min(1).nullable().default(null),
  confirmed: z.boolean().nullable().default(null),
});
export type ResumeRequest = z.infer<typeof resumeRequestSchema>;

export const extractRequestSchema = z.object({
  text: z.string().min(1, "text 不能为空"),
});

const PLACEHOLDER_ORDER_IDS = new Set(["", "null", "none", "n/a", "无"]);

export const afterSalesTicketSchema = z.object({
  order_id: z.string().nullable().describe("订单号,原文未出现则为 null,禁止编造"),
  request_type: z.enum(["退款", "换货", "维修", "投诉", "其他"]).describe("用户诉求类型"),
  expected_solution: z.string().describe("用户期望的处理方案,一句话概括"),
});
export type AfterSalesTicket = z.infer<typeof afterSalesTicketSchema>;

// The model sometimes expresses "no order id" as a placeholder string instead of omitting it.
export function normalizeOrderId(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return PLACEHOLDER_ORDER_IDS.has(trimmed.toLowerCase()) ? null : trimmed;
}

export const feedbackRequestSchema = z.object({
  conversation_id: z.number().int().positive(),
  rating: z.enum(["up", "down"]),
  question: z.string(),
});

export const approveRequestSchema = z.object({
  approved_answer: z.string().min(1),
});

export const faithCaseStatusRequestSchema = z.object({
  status: z.enum(["未解决", "已解决", "无需解决"]).describe("处置状态"),
  resolution: z.string().max(300).nullable().default(null).describe("处置说明"),
});

export const previewRequestSchema = z.object({
  text: z.string().nullable().default(null),
  file: z.string().nullable().default(null),
  content_type: z.string().default("faq"),
});

export const ingestRequestSchema = z.object({
  text: z.string().min(1),
  content_type: z.string().default("faq"),
  vectorize: z.boolean().default(true),
});

export const stagingReviewRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "至少要选一行"),
});

export const searchRequestSchema = z.object({
  q: z.string(),
  strategy: z.enum(["vector", "bm25", "hybrid", "hybrid_rerank"]).default("vector"),
  top_k: z.number().int().min(1).max(20).default(5),
});
