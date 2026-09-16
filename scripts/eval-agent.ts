// Labeled-sample evaluation: check whether the chat model selects the expected tools, and
// observe the query_faq keyword and missed recalls. Requires the app running
// (DB seeded + MCP servers + chat upstream). Run: node scripts/eval-agent.ts
import { z } from "zod";

import { settings } from "#/config.ts";

const BASE = `http://localhost:${settings.port ?? 8000}`;

// (user phrasing, expected tool-name set; null means no tool call is expected)
const SAMPLES: [string, Set<string> | null][] = [
  ["Where is the logistics for order 1001", new Set(["query_logistics"])],
  ["What is the returns policy", new Set(["query_faq"])], // acceptance 2: query_faq hit
  ["Can the shoes I bought be returned", new Set(["query_faq"])], // model extracts "return" -> hits "returns policy", not missed (semantic query params saved it)
  ["How much is the shipping fee", new Set(["query_faq"])], // acceptance 3: model extracts "shipping fee" -> may miss on literal question match, but the answer lives in "how is the shipping fee calculated" -> semantic gap, left to ch03
  ["Is the iPhone still in stock", new Set(["query_product"])],
  ["How much is order 2002", new Set(["query_order"])],
  ["I want to complain, please register it for me", new Set(["create_ticket"])],
  ["What's the weather like today", null], // out of scope, no tool call expected
];

const agentResponseSchema = z.object({
  answer: z.string(),
  tool_calls: z.array(z.object({ id: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) })),
  tool_results: z.array(
    z.object({ tool_call_id: z.string(), name: z.string(), ok: z.boolean(), content: z.string() }),
  ),
});
type AgentResponse = z.infer<typeof agentResponseSchema>;

// NOTE: the Python original read the query_faq result key "hits"; the TS query_faq returns
// "citations" instead (see src/tools/builtin/faq.ts), so the missed-recall check reads that.
const faqContentSchema = z.object({ citations: z.array(z.unknown()).default([]) }).loose();

function faqNote(body: AgentResponse): string {
  // For samples that called query_faq, print the extracted keyword and whether the recall was missed.
  const faqCalls = body.tool_calls.filter((tc) => tc.name === "query_faq");
  const faqResults = body.tool_results.filter((tr) => tr.name === "query_faq");
  if (faqCalls.length === 0 || faqResults.length === 0) {
    return "";
  }
  const keyword = faqCalls[0].args.keyword;
  const parsed = faqContentSchema.safeParse(JSON.parse(faqResults[0].content));
  const hits = parsed.success ? parsed.data.citations : [];
  return `  [query_faq keyword=${JSON.stringify(keyword ?? "")} missed_recall=${hits.length === 0 ? "yes" : "no"}]`;
}

async function main(): Promise<void> {
  let passed = 0;
  for (const [msg, expect] of SAMPLES) {
    const resp = await fetch(`${BASE}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: "eval", message: msg }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    }
    const body = agentResponseSchema.parse(await resp.json());
    const names = new Set(body.tool_calls.map((tc) => tc.name));
    const ok = expect === null ? names.size === 0 : [...expect].some((e) => names.has(e));
    passed += ok ? 1 : 0;
    const got = names.size > 0 ? JSON.stringify([...names]) : "(no tool call)";
    const want = expect === null ? "none" : JSON.stringify([...expect]);
    console.log(`${ok ? "✅" : "❌"} ${JSON.stringify(msg)} -> ${got} expected=${want}${faqNote(body)}`);
    console.log(`    answer: ${body.answer.slice(0, 70)}`);
  }
  console.log(`\nCorrect tool selection ${passed}/${SAMPLES.length} (the LLM is non-deterministic; rerun and record honestly if results wobble)`);
}

await main();
