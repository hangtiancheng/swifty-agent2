// Eval-set self-check (rag): the 300 hand-written ground-truth rows are guarded by this script,
// not by eyeballing.
//
// Checks five things:
//   1) id and query are unique, and the five buckets have equal counts;
//   2) each answerable bucket's expect_section hits at least one KB section (0 hits = always a miss);
//   3) expect_points must appear verbatim (whitespace-stripped) in the target section body — evidence
//      coverage is a mechanical substring match, so a point written differently from the KB never scores;
//      the cross-document bucket (E_multi) uses expect_sections_all: every group must hit a section,
//      and points are looked up in the union of those groups;
//   4) the D bucket must carry no ground truth, and should_refuse must agree with the bucket;
//   5) warn on questions whose expect_section is judged too loosely (one keyword hits many sections,
//      inflating recall).
//
// The Python version read KB text from Milvus; here it comes from the local store over
// knowledge_chunks (the same rows retrieval uses). Run: node scripts/validate-eval-rag.ts
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { settings } from "#/config.ts";
import { closeDb } from "#/db/client.ts";
import { listVectorizedChunks } from "#/db/repository.ts";

const EVALSET = path.join(settings.root, "tests/data/eval_rag.jsonl");
const GRADED_BUCKETS = new Set([
  "A_policy",
  "B_model",
  "C_colloquial",
  "E_multi",
]);
const LOOSE_LIMIT = 4; // warn when one expect_section hits more sections than this

const rowSchema = z.object({
  id: z.string(),
  bucket: z.string(),
  query: z.string(),
  expect_section: z.array(z.string()),
  expect_points: z.array(z.string()),
  expect_sections_all: z
    .array(z.union([z.string(), z.array(z.string())]))
    .optional(),
  should_refuse: z.boolean(),
});
type Row = z.infer<typeof rowSchema>;

const norm = (s: string): string => (s ?? "").split(/\s+/).join("");

function counter(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) {
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

async function kbTextBySection(): Promise<Map<string, string>> {
  const rows = await listVectorizedChunks();
  const out = new Map<string, string>();
  for (const r of rows) {
    const key = r.section_path || "";
    out.set(key, (out.get(key) ?? "") + `${r.question}:${r.answer}\n`);
  }
  return out;
}

async function main(): Promise<number> {
  const rows: Row[] = fs
    .readFileSync(EVALSET, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => rowSchema.parse(JSON.parse(l)));
  const textBySection = await kbTextBySection();
  const allText = norm([...textBySection.values()].join(""));
  const errs: string[] = [];
  const warns: string[] = [];

  const uniquenessChecks: [string, string[]][] = [
    ["id", rows.map((r) => r.id)],
    ["query", rows.map((r) => r.query)],
  ];
  for (const [label, values] of uniquenessChecks) {
    const dup = [...counter(values).entries()]
      .filter(([, n]) => n > 1)
      .map(([v]) => v);
    if (dup.length > 0) {
      errs.push(`${label} duplicated: ${JSON.stringify(dup)}`);
    }
  }
  const perBucket = counter(rows.map((r) => r.bucket));
  if (new Set(perBucket.values()).size !== 1) {
    errs.push(
      `bucket counts differ: ${JSON.stringify(Object.fromEntries(perBucket))}`,
    );
  }

  const sections = [...textBySection.keys()];
  const candHist = new Map<number, number>();
  for (const r of rows) {
    const rid = r.id;
    if (!GRADED_BUCKETS.has(r.bucket)) {
      if (r.expect_section.length > 0 || r.expect_points.length > 0) {
        errs.push(`${rid}: the D bucket must not carry ground truth`);
      }
      if (!r.should_refuse) {
        errs.push(`${rid}: the D bucket's should_refuse must be true`);
      }
      continue;
    }
    if (r.should_refuse) {
      errs.push(`${rid}: an answerable bucket's should_refuse must be false`);
    }
    if (r.expect_section.length === 0 || r.expect_points.length === 0) {
      errs.push(`${rid}: missing expect_section or expect_points`);
      continue;
    }
    const groups: (string | string[])[] = r.expect_sections_all ?? [
      r.expect_section,
    ];
    let matched: string[] = [];
    let bad = false;
    groups.forEach((rawG, gi) => {
      const g = Array.isArray(rawG) ? rawG : [rawG];
      const hit = sections.filter((p) => g.some((w) => p.includes(w)));
      if (hit.length === 0) {
        errs.push(
          `${rid}: group ${gi + 1} ${JSON.stringify(g)} hits 0 sections`,
        );
        bad = true;
      } else if (hit.length > LOOSE_LIMIT) {
        warns.push(
          `${rid}: group ${gi + 1} ${JSON.stringify(g)} hits ${hit.length} sections, judged too loosely`,
        );
      }
      matched = matched.concat(hit);
    });
    if (bad) {
      continue;
    }
    matched = [...new Set(matched)].sort();
    candHist.set(groups.length, (candHist.get(groups.length) ?? 0) + 1);
    const target = norm(
      matched.map((p) => textBySection.get(p) ?? "").join(""),
    );
    for (const pt of r.expect_points) {
      if (!target.includes(norm(pt))) {
        const where = allText.includes(norm(pt))
          ? "in the KB but not in the target section"
          : "not found anywhere in the KB";
        errs.push(`${rid}: point "${pt}" ${where}`);
      }
    }
  }

  const sortedCand = [...candHist.entries()].sort((a, b) => a[0] - b[0]);
  console.log(
    `Eval set ${rows.length} questions · per bucket ${JSON.stringify(Object.fromEntries(perBucket))} · KB ${textBySection.size} sections`,
  );
  console.log(
    `Answerable questions' "how many evidence groups" distribution: ${JSON.stringify(Object.fromEntries(sortedCand))}`,
  );
  for (const e of errs) {
    console.log("  ✗", e);
  }
  for (const w of warns) {
    console.log("  !", w);
  }
  console.log(
    `\n${errs.length} errors · ${warns.length} warnings` +
      (errs.length === 0 ? " — self-check passed" : " — self-check FAILED"),
  );
  return errs.length > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} finally {
  await closeDb();
}
