// Rerank upstream client (Jina / Cohere shaped /rerank endpoint, not OpenAI protocol).
import { z } from "zod";

import { settings } from "@/config.ts";

const VERSION_SEG = /\/v\d+$/;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRIES = 3;
const BACKOFF_MS = 1500;

function rerankUrl(): string {
  // Accept bases with or without a version segment; only append /v1 when missing.
  let base = settings.rerankBaseUrl.replace(/\/+$/, "");
  if (!VERSION_SEG.test(base)) {
    base += "/v1";
  }
  return `${base}/rerank`;
}

const rerankResponseSchema = z.object({
  results: z
    .array(z.object({ index: z.number(), relevance_score: z.number() }))
    .optional(),
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function post(url: string, body: Record<string, unknown>): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;
  for (let i = 0; i <= RETRIES; i += 1) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${settings.rerankApiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!RETRY_STATUS.has(resp.status)) {
        return resp;
      }
      lastResponse = resp;
    } catch (error) {
      // Connection-level flakes are transient exactly like 429/5xx.
      lastError = error;
      if (i >= RETRIES) {
        throw error;
      }
    }
    if (i < RETRIES) {
      await sleep(BACKOFF_MS * 2 ** i);
    }
  }
  if (lastResponse === null && lastError !== null) {
    throw lastError instanceof Error ? lastError : new Error("rerank upstream transport error");
  }
  if (lastResponse === null) {
    throw new Error("rerank upstream produced no response");
  }
  return lastResponse;
}

export async function rerank(query: string, docs: string[], topN: number | null = null): Promise<Array<[number, number]>> {
  if (docs.length === 0) {
    return [];
  }
  const body = {
    model: settings.rerankModel,
    query,
    documents: docs,
    top_n: topN || docs.length,
  };
  const resp = await post(rerankUrl(), body);
  if (!resp.ok) {
    throw new Error(`rerank upstream returned ${resp.status}: ${await resp.text()}`);
  }
  const data = rerankResponseSchema.parse(await resp.json());
  const ranked = (data.results ?? [])
    .map((r): [number, number] => [r.index, Number(r.relevance_score)])
    .sort((a, b) => b[1] - a[1]);
  return topN ? ranked.slice(0, topN) : ranked;
}
