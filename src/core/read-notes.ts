// Chart annotations ("read notes") generated at report write time, then machine-verified.
//
// The note is generated when the artifact is written (not when the page renders), so the
// dashboard never depends on a live model and every page load shows the same sentence.
import type { ChatOpenAI } from "@langchain/openai";

import { childLogger } from "../logger.ts";

import { getChatModel } from "./llm.ts";
import { contentToString } from "./memory.ts";

const log = childLogger("read-notes");

const MAX_CHARS = 130;
const TIMEOUT_MS = 120_000;

// Numbers inside identifiers (p25, Recall@10, bge-m3) are not conclusions.
const NUM_RE = /(?<![A-Za-z@_.\-\d])\d+(?:,\d{3})*(?:\.\d+)?(?![A-Za-z_])/g;

const KINDS: Record<string, [string, string]> = {
  rag_mrr: [
    "四种检索策略(纯向量 / 纯 BM25 / 混合 / 混合+重排)在四类问题桶(政策类 / 型号类 / 口语类 / 跨文档类)以及总体上的 MRR,越高说明正确证据排得越靠前。",
    "读者要判断哪一路检索该上线,以及每一路的短板在哪个桶。",
  ],
  rag_recall: [
    "同样四策略 × 五桶的 Recall@5,看这题需要的证据在前五条里凑齐了几成;跨文档类一问要两三块不同小节的知识。",
    "读者要判断哪一路会漏证据,漏在哪个桶。",
  ],
  rag_coverage: [
    "证据覆盖度:召回回来的十条证据里,标准答案的要点有几个在。",
    "读者要判断召回的证据够不够答题,不只是「有没有召回到」。",
  ],
  rag_answer_coverage: [
    "端到端答案覆盖度:同一套生成提示词,只换检索策略,最终答案覆盖了标准要点的比例。",
    "读者要看检索差会不会一路传导到答案缺要点。",
  ],
  cost_by_intent: [
    "按意图分堆的 token 账:每条意图的请求数、总 token、单均 token、占总量的比例。单均高说明一次用户提问背后有多次模型调用(多步工具链),与问题数量无关。",
    "读者要决定先给哪条意图瘦 prompt 或换小模型。",
  ],
  eval_trend: [
    "评估流水线最近两轮的四个指标(Recall@5、MRR、Faithfulness、拒答率),以及本轮相对上一轮的涨跌。",
    "读者要判断飞轮写回知识库之后有没有把质量拉下来,该不该去翻最近通过的审核。",
  ],
  confidence_calibration: [
    "证据置信度阈值扫描:每个候选阈值下,库里有答案的题通过率与库外该拒的题放行率,以及选定的那条线。可答被误拦的那些会走兜底进问题池,是数据飞轮的燃料。",
    "读者要理解这条线为什么定在这儿,以及往左右挪要付什么代价。",
  ],
};

const RULES =
  "你在给一个技术看板写「读图」小注,读者是正在学这套系统的开发者。要求:\n" +
  "1. 只能引用我给你的数据里出现的数字,一个都不许自己算、不许估、不许编;\n" +
  `2. 全文不超过 ${MAX_CHARS} 字,一到两句话,最后落在「所以该看哪儿 / 该做什么」上;\n` +
  "3. 中文口语,像同事指着屏幕说话。不用分号,不用破折号,整段最多一个句号;\n" +
  "4. 不要复述图上所有数字,挑最说明问题的一两个;\n" +
  "5. 策略名、题型名一律用我给的中文标签(比如「口语类」),不要出现 C_colloquial 这种英文字段名;\n" +
  "6. 句中停顿用半角逗号「,」,不要用全角「，」,句末用「。」;\n" +
  "7. 四位以上的数写千分位(7,942),跟页面表格里的写法一致;\n" +
  "8. 直接输出这句话本身,不要加引号、标题、markdown 或任何解释。";

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
  let out = text.split(/\s+/).join(" ").trim().replace(/^[「」"'"]+|[「」"'"]+$/g, "");
  out = out.replaceAll("，", ",").replaceAll("；", ",").replaceAll(";", ",");
  out = out.replace(/,\s+/g, ",");
  out = out.replace(/(?<=[\u4e00-\u9fff])(?=[\dA-Za-z])/g, " ");
  out = out.replace(/(?<=[\dA-Za-z%])(?=[\u4e00-\u9fff])/g, " ");
  out = out.replace(/(?<=[A-Za-z]{3})(?=\d)/g, " ");
  out = out.replace(/[!！?？.、,·…\s]+$/g, "");
  return out.endsWith("。") ? out : `${out}。`;
}

export async function generate(kind: string, payload: unknown, model: ChatOpenAI | null = null): Promise<string | null> {
  const spec = KINDS[kind];
  if (!spec) {
    return null;
  }
  const [what, decision] = spec;
  const chat = model ?? getChatModel();
  const prompt = `${RULES}\n\n这张图画的是:${what}\n读者要做的判断:${decision}\n\n数据(JSON):\n${JSON.stringify(payload)}`;
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
