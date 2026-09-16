// ch06 red-line smoke: the interrupt / Command(resume) surface shapes on the current langgraph.
// Does NOT call the chat upstream — only a pure interrupt node. Run: node scripts/smoke-interrupt.ts
//
// Pins down four things (for fetch_order / runtime):
//   A) invoke() on an interrupt: the __interrupt__ key structure and value access path
//   B) Command(resume=v) resumes, and v becomes the interrupt() return value
//   C) stream(streamMode=["messages","updates"]): which chunk the interrupt appears in
//      (vs C' getState probing pending)
//   D) calling the interrupted node directly (no runnable context): the GraphInterrupt payload
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import {
  Annotation,
  Command,
  END,
  GraphInterrupt,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
  messagesStateReducer,
} from "@langchain/langgraph";
import { z } from "zod";

import { contentToString } from "#/core/memory.ts";

const S = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  picked: Annotation<string>(),
});
type SState = typeof S.State;

interface OrderOption {
  order_id: string;
}
interface SelectOrderPayload {
  type: string;
  orders: OrderOption[];
}

// interrupt() is synchronous: it throws GraphInterrupt on the first pass and returns the resume
// value when resumed. These nodes therefore need no await (and must not be async, or the linter
// flags require-await).
function askOrder(_state: SState): Partial<SState> {
  const picked = interrupt<SelectOrderPayload, string>({
    type: "select_order",
    orders: [{ order_id: "1001" }, { order_id: "2002" }],
  });
  return { picked };
}

function confirm(state: SState): Partial<SState> {
  return { messages: [new AIMessage(`Selected order ${state.picked}`)] };
}

function build() {
  return new StateGraph(S)
    .addNode("ask_order", askOrder)
    .addNode("confirm", confirm)
    .addEdge(START, "ask_order")
    .addEdge("ask_order", "confirm")
    .addEdge("confirm", END)
    .compile({ checkpointer: new MemorySaver() });
}

// The langgraph stream types are loose; validate chunk shapes at the boundary instead of casting.
const streamTupleSchema = z.tuple([z.string(), z.unknown()]);
const updatesChunkSchema = z.record(z.string(), z.unknown());

async function main(): Promise<void> {
  const graph = build();

  // A) Non-streaming: the first run should carry __interrupt__
  const config = { configurable: { thread_id: "smoke-int-1" } };
  const out = await graph.invoke({ messages: [new AIMessage("I want a refund")] }, config);
  console.log("A invoke keys=", Object.keys(out));
  if (isInterrupted(out)) {
    const value = out[INTERRUPT][0]?.value;
    console.log("A __interrupt__=", JSON.stringify(value));
  } else {
    console.log("A __interrupt__= (none)");
  }

  // B) Non-streaming resume
  const out2 = await graph.invoke(new Command({ resume: "1001" }), config);
  console.log(
    "B resume picked=",
    out2.picked,
    "msgs=",
    JSON.stringify(out2.messages.map((m) => contentToString(m.content))),
  );

  // C) Streaming: which chunk carries the interrupt
  const streamModes: ("messages" | "updates")[] = ["messages", "updates"];
  const config2 = { configurable: { thread_id: "smoke-int-2" }, streamMode: streamModes };
  console.log("C stream chunks:");
  const stream = await graph.stream({ messages: [new AIMessage("I want a refund")] }, config2);
  for await (const chunk of stream) {
    const tuple = streamTupleSchema.safeParse(chunk);
    if (!tuple.success) {
      continue;
    }
    const [mode, payload] = tuple.data;
    if (mode === "updates") {
      const update = updatesChunkSchema.safeParse(payload);
      console.log("  UPD keys=", update.success ? Object.keys(update.data) : "(unparseable)", "val=", JSON.stringify(payload));
    }
  }
  // C') After streaming, probe pending (an alternate detection path)
  const snap = await graph.getState(config2);
  console.log(
    "C' getState .next=",
    JSON.stringify(snap.next),
    "tasks_interrupts=",
    JSON.stringify(snap.tasks.map((t) => t.interrupts)),
  );
  // C'') Streaming resume
  console.log("C'' stream resume:");
  const stream2 = await graph.stream(new Command({ resume: "2002" }), config2);
  for await (const chunk of stream2) {
    const tuple = streamTupleSchema.safeParse(chunk);
    if (!tuple.success) {
      continue;
    }
    const [mode, payload] = tuple.data;
    console.log("  ", mode, JSON.stringify(payload));
  }

  // D) Call the interrupted node directly (no runnable context) — record interrupt()'s real
  // behaviour outside a graph.
  try {
    askOrder({ messages: [], picked: "" });
    console.log("D no error (unexpected)");
  } catch (error) {
    if (error instanceof GraphInterrupt) {
      console.log("D GraphInterrupt interrupts=", JSON.stringify(error.interrupts));
    } else if (error instanceof Error) {
      console.log("D Error (interrupt cannot be called outside a graph):", error.message);
      console.log(
        "D conclusion: the fetch_order missing-order interrupt path must be tested through the " +
          "[compiled graph invoke], not by calling the node function directly.",
      );
    } else {
      throw error;
    }
  }
}

await main();
