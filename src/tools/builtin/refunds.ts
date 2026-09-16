// submit_refund: marks an order as refundable; the actual submission happens in the UI form.
import { z } from "zod";

import { ownsOrder } from "@/tools/business.ts";
import { defineTool, register } from "@/tools/registry.ts";

const NOT_OWNED = { error: "No such order was found for you", code: "order_not_owned" };

const submitRefundSchema = z.object({
  order_id: z.string().describe("Order number to refund"),
  reason: z.string().nullable().optional().describe("Refund reason (optional; the front-end fixed-category dropdown is authoritative)"),
});

register(
  defineTool({
    name: "submit_refund",
    description:
      "After determining that this order can be refunded, call this tool to initiate the refund request. The actual submission is persisted only after the user confirms the front-end refund form; " +
      "this tool merely means 'this order is refundable and the submission entry has been handed to the user'. " +
      "The caller's identity is injected by the system; do not pass user_id.",
    schema: submitRefundSchema,
    injectUserId: true,
    handler: (args) => {
      const { order_id } = submitRefundSchema.parse(args);
      const userId = typeof args.user_id === "string" ? args.user_id : "";
      // The write-confirmation gate confirms "should we refund", not ownership: check it here too.
      if (!ownsOrder(userId, order_id)) {
        return NOT_OWNED;
      }
      return { status: "awaiting user confirmation", order_id };
    },
  }),
);
