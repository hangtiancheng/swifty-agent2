// Question normalization and dedup fingerprints.
// JS \w is ASCII-only, so strip whitespace/punctuation/symbols explicitly and keep CJK.
const STRIP_RE = /[\s\p{P}\p{S}]+/gu;

export function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(STRIP_RE, "");
}

export function dedupeFingerprint(questions: string, answer: string): string {
  return `${normalizeQuestion(questions)}|${normalizeQuestion(answer)}`;
}

export interface DedupItem {
  question: string;
  answer: string;
}

export function dedupe<T extends DedupItem>(items: T[], existingQuestions: string[]): { kept: T[]; discarded: T[] } {
  const seen = new Set(existingQuestions.map((q) => normalizeQuestion(q)));
  const kept: T[] = [];
  const discarded: T[] = [];
  for (const item of items) {
    const key = normalizeQuestion(item.question);
    if (!key || seen.has(key)) {
      discarded.push(item);
    } else {
      seen.add(key);
      kept.push(item);
    }
  }
  return { kept, discarded };
}
