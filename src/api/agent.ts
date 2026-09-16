// Non-streaming agent endpoint used by evaluations and tests.
import { isAIMessage, isToolMessage } from "@langchain/core/messages";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { resolveAnswer } from "../graph/nodes.ts";
import * as runtime from "../graph/runtime.ts";
import type { GraphState } from "../graph/state.ts";
import { childLogger } from "../logger.ts";

import { parseJsonBody } from "./http.ts";
import { agentRequestSchema } from "./schemas.ts";

const log = childLogger("api.agent");
export const agentRouter = new Hono();

interface ToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface ToolResultView {
  tool_call_id: string;
  name: string;
  ok: boolean;
  content: string;
}

function viewsFromState(state: GraphState): { calls: ToolCallView[]; results: ToolResultView[] } {
  const calls: ToolCallView[] = [];
  const results: ToolResultView[] = [];
  for (const m of state.messages) {
    if (isAIMessage(m) && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        calls.push({ id: tc.id ?? "", name: tc.name, args: tc.args ?? {} });
      }
    } else if (isToolMessage(m)) {
      results.push({
        tool_call_id: m.tool_call_id,
        name: m.name ?? "",
        ok: m.status !== "error",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
    }
  }
  return { calls, results };
}

agentRouter.post("/api/agent", async (c) => {
  const req = await parseJsonBody(c, agentRequestSchema);
  let out: runtime.TurnResult;
  try {
    out = await runtime.runTurn(req.user_id, req.message, req.conversation_id);
  } catch (error) {
    if (error instanceof runtime.ConversationNotFound) {
      throw new HTTPException(404, { message: "会话不存在" });
    }
    const name = error instanceof Error ? error.constructor.name : "";
    if (name.startsWith("Prisma")) {
      log.error({ err: error, user_id: req.user_id }, "database error");
      throw new HTTPException(503, { message: "数据库暂时不可用,请稍后重试" });
    }
    log.error({ err: error, user_id: req.user_id }, "agent turn failed");
    throw new HTTPException(502, { message: "上游模型暂时不可用,请稍后重试" });
  }

  const state = out.state;
  const { calls, results } = viewsFromState(state);
  return c.json({
    conversation_id: out.conversation_id,
    answer: resolveAnswer(state),
    tool_calls: calls,
    tool_results: results,
    suggested_actions: runtime.dedupActions(state.suggestedActions ?? []),
    interrupt: out.interrupt,
  });
});
