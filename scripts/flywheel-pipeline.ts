// Flywheel batch: pool -> normalize/dedup -> review queue.
import { closeDb } from "../src/db/client.ts";
import { processPending } from "../src/core/flywheel.ts";

const stats = await processPending(200);
console.log(
  `本轮处理 ${stats.processed} 条:新建缺口 ${stats.created},归并 ${stats.merged},跳过待重试 ${stats.skipped}`,
);
await closeDb();
