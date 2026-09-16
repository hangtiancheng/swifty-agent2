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

# ch10 topic classifier: corpus -> dataset -> train/eval/export (Python, torch) -> threshold scan
# -> serve (:8110) -> bypass batch classification. The three torch steps run through uv's ml group.
ch10-golden:
	node scripts/ch10/validate-golden.ts

ch10-corpus:
	node scripts/ch10/build-corpus.ts

ch10-dataset:
	node scripts/ch10/build-dataset.ts

ch10-train:
	uv run --group ml python scripts/ch10/py/train.py

ch10-eval:
	uv run --group ml python scripts/ch10/py/evaluate.py

ch10-export:
	uv run --group ml python scripts/ch10/py/export_onnx.py

ch10-typecheck:
	uv run --with mypy mypy scripts/ch10/py

ch10-threshold-scan:
	node scripts/ch10/scan-threshold-replay.ts

classifier-up:
	@mkdir -p log data
	@nohup node scripts/ch10/serve.ts > log/classifier.log 2>&1 & echo $! > data/classifier.pid
	@sleep 2 && curl -sf http://127.0.0.1:8110/healthz >/dev/null && echo "Classifier service started: :8110 (pid in data/classifier.pid)" || echo "Start failed; see log/classifier.log"

classifier-down:
	-@kill `cat data/classifier.pid 2>/dev/null` 2>/dev/null; rm -f data/classifier.pid
	@echo "Classifier service stopped"

classify-pool:
	node scripts/ch10/classify-pool.ts $(if $(FORCE),--force,)
