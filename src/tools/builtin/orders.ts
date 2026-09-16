// Builtin order/product query tools. Identity is injected, never model-supplied.
import { z } from "zod";

import { orderSnapshot, ownsOrder, productSnapshot } from "#/tools/business.ts";
import { defineTool, register } from "#/tools/registry.ts";

// A missing order and someone else's order return the same message: different wording
// would turn the tool into an enumeration oracle.
const NOT_OWNED = {
  error: "No such order was found for you",
  code: "order_not_owned",
};

const queryOrderSchema = z.object({
  order_id: z.string().describe("Order number, e.g. 1001"),
});

register(
  defineTool({
    name: "query_order",
    description:
      "Query an order's status, amount, order time, product name, and tracking number (tracking_no). Use it when the user asks about a specific order. " +
      "To look up the logistics trace, first use this tool to get the order's tracking_no, then pass it to query_logistics. " +
      "The caller's identity is injected by the system; do not pass user_id.",
    schema: queryOrderSchema,
    injectUserId: true,
    handler: (args) => {
      const { order_id } = queryOrderSchema.parse(args);
      const userId = typeof args.user_id === "string" ? args.user_id : "";
      if (!ownsOrder(userId, order_id)) {
        return NOT_OWNED;
      }
      return orderSnapshot(order_id);
    },
  }),
);

const queryProductSchema = z.object({
  product_name: z.string().describe("Product name or keyword, e.g. cat food"),
});

register(
  defineTool({
    name: "query_product",
    description:
      "Query a product's price, stock, and specifications. Use it when the user asks whether an item is in stock or how much it costs.",
    schema: queryProductSchema,
    handler: (args) => {
      const { product_name } = queryProductSchema.parse(args);
      return productSnapshot(product_name);
    },
  }),
);
