@eslint.config.js

- MUST Ignore ALL eslint warnings
- NEVER add MIT license header manually
- Swifty Agent2 is a pure English project
- Ensure good type annotation for python code

## Milvus migration (Python Milvus => Node -> gRPC -> Milvus Lite)

The Python original ran Milvus Standalone with dense + sparse(BM25) + hybrid all inside
Milvus. This stack migrated the dense path instead of avoiding it:

- Node (`src/kb/store.ts`, `src/kb/dualwrite.ts`) -> gRPC client (`src/kb/milvus-rpc.ts`,
  `@grpc/grpc-js` + `@grpc/proto-loader`) -> Python bridge (`src/milvus/server.py`,
  contract in `src/milvus/kb_store.proto`) -> Milvus Lite (`data/milvus/kb.db`, no docker).
- Opt-in via `MILVUS_RPC_URL` (empty = legacy in-process cosine over SQLite embeddings).
  When set, Milvus is the authoritative dense store; `make milvus-up/down`, smoke with
  `node scripts/smoke-milvus.ts`.
- BM25 stays in-process (CJK bigrams over `knowledge_chunks` text); `hybrid` fuses dense +
  BM25 with reciprocal-rank fusion in Node. Collection dim is inferred from the first
  upserted embedding (model-agnostic, never hardcoded).
- Do not reintroduce "no Milvus" assumptions in comments or docs; the bridge is real.
