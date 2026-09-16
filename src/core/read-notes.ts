// Chart annotations ("read notes") generated at report write time, then machine-verified.
//
// The note is generated when the artifact is written (not when the page renders), so the
// dashboard never depends on a live model and every page load shows the same sentence.
import type { ChatOpenAI } from "@langchain/openai";


import { getChatModel } from "./llm.ts";
import { contentToString } from "./memory.ts";

import { childLogger } from "@/logger.ts";

const log = childLogger("read-notes");

const MAX_CHARS = 130;
const TIMEOUT_MS = 120_000;

// Numbers inside identifiers (p25, Recall@10, bge-m3) are not conclusions.
const NUM_RE = /(?<![A-Za-z@_.\-\d])\d+(?:,\d{3})*(?:\.\d+)?(?![A-Za-z_])/g;

const KINDS: Record<string, [string, string]> = {
  rag_mrr: [
    "MRR of the four retrieval strategies (vector only / BM25 only / hybrid / hybrid + rerank) across the four question buckets (Policy / Model numbers / Colloquial / Cross-document) and overall; higher means the correct evidence ranks closer to the top.",
    "The reader must decide which retrieval route to ship, and which bucket is each route's weak spot.",
  ],
  rag_recall: [
    "Recall@5 for the same four strategies × five buckets: how much of the evidence a question needs shows up in the top five; a cross-document question needs chunks from two or three different sections.",
    "The reader must decide which route leaks evidence, and in which bucket.",
  ],
  rag_coverage: [
    "Evidence coverage: of the ten retrieved evidence chunks, how many of the standard answer's key points are present.",
    "The reader must judge whether the retrieved evidence suffices to answer, not merely whether anything was retrieved.",
  ],
  rag_answer_coverage: [
    "End-to-end answer coverage: same generation prompt, only the retrieval strategy changes — the share of standard key points the final answer covers.",
    "The reader must see whether weak retrieval propagates all the way to missing points in the answer.",
  ],
  cost_by_intent: [
    "Token bill piled by intent: per-intent request count, total tokens, average tokens per request, and share of the total. A high average means one user question triggers multiple model calls (a multi-step tool chain), independent of the question count.",
    "The reader must decide which intent to slim the prompt for first, or move to a smaller model.",
  ],
  eval_trend: [
    "The last two rounds of the evaluation pipeline on four metrics (Recall@5, MRR, Faithfulness, refusal rate), plus this round's change versus the previous one.",
    "The reader must judge whether the flywheel's write-back to the knowledge base dragged quality down, and whether to revisit the recently approved reviews.",
  ],
  confidence_calibration: [
    "Evidence-confidence threshold scan: at each candidate threshold, the pass rate of answerable in-KB questions and the leak rate of out-of-KB questions that should be refused, plus the chosen line. Answerable questions wrongly blocked fall back into the question pool — fuel for the data flywheel.",
    "The reader must understand why the line sits here, and what moving it left or right costs.",
  ],
};

const RULES =
  "You are writing a short \"read note\" for a technical dashboard; the reader is a developer learning this system. Requirements:\n" +
  "1. Only cite numbers that appear in the data I give you; never compute, estimate, or invent a single one;\n" +
  `2. At most ${MAX_CHARS} characters in total, one or two sentences, ending on "so what to look at / what to do";\n` +
  "3. Casual English, like a colleague pointing at the screen. No semicolons, no dashes, at most one period in the whole note;\n" +
  "4. Do not recite every number on the chart; pick the one or two that tell the story;\n" +
  '5. Always use the labels I give for strategy names and question types (e.g. "Colloquial"); never expose raw field names like C_colloquial;\n' +
  "6. Use a comma for pauses within the sentence and end with a single period;\n" +
  "7. Write numbers of four digits or more with thousands separators (7,942), matching the page tables;\n" +
  "8. Output the sentence itself only; no quotes, titles, markdown, or explanations.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadNumbers(payload: unknown): Set<string> {
  // Accept raw form, common decimal forms, percentages and the 1-x complement.
  const out = new Set<string>();
  const add = (x: number): void => {
    for (const s of [x.toFixed(0), x.toFixed(1), x.toFixed(2), x.toFixed(3), String(x)]) {
      out.add(s);
    }
  };
  const walk = (node: unknown): void => {
    if (typeof node === "boolean") {
      return;
    }
    if (typeof node === "number") {
      add(node);
      add(Math.abs(node) * 100);
      if (node >= 0 && node <= 1) {
        add((1 - node) * 100);
        add(1 - node);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (isRecord(node)) {
      Object.values(node).forEach(walk);
      return;
    }
    if (typeof node === "string") {
      for (const m of node.matchAll(NUM_RE)) {
        const parsed = Number(m[0].replaceAll(",", ""));
        if (!Number.isNaN(parsed)) {
          add(parsed);
        }
      }
    }
  };
  walk(payload);
  return new Set([...out].map((s) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s)));
}

function normalizeNumber(raw: string): string {
  const cleaned = raw.replaceAll(",", "");
  return cleaned.includes(".") ? cleaned.replace(/0+$/, "").replace(/\.$/, "") : cleaned;
}

export function verify(text: string, payload: unknown): boolean {
  const allowed = payloadNumbers(payload);
  for (const m of text.matchAll(NUM_RE)) {
    if (!allowed.has(normalizeNumber(m[0]))) {
      log.warn({ number: m[0] }, "read note cites a number missing from the payload; discarding");
      return false;
    }
  }
  return true;
}

export function tidy(text: string): string {
  let out = text.split(/\s+/).join(" ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  out = out.replaceAll(";", ",");
  out = out.replace(/[!?.,…\s]+$/g, "");
  return out.endsWith(".") ? out : `${out}.`;
}

export async function generate(kind: string, payload: unknown, model: ChatOpenAI | null = null): Promise<string | null> {
  const spec = KINDS[kind];
  if (!spec) {
    return null;
  }
  const [what, decision] = spec;
  const chat = model ?? getChatModel();
  const prompt = `${RULES}\n\nWhat this chart shows: ${what}\nThe judgment the reader must make: ${decision}\n\nData (JSON):\n${JSON.stringify(payload)}`;
  let text: string;
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("read note timeout")), TIMEOUT_MS);
    });
    const response = await Promise.race([chat.invoke(prompt), timeout]);
    text = tidy(contentToString(response.content));
  } catch (error) {
    log.warn({ kind, err: error }, "read note generation failed; page will use its fallback sentence");
    return null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
  if (text.length <= 1 || text.length > MAX_CHARS) {
    log.warn({ kind, length: text.length }, "read note length rejected");
    return null;
  }
  return verify(text, payload) ? text : null;
}

export async function generateAll(jobs: Record<string, unknown>, model: ChatOpenAI | null = null): Promise<Record<string, string>> {
  const kinds = Object.keys(jobs);
  const notes = await Promise.all(kinds.map((k) => generate(k, jobs[k], model)));
  const out: Record<string, string> = {};
  kinds.forEach((k, i) => {
    if (notes[i] !== null) {
      out[k] = notes[i];
    }
  });
  return out;
}
