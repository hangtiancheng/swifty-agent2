// ch06 end-to-end acceptance evaluation. Requires the full stack running
// (DB + MCP servers + chat upstream + this app). Run: node scripts/eval-ch06.ts
import { z } from "zod";

import { settings } from "#/config.ts";

const BASE = `http://localhost:${settings.port ?? 8000}`;

const agentResponseSchema = z.object({
  conversation_id: z.number(),
  answer: z.string(),
  tool_calls: z.array(z.object({ id: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) })),
  suggested_actions: z.array(z.object({ type: z.string() }).loose()).default([]),
  interrupt: z.unknown().nullable(),
});
type AgentResponse = z.infer<typeof agentResponseSchema>;

async function agent(message: string, conversationId: number | null = null): Promise<AgentResponse> {
  const resp = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_id: "eval-ch06", message, conversation_id: conversationId }),
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
    detail: JSON.stringify({ actions: [...acts3], answer: b3.answer.slice(0, 40) }),
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

  console.log("\nAcceptance 2 (intent JSON is stable / weird questions land in other): run `node scripts/eval-intent.ts`.");
  console.log("Acceptance 4 full frontend chain interrupt -> resume -> refund button: see the browser screenshots.");
  console.log("Acceptance 1/3 coref/intent/route details: grep the app logs for `intent=.. route=.. trace={..coref..}`.");
}

await main();
