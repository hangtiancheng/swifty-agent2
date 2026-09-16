// Demystify: without any framework, hand-write the barest agent loop — see that it is just a for
// loop with a tool manifest. Run: node scripts/bare-agent-loop.ts "Where is the logistics for order 1001"
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import { getChatModel } from "#/core/llm.ts";
import { AGENT_SYSTEM } from "#/core/prompts.ts";
import * as engine from "#/tools/engine.ts";
import * as registry from "#/tools/registry.ts";

async function runAgent(query: string, maxTurns = 6): Promise<string> {
  const specs = new Map((await registry.getAllSpecs()).map((s) => [s.name, s]));
  // Same binding shape the graph uses (src/graph/nodes.ts): OpenAI function descriptors.
  const toolDefs = [...specs.values()].map((s) => ({
    type: "function" as const,
    function: {
      name: s.name,
      description: s.description,
      parameters: s.jsonSchema,
    },
  }));
  const model = getChatModel().bindTools(toolDefs);
  const messages: BaseMessage[] = [
    new SystemMessage(AGENT_SYSTEM),
    new HumanMessage(query),
  ];
  for (let step = 1; step <= maxTurns; step += 1) {
    const ai = await model.invoke(messages);
    messages.push(ai);
    const toolCalls =
      (AIMessage.isInstance(ai) ? ai.tool_calls : undefined) ?? [];
    if (toolCalls.length === 0) {
      console.log(`[step ${step}] no tool calls -> converged`);
      return typeof ai.content === "string"
        ? ai.content
        : JSON.stringify(ai.content);
    }
    for (const tc of toolCalls) {
      console.log(
        `[step ${step}] calling tool ${tc.name} args=${JSON.stringify(tc.args)}`,
      );
      const run = await engine.executeToolCall(
        { name: tc.name, id: tc.id ?? "", args: tc.args },
        0,
        specs,
      );
      messages.push(run.toolMessage);
    }
  }
  console.log(
    `[cap] max_turns=${maxTurns} exhausted without converging; production should fall back here`,
  );
  return "(did not converge)";
}

const query = process.argv[2] ?? "Where is the logistics for order 1001";
console.log("question:", query);
console.log("answer:", await runAgent(query));
