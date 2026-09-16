import { RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/rageval";

import {
  GroupedBarChart,
  RingGauge,
  type BarGroup,
  type BarSeries,
} from "~/components/charts";
import { JobRow } from "~/components/job-row";
import { useToast } from "~/components/toast";
import {
  Btn,
  GateBar,
  MissingBox,
  PageShell,
  Panel,
  Pill,
  SectionHead,
  Stat,
  TableScroll,
  Tbl,
  Td,
  Th,
  Tip,
  Tr,
} from "~/components/ui";
import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtTime } from "~/lib/format";
import { ReadNote } from "~/lib/read-note";
import type { JobSpec } from "~/lib/types";


/* 页面只画 /api/rag-eval/overview 端出来的那份产物:一个数都不在前端重算。
   重跑按钮走共用的 /api/jobs 运行器(作业名 eval-rag),跑完回调重新取数。 */

const STRAT: BarSeries[] = [
  { key: "vector", label: "纯向量", color: "var(--sky)" },
  { key: "bm25", label: "纯 BM25", color: "var(--online)" },
  { key: "hybrid", label: "混合", color: "#ff8095" },
  { key: "hybrid_rerank", label: "混合 + 重排", color: "var(--fur)" },
];

const BUCKETS: BarGroup[] = [
  { key: "A_policy", label: "政策类", sub: "A_policy" },
  { key: "B_model", label: "型号类", sub: "B_model" },
  { key: "C_colloquial", label: "口语类", sub: "C_colloquial" },
  { key: "E_multi", label: "跨文档类", sub: "E_multi" },
  { key: "overall", label: "总体", sub: "overall", agg: true },
];

const METRICS = ["MRR", "Recall@5", "证据覆盖度"] as const;

/* ---------- 产物形状 ---------- */

interface RefusalCase {
  id: string;
  query: string;
  section_path?: string | null;
  evidence?: string | null;
}

interface FaithCaseInline {
  id: string;
  query: string;
  bucket: string;
  reason?: string | null;
  answer?: string | null;
}

interface Generation {
  answer_coverage?: Record<string, Record<string, number | null>>;
  faithfulness?: Record<string, { v: number | null; answered: number }>;
  faithfulness_cases?: FaithCaseInline[];
  refusal: {
    rate: number | null;
    correct: number;
    total: number;
    cases?: RefusalCase[];
    skipped_ids?: string[];
  };
  skipped?: number;
}

interface Overview {
  present: boolean;
  hint?: string;
  make?: string;
  meta: {
    n_samples?: number;
    kb_chunks?: number;
    chat_model?: string;
    generated_at?: string;
  };
  retrieval: Record<string, Record<string, { mrr?: number; recall?: number }>>;
  evidence_coverage: Record<string, Record<string, number>>;
  generation: Generation | null;
  generation_done: boolean;
  read_notes: Record<string, string | null>;
  best: { strategy: string; mrr: number | null };
  job: {
    specs: JobSpec[];
    artifacts: {
      json: { path: string; present: boolean; mtime: string | null };
    };
  };
}

interface CitationSnap {
  n: number;
  question?: string;
  answer?: string;
  section_path?: string;
  chunk_id?: number | null;
}

interface LedgerCaseItem {
  id: number;
  eval_id: string;
  bucket: string;
  query: string;
  strategy: string;
  answer: string | null;
  reason: string | null;
  citations: CitationSnap[] | null;
  judge_model: string | null;
  resolution: string | null;
  status: string;
  seen_count: number;
  reopened: boolean;
  last_seen_at: string | null;
}

interface Hallucination {
  evaluated: number | null;
  graded: number | null;
  absent: number | null;
  cases_judged: number;
  cases_confirmed: number;
  pending: number;
  dismissed: number;
  refusal_missed: number;
  judged: number;
  confirmed: number;
  judged_rate: number | null;
  confirmed_rate: number | null;
  ledger: {
    total: number;
    未解决: number;
    已解决: number;
    无需解决: number;
  };
}

interface FaithCasesData {
  items: LedgerCaseItem[];
  total: number;
  page: number;
  size: number;
  pages: number;
  counts: Record<string, number>;
  hallucination: Hallucination;
}

type LoaderData = { ok: true; d: Overview } | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    return { ok: true, d: await api<Overview>("/api/rag-eval/overview") };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · RAG 评估" },
    {
      name: "description",
      content: "四策略对照 · 检索排序 / 证据覆盖 / 端到端答案,一次跑齐",
    },
  ];
}

const fmt2 = (v?: number | null): string =>
  v === null || v === undefined ? "—" : v.toFixed(2);

/* ---------- 取数函数:四种指标各一种口径 ---------- */

function valFn(d: Overview, metric: string) {
  return (s: string, b: string): number | null | undefined => {
    if (metric === "MRR") {
      return d.retrieval[s]?.[b]?.mrr ?? 0;
    }
    if (metric === "Recall@5") {
      return d.retrieval[s]?.[b]?.recall ?? 0;
    }
    if (metric === "证据覆盖度") {
      return d.evidence_coverage[s]?.[b] ?? 0;
    }
    if (metric === "答案覆盖度") {
      // null = 这一桶一条都没评上(上游抖动),按 0 画会被读成真的零分
      return d.generation?.answer_coverage?.[s]?.[b];
    }
    return 0;
  };
}

