// Authoritative topic taxonomy: 17 classes shared by data, inference, evaluation and APIs.
// Tuple order is the label id; severity drives the tolerance gate per class.

export interface TopicClass {
  name: string;
  boundary: string;
  examples: string[];
  severity: string;
}

export const TOPIC_CLASSES: readonly TopicClass[] = [
  { name: "returns_refunds", boundary: "how to return, exchange or get a refund; repairs belong to warranty_repair, returns belong here", examples: ["return", "refund", "money back", "want to return it", "can I still return it under the 7-day no-reason policy"], severity: "strict" },
  { name: "logistics", boundary: "where the package is and when it arrives; money questions about the fee belong to shipping_fee", examples: ["courier", "dispatch", "where is it now", "why hasn't it moved", "overseas direct mail"], severity: "strict" },
  { name: "sizing", boundary: "whether the size fits", examples: ["cat bed bought too large", "cat villa dimensions", "collar runs small", "what weight of cat does it fit"], severity: "strict" },
  { name: "invoicing", boundary: "issuing invoices, invoice titles, reimbursement vouchers", examples: ["issue an invoice", "invoice title is wrong", "can I get a VAT invoice", "combine invoices"], severity: "strict" },
  { name: "quality_issue", boundary: "defects in the product itself", examples: ["glue came apart", "has a hole", "has a flaw", "litter box motor is broken"], severity: "strict" },
  { name: "shipping_fee", boundary: "who pays the shipping fee, shipping insurance claims; about the money — where the package is belongs to logistics", examples: ["free shipping?", "who pays return shipping", "how does shipping insurance compensate"], severity: "medium" },
  { name: "promotions", boundary: "how to use coupons and campaigns, whether they stack", examples: ["coupon", "spend-and-save", "promo price", "can they be stacked", "any deals on Singles' Day"], severity: "medium" },
  { name: "price_protection", boundary: "whether the difference is refunded when the price drops after purchase", examples: ["price dropped right after I bought it", "can I get the difference back", "how long is the price protection window"], severity: "medium" },
  { name: "payment", boundary: "problems at the payment step", examples: ["can't pay", "Huabei installments", "charged twice", "cash on delivery", "digital yuan"], severity: "medium" },
  { name: "order_modification", boundary: "changing information or canceling after placing an order", examples: ["change address", "change phone number", "can the order still be canceled"], severity: "medium" },
  { name: "stock_replenishment", boundary: "whether it is in stock and when it will be restocked", examples: ["in stock?", "sold out", "when will it be restocked", "any on hand?"], severity: "medium" },
  { name: "product_info", boundary: "material, function, usage", examples: ["what material", "how to wash", "how to store freeze-dried food", "how often to empty the waste bin", "how to choose cat food"], severity: "medium" },
  { name: "warranty_repair", boundary: "warranty period, repair and replacement; repairs belong here, returns belong to returns_refunds", examples: ["how long is the warranty", "can it be repaired if broken", "can it be replaced with a new one"], severity: "medium" },
  { name: "account", boundary: "login, binding, account security", examples: ["can't log in", "forgot password", "rebind phone number", "delete account"], severity: "lenient" },
  { name: "membership_points", boundary: "membership benefits, how to use points", examples: ["how to use points", "what membership tier", "can points offset money"], severity: "lenient" },
  { name: "reviews", boundary: "rules for reviews and photo posts", examples: ["how to edit a review", "where to write a follow-up review", "any rewards for photo posts"], severity: "lenient" },
  { name: "other", boundary: "anything that matches none of the above falls back here", examples: ["chitchat", "transfer to a human", "what time does customer service start"], severity: "lenient" },
];

export const TOPIC_NAMES: readonly string[] = TOPIC_CLASSES.map((c) => c.name);
export const LABEL2ID: Record<string, number> = Object.fromEntries(TOPIC_NAMES.map((n, i) => [n, i]));
export const ID2LABEL: Record<number, string> = Object.fromEntries(TOPIC_NAMES.map((n, i) => [i, n]));
export const NUM_CLASSES = TOPIC_CLASSES.length;
export const SEVERITY: Record<string, string> = Object.fromEntries(TOPIC_CLASSES.map((c) => [c.name, c.severity]));

export function terminologyTable(): string {
  return TOPIC_CLASSES.map((c) => `- ${c.name}: ${c.boundary} (examples: ${c.examples.join(", ")})`).join("\n");
}
