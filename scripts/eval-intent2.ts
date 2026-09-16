import { classify } from "#/core/intent.ts";

const SAMPLES: [string, string][] = [
  ["Where is the courier for order 1001", "logistics"],
  ["Has what I bought shipped yet", "logistics"],
  ["What is the current status of order 2002", "order"],
  ["How much was the order I placed last week", "order"],
  ["How much is this cat food per bag", "product_inquiry"],
  ["Who usually pays the return shipping fee", "product_inquiry"],
  ["I want to return an item", "refund_return"],
  ["Can this order still apply for a refund", "refund_return"],
  ["My cat tree is broken, is it covered by warranty", "after_sales"],
  ["How far along is the replacement", "after_sales"],
  ["What kind of terrible service is this, I want to complain", "complaint"],
  ["This is awful, give me an explanation", "complaint"],
  ["Please create a ticket for me", "human_agent"],
  [
    "The litter box is leaking electricity; create a ticket to follow up",
    "human_agent",
  ],
  ["Hi there", "chitchat"],
  ["Nice weather today", "chitchat"],
  ["Write me a Python snippet", "other"],
  ["asdf qwerty", "other"],
];

const VALID = new Set([
  "logistics",
  "order",
  "product_inquiry",
  "refund_return",
  "after_sales",
  "complaint",
  "human_agent",
  "chitchat",
  "other",
]);

async function main(): Promise<void> {
  let passed = 0;
  let badJson = 0;
  for (const [q, expect] of SAMPLES) {
    const r = await classify(q);
    const got = r.intent;
    const conf = r.confidence;
    const ok = got === expect;
    const jsonOk =
      VALID.has(got) && typeof conf === "number" && conf >= 0 && conf <= 1;
    badJson += jsonOk ? 0 : 1;
    passed += ok ? 1 : 0;
    console.log(
      `${ok ? "✅" : "❌"} ${JSON.stringify(q)} -> ${got} (conf=${conf}) expected=${expect}`,
    );
  }

  // Multi-turn drift: logistics -> refund -> logistics; the current turn's intent follows context.
  const hist =
    "user: Where is order 1001\nassistant: Shipped, at the Shenzhen sorting center\nuser: Then I want to return it\nassistant: Sure, let me look at the refund\n";
  const r = await classify("So where is it now", hist);
  console.log(
    `Multi-turn drift "So where is it now" (after refund) -> ${r.intent} (expected logistics)`,
  );

  console.log(
    `\nCorrect ${passed}/${SAMPLES.length}; JSON out of range ${badJson} (LLM is non-deterministic; re-run and record honestly)`,
  );
}

await main();
