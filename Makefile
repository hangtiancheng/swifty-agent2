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
