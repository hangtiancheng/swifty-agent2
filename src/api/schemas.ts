// Request schemas shared by the HTTP routes.
import { z } from "zod";

export const chatRequestSchema = z.object({
  user_id: z.string().min(1, "user_id must not be empty"),
  message: z.string().min(1, "message must not be empty"),
  conversation_id: z.number().int().positive().nullable().default(null),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const agentRequestSchema = z.object({
  user_id: z.string().min(1, "user_id must not be empty"),
  message: z.string().min(1, "message must not be empty"),
  conversation_id: z.number().int().positive().nullable().default(null),
});
export type AgentRequest = z.infer<typeof agentRequestSchema>;

export const createTicketRequestSchema = z.object({
  conversation_id: z.number().int().positive(),
  description: z.string().min(1),
  ticket_type: z.enum(["after_sales", "complaint", "inquiry"]),
});

export const createRefundRequestSchema = z.object({
  conversation_id: z.number().int().positive(),
  order_id: z.string().min(1),
  reason: z.enum([
    "no_reason_7_day",
    "quality_issue",
    "wrong_item",
    "no_longer_wanted",
    "other",
  ]),
});

export const resumeRequestSchema = z.object({
  conversation_id: z.number().int().positive(),
  order_id: z.string().min(1).nullable().default(null),
  confirmed: z.boolean().nullable().default(null),
});
export type ResumeRequest = z.infer<typeof resumeRequestSchema>;

export const extractRequestSchema = z.object({
  text: z.string().min(1, "text must not be empty"),
});

const PLACEHOLDER_ORDER_IDS = new Set(["", "null", "none", "n/a", "无"]);

export const afterSalesTicketSchema = z.object({
  order_id: z
    .string()
    .nullable()
    .describe(
      "Order number; null when it does not appear in the text; never fabricate it",
    ),
  request_type: z
    .enum(["refund", "exchange", "repair", "complaint", "other"])
    .describe("Type of the user's request"),
  expected_solution: z
    .string()
    .describe("The resolution the user expects, summarized in one sentence"),
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
  status: z
    .enum(["unresolved", "resolved", "dismissed"])
    .describe("Handling status"),
  resolution: z
    .string()
    .max(300)
    .nullable()
    .default(null)
    .describe("Handling notes"),
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
  ids: z.array(z.number().int().positive()).min(1, "Select at least one row"),
});

export const searchRequestSchema = z.object({
  q: z.string(),
  strategy: z
    .enum(["vector", "bm25", "hybrid", "hybrid_rerank"])
    .default("vector"),
  top_k: z.number().int().min(1).max(20).default(5),
});
