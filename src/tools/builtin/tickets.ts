// create_ticket: the only write tool; requires the confirmation flow in agent_tools.
import { z } from "zod";

import { settings } from "../../config.ts";
import * as repository from "../../db/repository.ts";
import { defineTool, register } from "../registry.ts";

const createTicketSchema = z.object({
  description: z.string(),
  ticket_type: z.enum(["售后", "投诉", "咨询"]),
});

register(
  defineTool({
    name: "create_ticket",
    description:
      "创建人工工单。仅当用户明确要求建工单/要求人工跟进时才调用;调用前必须确认 description" +
      "(问题描述)已从用户处问清,信息不足时先向用户追问,严禁编造或用占位文本。" +
      "ticket_type 从 售后/投诉/咨询 中选;工单关联的会话号由系统注入,你不要传。",
    schema: createTicketSchema,
    injectConversation: true,
    handler: async (args) => {
      const { description, ticket_type } = createTicketSchema.parse(args);
      if (settings.demoTicketDelaySeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, settings.demoTicketDelaySeconds * 1000));
      }
      const conversationId = typeof args.conversation_id === "number" ? args.conversation_id : 0;
      const ticketNo = await repository.createTicket(conversationId, description, ticket_type);
      return { ticket_no: ticketNo, status: "已转人工" };
    },
  }),
);
