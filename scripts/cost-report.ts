// Cost control: aggregate token spend per intent from the Langfuse metrics API.
// Intents are tagged on each turn ("intent:<name>"); rows without the tag are ignored.
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "#/config.ts";
import { langfuseConfig } from "#/core/observability.ts";
import * as readNotes from "#/core/read-notes.ts";

const ROOT = settings.root;
const OUT_DIR = path.join(ROOT, "data/observability/reports");
const OUT = path.join(OUT_DIR, "cost_by_intent.txt");
const OUT_JSON = path.join(OUT_DIR, "cost_by_intent.json");

const days = process.argv.includes("--days")
  ? Number(process.argv[process.argv.indexOf("--days") + 1] ?? "7")
  : 7;

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

async function query(
  config: { publicKey: string; secretKey: string; baseUrl: string },
  from: string,
  to: string,
): Promise<Record<string, unknown>[]> {
  const query = {
    view: "observations",
    metrics: [{ measure: "totalTokens", aggregation: "sum" }],
    dimensions: [{ field: "tags" }, { field: "traceId" }],
    filters: [],
    fromTimestamp: from,
    toTimestamp: to,
  };
  const resp = await fetch(
    `${config.baseUrl.replace(/\/+$/, "")}/api/public/metrics`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`,
      },
      body: JSON.stringify({ query: JSON.stringify(query) }),
    },
  );
  if (!resp.ok) {
    throw new Error(
      `langfuse metrics API returned ${resp.status}: ${await resp.text()}`,
    );
  }
  const parsed = metricsResponseSchema.parse(await resp.json());
  return parsed.data;
}

function aggregate(rows: Record<string, unknown>[]): IntentRow[] {
  const acc = new Map<string, { tokens: number; traces: Set<string | null> }>();
  for (const row of rows) {
    const tags = Array.isArray(row.tags)
      ? row.tags.filter((t): t is string => typeof t === "string")
      : [];
    const intents = tags
      .filter((t) => t.startsWith("intent:"))
      .map((t) => t.slice("intent:".length));
    if (intents.length === 0) {
      continue;
    }
    const intent = intents[0];
    const entry = acc.get(intent) ?? {
      tokens: 0,
      traces: new Set<string | null>(),
    };
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
    console.log("Langfuse is not configured (three .env variables); there is no bill to read.");
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

  const lines = [
    `=== Token spend by intent (last ${days} days, source: Langfuse) ===`,
    `${"intent".padEnd(16)} ${"requests".padStart(8)} ${"total tokens".padStart(12)} ${"avg tokens".padStart(12)} ${"share".padStart(7)}`,
  ];
  rows.forEach((r, i) => {
    const mark = i === 0 ? "  ← top spender" : "";
    lines.push(
      `${r.intent.padEnd(16)} ${String(r.count).padStart(8)} ${String(r.tokens).padStart(12)} ${String(r.avg_tokens ?? 0).padStart(12)} ${`${Math.round((r.share ?? 0) * 100)}%`.padStart(6)}${mark}`,
    );
  });
  if (rows.length === 0) {
    lines.push("(No traces with an intent tag inside the window — chat a bit first)");
  }
  const out = lines.join("\n");
  console.log(out);

  const payload = {
    window_days: days,
    by_intent: rows.map((r) => ({
      intent: r.intent,
      requests: r.count,
      total_tokens: r.tokens,
      avg_tokens: r.avg_tokens,
      share: r.share,
    })),
    total_tokens: rows.reduce((sum, r) => sum + r.tokens, 0),
    total_requests: rows.reduce((sum, r) => sum + r.count, 0),
  };
  const note =
    rows.length > 0
      ? await readNotes.generate("cost_by_intent", payload)
      : null;
  console.log("\nRead note: " + (note ?? "none this round (the page uses its fallback sentence)"));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, `${out}\n`, "utf8");
  fs.writeFileSync(
    OUT_JSON,
    `${JSON.stringify(
      {
        meta: {
          days,
          source: "Langfuse",
          generated_at: new Date().toISOString().slice(0, 16).replace("T", " "),
          window_from: from,
          window_to: to,
        },
        rows,
        total_tokens: payload.total_tokens,
        total_requests: payload.total_requests,
        read_notes: note ? { cost_by_intent: note } : {},
      },
      null,
      1,
    )}\n`,
    "utf8",
  );
  console.log("\nReport written to data/observability/reports/cost_by_intent.txt and .json");
}

await main();
