// Dry-run knowledge base preview: list materials and show structured chunks without writing.
import fs from "node:fs";
import path from "node:path";

import * as chunking from "#/kb/chunking.ts";
import * as documents from "#/kb/documents.ts";
import { KB_DIR, SOURCE_TYPES } from "#/kb/sources.ts";

function preview(text: string, n = 46): string {
  const one = text.split(/\s+/).join(" ");
  return one.length <= n ? one : `${one.slice(0, n)}…`;
}

async function main(): Promise<void> {
  console.log("=== Offline KB build material list ===");
  console.log("Documents (structured chunking → knowledge_chunks):");
  for (const [fname, ctype] of Object.entries(SOURCE_TYPES)) {
    const raw = fs.readFileSync(path.join(KB_DIR, fname), "utf8");
    console.log(
      `  data/kb/${fname.padEnd(24)} [${ctype.padEnd(6)}] ${String(raw.length).padStart(4)} chars / ${raw.split("\n").length} lines`,
    );
  }

  console.log("\n=== Chunk preview (dry-run, nothing written) ===");
  const tally: Record<string, number> = {};
  let keyTotal = 0;
  const tableNotes: string[] = [];
  for (const [fname, ctype] of Object.entries(SOURCE_TYPES)) {
    const md = fs.readFileSync(path.join(KB_DIR, fname), "utf8");
    const chunks = await documents.buildChunks(md, ctype);
    tally[ctype] = (tally[ctype] ?? 0) + chunks.length;
    const byPath = new Map<string, documents.Chunk[]>();
    for (const c of chunks) {
      const list = byPath.get(c.sectionPath) ?? [];
      list.push(c);
      byPath.set(c.sectionPath, list);
    }
    console.log(`\n▼ ${fname} [${ctype}]  →  ${chunks.length} chunks`);
    for (const [sectionPath, group] of byPath) {
      const multi = group.length > 1 ? `  (this section split into ${group.length} chunks)` : "";
      console.log(`  ┌ section: ${sectionPath}${multi}`);
      group.forEach((c, j) => {
        keyTotal += c.isKeyClause;
        const flag = c.isKeyClause ? " ★key clause" : "";
        const seq = group.length > 1 ? `${j + 1}/${group.length}` : "-";
        const isTable = chunking.isTableBlock(c.answer);
        const kind = isTable ? "table chunk" : "text chunk";
        console.log(
          `  │ [${kind} ${seq}]${flag}  Q(questions)=${c.questions}  category=${c.category}`,
        );
        console.log(`  │   A(${c.answer.length} chars): ${preview(c.answer)}`);
        if (isTable && group.length > 1) {
          const header = c.answer.trim().split("\n")[0];
          tableNotes.push(
            `${fname} "${sectionPath.split(" / ").slice(-1)[0]}" chunk ${seq} copies the header: ${header.trim()}`,
          );
        }
      });
    }
  }
  console.log("\n=== Summary ===");
  console.log(
    `Total chunks ${Object.values(tally).reduce((a, b) => a + b, 0)}; type distribution ${Object.entries(
      tally,
    )
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  console.log(
    `Key clauses (is_key_clause=1): ${keyTotal} chunks (matching terms such as shipping fee/postage/refund/warranty)`,
  );
  if (tableNotes.length > 0) {
    console.log("Row-wise table splitting (header copied) triggered:");
    for (const n of tableNotes) {
      console.log(`  · ${n}`);
    }
  }
}

await main();
