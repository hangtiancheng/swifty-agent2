import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type * as DbExports from "#/db/client.ts";
import type * as RepositoryExports from "#/db/repository.ts";

let db: typeof DbExports;
let repository: typeof RepositoryExports;
let tempDir: string;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swifty-agent2-test-"));
  const dbPath = path.join(tempDir, "test.db");
  const migrationsDir = path.join(process.cwd(), "prisma/migrations");
  const migrations = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const sqlite = new DatabaseSync(dbPath);
  for (const migration of migrations) {
    sqlite.exec(
      fs.readFileSync(
        path.join(migrationsDir, migration.name, "migration.sql"),
        "utf8",
      ),
    );
  }
  sqlite.close();

  process.env.DATABASE_URL = `file:${dbPath}`;
  vi.resetModules();
  db = await import("#/db/client.ts");
  repository = await import("#/db/repository.ts");
});

beforeEach(async () => {
  await db.prisma.$transaction([
    db.prisma.topicClassification.deleteMany(),
    db.prisma.lowConfidenceQuestion.deleteMany(),
    db.prisma.reviewQueue.deleteMany(),
    db.prisma.ticket.deleteMany(),
    db.prisma.message.deleteMany(),
    db.prisma.conversationSummary.deleteMany(),
    db.prisma.faithCase.deleteMany(),
    db.prisma.knowledgeChunk.deleteMany(),
    db.prisma.conversation.deleteMany(),
  ]);
});

afterAll(async () => {
  await db.closeDb();
  delete process.env.DATABASE_URL;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("repository integrity", () => {
  it("does not create a ticket for a missing conversation", async () => {
    await expect(
      repository.createTicket(999, "missing", "inquiry"),
    ).rejects.toThrow();
    await expect(db.prisma.ticket.count()).resolves.toBe(0);
  });

  it("inserts a chunk batch atomically with neighbor links", async () => {
    const ids = await repository.insertKnowledgeChunks([
      { category: "a", questions: "q1", answer: "a1" },
      { category: "a", questions: "q2", answer: "a2" },
      { category: "a", questions: "q3", answer: "a3" },
    ]);
    const rows = await db.prisma.knowledgeChunk.findMany({
      orderBy: { id: "asc" },
    });

    expect(ids).toHaveLength(3);
    expect(rows.map((row) => [row.prevChunkId, row.nextChunkId])).toEqual([
      [null, ids[1]],
      [ids[0], ids[2]],
      [ids[1], null],
    ]);
  });

  it("selects rows that need migration between dense backends", async () => {
    const [id] = await repository.insertKnowledgeChunks([
      { category: "a", questions: "q", answer: "a" },
    ]);

    expect(
      (await repository.listChunksForVectorization(false, "model-a")).map(
        (row) => row.id,
      ),
    ).toEqual([id]);
    await repository.markChunkVectorized(id, String(id), [1, 0], "model-a");
    expect(
      (await repository.listChunksForVectorization(true, "model-a")).map(
        (row) => row.id,
      ),
    ).toEqual([id]);
    await repository.markChunkVectorizedExternal(id, String(id), "model-a");
    expect(
      (await repository.listChunksForVectorization(false, "model-a")).map(
        (row) => row.id,
      ),
    ).toEqual([id]);
    await repository.markChunkVectorized(id, String(id), [1, 0], "model-a");
    expect(
      (await repository.listChunksForVectorization(false, "model-b")).map(
        (row) => row.id,
      ),
    ).toEqual([id]);
  });

  it("prioritizes unresolved faith cases before pagination", async () => {
    await db.prisma.faithCase.createMany({
      data: [
        {
          evalId: "resolved-new",
          bucket: "a",
          query: "q1",
          answer: "a1",
          reason: "r1",
          status: "resolved",
          lastSeenAt: new Date("2026-09-16T12:00:00Z"),
        },
        {
          evalId: "unresolved-old",
          bucket: "a",
          query: "q2",
          answer: "a2",
          reason: "r2",
          status: "unresolved",
          lastSeenAt: new Date("2026-09-15T12:00:00Z"),
        },
      ],
    });

    const page = await repository.listFaithCases(null, 1, 1);

    expect(page.rows[0]?.evalId).toBe("unresolved-old");
    expect(page.total).toBe(2);
  });

  it("matches flywheel rows atomically", async () => {
    const conversationId = await repository.createConversation("user-1");
    const lowConfidenceId = await repository.insertLowConfidence(
      conversationId,
      "raw question",
      "self_check",
      null,
    );

    const first = await repository.matchLowConfidence(
      lowConfidenceId,
      "normalized question",
      "suggested answer",
      null,
    );
    const second = await repository.matchLowConfidence(
      lowConfidenceId,
      "normalized question",
      "suggested answer",
      null,
    );

    expect(first?.created).toBe(true);
    expect(first?.reviewId).toBeTypeOf("number");
    expect(second).toBeNull();
    await expect(db.prisma.reviewQueue.count()).resolves.toBe(1);
  });
});
