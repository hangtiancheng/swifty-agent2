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
import { EASE_DECEL } from "~/lib/motion";
import { ReadNote } from "~/lib/read-note";
import type { JobSpec } from "~/lib/types";

/* This page only renders the artifact served by /api/rag-eval/overview — not a single
   number is recomputed on the client. The re-run button goes through the shared
   /api/jobs runner (job name eval-rag) and revalidates once it finishes. */

const STRAT: BarSeries[] = [
  { key: "vector", label: "Vector", color: "var(--chart-1)" },
  { key: "bm25", label: "BM25", color: "var(--chart-4)" },
  { key: "hybrid", label: "Hybrid", color: "var(--chart-8)" },
  { key: "hybrid_rerank", label: "Hybrid + Rerank", color: "var(--chart-5)" },
];

const BUCKETS: BarGroup[] = [
  { key: "A_policy", label: "Policy", sub: "A_policy" },
  { key: "B_model", label: "Model", sub: "B_model" },
  { key: "C_colloquial", label: "Colloquial", sub: "C_colloquial" },
  { key: "E_multi", label: "Multi-doc", sub: "E_multi" },
  { key: "overall", label: "Overall", sub: "overall", agg: true },
];

const METRICS = ["MRR", "Recall@5", "Evidence Coverage"] as const;

/* ---------- Artifact shape ---------- */

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
    unresolved: number;
    resolved: number;
    dismissed: number;
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
    { title: "MeowMeow Select · RAG Eval" },
    {
      name: "description",
      content:
        "Four strategies side by side · retrieval ranking / evidence coverage / end-to-end answers in one run",
    },
  ];
}

const fmt2 = (v?: number | null): string =>
  v === null || v === undefined ? "—" : v.toFixed(2);

/* ---------- Value getters: one accessor per metric ---------- */

