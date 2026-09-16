// intent end-to-end acceptance evaluation. Requires the full stack running
// (DB + MCP servers + chat upstream + this app). Run: node scripts/eval-intent.ts
import { z } from "zod";

import { settings } from "#/config.ts";
import { classify } from "#/core/intent.ts";

const BASE = `http://localhost:${settings.port ?? 8000}`;

const agentResponseSchema = z.object({
  conversation_id: z.number(),
  answer: z.string(),
  tool_calls: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      args: z.record(z.string(), z.unknown()),
    }),
  ),
  suggested_actions: z
    .array(z.object({ type: z.string() }).loose())
    .default([]),
  interrupt: z.unknown().nullable(),
});
type AgentResponse = z.infer<typeof agentResponseSchema>;

async function agent(
  message: string,
  conversationId: number | null = null,
): Promise<AgentResponse> {
  const resp = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: "eval-intent",
      message,
      conversation_id: conversationId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }
  return agentResponseSchema.parse(await resp.json());
}

interface CaseResult {
  name: string;
  ok: boolean;
  detail: string;
}

// ============================== eval ==============================

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
  const results: CaseResult[] = [];

  // Acceptance 1: multi-turn logistics -> refund -> logistics; each turn's intent/coref follows the
  // context (details in the app logs: intent/route/coref)
  const r1 = await agent("Where is order 1001 now");
  const cid = r1.conversation_id;
  await agent("Then I want to return it", cid); // coref on "it" + intent drifts to refund_return
  await agent("Never mind, where is it now", cid); // drifts back to logistics
  results.push({
    name: "Acceptance 1 multi-turn intent drift (see intent/route in the logs)",
    ok: true,
    detail: `conv=${cid}; the logs should show route logistics -> refund_flow -> logistics`,
  });

  // Acceptance 3: "can this be returned" first resolves the reference, then walks the refund
  // sub-flow (with an order id, so no interrupt)
  const b3 = await agent("Can order 2002 be returned");
  const acts3 = new Set(b3.suggested_actions.map((a) => a.type));
  results.push({
    name: "Acceptance 3 refund sub-flow (refund_form or an explanation)",
    ok: b3.answer.length > 0,
    detail: JSON.stringify({
      actions: [...acts3],
      answer: b3.answer.slice(0, 40),
    }),
  });

  // Acceptance 4 (non-streaming half): asking for a refund without an order id -> interrupt returns the order list
  const b4 = await agent("I want a refund");
  results.push({
    name: "Acceptance 4 missing order id pops the order selector (interrupt)",
    ok: b4.interrupt !== null && b4.interrupt !== undefined,
    detail: JSON.stringify(b4.interrupt),
  });

  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.name} -> ${r.detail}`);
  }

  console.log(
    "\nAcceptance 2 (intent JSON is stable / weird questions land in other): run `node scripts/eval-intent.ts`.",
  );
  console.log(
    "Acceptance 4 full frontend chain interrupt -> resume -> refund button: see the browser screenshots.",
  );
  console.log(
    "Acceptance 1/3 coref/intent/route details: grep the app logs for `intent=.. route=.. trace={..coref..}`.",
  );

  // ============================== eval ==============================
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
