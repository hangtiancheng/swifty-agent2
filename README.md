# swifty-agent2 server

Node.js/TypeScript backend for the swifty-agent2 e-commerce customer-service agent. This is the
migrated backend of the Python project in `~/Downloads/python` (the static pages are out of scope).
It is not wire-compatible with the Python service; capabilities are aligned, response shapes are
kept close.

## Stack

Hono + zod (HTTP), LangChain / LangGraph + SQLite checkpointer (agent graph), Prisma +
better-sqlite3 (data), pino (logging), official MCP SDK (tool servers/clients), Langfuse
over OTel (optional tracing), Vitest + ESLint (tests/lint).

## Upstreams

Three direct upstreams are configured through `.env` (see `.env.example`): chat
(`CHAT_*`), embeddings (`EMBED_*`, OpenAI compatible) and rerank (`RERANK_*`,
Jina/Cohere shaped). Intent and summary slots fall back to the chat group unless
`INTENT_*` / `SUMMARY_*` are set.

## Storage

The Python project used MySQL + Milvus Standalone. This server uses a single SQLite database:

- relational tables live in `data/swifty-agent2.db` (Prisma schema in `prisma/schema.prisma`);
- dense embeddings are stored on `knowledge_chunks` and scored in-process;
- BM25 is computed in-process with CJK bigram tokenization, so the four retrieval
  strategies (`vector` / `bm25` / `hybrid` / `hybrid_rerank`) keep working without a
  vector database;
- the LangGraph checkpointer uses `CHECKPOINTER_DB_PATH`.

### Optional: Milvus dense bridge

Dense retrieval can instead run against real Milvus (Lite, no docker) through a Python gRPC
bridge — `src/milvus/server.py` wraps `pymilvus` behind `src/milvus/kb_store.proto`, and
`src/kb/milvus-rpc.ts` is the Node client:

```bash
make milvus-up                                  # start the bridge on 127.0.0.1:50051
echo 'MILVUS_RPC_URL=127.0.0.1:50051' >> .env   # then restart the Node server
make kb-vectorize                               # re-embed: vectors now upsert into Milvus
node scripts/smoke-milvus.ts                    # end-to-end smoke (throwaway collection)
make milvus-down                                # stop the bridge
```

With `MILVUS_RPC_URL` set, Milvus is the authoritative dense store (the SQLite `embedding`
column stays null; `vector_id` + status are still recorded) and a down bridge surfaces as an
error instead of silently degrading. BM25 always stays in-process, and `hybrid` fuses the two
with reciprocal-rank fusion — unlike the Python original, which ran dense + BM25 + hybrid all
inside Milvus Standalone (its BM25 Function needs Standalone; Lite does not support it).
`make milvus-proto` regenerates the Python stubs after editing the proto.

## train topic classifier (hybrid Python/TypeScript)

Full-parameter transformer train has no JavaScript equivalent, so the train pipeline is split:

- **TypeScript** (`scripts/train/*.ts`, `src/train/`): corpus building, dataset split/augmentation,
  golden-sample gate, threshold-scan replay, bypass batch classification, and the ONNX inference
  service (`scripts/train/serve.ts`, `onnxruntime-node` + `@huggingface/tokenizers`, port `:8110`).
- **Python** (`scripts/train/py/*.py`, run via `uv run --group ml`): the three torch-dependent steps —
  `train.py` (fine-tune), `evaluate.py` (per-class P/R/F1 + confusion matrix + red lines),
  `export_onnx.py` (torch → ONNX with a consistency check). See `pyproject.toml`'s `ml` group.

The authoritative 17-class taxonomy lives in `src/core/taxonomy.ts`. The corpus step exports it to
`data/train/taxonomy.json`, which the Python side reads (`scripts/train/py/taxonomy.py`), so label
ids/names/severity have a single source of truth and cannot drift.

All artifacts land under `data/train/` (gitignored). The acceptance API (`src/api/acceptance.ts`,
`/api/acceptance/*`) reads them and never recomputes, so the page and the terminal share one truth;
a missing artifact returns `present=false` plus the `make` target to run.

> Note: `@huggingface/tokenizers@0.2.0` ships ESM type declarations that use extensionless relative
> imports, which do not resolve under this repo's `nodenext` config. `src/types/huggingface-tokenizers.d.ts`
> provides a minimal ambient declaration for the surface we use; the runtime itself works.

## Offline jobs

`make <target>` and the admin pages' "re-run" buttons share one job runner (`src/core/jobs.ts`); the
front end can only submit a registered job name, never a shell fragment. Course acceptance/smoke
scripts (`scripts/eval-*.ts`, `scripts/smoke-*.ts`, `scripts/validate-*.ts`, `scripts/bare-agent-loop.ts`)
are offline tools that drive a running server or an upstream directly.
