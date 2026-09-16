// Flywheel batch: pool -> normalize/dedup -> review queue.
import { processPending } from "#/core/flywheel.ts";
import { closeDb } from "#/db/client.ts";

const stats = await processPending(200);
console.log(
  `Processed ${stats.processed} items this round: ${stats.created} new gaps created, ${stats.merged} merged, ${stats.skipped} skipped for retry`,
);
await closeDb();