/* ---------- KPI ---------- */

function KpiBox({ d }: { d: Overview }) {
  const mrr = valFn(d, "MRR");
  const G = d.generation;
  const cB = mrr("bm25", "C_colloquial") ?? 0;
  const cR = mrr("hybrid_rerank", "C_colloquial") ?? 0;
  const bestLabel = STRAT.find((s) => s.key === d.best.strategy)?.label ?? "—";
  const items: { label: string; val: string; sub: string }[] = [
    {
      label: "最佳整体 MRR",
      val: fmt2(d.best.mrr),
      sub: bestLabel + " · 四策略最高",
    },
    {
      label: "口语桶 MRR 提升",
      val: (cR - cB >= 0 ? "+" : "") + (cR - cB).toFixed(2),
      sub: "纯 BM25 " + fmt2(cB) + " → 混合 + 重排 " + fmt2(cR),
    },
    G
      ? {
          label: "答案覆盖度(重排)",
          val: fmt2(valFn(d, "答案覆盖度")("hybrid_rerank", "overall")),
          sub:
            "纯 BM25 只有 " + fmt2(valFn(d, "答案覆盖度")("bm25", "overall")),
        }
      : {
          label: "端到端答案覆盖度",
          val: "—",
          sub: "本次生成段未完成",
        },
    G?.refusal.rate != null
      ? {
          label: "库外问题拒答",
          val: String(Math.round(G.refusal.rate * 100)) + "%",
          sub:
            String(G.refusal.correct) +
            " / " +
            String(G.refusal.total) +
            " 正确拒答并落池",
        }
      : G
        ? {
            label: "库外问题拒答",
            val: "—",
            sub: "本轮一条都没评上(上游不稳)",
          }
        : {
            label: "库外问题拒答",
            val: "—",
            sub: "本次生成段未完成",
          },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((k) => (
        <div
          key={k.label}
          className="border-3 border-ink bg-paper px-3 pt-2.5 pb-3 shadow-hard-sm"
        >
          <div className="text-[11.5px] text-muted">{k.label}</div>
          <div className="text-2xl leading-snug font-bold tabular-nums">
            {k.val}
          </div>
          <div className="text-[11.5px] leading-6 text-ink-soft">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- 01 检索质量 ---------- */

function RetrievalPanel({ d }: { d: Overview }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]>("MRR");
  const READ: Record<string, () => string> = {
    MRR: () =>
      "型号桶里纯向量只有 " +
      fmt2(valFn(d, "MRR")("vector", "B_model")) +
      ",易混型号族认错了型号。口语桶里纯 BM25 只有 " +
      fmt2(valFn(d, "MRR")("bm25", "C_colloquial")) +
      ",关键词对不齐。两块短板都补上之后,总体 " +
      (STRAT.find((s) => s.key === d.best.strategy)?.label ?? "—") +
      " " +
      fmt2(d.best.mrr) +
      " 居首。",
    "Recall@5": () =>
      "召回率看的是「这题要的证据在前五条里凑齐了几成」。跨文档桶一问要两三块不同小节的知识,纯 BM25 只有 " +
      fmt2(valFn(d, "Recall@5")("bm25", "E_multi")) +
      ",混合 + 重排到 " +
      fmt2(valFn(d, "Recall@5")("hybrid_rerank", "E_multi")) +
      "。",
    证据覆盖度: () =>
      "召回的十条证据里,标准要点有几个在。纯 BM25 在口语桶仅 " +
      fmt2(valFn(d, "证据覆盖度")("bm25", "C_colloquial")) +
      ",答题要用的事实漏了一部分。混合 + 重排四个桶全是满覆盖。",
  };
  // 三张图各对一种小注:产物里有模型写的就用,没有才用 READ 里那句
  const NOTE_KIND: Record<string, string> = {
    MRR: "rag_mrr",
    "Recall@5": "rag_recall",
    证据覆盖度: "rag_coverage",
  };
  return (
    <Panel
      title="检索质量(确定性)"
      pill={<Pill tone="info">不依赖大模型 · 可复现</Pill>}
      lede="MRR 看排得够不够靠前,Recall@5 看这题要的证据在前五条里凑齐了几成。证据覆盖度是另一件事,召回的那十条证据里,标准答案的要点有几个在。三项都是机械算出来的,重跑分数不飘。图上是 A/B/C/E 四个可作答桶,库外该拒答的 D_absent 桶没有标准答案,它的成绩在生成段。"
    >
      <div className="flex flex-wrap items-center gap-3">
        <SectionHead unit="越高越好 · 0–1" className="mt-0">
          {metric}
        </SectionHead>
        <span className="flex-1" />
        <div className="flex border-3 border-ink bg-paper">
          {METRICS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              className={cn(
                "cursor-pointer border-r-3 border-ink px-3 py-1 text-xs font-bold last:border-r-0 hover:bg-fur-hover",
                metric === m && "bg-fur",
              )}
              onClick={() => { setMetric(m); }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2.5 mb-0.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {STRAT.map((s) => (
          <span
            key={s.key}
            className={cn(
              "inline-flex items-center gap-1.5",
              s.key === d.best.strategy && "font-bold",
            )}
          >
            <i
              className="h-3 w-3 border-2 border-ink"
              style={{ background: s.color }}
            />
            {s.label}
            {s.key === d.best.strategy ? "(最佳)" : ""}
          </span>
        ))}
      </div>
      <GroupedBarChart
        groups={BUCKETS}
        series={STRAT}
        getVal={valFn(d, metric)}
        ariaLabel={"检索质量:" + metric}
      />
      <ReadNote
        note={d.read_notes?.[NOTE_KIND[metric] ?? ""]}
        fallback={READ[metric]?.() ?? ""}
      />
    </Panel>
  );
}

/* ---------- 02 生成质量 ---------- */

function RefusalCases({ R }: { R: Generation["refusal"] }) {
  const cases = R.cases ?? [];
  if (!cases.length) {
    return (
      <div className="mt-3 border-3 border-ink bg-online-bg p-2.5 text-[12.5px]">
        ✓ 库外桶评上的 <b className="font-bold">{R.total}</b> 道题
        <b className="font-bold">全部正确拒答</b>,没有「该拒没拒」的个案。
      </div>
    );
  }
  return (
    <details className="group mt-3 border-3 border-ink bg-paper">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 bg-cream px-3 py-2 text-[12.5px] font-bold [&::-webkit-details-marker]:hidden">
        <span className="before:content-['▸'] group-open:before:content-['▾']" />
        该拒没拒的个案
        <Pill tone="sev-中">{cases.length} 例</Pill>
        <span className="font-normal text-muted">
          点开看是哪一条 / 被什么证据骗过了闸
        </span>
      </summary>
      <div className="px-3 pt-1 pb-3">
        <p className="my-2 text-xs leading-7 text-ink-soft">
          这些是库外该拒答、但两道证据闸都放行了的问题。要看的是它把哪一节当成了答案,
          据此收紧阈值或者补一条明确的「不支持」知识。
        </p>
        {cases.map((c) => (
          <div
            key={c.id}
            className="mt-2.5 border-2 border-ink bg-cream p-2.5"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="border-2 border-ink bg-fur px-1 text-[11px]">
                {c.id}
              </span>
              <span className="text-[13px] font-bold">{c.query}</span>
              <span className="text-[11px] text-muted">库外桶</span>
            </div>
            <div className="mt-1.5 text-[12.5px] leading-7">
              <span className="block text-[10.5px] text-muted">
                被当成答案的小节
              </span>
              {c.section_path ?? "—"}
            </div>
            <div className="mt-1.5 text-[12.5px] leading-7">
              <span className="block text-[10.5px] text-muted">
                那条证据(原文)
              </span>
              <div className="mt-0.5 border-2 border-ink bg-paper p-2 whitespace-pre-wrap">
                {c.evidence ?? ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function GenerationPanel({ d }: { d: Overview }) {
  const G = d.generation;
  if (!d.generation_done || !G) {
    return (
      <Panel
        title="生成质量(端到端)"
        pill={<Pill tone="missing">本次未完成</Pill>}
        lede="四策略各自把召回的证据交给同一个模型,答案生成出来,再由裁判数一数覆盖了几个标准要点。检索越好、答案越全,这一段就是它的端到端证据。下面还有上线管线的忠实度,以及库外问题该拒有没有拒。"
      >
        <MissingBox>
          生成段没跑完,裁判模型上游不可用,这一段的数缺着。
          上游恢复后按一次「重跑 RAG 评估」就补齐,检索段的分不受影响。
        </MissingBox>
      </Panel>
    );
  }
  const ac = valFn(d, "答案覆盖度");
  const acR = ac("hybrid_rerank", "overall");
  const acB = ac("bm25", "overall");
  return (
    <Panel
      title="生成质量(端到端)"
      pill={<Pill tone="info">LLM 裁判判分</Pill>}
      lede="四策略各自把召回的证据交给同一个模型,答案生成出来,再由裁判数一数覆盖了几个标准要点。检索越好、答案越全,这一段就是它的端到端证据。下面还有上线管线的忠实度,以及库外问题该拒有没有拒。"
    >
      <SectionHead
        unit="生成答案盖住标准要点的比例 · LLM 判分"
        className="mt-0"
      >
        四策略答案覆盖度
      </SectionHead>
      <GroupedBarChart
        groups={BUCKETS}
        series={STRAT}
        getVal={ac}
        ariaLabel="四策略答案覆盖度"
      />
      <ReadNote
        note={d.read_notes?.rag_answer_coverage}
        fallback={
          <>
            同一套生成提示词,只换检索策略:混合 + 重排的答案覆盖度总体{" "}
            <b>{fmt2(acR)}</b>,纯 BM25 只有 <b>{fmt2(acB)}</b>
            。检索差,证据就缺,答案跟着漏要点。
          </>
        }
      />

      <div className="mt-3.5 grid gap-3.5 md:grid-cols-[1.45fr_1fr]">
        <div>
          <SectionHead unit="混合 + 重排 · 答案有没有编造" className="mt-0">
            忠实度 Faithfulness
          </SectionHead>
          <div className="mt-2 flex flex-col gap-3">
            {/* 桶跟着上面的 BUCKETS 走,别在这儿再抄一份:漏的那桶恰恰是最难的那桶 */}
            {BUCKETS.filter((x) => !x.agg).map((b) => {
              const f = G.faithfulness?.[b.key] ?? {
                v: null,
                answered: 0,
              };
              const has = f.v !== null && f.v !== undefined; // 没评上 ≠ 0 分
              const v = has ? (f.v ?? 0) : 0;
              return (
                <div key={b.key}>
                  <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                    <div>
                      <b className="font-bold">{b.label}</b>
                      <span className="ml-1.5 text-[11px] text-muted">
                        {b.key} · 评 {f.answered} 题
                      </span>
                    </div>
                    <div className="font-bold tabular-nums">
                      {has ? v.toFixed(2) : "—"}
                    </div>
                  </div>
                  <div className="mt-1 h-3.5 border-2 border-ink bg-cream">
                    <span
                      className={cn(
                        "block h-full",
                        v >= 0.9
                          ? "bg-online"
                          : v >= 0.7
                            ? "bg-fur"
                            : "bg-error",
                        !has && "opacity-25",
                      )}
                      style={{ width: `${Math.max(2, Math.round(v * 100))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <RingGauge
          rate={G.refusal.rate ?? 0}
          caption={
            <>
              <b>D_absent 桶</b> · 库外问题
              <br />
              {G.refusal.correct} / {G.refusal.total} 正确拒答并落池
            </>
          }
        />
      </div>
      <RefusalCases R={G.refusal} />
      {G.skipped ? (
        <div className="mt-3 border-3 border-ink bg-paper p-2.5 text-xs leading-7 text-ink-soft">
          注:本轮有 {G.skipped}{" "}
          次裁判调用超时或失败被跳过(上游不稳),已按可用样本计。
          {(G.refusal.skipped_ids ?? []).length
            ? "库外桶里没评上的是 " +
              (G.refusal.skipped_ids ?? []).join("、") +
              "。"
            : ""}
        </div>
      ) : null}
    </Panel>
  );
}

/* ---------- 03 完整数据 + 本轮编造个案 ---------- */

function FaithCasesInline({ cases }: { cases: FaithCaseInline[] }) {
  if (!cases.length) {
    return (
      <div className="mt-3 border-3 border-ink bg-online-bg p-2.5 text-[12.5px]">
        ✓ 本轮上线管线的生成答案
        <b className="font-bold">没有被判「编造」的个案</b>
        ,每句事实性说法都能在检索证据里找到依据。
      </div>
    );
  }
  // 桶名跟着上面 BUCKETS 走,别再手抄一份
  const BMAP = Object.fromEntries(
    BUCKETS.map((b) => [b.key, b.label.replace("类", "")]),
  );
  return (
    <details className="group mt-3 border-3 border-ink bg-paper">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 bg-cream px-3 py-2 text-[12.5px] font-bold [&::-webkit-details-marker]:hidden">
        <span className="before:content-['▸'] group-open:before:content-['▾']" />
        编造个案
        <Pill tone="sev-中">{cases.length} 例</Pill>
        <span className="font-normal text-muted">
          点开看问题 / 生成答案 / 裁判理由
        </span>
      </summary>
      <div className="px-3 pt-1 pb-3">
        <p className="my-2 text-xs leading-7 text-ink-soft">
          下面这些是上线管线的生成答案里,被忠实度裁判判为「有检索证据没支撑的内容」的个案。
          要看的是编在哪一句,据此回补知识库或者改判据。
        </p>
        {cases.map((c) => (
          <div
            key={c.id}
            className="mt-2.5 border-2 border-ink bg-cream p-2.5"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="border-2 border-ink bg-fur px-1 text-[11px]">
                {c.id}
              </span>
              <span className="text-[13px] font-bold">{c.query}</span>
              <span className="text-[11px] text-muted">
                {(BMAP[c.bucket] ?? c.bucket) + "桶"}
              </span>
            </div>
            <div className="mt-1.5 text-[12.5px] leading-7">
              <span className="block text-[10.5px] text-muted">裁判理由</span>
              {c.reason ?? "—"}
            </div>
            <div className="mt-1.5 text-[12.5px] leading-7">
              <span className="block text-[10.5px] text-muted">
                生成答案(原文)
              </span>
              <div className="mt-0.5 border-2 border-ink bg-paper p-2 whitespace-pre-wrap">
                {c.answer ?? ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function TablePanel({ d }: { d: Overview }) {
  const G = d.generation;
  const mrr = valFn(d, "MRR");
  const cov = valFn(d, "证据覆盖度");
  const ac = valFn(d, "答案覆盖度");
  return (
    <Panel
      title="完整数据"
      lede="左半是分桶 MRR,右半是总体的证据覆盖度与答案覆盖度。带底色那一行就是总体 MRR 最佳的策略。"
    >
      <TableScroll>
        <Tbl>
          <thead>
            <tr>
              <Th>策略</Th>
              <Th>政策 MRR</Th>
              <Th>型号 MRR</Th>
              <Th>口语 MRR</Th>
              <Th>跨文档 MRR</Th>
              <Th>总体 MRR</Th>
              <Th>证据覆盖</Th>
              <Th>答案覆盖</Th>
            </tr>
          </thead>
          <tbody>
            {STRAT.map((s) => (
              <Tr
                key={s.key}
                className={
                  s.key === d.best.strategy ? "bg-picked" : undefined
                }
              >
                <Td className="whitespace-nowrap">
                  <i
                    className="mr-1.5 inline-block h-2.5 w-2.5 border-2 border-ink align-baseline"
                    style={{ background: s.color }}
                  />
                  {s.label}
                </Td>
                {[
                  "A_policy",
                  "B_model",
                  "C_colloquial",
                  "E_multi",
                  "overall",
                ].map((b) => (
                  <Td key={b} num>
                    {(mrr(s.key, b) ?? 0).toFixed(2)}
                  </Td>
                ))}
                <Td num className="border-l-3">
                  {(cov(s.key, "overall") ?? 0).toFixed(2)}
                </Td>
                <Td
                  num
                  className={d.generation_done ? undefined : "text-muted"}
                >
                  {d.generation_done
                    ? (ac(s.key, "overall") ?? 0).toFixed(2)
                    : "—"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Tbl>
      </TableScroll>
      <Tip>
        <b>D_absent</b> 库外问题(该拒答)没有标准答案,不参与上表。
        {G
          ? "它走上线管线,只评「该拒有没有拒」:" +
            String(G.refusal.correct) +
            " / " +
            String(G.refusal.total) +
            " = " +
            String(Math.round((G.refusal.rate ?? 0) * 100)) +
            "% 正确拒答。"
          : "它走上线管线,拒答率要等生成段跑完才有。"}
      </Tip>
      {G ? <FaithCasesInline cases={G.faithfulness_cases ?? []} /> : null}
    </Panel>
  );
}

/* ---------- 03.5 编造个案台账 ---------- */

const ST_CLS: Record<string, string> = {
  未解决: "bg-error-bg",
  已解决: "bg-online-bg",
  无需解决: "bg-paper text-muted",
};

/** 幻觉率两个口径:裁判判出率(线索量,含判严的)与确认幻觉率(人工过目并改掉的才算) */
function HallucBox({ h }: { h: Hallucination }) {
  const pct = (v: number | null) =>
    v === null || v === undefined ? "—" : (v * 100).toFixed(1);
  // 两类幻觉都算:可作答题「答了但编了」+ 库外题「该拒没拒」(无据而答)
  const split = (cases: number) => (
    <>
      编造 <b>{cases}</b> 条 + 该拒没拒 <b>{h.refusal_missed}</b> 条
    </>
  );
  const lg = h.ledger;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="border-3 border-ink bg-cream p-2.5 shadow-hard-sm">
        <div className="text-[11.5px] text-muted">
          本轮确认幻觉率(人工过目后算的真账)
        </div>
        <div className="text-2xl leading-snug font-bold tabular-nums">
          {pct(h.confirmed_rate)}
          <small className="ml-0.5 text-[13px] font-normal text-muted">%</small>
        </div>
        <div className="text-[11.5px] leading-6 text-ink-soft [&_b]:font-bold">
          <b>{h.confirmed}</b> / {h.evaluated ?? "—"} 道评上的题(
          {split(h.cases_confirmed)}
          )。编造那部分只算点成「已解决」的——确认真编了并且改掉了;
          {h.pending ? (
            <>
              本轮还有 <b>{h.pending}</b> 条没过目,所以这是下界、会往上走。
            </>
          ) : (
            "本轮判出的都过目了,这一轮的账已经结清。"
          )}
          该拒没拒不用人工确认,库外题答了就是无据而答。
        </div>
      </div>
      <div className="border-3 border-ink bg-paper p-2.5">
        <div className="text-[11.5px] text-muted">
          本轮裁判判出率(线索量,别当结论)
        </div>
        <div className="text-2xl leading-snug font-bold tabular-nums">
          {pct(h.judged_rate)}
          <small className="ml-0.5 text-[13px] font-normal text-muted">%</small>
        </div>
        <div className="text-[11.5px] leading-6 text-ink-soft [&_b]:font-bold">
          <b>{h.judged}</b> / {h.evaluated ?? "—"} 道({split(h.cases_judged)}
          )。编造那部分里有 <b>{h.dismissed}</b>{" "}
          条人工看过是判严了(标成「无需解决」)。分母 = 可作答{" "}
          {h.graded ?? "—"} 道 + 库外 {h.absent ?? "—"} 道。台账累计{" "}
          <b>{lg.total ?? "—"}</b> 条(未解决 {lg["未解决"] ?? "—"} · 已解决{" "}
          {lg["已解决"] ?? "—"} · 无需解决 {lg["无需解决"] ?? "—"}
          ),那是跨轮的管理视图,不要拿它除以一轮的题量。
        </div>
      </div>
    </div>
  );
}

function LedgerCaseCard({
  c,
  onChanged,
}: {
  c: LedgerCaseItem;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);

  const post = async (st: string, resolution: string | null) => {
    setPosting(true);
    try {
      await api(
        "/api/rag-eval/faith-cases/" + String(c.id) + "/status",
        jsonPost({ status: st, resolution }),
      );
      toast(c.eval_id + " → " + st);
      onChanged();
    } catch (e) {
      toast("改状态失败:" + errMsg(e), true);
      onChanged();
    } finally {
      setPosting(false);
    }
  };

  const submitNote = () => {
    if (!note.trim()) {
      toast("请先写一句处置说明", true);
      return;
    }
    void post(noteFor ?? "", note.trim());
    setNoteFor(null);
  };

  // 这份列表是**喂给模型的 Top-K 证据全集**,不是「答案引用过的」——答案通常只引其中两三条。
  // 两者要分开说:看编造,既要看它引了什么,也要看它手里其实有什么却没用
  const n = (c.citations ?? []).length;
  const used = [...new Set((c.answer ?? "").match(/\[(\d+)\]/g) ?? [])]
    .map((x) => Number.parseInt(x.slice(1, -1), 10))
    .filter((x) => x >= 1 && x <= n)
    .sort((a, b) => a - b);

  const actBtn =
    "press-sm cursor-pointer border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px] shadow-hard-xs hover:bg-fur disabled:cursor-default disabled:opacity-40 disabled:shadow-none";

  return (
    <div className="mt-2.5 border-2 border-ink bg-cream p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="border-2 border-ink bg-fur px-1 text-[11px]">
          {c.eval_id}
        </span>
        <span className="flex-1 text-[13px] font-bold">{c.query}</span>
        {c.reopened ? (
          <span className="border-2 border-ink bg-fur px-1.5 text-[11px] font-bold">
            复发
          </span>
        ) : null}
        <span
          className={cn(
            "border-2 border-ink bg-paper px-1.5 text-[11px] whitespace-nowrap",
            ST_CLS[c.status] ?? "",
          )}
        >
          {c.status}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-muted">
        {(BUCKETS.find((x) => x.key === c.bucket)?.label ?? c.bucket) +
          " · " +
          (STRAT.find((x) => x.key === c.strategy)?.label ?? c.strategy) +
          " · 被判 " +
          String(c.seen_count) +
          " 次 · 最近 " +
          fmtTime(c.last_seen_at) +
          (c.judge_model ? " · 裁判 " + c.judge_model : "")}
      </div>
      <div className="mt-1.5 text-[12.5px] leading-7">
        <span className="block text-[10.5px] text-muted">裁判理由</span>
        {c.reason ?? "—"}
      </div>
      {/* 处置说明:标了已解决/无需解决就得有交代(最该被回头看的两行放一起) */}
      {c.resolution ? (
        <div className="mt-1.5 text-[12.5px] leading-7">
          <span className="block text-[10.5px] text-muted">
            {c.status === "已解决" ? "怎么解决的" : "为什么不用改"}
          </span>
          {c.resolution}
        </div>
      ) : null}
      <div className="mt-1.5 text-[12.5px] leading-7">
        <span className="block text-[10.5px] text-muted">生成答案(原文)</span>
        <div className="mt-0.5 border-2 border-ink bg-paper p-2 whitespace-pre-wrap">
          {c.answer ?? ""}
        </div>
      </div>

      <details className="mt-2 border-2 border-ink bg-paper">
        <summary className="cursor-pointer bg-cream px-2.5 py-1.5 text-[11.5px] text-ink-soft [&::-webkit-details-marker]:hidden">
          {n
            ? "证据原文 " +
              String(n) +
              " 条(这一轮喂给模型的全部证据)" +
              (used.length
                ? " · 答案引用了其中 " +
                  String(used.length) +
                  " 条:" +
                  used.map((x) => "[" + String(x) + "]").join("")
                : " · 答案一条都没引")
            : "证据原文 —— 这条个案入台账时还没记快照"}
        </summary>
        {(c.citations ?? []).map((x) => {
          const isUsed = used.includes(x.n);
          return (
            <div
              key={x.n}
              className={cn(
                "border-t-2 border-ink px-2.5 py-2 text-[12.5px] leading-7",
                isUsed && "bg-paper",
              )}
            >
              <div>
                <span
                  className={cn(
                    "mr-1.5 border-2 border-ink px-1 font-bold",
                    isUsed ? "bg-fur" : "bg-paper text-muted",
                  )}
                >
                  [{x.n}]
                </span>
                {x.question ?? ""}
                {isUsed ? (
                  <span className="ml-1.5 border-2 border-ink bg-fur px-1 text-[10.5px]">
                    答案引用
                  </span>
                ) : null}
              </div>
              <div className="mt-1 whitespace-pre-wrap">{x.answer ?? ""}</div>
              <div className="mt-0.5 text-[10.5px] text-muted">
                {(x.section_path ?? "") +
                  (x.chunk_id ? " · chunk id " + String(x.chunk_id) : "")}
              </div>
            </div>
          );
        })}
      </details>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={c.status === "已解决" || posting}
          className={actBtn}
          onClick={() => {
            setNote("");
            setNoteFor("已解决");
          }}
        >
          已解决
        </button>
        <button
          type="button"
          disabled={c.status === "无需解决" || posting}
          className={actBtn}
          onClick={() => {
            setNote("");
            setNoteFor("无需解决");
          }}
        >
          无需解决
        </button>
        {c.status !== "未解决" ? (
          <button
            type="button"
            disabled={posting}
            className={actBtn}
            onClick={() => {
              // 退回不需要说明(会连说明一起清空)
              void post("未解决", null);
            }}
          >
            退回未解决
          </button>
        ) : null}
      </div>
      {/* 处置要留交代:先在卡片里展开一行输入,空的不让提交(后端也会挡,这里只是别让人白跑一趟) */}
      <AnimatePresence>
        {noteFor ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                maxLength={300}
                autoFocus
                className="min-w-65 flex-1 border-2 border-ink bg-paper px-2 py-1 text-[12.5px] outline-none"
                placeholder={
                  noteFor === "已解决"
                    ? "怎么解决的?比如:库里补了「Lite 废砂盒容量约 5 天」"
                    : "为什么不用改?比如:处理时限就是我们的到账时限,裁判判严了"
                }
                value={note}
                onChange={(e) => { setNote(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    submitNote();
                  }
                }}
              />
              <button
                type="button"
                className="press-sm cursor-pointer border-2 border-ink bg-fur px-2.5 py-1 text-[11.5px] shadow-hard-xs"
                onClick={submitNote}
              >
                确定标为「{noteFor}」
              </button>
              <button
                type="button"
                className="cursor-pointer border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px]"
                onClick={() => { setNoteFor(null); }}
              >
                取消
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function LedgerPanel() {
  const [status, setStatus] = useState("未解决");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FaithCasesData | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), size: "5" });
      if (status) {
        qs.set("status", status);
      }
      setData(
        await api<FaithCasesData>("/api/rag-eval/faith-cases?" + qs.toString()),
      );
      setErr("");
    } catch (e) {
      setErr(errMsg(e));
    }
  }, [status, page]);

  // 页签/翻页变化即取数:台账是跨轮管理视图,不进路由 loader(状态多、频次高)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步取数,setState 发生在 await 之后
    void load();
  }, [load]);

  const h = data?.hallucination;
  const counts = data?.counts ?? {};
  const all =
    (counts["未解决"] ?? 0) +
    (counts["已解决"] ?? 0) +
    (counts["无需解决"] ?? 0);

  return (
    <Panel
      title="编造个案台账"
      pill={<Pill tone="info">跨轮累计 · 可处置</Pill>}
      lede="上面那一栏只有这一轮的个案,报告重跑一次就被覆盖。台账把历轮判出的个案按题号存下来:同一道题再被判编造只更新这一条并累加次数,已处置过又冒出来会退回「未解决」并标「复发」——那说明上次没改对。每条都带当时答案里角标 [n] 对应的证据原文,追溯时点开就能看到喂进去的是什么。"
    >
      {err ? (
        <div className="border-3 border-ink bg-error-bg p-2.5 text-[12.5px]">
          台账取数失败:{err}(这张表要先应用 sql/rag-faith-ddl.sql)
        </div>
      ) : null}
      {h ? <HallucBox h={h} /> : null}
      {data ? (
        <>
          <div className="mt-3 mb-0.5 flex flex-wrap items-center gap-2">
            {[
              { label: "未解决", st: "未解决", cnt: counts["未解决"] ?? 0 },
              { label: "已解决", st: "已解决", cnt: counts["已解决"] ?? 0 },
              {
                label: "无需解决",
                st: "无需解决",
                cnt: counts["无需解决"] ?? 0,
              },
              { label: "全部", st: "", cnt: all },
            ].map(({ label, st, cnt }) => (
              <button
                key={label}
                type="button"
                className={cn(
                  "cursor-pointer border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px] hover:bg-fur-hover",
                  status === st && "bg-fur font-bold",
                )}
                onClick={() => {
                  setStatus(st);
                  setPage(1);
                }}
              >
                {label}({cnt})
              </button>
            ))}
          </div>
          {data.items.length ? (
            data.items.map((c) => (
              <LedgerCaseCard
                key={c.id}
                c={c}
                onChanged={() => {
                  void load();
                }}
              />
            ))
          ) : (
            <div className="mt-3 border-3 border-ink bg-online-bg p-2.5 text-[12.5px]">
              {all
                ? "这个状态下暂时没有个案。"
                : "台账还是空的——跑一轮 make eval-rag,判出的编造个案会自动写进来。"}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[11.5px] text-ink-soft">
            <button
              type="button"
              disabled={data.page <= 1}
              className="press-sm cursor-pointer border-2 border-ink bg-paper px-2.5 py-1 shadow-hard-xs hover:bg-fur disabled:cursor-default disabled:opacity-40 disabled:shadow-none"
              onClick={() => { setPage((p) => p - 1); }}
            >
              ← 上一页
            </button>
            <button
              type="button"
              disabled={data.page >= data.pages}
              className="press-sm cursor-pointer border-2 border-ink bg-paper px-2.5 py-1 shadow-hard-xs hover:bg-fur disabled:cursor-default disabled:opacity-40 disabled:shadow-none"
              onClick={() => { setPage((p) => p + 1); }}
            >
              下一页 →
            </button>
            <span>
              第 {data.page} / {data.pages} 页 · 共 {data.total} 条
            </span>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

/* ---------- 04 怎么读这份报告 ---------- */

const NOTES: [string, string][] = [
  [
    "三类查询,三种偏科",
    "型号桶特意放了易混型号族(几款饮水机、猫砂盆),纯向量会认错型号;口语桶换了说法,纯 BM25 关键词对不齐。混合 + 重排同时补上这两块短板。",
  ],
  [
    "融合 ≠ 重排",
    "纯 RRF 融合在口语桶反被弱侧的 BM25 拖累。重排把正确答案顶回前面,总体 MRR 才登顶,这就是「要重排」的直接证据。",
  ],
  [
    "确定性 vs LLM 裁判",
    "检索段与证据覆盖度不依赖大模型,重跑可复现。答案覆盖度与忠实度由裁判判定,有轻微浮动。生成段带超时与失败跳过,单点故障不拖垮整轮。",
  ],
  [
    "两道生成前证据闸",
    "机械低分闸与语义自评闸都在生成之前把关。证据不足就拒答,问题落进 low_confidence_questions,库外的题应当全部拒答。",
  ],
];

/* ---------- 页面 ---------- */

export default function RagEvalPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();

  const jobPanel = (d: Overview) => (
    <Panel
      title="就地重跑"
      pill={<Pill tone="missing">分钟级</Pill>}
      tight
      lede="这个按钮按下去,跑的就是终端那条 make eval-rag,四策略各一轮检索,证据再交给裁判判分。跑完这一页的数就换成新报告,页面读的是产物,自己不算。"
    >
      <JobRow
        specs={d.job.specs}
        onFinish={() => { void revalidate(); }}
        note={
          "产物 " +
          d.job.artifacts.json.path +
          (d.job.artifacts.json.mtime
            ? "(写于 " + fmtTime(d.job.artifacts.json.mtime) + ")"
            : "(还没有)")
        }
      />
    </Panel>
  );

  if (!loaderData.ok) {
    return (
      <PageShell title="RAG 评估" active="/rag-eval">
        <MissingBox className="mt-4">取数失败:{loaderData.error}</MissingBox>
      </PageShell>
    );
  }
  const d = loaderData.d;

  if (!d.present) {
    return (
      <PageShell
        title="RAG 评估"
        sub="四策略对照 · 检索排序 / 证据覆盖 / 端到端答案,一次跑齐"
        active="/rag-eval"
      >
        <MissingBox className="mt-4">{d.hint}</MissingBox>
        {jobPanel(d)}
      </PageShell>
    );
  }

  const m = d.meta;
  return (
    <PageShell
      title="RAG 评估"
      sub="四策略对照 · 检索排序 / 证据覆盖 / 端到端答案,一次跑齐"
      active="/rag-eval"
      actions={
        <Btn onClick={() => { void revalidate(); }} disabled={state === "loading"}>
          <RefreshCw
            className={
              state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"
            }
            aria-hidden
          />
          刷新
        </Btn>
      }
    >
      <GateBar>
        <Stat label="评估集" value={String(m.n_samples ?? "—") + " 题"} />
        <Stat label="知识库" value={String(m.kb_chunks ?? "—") + " 块"} />
        <Stat label="嵌入 / 重排" value="bge-m3 · reranker-v2-m3" small />
        <Stat label="裁判模型" value={m.chat_model ?? "—"} small />
        <Stat label="上次跑于" value={m.generated_at ?? "—"} small />
      </GateBar>
      <KpiBox d={d} />
      <RetrievalPanel d={d} />
      <GenerationPanel d={d} />
      <TablePanel d={d} />
      <LedgerPanel />
      {jobPanel(d)}
      <Panel title="怎么读这份报告" lede="四条口径,免得把分数读反。">
        <div className="grid gap-3 md:grid-cols-2">
          {NOTES.map(([t, body]) => (
            <div key={t} className="border-3 border-ink bg-paper p-3">
              <h3 className="mb-1 text-[12.5px] font-bold">{t}</h3>
              <p className="text-xs leading-7 text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </Panel>
    </PageShell>
  );
}
