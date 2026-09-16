// Coreference resolution labeled evaluation: multi-turn completion + passthrough when already
// complete. Requires chat upstream. Run: node scripts/eval-coref.ts
import { resolve } from "#/core/coref.ts";

// (history, query, expectation: "rewrite" fills in the entity / "passthrough" leaves it alone)
const CASES: [string, string, "rewrite" | "passthrough"][] = [
  [
    "user: When will the Bluetooth earphones arrive\nassistant: Expected to be delivered tomorrow",
    "Can this be returned",
    "rewrite",
  ],
  [
    "user: The cat food from order 1001\nassistant: Shipped",
    "Where is it now",
    "rewrite",
  ],
  ["", "How long is the warranty on the Bluetooth earphones", "passthrough"],
  ["", "Who pays the return shipping fee", "passthrough"],
];

async function main(): Promise<void> {
  for (const [hist, q, kind] of CASES) {
    const got = await resolve(q, hist);
    const changed = got !== q;
    const ok =
      (changed && kind === "rewrite") || (!changed && kind === "passthrough");
    console.log(
      `${ok ? "✅" : "❌"} ${JSON.stringify(q)} -> ${JSON.stringify(got)} expected=${kind}`,
    );
  }
  console.log(
    "\n(LLM is non-deterministic; passthrough cases must not change, completion cases should carry the entity from the context. Re-run and record honestly.)",
  );
}

await main();
