// Cost control: aggregate token spend per intent from the Langfuse metrics API.
// Intents are tagged on each turn ("intent:<name>"); rows without the tag are ignored.
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "../src/config.ts";
import { langfuseConfig } from "../src/core/observability.ts";
import * as readNotes from "../src/core/read-notes.ts";

const ROOT = settings.root;
const OUT_DIR = path.join(ROOT, "data/ch09/reports");
const OUT = path.join(OUT_DIR, "cost_by_intent.txt");
const OUT_JSON = path.join(OUT_DIR, "cost_by_intent.json");

const days = process.argv.includes("--days") ? Number(process.argv[process.argv.indexOf("--days") + 1] ?? "7") : 7;

const metricsResponseSchema = z.object({
  data: z
    .array(
      z
        .object({
          tags: z.array(z.string()).nullish(),
          traceId: z.string().nullish(),
          sum_totalTokens: z.number().nullish(),
        })
        .loose(),
    )
    .default([]),
});

interface IntentRow {
  intent: string;
  tokens: number;
  count: number;
  avg_tokens?: number;
  share?: number;
}

function window(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const fmt = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`;
  return { from: fmt(from), to: fmt(now) };
}

async function query(config: { publicKey: string; secretKey: string; baseUrl: string }, from: string, to: string): Promise<Array<Record<string, unknown>>> {
  const query = {
    view: "observations",
    metrics: [{ measure: "totalTokens", aggregation: "sum" }],
    dimensions: [{ field: "tags" }, { field: "traceId" }],
    filters: [],
    fromTimestamp: from,
    toTimestamp: to,
  };
  const resp = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/public/metrics`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`,
    },
    body: JSON.stringify({ query: JSON.stringify(query) }),
  });
  if (!resp.ok) {
    throw new Error(`langfuse metrics API returned ${resp.status}: ${await resp.text()}`);
  }
  const parsed = metricsResponseSchema.parse(await resp.json());
  return parsed.data;
}

function aggregate(rows: Array<Record<string, unknown>>): IntentRow[] {
  const acc = new Map<string, { tokens: number; traces: Set<string | null> }>();
  for (const row of rows) {
    const tags = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [];
    const intents = tags.filter((t) => t.startsWith("intent:")).map((t) => t.slice("intent:".length));
    if (intents.length === 0) {
      continue;
    }
    const intent = intents[0];
    const entry = acc.get(intent) ?? { tokens: 0, traces: new Set<string | null>() };
    entry.tokens += Number(row.sum_totalTokens ?? 0);
    entry.traces.add(typeof row.traceId === "string" ? row.traceId : null);
    acc.set(intent, entry);
  }
  return [...acc.entries()]
    .map(([intent, v]) => ({ intent, tokens: v.tokens, count: v.traces.size }))
    .sort((a, b) => b.tokens - a.tokens);
}

async function main(): Promise<void> {
  const config = langfuseConfig();
  if (config === null) {
    console.log("Langfuse 未配置(.env 三变量),无账可查。");
    process.exitCode = 1;
    return;
  }
  const { from, to } = window();
  const rows = aggregate(await query(config, from, to));
  const total = rows.reduce((sum, r) => sum + r.tokens, 0) || 1;
  for (const r of rows) {
    r.avg_tokens = Math.floor(r.tokens / Math.max(r.count, 1));
    r.share = Number((r.tokens / total).toFixed(4));
  }

  const lines = [`=== 按意图 token 花销(近 ${days} 天,数据源 Langfuse)===`, `${"意图".padEnd(6)} ${"请求数".padStart(8)} ${"总tokens".padStart(12)} ${"平均tokens".padStart(12)} ${"占比".padStart(7)}`];
  rows.forEach((r, i) => {
    const mark = i === 0 ? "  ← 最烧钱" : "";
    lines.push(`${r.intent.padEnd(6)} ${String(r.count).padStart(8)} ${String(r.tokens).padStart(12)} ${String(r.avg_tokens ?? 0).padStart(12)} ${`${Math.round((r.share ?? 0) * 100)}%`.padStart(6)}${mark}`);
  });
  if (rows.length === 0) {
    lines.push("(窗口内没有带 intent tag 的 trace——先聊几句再来)");
  }
  const out = lines.join("\n");
  console.log(out);

  const payload = {
    窗口天数: days,
    各意图: rows.map((r) => ({ 意图: r.intent, 请求数: r.count, "总 token": r.tokens, "单均 token": r.avg_tokens, 占比: r.share })),
    "总 token": rows.reduce((sum, r) => sum + r.tokens, 0),
    总请求数: rows.reduce((sum, r) => sum + r.count, 0),
  };
  const note = rows.length > 0 ? await readNotes.generate("cost_by_intent", payload) : null;
  console.log("\n读图小注:" + (note ?? "本轮没有(页面用兜底句)"));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, `${out}\n`, "utf8");
  fs.writeFileSync(
    OUT_JSON,
    `${JSON.stringify(
      {
        meta: { days, source: "Langfuse", generated_at: new Date().toISOString().slice(0, 16).replace("T", " "), window_from: from, window_to: to },
        rows,
        total_tokens: payload["总 token"],
        total_requests: payload["总请求数"],
        read_notes: note ? { cost_by_intent: note } : {},
      },
      null,
      1,
    )}\n`,
    "utf8",
  );
  console.log("\n报告已落 data/ch09/reports/cost_by_intent.txt 与 .json");
}

await main();
