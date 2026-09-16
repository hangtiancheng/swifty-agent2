// Dry-run knowledge base preview: list materials and show structured chunks without writing.
import fs from "node:fs";
import path from "node:path";

import * as chunking from "../src/kb/chunking.ts";
import * as documents from "../src/kb/documents.ts";
import { KB_DIR, SOURCE_TYPES } from "../src/kb/sources.ts";

function preview(text: string, n = 46): string {
  const one = text.split(/\s+/).join(" ");
  return one.length <= n ? one : `${one.slice(0, n)}…`;
}

async function main(): Promise<void> {
  console.log("=== 离线建库材料清单 ===");
  console.log("文档(结构化切块 → knowledge_chunks):");
  for (const [fname, ctype] of Object.entries(SOURCE_TYPES)) {
    const raw = fs.readFileSync(path.join(KB_DIR, fname), "utf8");
    console.log(`  data/kb/${fname.padEnd(24)} [${ctype.padEnd(6)}] ${String(raw.length).padStart(4)} 字符 / ${raw.split("\n").length} 行`);
  }

  console.log("\n=== 切块预览(dry-run,不写库)===");
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
    console.log(`\n▼ ${fname} [${ctype}]  →  ${chunks.length} 块`);
    for (const [sectionPath, group] of byPath) {
      const multi = group.length > 1 ? `  (该节切成 ${group.length} 块)` : "";
      console.log(`  ┌ 节:${sectionPath}${multi}`);
      group.forEach((c, j) => {
        keyTotal += c.isKeyClause;
        const flag = c.isKeyClause ? " ★关键条款" : "";
        const seq = group.length > 1 ? `${j + 1}/${group.length}` : "-";
        const isTable = chunking.isTableBlock(c.answer);
        const kind = isTable ? "表格块" : "文本块";
        console.log(`  │ [${kind} ${seq}]${flag}  Q(questions)=${c.questions}  category=${c.category}`);
        console.log(`  │   A(${c.answer.length}字): ${preview(c.answer)}`);
        if (isTable && group.length > 1) {
          const header = c.answer.trim().split("\n")[0];
          tableNotes.push(`${fname}「${sectionPath.split(" / ").slice(-1)[0]}」块${seq} 复制表头: ${header.trim()}`);
        }
      });
    }
  }
  console.log("\n=== 汇总 ===");
  console.log(`总块数 ${Object.values(tally).reduce((a, b) => a + b, 0)};类型分布 ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`关键条款(is_key_clause=1)共 ${keyTotal} 块(命中 运费/邮费/退款/保修 等词)`);
  if (tableNotes.length > 0) {
    console.log("表格按行拆(表头复制)已触发:");
    for (const n of tableNotes) {
      console.log(`  · ${n}`);
    }
  }
}

await main();
