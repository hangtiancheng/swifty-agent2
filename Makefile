kb-build:
	node scripts/kb-build.ts

kb-vectorize:
	node scripts/kb-vectorize.ts

kb-mine:
	node scripts/kb-mine.ts

kb-reset:
	node scripts/kb-reset.ts

kb-preview:
	node scripts/kb-preview.ts

kb-repatch:
	node scripts/kb-repatch.ts

# Milvus dense bridge (src/milvus/server.py): dense-only gRPC bridge over Milvus Lite.
# Start it, then set MILVUS_RPC_URL=127.0.0.1:50051 in .env to make dense retrieval use it.
milvus-up:
	@mkdir -p log data/milvus
	@nohup uv run python src/milvus/server.py > log/milvus.log 2>&1 & echo $$! > data/milvus.pid
	@sleep 3 && grep -q "listening" log/milvus.log && echo "Milvus bridge started: 127.0.0.1:50051 (pid in data/milvus.pid)" || (echo "Start failed; see log/milvus.log:"; tail -5 log/milvus.log)

milvus-down:
	-@kill `cat data/milvus.pid 2>/dev/null` 2>/dev/null; rm -f data/milvus.pid
	@echo "Milvus bridge stopped"

milvus-proto:
	uv run python -m grpc_tools.protoc -I src/milvus --python_out=src/milvus --grpc_python_out=src/milvus src/milvus/kb_store.proto
	@echo "Regenerated src/milvus/kb_store_pb2.py and kb_store_pb2_grpc.py"

seed-conv:
	node scripts/seed-conv.ts

flywheel:
	node scripts/flywheel.ts

eval-rag:
	node scripts/eval-rag.ts

eval-flywheel:
	node scripts/eval-flywheel.ts

eval-retrieval:
	node scripts/eval-retrieval.ts

eval-judge:
	node scripts/eval-judge.ts

calibrate:
	node scripts/calibrate-confidence.ts

cost-report:
	node scripts/cost-report.ts

mcp-logistics:
	node src/mcp-servers/logistics.ts

mcp-aftersales:
	node src/mcp-servers/aftersales.ts

# train topic classifier: corpus -> dataset -> train/eval/export (Python, torch) -> threshold scan
# -> serve (:8110) -> bypass batch classification. The three torch steps run through uv's ml group.
train-golden:
	node scripts/train/validate-golden.ts

train-corpus:
	node scripts/train/build-corpus.ts

train-dataset:
	node scripts/train/build-dataset.ts

train-train:
	uv run --group ml python scripts/train/py/train.py

train-eval:
	uv run --group ml python scripts/train/py/evaluate.py

train-export:
	uv run --group ml python scripts/train/py/export_onnx.py

train-typecheck:
	uv run --with mypy mypy scripts/train/py

train-threshold-scan:
	node scripts/train/scan-threshold-replay.ts

classifier-up:
	@mkdir -p log data
	@nohup node scripts/train/serve.ts > log/classifier.log 2>&1 & echo $! > data/classifier.pid
	@sleep 2 && curl -sf http://127.0.0.1:8110/healthz >/dev/null && echo "Classifier service started: :8110 (pid in data/classifier.pid)" || echo "Start failed; see log/classifier.log"

classifier-down:
	-@kill `cat data/classifier.pid 2>/dev/null` 2>/dev/null; rm -f data/classifier.pid
	@echo "Classifier service stopped"

classify-pool:
	node scripts/train/classify-pool.ts $(if $(FORCE),--force,)