function valFn(d: Overview, metric: string) {
  return (s: string, b: string): number | null | undefined => {
    if (metric === "MRR") {
      return d.retrieval[s]?.[b]?.mrr ?? 0;
    }
    if (metric === "Recall@5") {
      return d.retrieval[s]?.[b]?.recall ?? 0;
    }
    if (metric === "Evidence Coverage") {
      return d.evidence_coverage[s]?.[b] ?? 0;
    }
    if (metric === "Answer Coverage") {
      // null = no case in this bucket got evaluated (upstream flakiness); drawing 0 would read as a real zero score
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
      label: "Best overall MRR",
      val: fmt2(d.best.mrr),
      sub: bestLabel + " · highest of the four strategies",
    },
    {
      label: "Colloquial bucket MRR lift",
      val: (cR - cB >= 0 ? "+" : "") + (cR - cB).toFixed(2),
      sub: "BM25 " + fmt2(cB) + " → Hybrid + Rerank " + fmt2(cR),
    },
    G
      ? {
          label: "Answer coverage (rerank)",
          val: fmt2(valFn(d, "Answer Coverage")("hybrid_rerank", "overall")),
          sub:
            "BM25 alone only reaches " +
            fmt2(valFn(d, "Answer Coverage")("bm25", "overall")),
        }
      : {
          label: "End-to-end answer coverage",
          val: "—",
          sub: "Generation stage incomplete for this run",
        },
    G?.refusal.rate != null
      ? {
          label: "Out-of-KB refusals",
          val: String(Math.round(G.refusal.rate * 100)) + "%",
          sub:
            String(G.refusal.correct) +
            " / " +
            String(G.refusal.total) +
            " correct refusals, logged to the low-confidence pool",
        }
      : G
        ? {
            label: "Out-of-KB refusals",
            val: "—",
            sub: "No cases evaluated this round (upstream instability)",
          }
        : {
            label: "Out-of-KB refusals",
            val: "—",
            sub: "Generation stage incomplete for this run",
          },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((k) => (
        <div
          key={k.label}
          className="bg-card shadow-e1 rounded-lg px-3.5 pt-3 pb-3.5"
        >
          <div className="text-on-surface-variant text-[11.5px]">{k.label}</div>
          <div className="text-2xl leading-snug font-medium tabular-nums">
            {k.val}
          </div>
          <div className="text-on-surface-variant text-[11.5px] leading-6">
            {k.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- 01 Retrieval quality ---------- */

function RetrievalPanel({ d }: { d: Overview }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]>("MRR");
  const READ: Record<string, () => string> = {
    MRR: () =>
      "Vector alone scores just " +
      fmt2(valFn(d, "MRR")("vector", "B_model")) +
      " in the Model bucket — it confuses look-alike model families. BM25 alone scores just " +
      fmt2(valFn(d, "MRR")("bm25", "C_colloquial")) +
      " in the Colloquial bucket, where keywords don't line up. With both gaps covered, " +
      (STRAT.find((s) => s.key === d.best.strategy)?.label ?? "—") +
      " leads overall at " +
      fmt2(d.best.mrr) +
      ".",
    "Recall@5": () =>
      "Recall@5 measures how much of the evidence a question needs lands in the top five hits. Multi-doc questions draw on two or three different sections: BM25 alone reaches only " +
      fmt2(valFn(d, "Recall@5")("bm25", "E_multi")) +
      ", while hybrid + rerank gets to " +
      fmt2(valFn(d, "Recall@5")("hybrid_rerank", "E_multi")) +
      ".",
    "Evidence Coverage": () =>
      "Of the ten retrieved chunks, how many gold-answer points are present. BM25 alone covers just " +
      fmt2(valFn(d, "Evidence Coverage")("bm25", "C_colloquial")) +
      " in the Colloquial bucket, leaving out facts the answer needs; hybrid + rerank reaches full coverage in all four buckets.",
  };
  // One read-note per chart: prefer the model-written note from the artifact; fall back to the canned READ copy
  const NOTE_KIND: Record<string, string> = {
    MRR: "rag_mrr",
    "Recall@5": "rag_recall",
    "Evidence Coverage": "rag_coverage",
  };
  return (
    <Panel
      title="Retrieval quality (deterministic)"
      pill={<Pill tone="info">No LLM involved · reproducible</Pill>}
      lede="MRR measures how high the right chunks rank; Recall@5 measures how much of the evidence a question needs lands in the top five hits. Evidence coverage asks a different question: of the ten retrieved chunks, how many gold-answer points are present. All three are computed mechanically, so scores don't drift across re-runs. The charts cover the four answerable buckets A/B/C/E; the out-of-KB bucket D_absent, which should be refused, has no gold answers — its results live in the generation stage."
    >
      <div className="flex flex-wrap items-center gap-3">
        <SectionHead unit="Higher is better · 0–1" className="mt-0">
          {metric}
        </SectionHead>
        <span className="flex-1" />
        <div className="bg-surface-container-high flex items-center gap-1 rounded-full p-1">
          {METRICS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              className={cn(
                "text-label-medium cursor-pointer rounded-full px-3.5 py-1 whitespace-nowrap transition-all duration-200 active:scale-[0.97]",
                metric === m
                  ? "bg-card text-on-surface shadow-e1"
                  : "text-on-surface-variant hover:bg-on-surface/8",
              )}
              onClick={() => {
                setMetric(m);
              }}
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
              s.key === d.best.strategy && "font-medium",
            )}
          >
            <i className="h-3 w-3 rounded-xs" style={{ background: s.color }} />
            {s.label}
            {s.key === d.best.strategy ? " (best)" : ""}
          </span>
        ))}
      </div>
      <GroupedBarChart
        groups={BUCKETS}
        series={STRAT}
        getVal={valFn(d, metric)}
        ariaLabel={"Retrieval quality: " + metric}
      />
      <ReadNote
        note={d.read_notes?.[NOTE_KIND[metric] ?? ""]}
        fallback={READ[metric]?.() ?? ""}
      />
    </Panel>
  );
}

/* ---------- 02 Generation quality ---------- */

