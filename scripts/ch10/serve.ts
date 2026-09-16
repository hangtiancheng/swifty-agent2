// ch10 inference service: ONNX + a light runtime (onnxruntime-node + tokenizers), no torch.
// Start/stop: make classifier-up / classifier-down (repo convention: nohup + pid file).
//
// NOTE on tokenizer fidelity: this uses @huggingface/tokenizers (pure-JS) to reproduce the
// truncation(max_length=128) + padding(pad_id=0) the Python serve applied. The library has no
// built-in truncation/padding, so both are applied manually below. Fidelity against the exact
// HF fast-tokenizer can only be confirmed once a trained model + tokenizer.json exist (run the
// ch10 train/export pipeline first); until then this path is structurally correct but unverified.
import fs from "node:fs";
import path from "node:path";

import { serve } from "@hono/node-server";
import { Tokenizer } from "@huggingface/tokenizers";
import { Hono } from "hono";
import * as ort from "onnxruntime-node";
import { z } from "zod";

import { parseJsonBody } from "#/api/http.ts";
import { settings } from "#/config.ts";
import { TOPIC_NAMES } from "#/core/taxonomy.ts";
import { applyThreshold } from "#/train/inference-lib.ts";

const DIR = path.join(settings.root, "data/train/onnx");
const MAX_LENGTH = 128;
const PAD_ID = 0; // BERT-style [PAD]; attention_mask=0 masks pad positions regardless.

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const modelPath = path.join(DIR, "model.onnx");
const tokenizerPath = path.join(DIR, "tokenizer.json");
const thresholdPath = path.join(DIR, "threshold.json");
if (!fs.existsSync(modelPath)) {
  fail(`Missing ${modelPath}; run the ch10 train + export pipeline first (make ch10-train && make ch10-export)`);
}
if (!fs.existsSync(tokenizerPath)) {
  fail(`Missing ${tokenizerPath}; run make ch10-export first`);
}

// tokenizer.json holds model/normalizer/pre_tokenizer/post_processor/decoder/added_tokens; the
// second constructor arg is the tokenizer_config.json (optional; {} is accepted).
const jsonObject = z.record(z.string(), z.unknown());
const tokenizerJson: object = jsonObject.parse(JSON.parse(fs.readFileSync(tokenizerPath, "utf8")));
const configPath = path.join(DIR, "tokenizer_config.json");
const tokenizerConfig: object = fs.existsSync(configPath)
  ? jsonObject.parse(JSON.parse(fs.readFileSync(configPath, "utf8")))
  : {};
const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);

const threshold = z.object({ threshold: z.number() }).parse(JSON.parse(fs.readFileSync(thresholdPath, "utf8"))).threshold;

const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });

interface Encoded {
  ids: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
}

function encodeOne(text: string): Encoded {
  const enc = tokenizer.encode(text, { add_special_tokens: true, return_token_type_ids: true });
  const ids = enc.ids.slice(0, MAX_LENGTH);
  const attentionMask = enc.attention_mask.slice(0, MAX_LENGTH);
  const tokenTypeIds = (enc.token_type_ids ?? enc.ids.map(() => 0)).slice(0, MAX_LENGTH);
  return { ids, attentionMask, tokenTypeIds };
}

// Pad every sequence in the batch to the longest (post-truncation) length. pad_id=0, mask=0, type=0.
function padBatch(encs: Encoded[]): { inputIds: number[][]; attentionMask: number[][]; tokenTypeIds: number[][] } {
  const maxLen = Math.max(...encs.map((e) => e.ids.length), 1);
  const inputIds: number[][] = [];
  const attentionMask: number[][] = [];
  const tokenTypeIds: number[][] = [];
  for (const e of encs) {
    const pad = maxLen - e.ids.length;
    inputIds.push([...e.ids, ...Array.from({ length: pad }, () => PAD_ID)]);
    attentionMask.push([...e.attentionMask, ...Array.from({ length: pad }, () => 0)]);
    tokenTypeIds.push([...e.tokenTypeIds, ...Array.from({ length: pad }, () => 0)]);
  }
  return { inputIds, attentionMask, tokenTypeIds };
}

function toInt64Tensor(rows: number[][], dims: [number, number]): ort.Tensor {
  const flat = new BigInt64Array(rows.length * dims[1]);
  rows.forEach((row, i) => {
    row.forEach((v, j) => {
      flat[i * dims[1] + j] = BigInt(v);
    });
  });
  return new ort.Tensor("int64", flat, dims);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

async function classify(texts: string[]): Promise<{ labels: string[]; scores: Record<string, number> }[]> {
  if (texts.length === 0) {
    return [];
  }
  const encs = texts.map(encodeOne);
  const { inputIds, attentionMask, tokenTypeIds } = padBatch(encs);
  const dims: [number, number] = [texts.length, inputIds[0].length];
  const feeds: Record<string, ort.Tensor> = {
    input_ids: toInt64Tensor(inputIds, dims),
    attention_mask: toInt64Tensor(attentionMask, dims),
    token_type_ids: toInt64Tensor(tokenTypeIds, dims),
  };
  const outputs = await session.run(feeds);
  const logitsTensor = outputs.logits;
  if (!logitsTensor) {
    throw new Error("ONNX model did not return a 'logits' output");
  }
  if (!(logitsTensor.data instanceof Float32Array)) {
    throw new Error("ONNX logits are not float32");
  }
  const logitsData = logitsTensor.data;
  const numClasses = TOPIC_NAMES.length;
  const probs: number[][] = [];
  for (let i = 0; i < texts.length; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < numClasses; j += 1) {
      row.push(sigmoid(Number(logitsData[i * numClasses + j])));
    }
    probs.push(row);
  }
  const preds = applyThreshold(probs, threshold);
  return probs.map((row, i) => ({
    labels: TOPIC_NAMES.filter((_, j) => preds[i][j] === 1),
    scores: Object.fromEntries(TOPIC_NAMES.map((n, j) => [n, Number(row[j].toFixed(4))])),
  }));
}

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

const classifyInSchema = z.object({ texts: z.array(z.string()) });

app.post("/classify", async (c) => {
  const body = await parseJsonBody(c, classifyInSchema);
  const results = await classify(body.texts);
  return c.json({ results });
});

const port = 8110;
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`ch10 classifier serving on http://127.0.0.1:${port} (threshold ${threshold})`);
