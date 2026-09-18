.DEFAULT_GOAL := help

.PHONY: help
help:
	@grep -E '^[a-z][a-z0-9-]*:.*?## ' $(MAKEFILE_LIST) \
		| sed 's/:.*## /\t/' | sort | awk -F'\t' '{printf "  %-22s %s\n", $$1, $$2}'

.PHONY: dev
dev: mcp-up ## Start MCP servers and the API
	pnpm dev

.PHONY: dev-down
dev-down: mcp-down ## Stop background development services

.PHONY: kb-build
kb-build:
	pnpm exec tsx scripts/kb-build.ts

.PHONY: kb-vectorize
kb-vectorize:
	pnpm exec tsx scripts/kb-vectorize.ts

.PHONY: kb-mine
kb-mine:
	pnpm exec tsx scripts/kb-mine.ts

.PHONY: kb-reset
kb-reset:
	pnpm exec tsx scripts/kb-reset.ts

.PHONY: kb-preview
kb-preview:
	pnpm exec tsx scripts/kb-preview.ts

.PHONY: kb-repatch
kb-repatch:
	pnpm exec tsx scripts/kb-repatch.ts

# Milvus dense bridge (src/milvus/server.py): dense-only gRPC bridge over Milvus Lite.
# Start it, then set MILVUS_RPC_URL=127.0.0.1:50051 in .env to make dense retrieval use it.
.PHONY: milvus-up
milvus-up:
	@mkdir -p log data/milvus
	@nohup uv run python src/milvus/server.py > log/milvus.log 2>&1 & echo $$! > data/milvus.pid
	@sleep 3 && grep -q "listening" log/milvus.log && echo "Milvus bridge started: 127.0.0.1:50051 (pid in data/milvus.pid)" || (echo "Start failed; see log/milvus.log:"; tail -5 log/milvus.log)

.PHONY: milvus-down
milvus-down:
	-@kill `cat data/milvus.pid 2>/dev/null` 2>/dev/null; rm -f data/milvus.pid
	@echo "Milvus bridge stopped"

.PHONY: milvus-proto
milvus-proto:
	@mkdir -p src/milvus/pb
	uv run python -m grpc_tools.protoc -I src/milvus --python_out=src/milvus/pb --grpc_python_out=src/milvus/pb --mypy_out=src/milvus/pb --mypy_grpc_out=src/milvus/pb src/milvus/kb_store.proto
	@echo "Regenerated src/milvus/pb/kb_store_pb2.py/.pyi and kb_store_pb2_grpc.py/.pyi"

.PHONY: seed-conv
seed-conv:
	pnpm exec tsx scripts/seed-conv.ts

.PHONY: flywheel
flywheel:
	pnpm exec tsx scripts/flywheel.ts

.PHONY: eval-rag
eval-rag:
	pnpm exec tsx scripts/eval-rag.ts $(if $(SKIP_GEN),--skip-gen,)

.PHONY: eval-flywheel
eval-flywheel:
	pnpm exec tsx scripts/eval-flywheel.ts --triggered-by $(or $(TRIGGER),manual)

.PHONY: eval-retrieval
eval-retrieval:
	pnpm exec tsx scripts/eval-retrieval.ts

.PHONY: eval-judge
eval-judge:
	pnpm exec tsx scripts/eval-judge.ts

.PHONY: calibrate-confidence
calibrate-confidence:
	pnpm exec tsx scripts/calibrate-confidence.ts

.PHONY: cost-report
cost-report:
	pnpm exec tsx scripts/cost-report.ts --days $(or $(DAYS),7)

.PHONY: mcp-logistics
mcp-logistics:
	pnpm exec tsx src/mcp-servers/logistics.ts

.PHONY: mcp-aftersales
mcp-aftersales:
	pnpm exec tsx src/mcp-servers/aftersales.ts

.PHONY: mcp-up
mcp-up: ## Start both MCP servers
	@mkdir -p log data
	@nohup tsx src/mcp-servers/logistics.ts > log/mcp-logistics.log 2>&1 & echo $$! > data/mcp-logistics.pid
	@nohup tsx src/mcp-servers/aftersales.ts > log/mcp-aftersales.log 2>&1 & echo $$! > data/mcp-aftersales.pid
	@sleep 1 && echo "MCP servers started: logistics=:8101 aftersales=:8102"

.PHONY: mcp-down
mcp-down: ## Stop both MCP servers
	-@kill `cat data/mcp-logistics.pid 2>/dev/null` 2>/dev/null; rm -f data/mcp-logistics.pid
	-@kill `cat data/mcp-aftersales.pid 2>/dev/null` 2>/dev/null; rm -f data/mcp-aftersales.pid

# train topic classifier: corpus -> dataset -> train/eval/export (Python, torch) -> threshold scan
# -> serve (:8110) -> bypass batch classification.
.PHONY: train-golden
train-golden:
	pnpm exec tsx scripts/train/validate-golden.ts

.PHONY: train-corpus
train-corpus:
	pnpm exec tsx scripts/train/build-corpus.ts

.PHONY: train-dataset
train-dataset:
	pnpm exec tsx scripts/train/build-dataset.ts

.PHONY: train
train:
	uv run python scripts/train/py/train.py

.PHONY: train-eval
train-eval:
	uv run python scripts/train/py/evaluate.py

.PHONY: train-export
train-export:
	uv run python scripts/train/py/export_onnx.py

.PHONY: train-typecheck
train-typecheck:
	uv run --with mypy mypy scripts/train/py

.PHONY: train-threshold-scan
train-threshold-scan:
	pnpm exec tsx scripts/train/scan-threshold-replay.ts

.PHONY: classifier-up
classifier-up:
	@mkdir -p log data
	@nohup tsx scripts/train/serve.ts > log/classifier.log 2>&1 & echo $$! > data/classifier.pid
	@sleep 2 && curl -sf http://127.0.0.1:8110/healthz >/dev/null && echo "Classifier service started: :8110 (pid in data/classifier.pid)" || echo "Start failed; see log/classifier.log"

.PHONY: classifier-down
classifier-down:
	-@kill `cat data/classifier.pid 2>/dev/null` 2>/dev/null; rm -f data/classifier.pid
	@echo "Classifier service stopped"

.PHONY: classify-pool
classify-pool:
	pnpm exec tsx scripts/train/classify-pool.ts

.PHONY: classify-force
classify-pool-force:
	pnpm exec tsx scripts/train/classify-pool.ts --force

# GitHub MCP server (mcp/, TypeScript): github_* tools over the gh CLI or GITHUB_TOKEN.
.PHONY: agent2-mcp
agent2-mcp: ## Run the GitHub MCP server over stdio
	pnpm exec tsx mcp/src/main.ts

.PHONY: agent2-http
agent2-mcp-http: ## Run the GitHub MCP server over HTTP (Streamable HTTP + SSE)
	pnpm exec tsx mcp/src/main.ts --http