function RefusalCases({ R }: { R: Generation["refusal"] }) {
  const cases = R.cases ?? [];
  if (!cases.length) {
    return (
      <div className="bg-success-container text-on-success-container mt-3 rounded-lg p-3 text-[12.5px]">
        ✓ All <b className="font-semibold">{R.total}</b> evaluated out-of-KB
        questions were <b className="font-semibold">correctly refused</b> — no
        should-refuse leaks.
      </div>
    );
  }
  return (
    <details className="group bg-card border-outline-variant shadow-e1 mt-3 rounded-lg border">
      <summary className="text-on-surface flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-[12.5px] font-medium [&::-webkit-details-marker]:hidden">
        <span className="before:content-['▸'] group-open:before:content-['▾']" />
        Should-refuse leaks
        <Pill tone="sev-medium">{cases.length} cases</Pill>
        <span className="text-on-surface-variant font-normal">
          Open to see which questions slipped through, and what evidence fooled
          the gates
        </span>
      </summary>
      <div className="px-3 pt-1 pb-3">
        <p className="text-on-surface-variant my-2 text-xs leading-7">
          These out-of-KB questions should have been refused, but both evidence
          gates waved them through. Check which section got mistaken for an
          answer, then tighten the threshold or add an explicit "not supported"
          knowledge entry.
        </p>
        {cases.map((c) => (
          <div
            key={c.id}
            className="bg-surface-container-low mt-2.5 rounded-lg p-2.5"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="bg-primary-container text-on-primary-container rounded-md px-1.5 py-0.5 text-[11px]">
                {c.id}
              </span>
              <span className="text-[13px] font-medium">{c.query}</span>
              <span className="text-on-surface-variant text-[11px]">
                Out-of-KB bucket
              </span>
            </div>
            <div className="mt-1.5 text-[12.5px] leading-7">
              <span className="text-on-surface-variant block text-[10.5px]">
                Section mistaken for the answer
              </span>
              {c.section_path ?? "—"}
            </div>
            <div className="mt-1.5 text-[12.5px] leading-7">
              <span className="text-on-surface-variant block text-[10.5px]">
                The evidence (verbatim)
              </span>
              <div className="bg-card mt-0.5 rounded-md p-2 whitespace-pre-wrap">
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
        title="Generation quality (end-to-end)"
        pill={<Pill tone="missing">Incomplete this run</Pill>}
        lede="Each strategy feeds its retrieved evidence to the same model, an answer is generated, and an LLM judge counts how many gold-answer points it covers — the end-to-end proof that better retrieval yields fuller answers. Below: faithfulness of the production pipeline, and whether out-of-KB questions were properly refused."
      >
        <MissingBox>
          The generation stage didn't finish — the judge model's upstream was
          unavailable, so these numbers are missing. Once it recovers, press
          "Re-run RAG evaluation" and they will fill in; retrieval scores are
          unaffected.
        </MissingBox>
      </Panel>
    );
  }
  const ac = valFn(d, "Answer Coverage");
  const acR = ac("hybrid_rerank", "overall");
  const acB = ac("bm25", "overall");
  return (
    <Panel
      title="Generation quality (end-to-end)"
      pill={<Pill tone="info">Scored by LLM judge</Pill>}
      lede="Each strategy feeds its retrieved evidence to the same model, an answer is generated, and an LLM judge counts how many gold-answer points it covers — the end-to-end proof that better retrieval yields fuller answers. Below: faithfulness of the production pipeline, and whether out-of-KB questions were properly refused."
    >
      <SectionHead
        unit="Share of gold-answer points covered by the generated answer · LLM-judged"
        className="mt-0"
      >
        Answer coverage by strategy
      </SectionHead>
      <GroupedBarChart
        groups={BUCKETS}
        series={STRAT}
        getVal={ac}
        ariaLabel="Answer coverage by strategy"
      />
      <ReadNote
        note={d.read_notes?.rag_answer_coverage}
        fallback={
          <>
            Same generation prompt, only the retrieval strategy changes: hybrid
            + rerank reaches <b>{fmt2(acR)}</b> answer coverage overall, while
            BM25 alone manages just <b>{fmt2(acB)}</b>. Weaker retrieval means
            missing evidence, and the answer drops gold points.
          </>
        }
      />

      <div className="mt-3.5 grid gap-3.5 md:grid-cols-[1.45fr_1fr]">
        <div>
          <SectionHead
            unit="Hybrid + rerank · does the answer fabricate?"
            className="mt-0"
          >
            Faithfulness
          </SectionHead>
          <div className="mt-2 flex flex-col gap-3">
            {/* Buckets follow BUCKETS above — don't duplicate the list here; the missing bucket is exactly the hardest one */}
            {BUCKETS.filter((x) => !x.agg).map((b) => {
              const f = G.faithfulness?.[b.key] ?? {
                v: null,
                answered: 0,
              };
              const has = f.v !== null && f.v !== undefined; // not evaluated ≠ a score of 0
              const v = has ? (f.v ?? 0) : 0;
              return (
                <div key={b.key}>
                  <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                    <div>
                      <b className="font-medium">{b.label}</b>
                      <span className="text-on-surface-variant ml-1.5 text-[11px]">
                        {b.key} · {f.answered} evaluated
                      </span>
                    </div>
                    <div className="font-medium tabular-nums">
                      {has ? v.toFixed(2) : "—"}
                    </div>
                  </div>
                  <div className="bg-surface-container-highest mt-1 h-2 overflow-hidden rounded-full">
                    <span
                      className={cn(
                        "ease-decel block h-full rounded-full transition-[width] duration-500",
                        v >= 0.9
                          ? "bg-success"
                          : v >= 0.7
                            ? "bg-warning"
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
              <b>D_absent bucket</b> · out-of-KB questions
              <br />
              {G.refusal.correct} / {G.refusal.total} correct refusals, logged
              to the low-confidence pool
            </>
          }
        />
      </div>
      <RefusalCases R={G.refusal} />
      {G.skipped ? (
        <div className="bg-surface-container-low text-on-surface-variant mt-3 rounded-lg p-3 text-xs leading-7">
          Note: {G.skipped} judge calls timed out or failed this round and were
          skipped (upstream instability); rates are computed from the available
          samples.
          {(G.refusal.skipped_ids ?? []).length
            ? " Skipped out-of-KB ids: " +
              (G.refusal.skipped_ids ?? []).join(", ") +
              "."
            : ""}
        </div>
      ) : null}
    </Panel>
  );
}

/* ---------- 03 Full data + this round's fabricated cases ---------- */

function FaithCasesInline({ cases }: { cases: FaithCaseInline[] }) {
  if (!cases.length) {
    return (
      <div className="bg-success-container text-on-success-container mt-3 rounded-lg p-3 text-[12.5px]">
        ✓ No generated answer from this round's production pipeline was{" "}
        <b className="font-semibold">judged "fabricated"</b> — every factual
        claim is backed by the retrieved evidence.
      </div>
    );
  }
  // Bucket names follow BUCKETS above — don't hand-copy a second list
  const BMAP = Object.fromEntries(BUCKETS.map((b) => [b.key, b.label]));
  return (
    <details className="group bg-card border-outline-variant shadow-e1 mt-3 rounded-lg border">
      <summary className="text-on-surface flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-[12.5px] font-medium [&::-webkit-details-marker]:hidden">
        <span className="before:content-['▸'] group-open:before:content-['▾']" />
        Fabricated cases
        <Pill tone="sev-medium">{cases.length} cases</Pill>
        <span className="text-on-surface-variant font-normal">
          Open for the question / generated answer / judge rationale
        </span>
      </summary>
      <div className="px-3 pt-1 pb-3">
        <p className="text-on-surface-variant my-2 text-xs leading-7">
          These generated answers from the production pipeline were judged to
          contain claims the retrieved evidence doesn't support. Look at which
          sentence was fabricated, then patch the Knowledge Base or adjust the
          judging criteria.
        </p>
        {cases.map((c) => (
          <div
            key={c.id}
            className="bg-surface-container-low mt-2.5 rounded-lg p-2.5"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="bg-primary-container text-on-primary-container rounded-md px-1.5 py-0.5 text-[11px]">
                {c.id}
              </span>
              <span className="text-[13px] font-medium">{c.query}</span>
              <span className="text-on-surface-variant text-[11px]">
                {(BMAP[c.bucket] ?? c.bucket) + " bucket"}
              </span>
            </div>
            <div className="mt-1.5 text-[12.5px] leading-7">
              <span className="text-on-surface-variant block text-[10.5px]">
                Judge rationale
              </span>
              {c.reason ?? "—"}
            </div>
            <div className="mt-1.5 text-[12.5px] leading-7">
              <span className="text-on-surface-variant block text-[10.5px]">
                Generated answer (verbatim)
              </span>
              <div className="bg-card mt-0.5 rounded-md p-2 whitespace-pre-wrap">
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
  const cov = valFn(d, "Evidence Coverage");
  const ac = valFn(d, "Answer Coverage");
  return (
    <Panel
      title="Full data"
      lede="Left half: MRR per bucket. Right half: overall evidence and answer coverage. The highlighted row is the strategy with the best overall MRR."
    >
      <TableScroll>
        <Tbl>
          <thead>
            <tr>
              <Th>Strategy</Th>
              <Th>Policy MRR</Th>
              <Th>Model MRR</Th>
              <Th>Colloquial MRR</Th>
              <Th>Multi-doc MRR</Th>
              <Th>Overall MRR</Th>
              <Th>Evidence cov.</Th>
              <Th>Answer cov.</Th>
            </tr>
          </thead>
          <tbody>
            {STRAT.map((s) => (
              <Tr
                key={s.key}
                className={
                  s.key === d.best.strategy
                    ? "bg-primary-container/45"
                    : undefined
                }
              >
                <Td className="whitespace-nowrap">
                  <i
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-xs align-baseline"
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
                <Td num className="border-outline-variant border-l">
                  {(cov(s.key, "overall") ?? 0).toFixed(2)}
                </Td>
                <Td
                  num
                  className={
                    d.generation_done ? undefined : "text-on-surface-variant"
                  }
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
        <b>D_absent</b> out-of-KB questions (should be refused) have no gold
        answers, so they don't appear in the table above.
        {G
          ? " They run through the production pipeline and are graded on refusal only: " +
            String(G.refusal.correct) +
            " / " +
            String(G.refusal.total) +
            " = " +
            String(Math.round((G.refusal.rate ?? 0) * 100)) +
            "% correct refusals."
          : " They run through the production pipeline; the refusal rate arrives once the generation stage completes."}
      </Tip>
      {G ? <FaithCasesInline cases={G.faithfulness_cases ?? []} /> : null}
    </Panel>
  );
}

/* ---------- 03.5 Fabricated-case ledger ---------- */

/* Ledger status values are the backend enum (contract): they key the row classes and get
   their English labels for display via STATUS_LABEL. */
const ST_CLS: Record<string, string> = {
  unresolved: "bg-error-container text-on-error-container",
  resolved: "bg-success-container text-on-success-container",
  dismissed: "bg-surface-container-high text-on-surface-variant",
};

const STATUS_LABEL: Record<string, string> = {
  unresolved: "Unresolved",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

/** Two hallucination rates: judge-flagged (a lead volume, includes over-strict calls) and confirmed (only cases a human reviewed and fixed) */
function HallucBox({ h }: { h: Hallucination }) {
  const pct = (v: number | null) =>
    v === null || v === undefined ? "—" : (v * 100).toFixed(1);
  // Both hallucination kinds count: answerable questions "answered but fabricated" + out-of-KB questions "should-refuse leaks" (answered without evidence)
  const split = (cases: number) => (
    <>
      <b>{cases}</b> fabricated + <b>{h.refusal_missed}</b> should-refuse leaks
    </>
  );
  const lg = h.ledger;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="bg-card border-outline-variant shadow-e1 rounded-lg border p-3.5">
        <div className="text-on-surface-variant text-[11.5px]">
          Confirmed hallucination rate this round (counted after human review)
        </div>
        <div className="text-2xl leading-snug font-medium tabular-nums">
          {pct(h.confirmed_rate)}
          <small className="text-on-surface-variant ml-0.5 text-[13px] font-normal">
            %
          </small>
        </div>
        <div className="text-on-surface-variant text-[11.5px] leading-6 [&_b]:font-semibold">
          <b>{h.confirmed}</b> / {h.evaluated ?? "—"} evaluated questions (
          {split(h.cases_confirmed)}
          ). The fabricated part only counts cases marked "Resolved" — confirmed
          real and fixed.{" "}
          {h.pending ? (
            <>
              <b>{h.pending}</b> cases are still awaiting review this round, so
              this is a lower bound and can only go up.{" "}
            </>
          ) : (
            "Everything flagged this round has been reviewed — the books are settled. "
          )}
          Should-refuse leaks need no human confirmation: answering an out-of-KB
          question is answering without evidence.
        </div>
      </div>
      <div className="bg-card border-outline-variant shadow-e1 rounded-lg border p-3.5">
        <div className="text-on-surface-variant text-[11.5px]">
          Judge-flagged rate this round (a lead volume, not a verdict)
        </div>
        <div className="text-2xl leading-snug font-medium tabular-nums">
          {pct(h.judged_rate)}
          <small className="text-on-surface-variant ml-0.5 text-[13px] font-normal">
            %
          </small>
        </div>
        <div className="text-on-surface-variant text-[11.5px] leading-6 [&_b]:font-semibold">
          <b>{h.judged}</b> / {h.evaluated ?? "—"} questions (
          {split(h.cases_judged)}). Of the fabricated ones, <b>{h.dismissed}</b>{" "}
          were reviewed as over-strict judge calls (marked "Dismissed").
          Denominator = {h.graded ?? "—"} answerable + {h.absent ?? "—"}{" "}
          out-of-KB questions. The ledger holds <b>{lg.total ?? "—"}</b> cases
          across all rounds (Unresolved {lg.unresolved ?? "—"} · Resolved{" "}
          {lg.resolved ?? "—"} · Dismissed {lg.dismissed ?? "—"}) — a
          cross-round management view; don't divide it by one round's question
          count.
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
      toast(c.eval_id + " → " + (STATUS_LABEL[st] ?? st));
      onChanged();
    } catch (e) {
      toast("Failed to update status: " + errMsg(e), true);
      onChanged();
    } finally {
      setPosting(false);
    }
  };

  const submitNote = () => {
    if (!note.trim()) {
      toast("Write a resolution note first", true);
      return;
    }
    void post(noteFor ?? "", note.trim());
    setNoteFor(null);
  };

  // This list is the **full Top-K evidence set fed to the model**, not "what the answer cited" —
  // answers usually cite only two or three of them. Keep the two apart: judging fabrication means
  // looking at what was cited and at what was on hand but ignored
  const n = (c.citations ?? []).length;
  const used = [...new Set((c.answer ?? "").match(/\[(\d+)\]/g) ?? [])]
    .map((x) => Number.parseInt(x.slice(1, -1), 10))
    .filter((x) => x >= 1 && x <= n)
    .sort((a, b) => a - b);

  const actBtn =
    "inline-flex h-8 cursor-pointer items-center justify-center rounded-full border border-outline px-3.5 text-label-medium text-primary transition-all duration-200 hover:bg-primary/8 active:bg-primary/12 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-38";

  return (
    <div className="bg-surface-container-low mt-2.5 rounded-lg p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-primary-container text-on-primary-container rounded-md px-1.5 py-0.5 text-[11px]">
          {c.eval_id}
        </span>
        <span className="flex-1 text-[13px] font-medium">{c.query}</span>
        {c.reopened ? (
          <span className="bg-primary-container text-on-primary-container rounded-full px-2 py-0.5 text-[11px] font-medium">
            Recurred
          </span>
        ) : null}
        <span
          className={cn(
            "bg-surface-container-high text-on-surface-variant rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap",
            ST_CLS[c.status] ?? "",
          )}
        >
          {STATUS_LABEL[c.status] ?? c.status}
        </span>
      </div>
      <div className="text-on-surface-variant mt-1 text-[11px]">
        {(BUCKETS.find((x) => x.key === c.bucket)?.label ?? c.bucket) +
          " · " +
          (STRAT.find((x) => x.key === c.strategy)?.label ?? c.strategy) +
          " · flagged " +
          String(c.seen_count) +
          "× · last " +
          fmtTime(c.last_seen_at) +
          (c.judge_model ? " · judge " + c.judge_model : "")}
      </div>
      <div className="mt-1.5 text-[12.5px] leading-7">
        <span className="text-on-surface-variant block text-[10.5px]">
          Judge rationale
        </span>
        {c.reason ?? "—"}
      </div>
      {/* Resolution note: marking resolved/dismissed requires an explanation (the two fields most worth revisiting, kept together) */}
      {c.resolution ? (
        <div className="mt-1.5 text-[12.5px] leading-7">
          <span className="text-on-surface-variant block text-[10.5px]">
            {c.status === "resolved"
              ? "How it was resolved"
              : "Why no fix is needed"}
          </span>
          {c.resolution}
        </div>
      ) : null}
      <div className="mt-1.5 text-[12.5px] leading-7">
        <span className="text-on-surface-variant block text-[10.5px]">
          Generated answer (verbatim)
        </span>
        <div className="bg-card mt-0.5 rounded-md p-2 whitespace-pre-wrap">
          {c.answer ?? ""}
        </div>
      </div>

      <details className="bg-card mt-2 overflow-hidden rounded-md">
        <summary className="text-on-surface-variant cursor-pointer px-2.5 py-2 text-[11.5px] [&::-webkit-details-marker]:hidden">
          {n
            ? "Evidence (verbatim): " +
              String(n) +
              " chunks — everything fed to the model this round" +
              (used.length
                ? " · the answer cited " +
                  String(used.length) +
                  " of them: " +
                  used.map((x) => "[" + String(x) + "]").join("")
                : " · the answer cited none")
            : "Evidence (verbatim) — no snapshot was recorded when this case entered the ledger"}
        </summary>
        {(c.citations ?? []).map((x) => {
          const isUsed = used.includes(x.n);
          return (
            <div
              key={x.n}
              className={cn(
                "border-outline-variant border-t px-2.5 py-2 text-[12.5px] leading-7",
                isUsed && "bg-surface-container-low",
              )}
            >
              <div>
                <span
                  className={cn(
                    "mr-1.5 rounded-md px-1.5 py-0.5 font-medium",
                    isUsed
                      ? "bg-primary-container text-on-primary-container"
                      : "bg-surface-container-high text-on-surface-variant",
                  )}
                >
                  [{x.n}]
                </span>
                {x.question ?? ""}
                {isUsed ? (
                  <span className="bg-primary-container text-on-primary-container ml-1.5 rounded-full px-1.5 py-0.5 text-[10.5px]">
                    Cited in answer
                  </span>
                ) : null}
              </div>
              <div className="mt-1 whitespace-pre-wrap">{x.answer ?? ""}</div>
              <div className="text-on-surface-variant mt-0.5 text-[10.5px]">
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
          disabled={c.status === "resolved" || posting}
          className={actBtn}
          onClick={() => {
            setNote("");
            setNoteFor("resolved");
          }}
        >
          Resolve
        </button>
        <button
          type="button"
          disabled={c.status === "dismissed" || posting}
          className={actBtn}
          onClick={() => {
            setNote("");
            setNoteFor("dismissed");
          }}
        >
          Dismiss
        </button>
        {c.status !== "unresolved" ? (
          <button
            type="button"
            disabled={posting}
            className={actBtn}
            onClick={() => {
              // Reopening needs no note (it clears the existing one)
              void post("unresolved", null);
            }}
          >
            Reopen
          </button>
        ) : null}
      </div>
      {/* Resolutions must leave a trail: expand an inline input first and block empty submissions (the backend rejects them too — this just saves a wasted round trip) */}
      <AnimatePresence>
        {noteFor ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE_DECEL }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                maxLength={300}
                autoFocus
                className="bg-card border-outline-variant focus:border-primary min-w-65 flex-1 rounded-sm border px-3 py-1.5 text-[12.5px] transition-colors outline-none"
                placeholder={
                  noteFor === "resolved"
                    ? 'How was it resolved? e.g. added "Lite waste bin holds ~5 days" to the Knowledge Base'
                    : "Why is no fix needed? e.g. the processing deadline is our payout deadline — the judge was too strict"
                }
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    submitNote();
                  }
                }}
              />
              <button
                type="button"
                className="bg-primary text-label-medium text-on-primary shadow-e1 hover:bg-primary-hover hover:shadow-e2 active:bg-primary-pressed inline-flex h-8 cursor-pointer items-center justify-center rounded-full px-3.5 transition-all duration-200 active:scale-[0.97]"
                onClick={submitNote}
              >
                Mark as "{STATUS_LABEL[noteFor] ?? noteFor}"
              </button>
              <button
                type="button"
                className="text-label-medium text-on-surface-variant hover:bg-on-surface/8 inline-flex h-8 cursor-pointer items-center justify-center rounded-full px-3.5 transition-all duration-200 active:scale-[0.97]"
                onClick={() => {
                  setNoteFor(null);
                }}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function LedgerPanel() {
  const [status, setStatus] = useState("unresolved");
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

  // Refetch on tab/page change: the ledger is a cross-round management view, so it stays out of the route loader (lots of state, high frequency)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; setState runs after the await
    void load();
  }, [load]);

  const h = data?.hallucination;
  const counts = data?.counts ?? {};
  const all =
    (counts.unresolved ?? 0) + (counts.resolved ?? 0) + (counts.dismissed ?? 0);

  return (
    <Panel
      title="Fabricated-case ledger"
      pill={<Pill tone="info">Cumulative across rounds · actionable</Pill>}
      lede="The section above only covers the current round — re-running the report overwrites it. The ledger keeps flagged cases across rounds, keyed by question: when the same question is flagged again, its entry updates and the count increments; a case that resurfaces after being handled reverts to “Unresolved” and is marked “Recurred” — the previous fix didn't hold. Every entry keeps the evidence behind the [n] markers in the answer at the time, so you can open it and see exactly what the model was fed."
    >
      {err ? (
        <div className="bg-error-container text-on-error-container rounded-lg p-3 text-[12.5px]">
          Failed to load ledger data: {err} (the FaithCase table needs its
          Prisma migration applied first)
        </div>
      ) : null}
      {h ? <HallucBox h={h} /> : null}
      {data ? (
        <>
          <div className="mt-3 mb-0.5 flex flex-wrap items-center gap-2">
            {[
              {
                label: "Unresolved",
                st: "unresolved",
                cnt: counts.unresolved ?? 0,
              },
              { label: "Resolved", st: "resolved", cnt: counts.resolved ?? 0 },
              {
                label: "Dismissed",
                st: "dismissed",
                cnt: counts.dismissed ?? 0,
              },
              { label: "All", st: "", cnt: all },
            ].map(({ label, st, cnt }) => (
              <button
                key={label}
                type="button"
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-[11.5px] transition-all duration-200 active:scale-[0.97]",
                  status === st
                    ? "border-primary-container bg-primary-container text-on-primary-container font-medium"
                    : "border-outline-variant bg-card text-on-surface-variant hover:bg-on-surface/8",
                )}
                onClick={() => {
                  setStatus(st);
                  setPage(1);
                }}
              >
                {label} ({cnt})
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
            <div className="bg-success-container text-on-success-container mt-3 rounded-lg p-3 text-[12.5px]">
              {all
                ? "No cases in this status yet."
                : "The ledger is still empty — run make eval-rag and the fabricated cases it flags are written here automatically."}
            </div>
          )}
          <div className="text-on-surface-variant mt-3 flex flex-wrap items-center gap-2.5 text-[11.5px]">
            <button
              type="button"
              disabled={data.page <= 1}
              className="border-outline text-label-medium text-primary hover:bg-primary/8 active:bg-primary/12 inline-flex h-8 cursor-pointer items-center justify-center rounded-full border px-3.5 transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-38"
              onClick={() => {
                setPage((p) => p - 1);
              }}
            >
              ← Previous
            </button>
            <button
              type="button"
              disabled={data.page >= data.pages}
              className="border-outline text-label-medium text-primary hover:bg-primary/8 active:bg-primary/12 inline-flex h-8 cursor-pointer items-center justify-center rounded-full border px-3.5 transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-38"
              onClick={() => {
                setPage((p) => p + 1);
              }}
            >
              Next →
            </button>
            <span>
              Page {data.page} of {data.pages} · {data.total} cases total
            </span>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

/* ---------- 04 How to read this report ---------- */

const NOTES: [string, string][] = [
  [
    "Three query types, three blind spots",
    "The Model bucket deliberately includes look-alike model families (several water fountains and litter boxes) that trip up vector-only retrieval; the Colloquial bucket rephrases questions so BM25 keywords don't match. Hybrid + rerank covers both gaps at once.",
  ],
  [
    "Fusion ≠ reranking",
    "Plain RRF fusion actually gets dragged down by the weak BM25 side in the Colloquial bucket. Reranking pushes the right answers back to the top and takes the best overall MRR — the direct case for reranking.",
  ],
  [
    "Deterministic vs LLM judge",
    "Retrieval metrics and evidence coverage don't involve an LLM and reproduce exactly on re-run. Answer coverage and faithfulness are judge-graded and can fluctuate slightly. The generation stage skips timed-out or failed calls, so a single upstream failure doesn't sink the whole round.",
  ],
  [
    "Two pre-generation evidence gates",
    "A mechanical low-score gate and a semantic self-check gate both run before generation. Weak evidence triggers a refusal and the question lands in low_confidence_questions; out-of-KB questions should all be refused.",
  ],
];

/* ---------- Page ---------- */

export default function RagEvalPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();

  const jobPanel = (d: Overview) => (
    <Panel
      title="Re-run in place"
      pill={<Pill tone="missing">Takes minutes</Pill>}
      tight
      lede="This button runs the same make eval-rag as the terminal: one retrieval round per strategy, then the evidence goes to the judge for scoring. When it finishes, this page swaps in the new report — it only reads the artifact and never computes anything itself."
    >
      <JobRow
        specs={d.job.specs}
        onFinish={() => {
          void revalidate();
        }}
        note={
          "Artifact " +
          d.job.artifacts.json.path +
          (d.job.artifacts.json.mtime
            ? " (written " + fmtTime(d.job.artifacts.json.mtime) + ")"
            : " (none yet)")
        }
      />
    </Panel>
  );

  if (!loaderData.ok) {
    return (
      <PageShell title="RAG Eval" active="/rag-eval">
        <MissingBox className="mt-4">
          Failed to load data: {loaderData.error}
        </MissingBox>
      </PageShell>
    );
  }
  const d = loaderData.d;

  if (!d.present) {
    return (
      <PageShell
        title="RAG Eval"
        sub="Four strategies side by side · retrieval ranking / evidence coverage / end-to-end answers in one run"
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
      title="RAG Eval"
      sub="Four strategies side by side · retrieval ranking / evidence coverage / end-to-end answers in one run"
      active="/rag-eval"
      actions={
        <Btn
          onClick={() => {
            void revalidate();
          }}
          disabled={state === "loading"}
        >
          <RefreshCw
            className={state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            aria-hidden
          />
          Refresh
        </Btn>
      }
    >
      <GateBar>
        <Stat
          label="Eval set"
          value={String(m.n_samples ?? "—") + " questions"}
        />
        <Stat
          label="Knowledge Base"
          value={String(m.kb_chunks ?? "—") + " chunks"}
        />
        <Stat
          label="Embedding / rerank"
          value="qwen3.7-text-embedding-flash · reranker-v2-m3"
          small
        />
        <Stat label="Judge model" value={m.chat_model ?? "—"} small />
        <Stat label="Last run" value={m.generated_at ?? "—"} small />
      </GateBar>
      <KpiBox d={d} />
      <RetrievalPanel d={d} />
      <GenerationPanel d={d} />
      <TablePanel d={d} />
      <LedgerPanel />
      {jobPanel(d)}
      <Panel
        title="How to read this report"
        lede="Four ground rules so the scores don't get misread."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {NOTES.map(([t, body]) => (
            <div
              key={t}
              className="bg-card border-outline-variant shadow-e1 rounded-lg border p-3.5"
            >
              <h3 className="mb-1 text-[12.5px] font-medium">{t}</h3>
              <p className="text-on-surface-variant text-xs leading-7">
                {body}
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </PageShell>
  );
}
