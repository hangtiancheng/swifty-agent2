// Model-number guard: any product model mentioned in an answer must appear verbatim in
// the evidence. Mechanical check (regex), no extra judge call.
const MODEL_RE = /MH-[A-Za-z]{1,4}\d{1,4}/g;

export function modelsIn(text: string): string[] {
  const seen = new Set<string>();
  for (const m of String(text ?? "").matchAll(MODEL_RE)) {
    seen.add(m[0]);
  }
  return [...seen];
}

export function unsupportedModels(answer: string, evidence: string): string[] {
  const allowed = new Set(modelsIn(evidence));
  return modelsIn(answer).filter((m) => !allowed.has(m));
}

export function repairHint(bad: string[]): string {
  // Only name the unsupported models; guessing the right one would create a new hallucination.
  return (
    "上一版回答里这些型号在给你的证据里找不到:" +
    bad.join("、") +
    "。请重写回答:型号必须逐字复制证据里出现过的型号串,证据里没有的型号一个都不要写," +
    "拿不准就不提型号。其余内容与引用编号保持不变。"
  );
}
