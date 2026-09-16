// Knowledge base source manifest: which files are ingested and their content types.
// One definition shared by offline build, preview and the ingest page.
import path from "node:path";

import { settings } from "#/config.ts";

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
  faq: "Product FAQ: questions hold real user phrasings",
  policy: "Policy clauses: questions hold section titles, category holds the parent path",
  manual: "After-sales manual: same as policy, split by heading hierarchy",
  spec: "Product specs: contain concrete model numbers; exact-term recall relies on them",
};
