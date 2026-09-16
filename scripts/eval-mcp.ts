// mcp acceptance end-to-end evaluation: ticket-confirm flow (follow-up / preview / confirm /
// cancel) + logistics served by the MCP server. Requires the full stack running
// (DB + both MCP servers + chat upstream + this app). Run: node scripts/eval-mcp.ts
// Criteria are the acceptance standard: interrupt presence / ticket rows / audit status / tool
// trace; the follow-up wording is printed for human review (prompt-class output).
import { z } from "zod";

import { settings } from "#/config.ts";
import { closeDb, prisma } from "#/db/client.ts";

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
  interrupt: z
    .object({
      type: z.string().optional(),
      preview: z
        .object({ description: z.string().optional() })
        .loose()
        .optional(),
    })
    .loose()
    .nullable(),
});
type AgentResponse = z.infer<typeof agentResponseSchema>;

const sseDataSchema = z.object({ delta: z.string().optional() }).loose();

async function agent(
  message: string,
  conversationId: number | null = null,
): Promise<AgentResponse> {
  const resp = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: "eval-mcp",
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

async function resume(
  conversationId: number,
  confirmed: boolean,
): Promise<string> {
  // POST /api/actions/resume (SSE); concatenate the deltas into the final answer text. This is an
  // eval script, so read the whole body once rather than streaming it chunk by chunk.
  const resp = await fetch(`${BASE}/api/actions/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, confirmed }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  let answer = "";
  const body = await resp.text();
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data: ") || line === "data: [DONE]") {
      continue;
    }
    const data = sseDataSchema.parse(JSON.parse(line.slice(6)));
    if (data.delta !== undefined) {
      answer += data.delta;
    }
  }
  return answer;
}

async function countTickets(): Promise<number> {
  return prisma.ticket.count();
}

async function latestTicketNo(): Promise<string | null> {
  const row = await prisma.ticket.findFirst({
    orderBy: [{ createdAt: "desc" }, { ticketNo: "desc" }],
  });
  return row?.ticketNo ?? null;
}

async function latestAuditStatus(toolName: string): Promise<string | null> {
  const row = await prisma.toolAuditLog.findFirst({
    where: { toolName },
    orderBy: { id: "desc" },
  });
  return row?.status ?? null;
}

async function latestAuditSource(toolName: string): Promise<string | null> {
  const row = await prisma.toolAuditLog.findFirst({
    where: { toolName },
    orderBy: { id: "desc" },
  });
  return row === null ? null : `${row.toolSource}/${row.mcpServer ?? ""}`;
}

interface CaseResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const results: CaseResult[] = [];

  // ---- Acceptance 4a: clearly wants a ticket but never states the problem -> follow-up question, no card, no row ----
  const ticketsBefore = await countTickets();
  const r1 = await agent("Please create a ticket for me");
  const cid = r1.conversation_id;
  const ticketsNow = await countTickets();
  const noInterrupt = r1.interrupt === null;
  results.push({
    name: "Acceptance 4a missing problem description -> follow-up first (no preview card / no row)",
    ok: noInterrupt && ticketsNow === ticketsBefore,
    detail: `answer=${JSON.stringify(r1.answer)}`,
  });

  // ---- Acceptance 4b: the problem description is supplied -> the ticket preview card pops (interrupt confirm_ticket) ----
  const r2 = await agent(
    "My smart litter box is leaking electricity; it trips the breaker as soon as it powers on",
    cid,
  );
  const intr = r2.interrupt;
  const okPreview =
    intr !== null &&
    intr.type === "confirm_ticket" &&
    Boolean(intr.preview?.description);
  results.push({
    name: "Acceptance 4b after the description the ticket preview card pops (type/preview present)",
    ok: okPreview,
    detail: `interrupt=${JSON.stringify(intr)}`,
  });

  // ---- Acceptance 4c: confirm and submit -> one row in tickets, audit success, answer carries the ticket number ----
  const answer = await resume(cid, true);
  const ticketNo = await latestTicketNo();
  const ticketsAfter = await countTickets();
  const auditOk = await latestAuditStatus("create_ticket");
  results.push({
    name: "Acceptance 4c confirm -> tickets row + audit success + answer carries the ticket number",
    ok:
      ticketsAfter === ticketsBefore + 1 &&
      auditOk === "success" &&
      ticketNo !== null &&
      answer.includes(ticketNo ?? ""),
    detail: `ticket_no=${ticketNo} audit=${auditOk} answer=${JSON.stringify(answer)}`,
  });

  // ---- Acceptance 5: reach the preview card then cancel -> no ticket, audit permission_denied ----
  const r3 = await agent(
    "Please create a ticket for me; the third level of my cat tree collapsed",
  );
  const cid2 = r3.conversation_id;
  const intr3 = r3.interrupt;
  let answer3 = "";
  if (intr3 !== null && intr3.type === "confirm_ticket") {
    answer3 = await resume(cid2, false);
  }
  const ticketsFinal = await countTickets();
  const auditDeny = await latestAuditStatus("create_ticket");
  results.push({
    name: 'Acceptance 5 cancel -> no ticket + audit "permission_denied"',
    ok:
      intr3 !== null &&
      intr3.type === "confirm_ticket" &&
      ticketsFinal === ticketsAfter &&
      auditDeny === "permission_denied",
    detail: `interrupt=${intr3?.type ?? "none"} audit=${auditDeny} answer=${JSON.stringify(answer3)}`,
  });

  // ---- Acceptance 2: the logistics trace is served by the logistics MCP server (tool trace + audit source) ----
  const r4 = await agent("Where is the logistics for order 1001");
  const names = r4.tool_calls.map((tc) => tc.name);
  const lg = r4.tool_results.filter((tr) => tr.name === "query_logistics");
  // The MCP result formatter translates status codes to English (see src/tools/mcp-client.ts).
  const enStatus = [
    "Picked up",
    "In transit",
    "Out for delivery",
    "Delivered",
  ].some((s) => (lg[0]?.content ?? "").includes(s));
  const src = await latestAuditSource("query_logistics");
  results.push({
    name: "Acceptance 2 logistics goes through MCP (trace has English status + audit source mcp/logistics)",
    ok:
      names.includes("query_logistics") && enStatus && src === "mcp/logistics",
    detail: `tools=${JSON.stringify(names)} audit_source=${src} answer=${JSON.stringify(r4.answer)}`,
  });

  console.log("\n" + "=".repeat(72));
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.name}\n   ${r.detail}`);
    failed += r.ok ? 0 : 1;
  }
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exitCode = failed > 0 ? 1 : 0;
}

try {
  await main();
} finally {
  await closeDb();
}
