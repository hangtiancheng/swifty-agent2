// Smoke the Milvus dense bridge end to end: spawn an isolated Python gRPC server (throwaway
// Lite db + "smoke" collection), then drive the JS client (src/kb/milvus-rpc.ts) through
// upsert -> search -> count -> delete -> drop. A failure is a red line: stop.
//
// This is the JS counterpart of the Python original's Milvus smoke, scoped to dense only: the
// bridge wraps Milvus Lite, while BM25 stays in-process on the Node side (see src/kb/store.ts).
// It runs against a throwaway collection so it never touches a real knowledge base.
// Run: node scripts/smoke-milvus.ts (requires uv + the milvus deps: pymilvus, milvus-lite, grpcio)
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MilvusRow } from "#/kb/milvus-rpc.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => {
        if (port === 0) {
          reject(new Error("could not allocate a free port"));
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function main(): Promise<void> {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-milvus-"));
  const db = path.join(dir, "kb.db");

  // Point the bridge client at the throwaway server BEFORE config.ts is imported (loadEnvFile
  // does not override an already-set process.env value).
  process.env.MILVUS_RPC_URL = `127.0.0.1:${port}`;

  const server: ChildProcess = spawn(
    "uv",
    [
      "run",
      "python",
      path.join(ROOT, "src", "milvus", "server.py"),
      "--uri",
      db,
      "--port",
      String(port),
      "--collection",
      "smoke",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  let serverLog = "";
  server.stdout?.on("data", (chunk: Buffer) => {
    serverLog += chunk.toString();
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    serverLog += chunk.toString();
  });

  const milvus = await import("#/kb/milvus-rpc.ts");

  try {
    // Wait for the bridge to accept calls (Milvus Lite init takes a moment). count() fails fast
    // with UNAVAILABLE until the server is listening, so polling is cheap.
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(250);
      if (server.exitCode !== null) {
        break;
      }
      try {
        await milvus.count();
        ready = true;
        break;
      } catch {
        // not ready yet
      }
    }
    if (!ready) {
      throw new Error(
        `bridge did not become ready on :${port}; log:\n${serverLog}`,
      );
    }
    console.log(`bridge ready on 127.0.0.1:${port} (collection=smoke)`);

    const rows: MilvusRow[] = [
      {
        id: 1,
        dense: [0.1, 0.2, 0.3, 0.4],
        question: "shipping fee?",
        answer: "free over 99",
        section_path: "logistics/fee",
        content_type: "faq",
        category: "logistics",
      },
      {
        id: 2,
        dense: [0.9, 0.8, 0.7, 0.6],
        question: "return policy?",
        answer: "7 days",
        section_path: "refund/policy",
        content_type: "faq",
        category: "refund",
      },
      {
        id: 3,
        dense: [0.11, 0.2, 0.3, 0.4],
        question: "delivery time?",
        answer: "2-3 days",
        section_path: "logistics/time",
        content_type: "faq",
        category: "logistics",
      },
    ];
    const upserted = await milvus.upsert(rows);
    console.log("upserted:", upserted);
    if (upserted !== 3) {
      throw new Error(`expected 3 rows upserted, got ${upserted}`);
    }
    await milvus.flush();

    const total = await milvus.count();
    console.log("count:", total);
    if (total !== 3) {
      throw new Error(`expected count 3, got ${total}`);
    }

    // The query vector equals row 1, so COSINE should rank id=1 first at ~1.0.
    const hits = await milvus.search([0.1, 0.2, 0.3, 0.4], 3, null);
    console.log(
      "search:",
      JSON.stringify(hits.map((h) => [h.id, Number(h.score.toFixed(4))])),
    );
    if (hits.length === 0) {
      throw new Error("search returned no hits");
    }
    const top = hits[0];
    if (top.id !== 1) {
      throw new Error(`expected id 1 ranked first, got ${top.id}`);
    }
    if (top.score < 0.99) {
      throw new Error(
        `expected ~1.0 cosine for an exact match, got ${top.score}`,
      );
    }

    // A category filter must exclude the other categories.
    const filtered = await milvus.search([0.1, 0.2, 0.3, 0.4], 3, "refund");
    console.log(
      "filtered(refund):",
      JSON.stringify(filtered.map((h) => [h.id, h.category])),
    );
    if (filtered.some((h) => h.category !== "refund")) {
      throw new Error("category filter leaked rows from other categories");
    }

    const deleted = await milvus.deleteRows([2]);
    if (deleted !== 1 || (await milvus.count()) !== 2) {
      throw new Error("delete did not remove the requested row");
    }

    await milvus.drop();
    const afterDrop = await milvus.count();
    console.log("count after drop:", afterDrop);
    if (afterDrop !== 0) {
      throw new Error(`expected 0 after drop, got ${afterDrop}`);
    }

    console.log(
      "GO: Milvus dense bridge (gRPC + Milvus Lite) upsert/search/count/drop all live",
    );
  } finally {
    server.kill("SIGTERM");
    await sleep(300);
    if (server.exitCode === null) {
      server.kill("SIGKILL");
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

await main();
