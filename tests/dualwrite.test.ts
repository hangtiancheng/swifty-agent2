import { beforeEach, describe, expect, it, vi } from "vitest";

import { settings } from "#/config.ts";
import {
  deleteChunks,
  rependChunks,
  vectorizePending,
} from "#/kb/dualwrite.ts";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  deleteKnowledgeChunks: vi.fn(),
  insertKnowledgeChunks: vi.fn(),
  listChunksForVectorization: vi.fn(),
  markChunkVectorized: vi.fn(),
  markChunkVectorizedExternal: vi.fn(),
  rependChunkTexts: vi.fn(),
  milvusEnabled: vi.fn(),
  upsert: vi.fn(),
  flush: vi.fn(),
  deleteRows: vi.fn(),
}));

vi.mock("#/core/embeddings.ts", () => ({ embedTexts: mocks.embedTexts }));
vi.mock("#/db/repository.ts", () => ({
  deleteKnowledgeChunks: mocks.deleteKnowledgeChunks,
  insertKnowledgeChunks: mocks.insertKnowledgeChunks,
  listChunksForVectorization: mocks.listChunksForVectorization,
  markChunkVectorized: mocks.markChunkVectorized,
  markChunkVectorizedExternal: mocks.markChunkVectorizedExternal,
  rependChunkTexts: mocks.rependChunkTexts,
}));
vi.mock("#/kb/milvus-rpc.ts", () => ({
  milvusEnabled: mocks.milvusEnabled,
  upsert: mocks.upsert,
  flush: mocks.flush,
  deleteRows: mocks.deleteRows,
}));

const pendingRow = {
  id: 7,
  category: "returns",
  questions: "Can I return it?",
  answer: "Yes",
  sectionPath: "Returns",
  contentType: "policy",
  embedding: "[1,0]",
  vectorId: "7",
  vectorizeStatus: "done",
  isKeyClause: 0,
  prevChunkId: null,
  nextChunkId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("knowledge dual write", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
  });

  it("flushes Milvus before marking relational rows done", async () => {
    mocks.milvusEnabled.mockReturnValue(true);
    mocks.listChunksForVectorization.mockResolvedValue([
      pendingRow,
      { ...pendingRow, id: 8 },
    ]);
    mocks.embedTexts.mockResolvedValue([[1, 0]]);
    mocks.upsert.mockResolvedValue(1);
    mocks.flush.mockResolvedValue(undefined);
    mocks.markChunkVectorizedExternal.mockResolvedValue(undefined);

    await expect(vectorizePending(1)).resolves.toBe(2);

    expect(mocks.listChunksForVectorization).toHaveBeenCalledWith(
      true,
      settings.embedModel,
    );
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markChunkVectorizedExternal.mock.invocationCallOrder[0],
    );
  });

  it("removes Milvus rows before deleting relational chunks", async () => {
    mocks.milvusEnabled.mockReturnValue(true);
    mocks.deleteRows.mockResolvedValue(1);
    mocks.deleteKnowledgeChunks.mockResolvedValue(undefined);

    await deleteChunks([7]);

    expect(mocks.deleteRows.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteKnowledgeChunks.mock.invocationCallOrder[0],
    );
  });

  it("removes stale Milvus rows before repending changed text", async () => {
    mocks.milvusEnabled.mockReturnValue(true);
    mocks.deleteRows.mockResolvedValue(1);
    mocks.rependChunkTexts.mockResolvedValue(undefined);
    const updates = [
      { id: 7, questions: "updated question", answer: "updated answer" },
    ];

    await rependChunks(updates);

    expect(mocks.deleteRows).toHaveBeenCalledWith([7]);
    expect(mocks.deleteRows.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rependChunkTexts.mock.invocationCallOrder[0],
    );
    expect(mocks.rependChunkTexts).toHaveBeenCalledWith(updates);
  });
});
