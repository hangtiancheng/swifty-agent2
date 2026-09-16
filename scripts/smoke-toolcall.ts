// Verify for real that the chat upstream returns structured tool_calls. A go/no-go risk gate.
// Run: node scripts/smoke-toolcall.ts
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";

import { settings } from "#/config.ts";
import { getChatModel } from "#/core/llm.ts";

// Same binding shape the app uses (src/graph/nodes.ts): OpenAI function-calling descriptors,
// not langchain BaseTool objects.
const addSchema = z.object({
  a: z.number().int().describe("The first addend"),
  b: z.number().int().describe("The second addend"),
});

const toolDefs = [
  {
    type: "function" as const,
    function: {
      name: "add",
      description: "Add two integers together.",
      parameters: z.toJSONSchema(addSchema),
    },
  },
];

async function main(): Promise<void> {
  const model = getChatModel(); // non-streaming, direct to settings.chatBaseUrl
  const bound = model.bindTools(toolDefs);
  const ai = await bound.invoke("Please use the tool to compute what 23 plus 19 equals");
  const toolCalls = (AIMessage.isInstance(ai) ? ai.tool_calls : undefined) ?? [];
  console.log("content:", JSON.stringify(ai.content));
  console.log("tool_calls:", JSON.stringify(toolCalls));
  if (toolCalls.length > 0 && toolCalls[0].name === "add") {
    console.log(
      `✅ GO: ${settings.chatModel} supports tool calling, selected add, args=${JSON.stringify(toolCalls[0].args)}`,
    );
  } else {
    console.log("❌ NO-GO: the expected tool_calls were not returned — stop and ask, do not switch approach on your own");
    process.exitCode = 1;
  }
}

await main();
