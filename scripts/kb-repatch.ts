// Patch-style re-ingest: align data/kb/*.md chunks with DB rows by (section path, index)
// and update only the bodies that changed. Flywheel-written chunks are never touched.
import fs from "node:fs";
import path from "node:path";

import { closeDb } from "../src/db/client.ts";
import * as repository from "../src/db/repository.ts";
import * as documents from "../src/kb/documents.ts";
import { KB_DIR, SOURCE_TYPES } from "../src/kb/sources.ts";

function norm(s: string): string {
  return (s ?? "")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

async function main(): Promise<void> {
  const inDb = await repository.listChunksByContentTypes(Object.values(SOURCE_TYPES));
  // A section path can map to several chunks (large tables are split); align by path + index.
  const byPath = new Map<string, typeof inDb>();
  for (const row of inDb) {
    const key = row.sectionPath ?? "";
    const list = byPath.get(key) ?? [];
    list.push(row);
    byPath.set(key, list);
  }
  const used = new Map<string, number>();
  let changed = 0;
  let added = 0;

  for (const [fname, ctype] of Object.entries(SOURCE_TYPES)) {
    const md = fs.readFileSync(path.join(KB_DIR, fname), "utf8");
    for (const chunk of await documents.buildChunks(md, ctype)) {
      const i = used.get(chunk.sectionPath) ?? 0;
      used.set(chunk.sectionPath, i + 1);
      const rows = byPath.get(chunk.sectionPath) ?? [];
      const row = rows[i];
      if (row === undefined) {
        console.log(`  + 文件里有、库里没有(本脚本不插,走 kb-build / 录入页):${chunk.sectionPath} 第 ${i + 1} 块`);
        added += 1;
        continue;
      }
      if (norm(row.answer) === norm(chunk.answer) && norm(row.questions) === norm(chunk.questions)) {
        continue;
      }
      await repository.rependChunkText(row.id, chunk.questions, chunk.answer);
      console.log(`  ~ 正文已更新(id=${row.id}):${chunk.sectionPath}`);
      changed += 1;
    }
  }

  for (const [sectionPath, rows] of byPath) {
    const start = used.get(sectionPath) ?? 0;
    for (const row of rows.slice(start)) {
      console.log(`  ! 库里有、文件里没有(不动它,可能是飞轮写回的):id=${row.id} ${sectionPath}`);
    }
  }

  const pending = await repository.countChunksByStatus("pending");
  console.log(`\n改动 ${changed} 块 · 新小节 ${added} 个 · 当前 pending ${pending} 块`);
}

await main();
await closeDb();
