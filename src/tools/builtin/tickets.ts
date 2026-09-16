// create_ticket: the only write tool; requires the confirmation flow in agent_tools.
import { z } from "zod";

import { settings } from "#/config.ts";
import * as repository from "#/db/repository.ts";
import { defineTool, register } from "#/tools/registry.ts";

const createTicketSchema = z.object({
  description: z.string(),
  ticket_type: z.enum(["after_sales", "complaint", "inquiry"]),
});

register(
  defineTool({
    name: "create_ticket",
    description:
      "Create a human-agent ticket. Call it only when the user explicitly asks for a ticket or for human follow-up; before calling, you must have obtained the description " +
      "(problem description) from the user — ask first when information is missing, and never fabricate it or use placeholder text. " +
      "ticket_type must be one of after_sales/complaint/inquiry; the conversation id linked to the ticket is injected by the system, so do not pass it.",
    schema: createTicketSchema,
    injectConversation: true,
    handler: async (args) => {
      const { description, ticket_type } = createTicketSchema.parse(args);
      if (settings.demoTicketDelaySeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, settings.demoTicketDelaySeconds * 1000));
      }
      const conversationId = typeof args.conversation_id === "number" ? args.conversation_id : 0;
      const ticketNo = await repository.createTicket(conversationId, description, ticket_type);
      return { ticket_no: ticketNo, status: "transferred" };
    },
  }),
);
