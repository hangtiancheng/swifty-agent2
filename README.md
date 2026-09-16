# swifty-agent2 server

Node.js/TypeScript backend for the swifty-agent2 e-commerce customer-service agent. This is the
migrated backend of the Python project in `~/Downloads/python` (static pages and the train
training/export pipeline are out of scope). It is not wire-compatible with the Python
service; capabilities are aligned, response shapes are kept close.

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
