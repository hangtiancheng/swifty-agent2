# swifty-agent2 server

Node.js/TypeScript backend for the swifty-agent2 e-commerce customer-service agent. This is the
migrated backend of the Python project in `~/Downloads/python` (the static pages are out of scope).
It is not wire-compatible with the Python service; capabilities are aligned, response shapes are
kept close.

- ch04 => rag
- ch09 => eval
- ch10 => train

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

The Python project used MySQL + Milvus. This server uses a single SQLite database:

- relational tables live in `data/swifty-agent2.db` (Prisma schema in `prisma/schema.prisma`);
- dense embeddings are stored on `knowledge_chunks` and scored in-process;
- BM25 is computed in-process with CJK bigram tokenization, so the four retrieval
  strategies (`vector` / `bm25` / `hybrid` / `hybrid_rerank`) keep working without a
  vector database;
- the LangGraph checkpointer uses `CHECKPOINTER_DB_PATH`.

## ch10 topic classifier (hybrid Python/TypeScript)

Full-parameter transformer train has no JavaScript equivalent, so the ch10 pipeline is split:

- **TypeScript** (`scripts/ch10/*.ts`, `src/train/`): corpus building, dataset split/augmentation,
  golden-sample gate, threshold-scan replay, bypass batch classification, and the ONNX inference
  service (`scripts/ch10/serve.ts`, `onnxruntime-node` + `@huggingface/tokenizers`, port `:8110`).
- **Python** (`scripts/ch10/py/*.py`, run via `uv run --group ml`): the three torch-dependent steps —
  `train.py` (fine-tune), `evaluate.py` (per-class P/R/F1 + confusion matrix + red lines),
  `export_onnx.py` (torch → ONNX with a consistency check). See `pyproject.toml`'s `ml` group.

The authoritative 17-class taxonomy lives in `src/core/taxonomy.ts`. The corpus step exports it to
`data/train/taxonomy.json`, which the Python side reads (`scripts/ch10/py/taxonomy.py`), so label
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
