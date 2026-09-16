// Query expansion labeled evaluation: the core scenario yields 3 queries + stable JSON + keeps the
// key entities. Requires chat upstream. Run: node scripts/eval-expand.ts
import { expandQueries } from "#/core/query-understanding.ts";

const CASES = [
  "Can the Bluetooth earphones still be returned",
  "Can the quality problem with the cat food from order 1001 be refunded",
  "How do I claim warranty on a broken smart litter box",
];

async function main(): Promise<void> {
  for (const q of CASES) {
    const qs = await expandQueries(q);
    console.log(`${qs.length === 3 ? "✅" : "⚠️"} ${JSON.stringify(q)} -> ${JSON.stringify(qs)} (count=${qs.length})`);
  }
  console.log(
    "\nThe core scenario should yield 3 queries with different emphases that keep the key entities of the original; when the JSON is unstable the count drops below 3. Re-run and record honestly.",
  );
}

await main();
