// train data pipeline pure functions: desensitization, dedup and stratified splitting.
// No network or DB access — unit-testable in isolation.
import { LABEL2ID } from "#/core/taxonomy.ts";

export interface CorpusSample {
  text: string;
  labels: string[];
  origin?: string | undefined;
}

// Contact info and long identifiers are the mechanically-detectable PII in this locale.
// Product model numbers (letter-prefixed, short) do not match and are left untouched.
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const LONG_DIGITS = /\d{10,}/g; // order / tracking / phone-style long digit runs
const HANDLE = /@[A-Za-z0-9_]{3,}/g;

export function desensitize(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(LONG_DIGITS, "[number]")
    .replace(HANDLE, "[handle]");
}

export function dedupe(samples: CorpusSample[]): CorpusSample[] {
  // Exact dedup on text, keeping the first occurrence in order; trims surrounding whitespace.
  const seen = new Set<string>();
  const out: CorpusSample[] = [];
  for (const s of samples) {
    const t = s.text.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push({ ...s, text: t });
    }
  }
  return out;
}

// Deterministic seeded RNG (mulberry32) + Fisher-Yates shuffle so the split is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr: unknown[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function labelIds(labels: string[]): number[] {
  return labels
    .map((l) => LABEL2ID[l])
    .filter((id): id is number => id !== undefined)
    .sort((a, b) => a - b);
}

export function splitDataset(
  samples: CorpusSample[],
  seed = 42,
): [CorpusSample[], CorpusSample[], CorpusSample[]] {
  // 80/10/10 stratified split, stratifying on the label-id combination. Combinations with
  // fewer than 10 samples fold into the single-label stratum of their smallest label id, so
  // small classes do not vanish from validation/test. Strata with <3 samples go wholly to train.
  const rng = mulberry32(seed);

  const combos = new Map<string, CorpusSample[]>();
  for (const s of samples) {
    const key = labelIds(s.labels).join(",");
    const bucket = combos.get(key);
    if (bucket) {
      bucket.push(s);
    } else {
      combos.set(key, [s]);
    }
  }

  const strata = new Map<string, CorpusSample[]>();
  for (const [key, items] of combos) {
    const target =
      items.length >= 10
        ? key
        : String(Math.min(...key.split(",").map(Number)));
    const bucket = strata.get(target);
    if (bucket) {
      bucket.push(...items);
    } else {
      strata.set(target, [...items]);
    }
  }

  const train: CorpusSample[] = [];
  const val: CorpusSample[] = [];
  const test: CorpusSample[] = [];
  // Sort stratum keys (by ascending label id) so the split is deterministic.
  const keys = [...strata.keys()].sort((a, b) => {
    const ka = a.split(",").map(Number);
    const kb = b.split(",").map(Number);
    for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
      const d = (ka[i] ?? Infinity) - (kb[i] ?? Infinity);
      if (d !== 0) {
        return d;
      }
    }
    return ka.length - kb.length;
  });
  for (const key of keys) {
    const items = strata.get(key) ?? [];
    shuffle(items, rng);
    const n = items.length;
    const nTest = n >= 3 ? Math.max(1, Math.round(n * 0.1)) : 0;
    const nVal = n >= 3 ? Math.max(1, Math.round(n * 0.1)) : 0;
    test.push(...items.slice(0, nTest));
    val.push(...items.slice(nTest, nTest + nVal));
    train.push(...items.slice(nTest + nVal));
  }
  return [train, val, test];
}
