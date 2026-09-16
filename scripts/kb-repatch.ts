// Patch-style re-ingest: align data/kb/*.md chunks with DB rows by (section path, index)
// and update only the bodies that changed. Flywheel-written chunks are never touched.
import fs from "node:fs";
import path from "node:path";

import { closeDb } from "@/db/client.ts";
import * as repository from "@/db/repository.ts";
import * as documents from "@/kb/documents.ts";
import { KB_DIR, SOURCE_TYPES } from "@/kb/sources.ts";

function norm(s: string): string {
  return (s ?? "")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

async function main(): Promise<void> {
  const inDb = await repository.listChunksByContentTypes(
    Object.values(SOURCE_TYPES),
  );
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
        console.log(
          `  + present in the file but not in the DB (this script does not insert; use kb-build / the ingest page): ${chunk.sectionPath} chunk ${i + 1}`,
        );
        added += 1;
        continue;
      }
      if (
        norm(row.answer) === norm(chunk.answer) &&
        norm(row.questions) === norm(chunk.questions)
      ) {
        continue;
      }
      await repository.rependChunkText(row.id, chunk.questions, chunk.answer);
      console.log(`  ~ body updated (id=${row.id}): ${chunk.sectionPath}`);
      changed += 1;
    }
  }

  for (const [sectionPath, rows] of byPath) {
    const start = used.get(sectionPath) ?? 0;
    for (const row of rows.slice(start)) {
      console.log(
        `  ! in the DB but not in the file (left untouched; may have been written back by the flywheel): id=${row.id} ${sectionPath}`,
      );
    }
  }

  const pending = await repository.countChunksByStatus("pending");
  console.log(
    `\n${changed} chunks changed · ${added} new sections · ${pending} chunks currently pending`,
  );
}

await main();
await closeDb();
