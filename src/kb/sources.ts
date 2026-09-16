// Knowledge base source manifest: which files are ingested and their content types.
// One definition shared by offline build, preview and the ingest page.
import path from "node:path";

import { settings } from "../config.ts";

export const KB_DIR = path.join(settings.root, "data", "kb");

export const SOURCE_TYPES: Record<string, string> = {
  "product-faq.md": "faq",
  "returns-policy.md": "policy",
  "after-sales-manual.md": "manual",
  "product-specs.md": "spec",
  "member-benefits.md": "policy",
  "billing-shipping.md": "policy",
};

export const CONTENT_TYPES = ["faq", "policy", "manual", "spec"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_DESC: Record<ContentType, string> = {
  faq: "商品 FAQ:questions 填真实问法",
  policy: "政策条款:questions 填章节标题、category 填上级路径",
  manual: "售后手册:同政策,按标题层级切",
  spec: "商品规格:含具体型号,精确词召回靠它",
};
