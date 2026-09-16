// Observability page API: cost ledger, eval trend and confidence calibration, all read from
// artifacts (or the eval_runs table for the trend). The page never recomputes numbers.
import fs from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import { z } from "zod";

import { settings } from "@/config.ts";
import { W_KEY, W_MARGIN, W_TOP1, W_VALID } from "@/core/confidence.ts";
import { status as jobStatus } from "@/core/jobs.ts";
import * as repository from "@/db/repository.ts";

export const observabilityRouter = new Hono();

const REPORT_DIR = path.join(settings.root, "data/eval/reports");
const COST = path.join(REPORT_DIR, "cost_by_intent.json");
const CALIB = path.join(REPORT_DIR, "confidence_calibration.json");
const TREND_NOTE = path.join(REPORT_DIR, "eval_trend_note.json");
const COST_JOB = "cost-report";
const TREND_JOB = "eval-flywheel";
const CALIB_JOB = "calibrate-confidence";
const TREND_LIMIT = 10;
const METRIC_NAMES = ["recall_at_5", "recall_at_10", "mrr", "faithfulness", "refusal_rate"];

const recordSchema = z.record(z.string(), z.unknown());

function asRecord(value: unknown): Record<string, unknown> | null {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed = recordSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function block(job: string, make: string, hint: string): Record<string, unknown> {
  return { present: false, status: "missing", job: jobStatus(job), make, hint };
}

function costBlock(): Record<string, unknown> {
  const base = block(COST_JOB, "make cost-report", "The cost ledger by intent has not run yet. Ask a few questions on the chat page to accumulate traces, then press \"Re-run cost ledger by intent\".");
  const report = readJson(COST);
  if (report === null) {
    return base;
  }
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const readNotes = asRecord(report.read_notes) ?? {};
  return {
    ...base,
    present: true,
    status: rows.length > 0 ? "ok" : "missing",
    meta: asRecord(report.meta) ?? {},
    rows,
    total_tokens: report.total_tokens ?? null,
    total_requests: report.total_requests ?? null,
    top: rows.length > 0 ? rows[0] : null,
    read_note: readNotes.cost_by_intent ?? null,
    hint: rows.length > 0 ? null : "No traces with an intent tag inside the window; ask a few questions on the chat page, then re-run.",
  };
}

function trendNote(latestRunId: number | null): string | null {
  const note = readJson(TREND_NOTE) ?? {};
  if (latestRunId === null || note.run_id !== latestRunId) {
    return null;
  }
  return typeof note.note === "string" ? note.note : null;
}

async function trendBlock(): Promise<Record<string, unknown>> {
  const base = block(TREND_JOB, "make eval-flywheel", "The evaluation pipeline has not run yet. Press \"Re-run evaluation pipeline\" once, and this round becomes the first point of the trend.");
  let runs: repository.EvalRunRow[];
  try {
    runs = await repository.listEvalRuns(TREND_LIMIT);
  } catch (error) {
    return { ...base, status: "error", note: `${error instanceof Error ? error.constructor.name : "Error"}: ${String(error)}` };
  }
  return {
    ...base,
    present: runs.length > 0,
    status: runs.length > 0 ? "ok" : "missing",
    metric_names: METRIC_NAMES,
    read_note: runs.length > 0 ? trendNote(runs[0].id) : null,
    runs: runs.map((r) => ({
      id: r.id,
      triggered_by: r.triggeredBy,
      dataset_size: r.datasetSize,
      metrics: r.metrics,
      created_at: r.createdAt.toISOString().slice(0, 19),
    })),
  };
}

function calibrationBlock(): Record<string, unknown> {
  const base = block(CALIB_JOB, "make calibrate-confidence", "No calibration yet. Press \"Re-run confidence threshold calibration\" to scan the rag eval set, so the threshold is no longer a guess.");
  const withSettings = {
    ...base,
    in_use: settings.evidenceConfidenceThreshold,
    weights: { top1: W_TOP1, valid_count: W_VALID, margin: W_MARGIN, key_clause: W_KEY },
  };
  const report = readJson(CALIB);
  if (report === null) {
    return withSettings;
  }
  const recommended = asRecord(report.recommended) ?? {};
  const readNotes = asRecord(report.read_notes) ?? {};
  return {
    ...withSettings,
    present: true,
    status: "ok",
    meta: asRecord(report.meta) ?? {},
    distribution: asRecord(report.distribution) ?? {},
    scan: Array.isArray(report.scan) ? report.scan : [],
    recommended,
    read_note: readNotes.confidence_calibration ?? null,
    in_sync: recommended.threshold === settings.evidenceConfidenceThreshold,
  };
}

export async function overview(): Promise<Record<string, unknown>> {
  return { cost: costBlock(), trend: await trendBlock(), calibration: calibrationBlock() };
}

observabilityRouter.get("/api/observability/overview", async () => Response.json(await overview()));
