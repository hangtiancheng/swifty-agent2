// submit_refund: marks an order as refundable; the actual submission happens in the UI form.
import { z } from "zod";

import { ownsOrder } from "../business.ts";
import { defineTool, register } from "../registry.ts";

const NOT_OWNED = { error: "没有找到您的这笔订单", code: "order_not_owned" };

const submitRefundSchema = z.object({
  order_id: z.string().describe("要退款的订单号"),
  reason: z.string().nullable().optional().describe("退款原因(可选,最终以前端固定类目下拉为准)"),
});

register(
  defineTool({
    name: "submit_refund",
    description:
      "判定这一单可以退款后,调用本工具发起退款申请。实际提交由前端退款表单确认后落库," +
      "本工具只表示『这一单可以退,已把提交入口交给用户』。" +
      "发起人身份由系统注入,你不要传 user_id。",
    schema: submitRefundSchema,
    injectUserId: true,
    handler: (args) => {
      const { order_id } = submitRefundSchema.parse(args);
      const userId = typeof args.user_id === "string" ? args.user_id : "";
      // The write-confirmation gate confirms "should we refund", not ownership: check it here too.
      if (!ownsOrder(userId, order_id)) {
        return NOT_OWNED;
      }
      return { status: "待用户确认", order_id };
    },
  }),
);
