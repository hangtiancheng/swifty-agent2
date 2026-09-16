// workflow end-to-end acceptance evaluation. Requires the full stack running
// (DB + MCP servers + chat upstream + this app). Run: node scripts/eval-workflow.ts
// Uses /api/agent (non-streaming, so tool traces and suggested_actions are visible);
// acceptance 1 is checked in the app logs, the frontend half of acceptance 3 in the browser.
import { z } from "zod";

import { settings } from "#/config.ts";

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
  tool_results: z.array(
    z.object({
      tool_call_id: z.string(),
      name: z.string(),
      ok: z.boolean(),
      content: z.string(),
    }),
  ),
  suggested_actions: z
    .array(z.object({ type: z.string() }).loose())
    .default([]),
  interrupt: z.unknown().nullable(),
});
type AgentResponse = z.infer<typeof agentResponseSchema>;

async function agent(message: string): Promise<AgentResponse> {
  // Each case uses a fresh conversation (conversation_id = null) to avoid cross-case context pollution.
  const resp = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: "eval-workflow",
      message,
      conversation_id: null,
    }),
    signal: AbortSignal.timeout(120_000),
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

  // Acceptance 2: business-data question, the agent calls tools itself (logistics needs the order -> query_order + query_logistics)
  const b2 = await agent("Where is the logistics for order 1001");
  const names2 = new Set(b2.tool_calls.map((tc) => tc.name));
  results.push({
    name: "Acceptance 2 logistics auto-calls tools",
    ok: names2.has("query_logistics"),
    detail: JSON.stringify([...names2].sort()),
  });

  // Acceptance 3 (backend half): a complaint offers both "transfer to human" and "create ticket"; the backend creates nothing by itself
  const b3 = await agent("I want to complain, your service is terrible");
  const types3 = new Set(b3.suggested_actions.map((a) => a.type));
  results.push({
    name: "Acceptance 3 complaint offers both action options",
    ok: types3.has("transfer_human") && types3.has("create_ticket"),
    detail: JSON.stringify([...types3].sort()),
  });

  // Acceptance 4: chitchat gets the fixed script, zero tools
  const b4 = await agent("Hello there");
  results.push({
    name: "Acceptance 4 chitchat fixed script with zero tools",
    ok: b4.tool_calls.length === 0 && b4.answer.length > 0,
    detail: b4.answer.slice(0, 24),
  });

  // Acceptance 5: complex question -> true sequential multi-step (query_logistics needs the tracking_no produced by query_order)
  const b5 = await agent(
    "Has the order ending in 1001 shipped? Where is it now?",
  );
  const names5 = new Set(b5.tool_calls.map((tc) => tc.name));
  const chained = names5.has("query_order") && names5.has("query_logistics");
  results.push({
    name: "Acceptance 5 ReAct sequential multi-step (order -> logistics chain)",
    ok: chained,
    detail: JSON.stringify([...names5].sort()),
  });

  console.log("=".repeat(60));
  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.name} -> ${r.detail}`);
  }
  console.log("=".repeat(60));
  console.log(
    'Acceptance 1 (the forced-retrieval node is reached): ask "What is the returns policy", then check the app logs;',
  );
  console.log(
    "  you should see `turn ... route=knowledge trace={... forced_rag: true ...}`",
  );
  console.log(
    'Acceptance 3 (frontend): in the browser, clicking "transfer to human" shows transferred + a greeting from the service cat;',
  );
  console.log(
    '  clicking "create ticket" writes into tickets; clicking neither keeps the conversation going normally',
  );
  const passed = results.filter((r) => r.ok).length;
  console.log(
    `\nBackend-assertable cases ${passed}/${results.length} passed (the LLM is non-deterministic; rerun and record honestly if results wobble)`,
  );
}

await main();
