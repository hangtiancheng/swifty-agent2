// Builtin order/product query tools. Identity is injected, never model-supplied.
import { z } from "zod";

import { orderSnapshot, ownsOrder, productSnapshot } from "../business.ts";
import { defineTool, register } from "../registry.ts";

// A missing order and someone else's order return the same message: different wording
// would turn the tool into an enumeration oracle.
const NOT_OWNED = { error: "没有找到您的这笔订单", code: "order_not_owned" };

const queryOrderSchema = z.object({
  order_id: z.string().describe("订单号,例如 1001"),
});

register(
  defineTool({
    name: "query_order",
    description:
      "查询订单的状态、金额、下单时间、商品名和物流单号(tracking_no)。用于用户询问某个订单情况时。" +
      "要查物流轨迹,需先用本工具拿到订单的 tracking_no,再把它传给 query_logistics。" +
      "发起人身份由系统注入,你不要传 user_id。",
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
  product_name: z.string().describe("商品名称或关键词,例如 猫粮"),
});

register(
  defineTool({
    name: "query_product",
    description: "查询商品的价格、库存和规格。用于用户咨询某商品是否有货、多少钱时。",
    schema: queryProductSchema,
    handler: (args) => {
      const { product_name } = queryProductSchema.parse(args);
      return productSnapshot(product_name);
    },
  }),
);
