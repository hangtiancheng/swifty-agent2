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
    "These model numbers in the previous answer cannot be found in the evidence given to you: " +
    bad.join(", ") +
    ". Please rewrite the answer: model numbers must be copied verbatim from the model strings that appear in the evidence; " +
    "do not write a single model number absent from the evidence; if unsure, do not mention model numbers at all. " +
    "Keep the rest of the content and the citation numbers unchanged."
  );
}
