// Admin home aggregation: one card per module. A failing dependency only spoils its own card.
import { Hono } from "hono";

import * as acceptance from "./acceptance.ts";
import * as kb from "./kb.ts";
import * as observability from "./observability.ts";
import * as rageval from "./rageval.ts";

import { statusAll } from "#/core/jobs.ts";
import * as repository from "#/db/repository.ts";

export const adminRouter = new Hono();

const REVIEW_STATES = ["pending_review", "approved", "rejected"] as const;
const RAG_LABEL: Record<string, string> = {
  vector: "Vector only",
  bm25: "BM25 only",
  hybrid: "Hybrid",
  hybrid_rerank: "Hybrid + rerank",
};

interface Card {
  key: string;
  title: string;
  page: string;
  lede: string;
  status: "error" | "ok" | "attention" | "missing";
  headline: string;
  metrics: { label: string; value: unknown }[];
  note: string | null;
}

function card(key: string, title: string, page: string, lede: string): Card {
  return {
    key,
    title,
    page,
    lede,
    status: "error",
    headline: "Failed to read metrics",
    metrics: [],
    note: null,
  };
}

function errText(error: unknown): string {
  return `${error instanceof Error ? error.constructor.name : "Error"}: ${String(error)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

async function kbCard(): Promise<Card> {
  const c = card(
    "kb",
    "Knowledge base",
    "/kb",
    "Knowledge from documents and mined conversations → chunked → dual-written to the local DB and the vector store",
  );
  let stats: repository.KnowledgeStats;
  try {
    stats = await repository.knowledgeStats();
  } catch (error) {
    c.note = errText(error);
    return c;
  }
  const milvus = await kb.milvusState();
  const count = asNumber(milvus.count);
  c.metrics = [
    { label: "Chunks", value: stats.total },
    { label: "Pending vectorization", value: stats.pending },
    {
      label: "Vector store",
      value: milvus.online === true ? count : "offline",
    },
    { label: "Key clauses", value: stats.key_clause },
  ];
  if (stats.total === 0) {
    c.status = "missing";
    c.headline =
      "The KB is empty; ingest content or run the offline build first";
  } else if (milvus.online !== true) {
    c.status = "attention";
    c.headline = `${stats.total} chunks in the KB, but the vector store is offline`;
  } else if (stats.pending > 0 || stats.done !== count) {
    c.status = "attention";
    c.headline = `${stats.pending} chunks pending vectorization; ${stats.done} vectorized vs ${count} in the vector store`;
  } else {
    c.status = "ok";
    c.headline = `${stats.total} chunks consistent across both writes and ready for semantic retrieval`;
  }
  c.note =
    "Type distribution " +
    Object.entries(stats.by_content_type)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
  return c;
}

function ragevalCard(): Card {
  const c = card(
    "rageval",
    "RAG evaluation",
    "/rag-eval",
    "Four-strategy comparison: does retrieval rank well → is the evidence sufficient → is the answer complete",
  );
  let ov: Record<string, unknown>;
  try {
    ov = rageval.overview();
  } catch (error) {
    c.note = errText(error);
    return c;
  }
  if (ov.present !== true) {
    c.status = "missing";
    c.headline =
      'No evaluation run yet; open the page and press "Re-run RAG evaluation" once';
    c.note =
      "Four strategies × four buckets, takes minutes; requires the vector store + a built KB + chat upstream";
    return c;
  }
  const best = asRecord(ov.best);
  const generation =
    ov.generation === null || ov.generation === undefined
      ? null
      : asRecord(ov.generation);
  const meta = asRecord(ov.meta);
  const refusal = generation ? asRecord(generation.refusal) : {};
  const rate = asNumber(refusal.rate);
  const mrr = asNumber(best.mrr);
  c.metrics = [
    { label: "Best MRR", value: mrr === null ? "—" : mrr.toFixed(3) },
    {
      label: "Eval set",
      value:
        asText(meta.n_samples) === null
          ? "—"
          : `${asText(meta.n_samples)} questions`,
    },
    {
      label: "Out-of-KB refusal",
      value: rate === null ? "—" : `${Math.round(rate * 100)}%`,
    },
  ];
  if (ov.generation_done !== true) {
    c.status = "attention";
    c.headline =
      "The generation stage did not finish; only retrieval numbers are present — one more run completes it";
  } else {
    c.status = "ok";
    const strategy = typeof best.strategy === "string" ? best.strategy : "";
    c.headline = `${RAG_LABEL[strategy] ?? strategy} leads, overall MRR ${mrr === null ? "—" : mrr.toFixed(3)}`;
  }
  c.note = `Last run at ${asText(meta.generated_at) ?? "—"}; the page reads artifacts only and never recomputes`;
  return c;
}

async function reviewCard(): Promise<Card> {
  const c = card(
    "review",
    "Flywheel review queue",
    "/review",
    "Unanswerable questions → normalized & deduplicated → human review → written back to the knowledge base",
  );
  const counts: Record<string, number> = {};
  try {
    for (const st of REVIEW_STATES) {
      counts[st] = (await repository.listReviewQueue(st)).length;
    }
  } catch (error) {
    c.note = errText(error);
    return c;
  }
  c.metrics = REVIEW_STATES.map((st) => ({ label: st, value: counts[st] }));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    c.status = "missing";
    c.headline =
      "The queue is empty; ask a few unanswerable questions on the chat page first";
  } else if (counts.pending_review > 0) {
    c.status = "attention";
    c.headline = `${counts.pending_review} items awaiting review`;
  } else {
    c.status = "ok";
    c.headline = `Nothing awaiting review; ${total} items processed in total`;
  }
  c.note =
    "Approved items are written back to the knowledge base and vectorized immediately, recallable from the next round";
  return c;
}

async function observabilityCard(): Promise<Card> {
  const c = card(
    "observability",
    "Observability & cost",
    "/observability",
    "Where the money goes by question type · whether metrics are degrading · how the fallback threshold was set",
  );
  let ov: Record<string, unknown>;
  try {
    ov = await observability.overview();
  } catch (error) {
    c.note = errText(error);
    return c;
  }
  const cost = asRecord(ov.cost);
  const trend = asRecord(ov.trend);
  const calib = asRecord(ov.calibration);
  const runs = Array.isArray(trend.runs) ? trend.runs : [];
  const latest = runs.length > 0 ? asRecord(asRecord(runs[0]).metrics) : {};
  const top =
    cost.top === null || cost.top === undefined ? null : asRecord(cost.top);
  const topShare = top ? asNumber(top.share) : null;
  const faithfulness = asNumber(latest.faithfulness);
  const inUse = asNumber(calib.in_use);
  c.metrics = [
    {
      label: "Top-cost share",
      value: topShare === null ? "—" : `${Math.round(topShare * 100)}%`,
    },
    { label: "Eval rounds", value: runs.length },
    {
      label: "Faithfulness",
      value: faithfulness === null ? "—" : faithfulness.toFixed(3),
    },
    {
      label: "Threshold in use",
      value: inUse === null ? "—" : inUse.toFixed(2),
    },
  ];
  if (trend.status === "error") {
    c.note = typeof trend.note === "string" ? trend.note : null;
    return c;
  }
  const blocks: [string, Record<string, unknown>][] = [
    ["Cost ledger by intent", cost],
    ["Eval trend", trend],
    ["Threshold calibration", calib],
  ];
  const missing = blocks
    .filter(([, b]) => asRecord(b).status !== "ok")
    .map(([name]) => name);
  if (missing.length === 3) {
    c.status = "missing";
    c.headline =
      "None of the three has run yet; open the page and press once to get numbers";
  } else if (missing.length > 0) {
    c.status = "attention";
    c.headline = `Missing: ${missing.join(", ")}`;
  } else if (calib.in_sync !== true) {
    c.status = "attention";
    c.headline = `Recommended threshold ${String(asRecord(calib.recommended).threshold)} differs from ${String(inUse)} in use; backfill it`;
  } else {
    c.status = "ok";
    const intent = top ? (asText(top.intent) ?? "") : "";
    c.headline =
      (intent ? `${intent} costs the most; ` : "") +
      "latest-round faithfulness " +
      (faithfulness === null ? "—" : faithfulness.toFixed(3));
  }
  c.note =
    c.note ??
    "All reports are artifacts written by offline jobs; the page reads them and never recomputes";
  return c;
}

async function topicsCard(): Promise<Card> {
  const c = card(
    "topics",
    "Topic distribution",
    "/topics",
    "Low-confidence questions → classifier bypass grouping → whichever class piles up tells you which knowledge to add first",
  );
  let dist: repository.TopicDistribution;
  try {
    dist = await repository.topicDistribution();
  } catch (error) {
    c.note = errText(error);
    return c;
  }
  const hit = dist.classes.filter((x) => x.count > 0).length;
  const top = [...dist.classes]
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  c.metrics = [
    { label: "Classified questions", value: dist.total },
    { label: "Classes hit", value: `${hit}/${dist.classes.length}` },
  ];
  if (dist.total === 0) {
    c.status = "missing";
    c.headline =
      "Nothing classified yet; run a bypass batch classification on the classifier acceptance page";
  } else {
    c.status = "ok";
    c.headline =
      "Top three: " + top.map((x) => `${x.label} ${x.count}`).join(", ");
  }
  return c;
}

// Classifier acceptance: the nine evidence gates, read straight from the acceptance overview — not recomputed here.
async function classifierCard(): Promise<Card> {
  const c = card(
    "classifier",
    "Classifier acceptance",
    "/acceptance",
    "Corpus → fine-tune → evaluate → export → bypass grouping, nine evidence checks gated one by one",
  );
  let ov: acceptance.AcceptanceOverview;
  try {
    ov = await acceptance.overview();
  } catch (error) {
    c.note = errText(error);
    return c;
  }
  c.metrics = [
    { label: "Gates passed", value: `${ov.passed}/${ov.total}` },
    { label: ":8110", value: ov.classifier.online ? "online" : "offline" },
  ];
  if (ov.all_pass) {
    c.status = "ok";
    c.headline = "All nine gates passed";
  } else {
    const missing = ov.blocks
      .filter((b) => b.status === "missing")
      .map((b) => b.title);
    const failed = ov.blocks
      .filter((b) => b.status === "fail")
      .map((b) => b.title);
    c.status = failed.length > 0 ? "attention" : "missing";
    c.headline =
      [
        failed.length > 0
          ? `${failed.length} below bar: ${failed.join("/")}`
          : "",
        missing.length > 0
          ? `${missing.length} missing artifact: ${missing.join("/")}`
          : "",
      ]
        .filter(Boolean)
        .join("; ") || "Not run yet";
  }
  c.note =
    c.note ??
    "The numbers on the page are the same artifacts the terminal task runner (node main.js) produces";
  return c;
}

export async function overview(): Promise<Record<string, unknown>> {
  return {
    modules: [
      await kbCard(),
      ragevalCard(),
      await reviewCard(),
      await observabilityCard(),
      await topicsCard(),
      await classifierCard(),
    ],
  };
}

adminRouter.get("/api/admin/overview", async () =>
  Response.json(await overview()),
);
adminRouter.get("/api/admin/jobs", (c) => c.json({ jobs: statusAll() }));
