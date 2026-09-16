# MewHelp server

Node.js/TypeScript backend for the MewHelp e-commerce customer-service agent. This is the
migrated backend of the Python project in `../python` (static pages and the ch10
training/export pipeline are out of scope). It is not wire-compatible with the Python
service; capabilities are aligned, response shapes are kept close.

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

- relational tables live in `data/mewhelp.db` (Prisma schema in `prisma/schema.prisma`);
- dense embeddings are stored on `knowledge_chunks` and scored in-process;
- BM25 is computed in-process with CJK bigram tokenization, so the four retrieval
  strategies (`vector` / `bm25` / `hybrid` / `hybrid_rerank`) keep working without a
  vector database;
- the LangGraph checkpointer uses `CHECKPOINTER_DB_PATH`.

## Run

```bash
pnpm install
cp .env.example .env   # fill the three upstream groups
pnpm db:push           # create/update the SQLite schema
pnpm start             # http://localhost:8000
```

MCP tool servers run as separate processes:

```bash
pnpm mcp:logistics     # :8101
pnpm mcp:aftersales    # :8102
```

## Knowledge base

```bash
pnpm kb:preview        # dry-run materials + chunk preview
pnpm kb:build          # data/kb/*.md -> knowledge_chunks (pending)
pnpm kb:vectorize      # embed pending chunks
pnpm kb:mine           # mine Q&A pairs from conversations into staging
pnpm kb:repatch        # align edited markdown with existing chunks in place
pnpm kb:reset          # clear chunks/staging
pnpm seed:conv         # seed historical conversations
```

## Evaluation / operations

```bash
pnpm eval:rag          # four-strategy RAG report (data/ch04/reports)
pnpm eval:flywheel     # eval pipeline run -> eval_runs trend
pnpm eval:retrieval    # vector recall acceptance
pnpm eval:judge        # faithfulness judge regression over reviewed cases
pnpm calibrate         # confidence threshold calibration
pnpm cost:report       # per-intent token ledger from Langfuse
pnpm flywheel          # pool -> normalize/dedup -> review queue
```

All of the above are also exposed through `/api/jobs` and the admin overview API.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
```
