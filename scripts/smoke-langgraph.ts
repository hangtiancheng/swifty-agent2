// workflow red-line smoke: does StateGraph + a checkpointer + multi-mode streaming work on the current
// langgraph version, and what do the streamed chunk shapes look like? Requires chat upstream.
// Run: node scripts/smoke-langgraph.ts
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
  messagesStateReducer,
} from "@langchain/langgraph";
import { z } from "zod";

import { getChatModel } from "#/core/llm.ts";
import { contentToString } from "#/core/memory.ts";

const S = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});
type SState = typeof S.State;

// Same chunk-shape schemas the runtime uses (src/graph/runtime.ts): the langgraph stream types are
// loose, so validate at the boundary instead of casting.
const streamTupleSchema = z.tuple([z.string(), z.unknown()]);
const messagesChunkSchema = z.tuple([
  z.unknown(),
  z.object({ langgraph_node: z.string().optional() }),
]);
const updatesChunkSchema = z.record(z.string(), z.unknown());

async function callModel(state: SState): Promise<Partial<SState>> {
  const ai = await getChatModel({ streaming: true }).invoke(state.messages);
  return { messages: [ai] };
}

async function main(): Promise<void> {
  const checkpointer = new MemorySaver();
  const graph = new StateGraph(S)
    .addNode("call_model", callModel)
    .addEdge(START, "call_model")
    .addEdge("call_model", END)
    .compile({ checkpointer });

  const streamModes: ("messages" | "updates")[] = ["messages", "updates"];
  const config = {
    configurable: { thread_id: "smoke-1" },
    streamMode: streamModes,
  };
  const seenModes = new Set<string>();
  const stream = await graph.stream(
    { messages: [new HumanMessage("Introduce yourself in one sentence")] },
    config,
  );
  for await (const chunk of stream) {
    const tuple = streamTupleSchema.safeParse(chunk);
    if (!tuple.success) {
      continue;
    }
    const [mode, payload] = tuple.data;
    seenModes.add(mode);
    if (mode === "messages") {
      const parsed = messagesChunkSchema.safeParse(payload);
      if (parsed.success) {
        const [msg, meta] = parsed.data;
        const text = BaseMessage.isInstance(msg)
          ? contentToString(msg.content)
          : "";
        console.log(
          "MSG node=",
          meta.langgraph_node,
          "text=",
          text.slice(0, 20),
        );
      }
    } else {
      const update = updatesChunkSchema.safeParse(payload);
      console.log(
        "UPD",
        update.success ? Object.keys(update.data) : "(unparseable)",
      );
    }
  }
  console.log("OK modes=", [...seenModes].join(","));
}

await main();
