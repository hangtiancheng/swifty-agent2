// Smoke the rerank upstream through the same code path the app uses. A failure is a red line: stop.
// Run: node scripts/smoke-rerank.ts
import { rerank } from "#/core/rerank.ts";

async function main(): Promise<void> {
  // Use the app's own rerank() rather than re-assembling the request here: the smoke test must
  // exercise the exact request shape the application sends, not a second implementation.
  const ranked = await rerank(
    "who pays the return shipping fee",
    [
      "Free shipping on orders of 99 yuan or more; below that a 10 yuan shipping fee applies.",
      "Seven-day no-reason returns; for non-quality issues the buyer pays the return shipping fee.",
      "The smart litter box Pro model supports automatic cleaning.",
    ],
    3,
  );
  console.log("ranked:", JSON.stringify(ranked));
  if (ranked.length === 0) {
    throw new Error("rerank returned empty");
  }
  const [topIndex, topScore] = ranked[0];
  console.log(`most relevant index=${topIndex} score=${topScore.toFixed(4)}`);
  if (topIndex !== 1) {
    throw new Error("the return-shipping question should hit the second document (buyer pays)");
  }
  console.log("GO: rerank path is live");
}

await main();
