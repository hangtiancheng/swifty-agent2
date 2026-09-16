// Admin home aggregation: one card per module. A failing dependency only spoils its own card.
import { Hono } from "hono";

import { statusAll } from "../core/jobs.ts";
import * as repository from "../db/repository.ts";

import * as kb from "./kb.ts";
import * as observability from "./observability.ts";
import * as rageval from "./rageval.ts";

export const adminRouter = new Hono();

const REVIEW_STATES = ["待审", "通过", "驳回"] as const;
const RAG_LABEL: Record<string, string> = {
  vector: "纯向量",
  bm25: "纯 BM25",
  hybrid: "混合",
  hybrid_rerank: "混合 + 重排",
};

interface Card {
  key: string;
  title: string;
  page: string;
  lede: string;
  status: "error" | "ok" | "attention" | "missing";
  headline: string;
  metrics: Array<{ label: string; value: unknown }>;
  note: string | null;
}

function card(key: string, title: string, page: string, lede: string): Card {
  return { key, title, page, lede, status: "error", headline: "读数失败", metrics: [], note: null };
}

function errText(error: unknown): string {
  return `${error instanceof Error ? error.constructor.name : "Error"}: ${String(error)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
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
  const c = card("kb", "知识库", "/kb", "文档与对话挖出来的知识 → 切块 → 双写本地库与向量");
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
    { label: "知识块", value: stats.total },
    { label: "待向量化", value: stats.pending },
    { label: "向量库", value: milvus.online === true ? count : "离线" },
    { label: "关键条款", value: stats.key_clause },
  ];
  if (stats.total === 0) {
    c.status = "missing";
    c.headline = "库是空的,先录入或跑一次离线建库";
  } else if (milvus.online !== true) {
    c.status = "attention";
    c.headline = `库里有 ${stats.total} 块,向量库离线`;
  } else if (stats.pending > 0 || stats.done !== count) {
    c.status = "attention";
    c.headline = `${stats.pending} 块待向量化,已向量化 ${stats.done} 对向量库 ${count}`;
  } else {
    c.status = "ok";
    c.headline = `${stats.total} 块双写一致,可被语义检索`;
  }
  c.note = "类型分布 " + Object.entries(stats.by_content_type).map(([k, v]) => `${k}=${v}`).join(" ");
  return c;
}

function ragevalCard(): Card {
  const c = card("rageval", "RAG 评估", "/rag-eval", "四策略对照:检索排得准不准 → 证据够不够 → 答案全不全");
  let ov: Record<string, unknown>;
  try {
    ov = rageval.overview();
  } catch (error) {
    c.note = errText(error);
    return c;
  }
  if (ov.present !== true) {
    c.status = "missing";
    c.headline = "还没跑过评估,进去按一次「重跑 RAG 评估」";
    c.note = "四策略 × 四桶,分钟级;需向量库 + 已建库 + 聊天上游";
    return c;
  }
  const best = asRecord(ov.best);
  const generation = ov.generation === null || ov.generation === undefined ? null : asRecord(ov.generation);
  const meta = asRecord(ov.meta);
  const refusal = generation ? asRecord(generation.refusal) : {};
  const rate = asNumber(refusal.rate);
  const mrr = asNumber(best.mrr);
  c.metrics = [
    { label: "最佳 MRR", value: mrr === null ? "—" : mrr.toFixed(3) },
    { label: "评估集", value: asText(meta.n_samples) === null ? "—" : `${asText(meta.n_samples)} 题` },
    { label: "库外拒答", value: rate === null ? "—" : `${Math.round(rate * 100)}%` },
  ];
  if (ov.generation_done !== true) {
    c.status = "attention";
    c.headline = "生成段没跑完,只有检索段的数,补跑一次就齐";
  } else {
    c.status = "ok";
    const strategy = typeof best.strategy === "string" ? best.strategy : "";
    c.headline = `${RAG_LABEL[strategy] ?? strategy} 领先,总体 MRR ${mrr === null ? "—" : mrr.toFixed(3)}`;
  }
  c.note = `上次跑于 ${asText(meta.generated_at) ?? "—"};页面只读产物,不重算`;
  return c;
}

async function reviewCard(): Promise<Card> {
  const c = card("review", "飞轮待审队列", "/review", "答不上的问题 → 标准化查重 → 人工审核 → 写回知识库");
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
    c.headline = "队列还没有货,先在聊天页问几个答不上的问题";
  } else if (counts["待审"] > 0) {
    c.status = "attention";
    c.headline = `${counts["待审"]} 条等着审`;
  } else {
    c.status = "ok";
    c.headline = `待审清零,累计处理 ${total} 条`;
  }
  c.note = "审核通过即写回知识库并即时向量化,下一轮就能召回";
  return c;
}

async function observabilityCard(): Promise<Card> {
  const c = card("observability", "观测与成本", "/observability", "钱花在哪类问题上 · 指标有没有劣化 · 兜底阈值怎么定的");
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
  const top = cost.top === null || cost.top === undefined ? null : asRecord(cost.top);
  const topShare = top ? asNumber(top.share) : null;
  const faithfulness = asNumber(latest.faithfulness);
  const inUse = asNumber(calib.in_use);
  c.metrics = [
    { label: "最烧钱占比", value: topShare === null ? "—" : `${Math.round(topShare * 100)}%` },
    { label: "评估轮次", value: runs.length },
    { label: "忠实度", value: faithfulness === null ? "—" : faithfulness.toFixed(3) },
    { label: "在用阈值", value: inUse === null ? "—" : inUse.toFixed(2) },
  ];
  if (trend.status === "error") {
    c.note = typeof trend.note === "string" ? trend.note : null;
    return c;
  }
  const blocks: Array<[string, Record<string, unknown>]> = [
    ["意图成本账", cost],
    ["评估趋势", trend],
    ["阈值校准", calib],
  ];
  const missing = blocks.filter(([, b]) => asRecord(b).status !== "ok").map(([name]) => name);
  if (missing.length === 3) {
    c.status = "missing";
    c.headline = "三块都还没跑过,进去按一次就有数";
  } else if (missing.length > 0) {
    c.status = "attention";
    c.headline = `缺 ${missing.join("、")}`;
  } else if (calib.in_sync !== true) {
    c.status = "attention";
    c.headline = `推荐阈值 ${String(asRecord(calib.recommended).threshold)} 与在用 ${String(inUse)} 不一致,该回填`;
  } else {
    c.status = "ok";
    const intent = top ? asText(top.intent) ?? "" : "";
    c.headline = (intent ? `${intent}最烧钱,` : "") + "最近一轮忠实度 " + (faithfulness === null ? "—" : faithfulness.toFixed(3));
  }
  c.note = c.note ?? "报表都是离线作业落的产物,页面只读不重算";
  return c;
}

async function topicsCard(): Promise<Card> {
  const c = card("topics", "主题分布", "/topics", "低置信度问题 → 分类器旁路归类 → 哪类堆得多,先补哪块知识");
  let dist: repository.TopicDistribution;
  try {
    dist = await repository.topicDistribution();
  } catch (error) {
    c.note = errText(error);
    return c;
  }
  const hit = dist.classes.filter((x) => x.count > 0).length;
  const top = [...dist.classes].filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  c.metrics = [
    { label: "已归类问题", value: dist.total },
    { label: "命中类目", value: `${hit}/${dist.classes.length}` },
  ];
  if (dist.total === 0) {
    c.status = "missing";
    c.headline = "还没归类过,去分类器验收页跑一次旁路批量归类";
  } else {
    c.status = "ok";
    c.headline = "占前三:" + top.map((x) => `${x.label} ${x.count}`).join("、");
  }
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
    ],
  };
}

adminRouter.get("/api/admin/overview", async () => Response.json(await overview()));
adminRouter.get("/api/admin/jobs", (c) => c.json({ jobs: statusAll() }));
