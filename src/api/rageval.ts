// RAG evaluation report API: read the artifact written by the eval job, never recompute it.
import fs from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { parseJsonBody, parseParamInt, parseQuery } from "./http.ts";
import { faithCaseStatusRequestSchema } from "./schemas.ts";

import { settings } from "@/config.ts";
import { status as jobStatus } from "@/core/jobs.ts";
import { parseJson } from "@/db/json.ts";
import * as repository from "@/db/repository.ts";


export const ragevalRouter = new Hono();

const REPORT = path.join(settings.root, "data/ch04/reports/rag_eval.json");
const TEXT_LOG = path.join(settings.root, "data/ch04/reports/rag_eval.txt");
const JOB = "eval-rag";
const STRATEGIES = ["vector", "bm25", "hybrid", "hybrid_rerank"];
const BUCKETS = ["A_policy", "B_model", "C_colloquial", "E_multi"];

const recordSchema = z.record(z.string(), z.unknown());

function asRecord(value: unknown): Record<string, unknown> | null {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readReport(): Record<string, unknown> | null {
  try {
    const parsed = recordSchema.safeParse(JSON.parse(fs.readFileSync(REPORT, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function stat(file: string): Record<string, unknown> {
  try {
    const st = fs.statSync(file);
    return { present: true, bytes: st.size, mtime: st.mtime.toISOString().slice(0, 19) };
  } catch {
    return { present: false, bytes: null, mtime: null };
  }
}

function bestStrategy(report: Record<string, unknown>): { strategy: string | null; mrr: number | null } {
  let best: string | null = null;
  let bestMrr = -1;
  for (const s of STRATEGIES) {
    const retrieval = asRecord(report.retrieval);
    const entry = asRecord(retrieval?.[s]);
    const overall = asRecord(entry?.overall);
    const mrr = asNumber(overall?.mrr);
    if (mrr !== null && mrr > bestMrr) {
      best = s;
      bestMrr = mrr;
    }
  }
  return { strategy: best, mrr: best === null ? null : bestMrr };
}

const hallucinationSchema = z.object({
  faithfulness: z.record(z.string(), z.object({ v: z.number().nullable().optional(), answered: z.number().optional() })).optional(),
  faithfulness_cases: z.array(z.object({ id: z.string().optional() }).loose()).optional(),
  refusal: z
    .object({
      rate: z.number().nullable().optional(),
      total: z.number().optional(),
      correct: z.number().optional(),
      cases: z.array(recordSchema).optional(),
      skipped_ids: z.array(z.string()).optional(),
    })
    .optional(),
});

export interface HallucinationReport {
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
  ledger: Record<string, number>;
}

export function hallucination(counts: repository.FaithCounts, report: Record<string, unknown> | null, statusMap: Record<string, string>): HallucinationReport {
  // Both rates are per-round: the ledger is a cross-round management view and must not
  // become the numerator of a single-round rate.
  const gen = asRecord(report?.generation) ?? {};
  const parsed = hallucinationSchema.safeParse(gen);
  const data = parsed.success ? parsed.data : {};
  const faith = data.faithfulness ?? {};
  let graded = 0;
  for (const v of Object.values(faith)) {
    graded += v.answered ?? 0;
  }
  const absent = data.refusal?.total ?? 0;
  const missed = Math.max(0, absent - (data.refusal?.correct ?? 0));
  const evaluated = graded + absent || null;

  const roundIds = (data.faithfulness_cases ?? []).map((c) => c.id).filter((id): id is string => typeof id === "string");
  const tally = { unresolved: 0, resolved: 0, dismissed: 0 };
  for (const id of roundIds) {
    const status = statusMap[id];
    if (status === "unresolved" || status === "resolved" || status === "dismissed") {
      tally[status] += 1;
    }
  }
  const casesJudged = roundIds.length;
  const confirmedCases = tally["resolved"];
  const rate = (n: number): number | null => (evaluated ? Number((n / evaluated).toFixed(4)) : null);
  return {
    evaluated,
    graded: graded || null,
    absent: absent || null,
    cases_judged: casesJudged,
    cases_confirmed: confirmedCases,
    pending: tally["unresolved"],
    dismissed: tally["dismissed"],
    refusal_missed: missed,
    judged: casesJudged + missed,
    confirmed: confirmedCases + missed,
    judged_rate: rate(casesJudged + missed),
    confirmed_rate: rate(confirmedCases + missed),
    ledger: { total: counts["unresolved"] + counts["resolved"] + counts["dismissed"], ...counts },
  };
}

export function overview(): Record<string, unknown> {
  const report = readReport();
  const job = {
    specs: [jobStatus(JOB)],
    artifacts: {
      json: { ...stat(REPORT), path: "data/ch04/reports/rag_eval.json" },
      text: { ...stat(TEXT_LOG), path: "data/ch04/reports/rag_eval.txt" },
    },
  };
  if (report === null) {
    return {
      present: false,
      job,
      make: "make eval-rag",
      hint: "No RAG evaluation run yet. Press \"Re-run RAG evaluation\" to run one round on the spot (four strategies × four buckets; requires the vector store + a built KB + chat upstream; takes minutes).",
    };
  }
  const generation = report.generation ?? null;
  return {
    present: true,
    meta: report.meta ?? {},
    retrieval: report.retrieval ?? {},
    evidence_coverage: report.evidence_coverage ?? {},
    generation,
    generation_done: generation !== null,
    read_notes: report.read_notes ?? {},
    best: bestStrategy(report),
    strategies: STRATEGIES,
    buckets: BUCKETS,
    job,
  };
}

ragevalRouter.get("/api/rag-eval/overview", (c) => c.json(overview()));

// ---------- fabrication case ledger ----------

interface FaithCaseRow {
  id: number;
  evalId: string;
  bucket: string;
  query: string;
  strategy: string;
  answer: string;
  reason: string;
  citations: string | null;
  judgeModel: string | null;
  resolution: string | null;
  status: string;
  seenCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
}

function caseOut(r: FaithCaseRow): Record<string, unknown> {
  return {
    id: r.id,
    eval_id: r.evalId,
    bucket: r.bucket,
    query: r.query,
    strategy: r.strategy,
    answer: r.answer,
    reason: r.reason,
    citations: parseJson(r.citations),
    judge_model: r.judgeModel,
    resolution: r.resolution,
    status: r.status,
    seen_count: r.seenCount,
    reopened: r.resolvedAt !== null && r.status === "unresolved",
    first_seen_at: r.firstSeenAt.toISOString().slice(0, 19),
    last_seen_at: r.lastSeenAt.toISOString().slice(0, 19),
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString().slice(0, 19) : null,
  };
}

const faithQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(50).default(5),
});

ragevalRouter.get("/api/rag-eval/faith-cases", async (c) => {
  const query = parseQuery(c, faithQuerySchema);
  const status = query.status ?? null;
  if (status !== null && status !== "unresolved" && status !== "resolved" && status !== "dismissed") {
    throw new HTTPException(400, { message: "status must be one of unresolved/resolved/dismissed" });
  }
  const { rows, total, counts } = await repository.listFaithCases(status, query.page, query.size);
  const statusMap = await repository.faithCaseStatusMap();
  return Response.json({
    items: rows.map(caseOut),
    total,
    page: query.page,
    size: query.size,
    pages: Math.max(1, Math.ceil(total / query.size)),
    counts,
    hallucination: hallucination(counts, readReport(), statusMap),
  });
});

ragevalRouter.post("/api/rag-eval/faith-cases/:case_id/status", async (c) => {
  const caseId = parseParamInt(c.req.param("case_id"), "case_id");
  const req = await parseJsonBody(c, faithCaseStatusRequestSchema);
  const note = (req.resolution ?? "").trim();
  if (req.status !== "unresolved" && !note) {
    throw new HTTPException(400, {
      message: "Marking \"resolved\" requires stating how it was resolved; marking \"dismissed\" requires stating why no change is needed",
    });
  }
  const row = await repository.setFaithCaseStatus(caseId, req.status, note || null);
  if (row === null) {
    throw new HTTPException(404, { message: "Case not found" });
  }
  return Response.json(caseOut(row));
});
