import type { ActionItem, Citation, InterruptFrame } from "./types";

/** SSE frame (matches the frame format of the backend /api/chat and /api/actions/resume) */
type SseFrame =
  | { event: "tool"; name: string }
  | { event: "citations"; items: Citation[] }
  | { event: "interrupt" }
  | { event: "actions"; items: ActionItem[] }
  | { event: "done"; conversation_id: number }
  | { delta: string };

export interface SseHandlers {
  delta?: (d: string) => void;
  tool?: (name: string) => void;
  citations?: (items: Citation[]) => void;
  actions?: (items: ActionItem[]) => void;
  interrupt?: (data: InterruptFrame) => void;
  done?: (conversationId: number) => void;
}

/** Read one SSE stream and dispatch by frame. event: error throws; data: [DONE] ends.
 *  Uses fetch + reader rather than EventSource because the request is a POST with a body. */
export async function readSSEStream(
  resp: Response,
  on: SseHandlers,
): Promise<void> {
  if (!resp.ok || !resp.body) {
    throw new Error("bad response");
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (frame.startsWith("event: error")) {
        throw new Error("stream error");
      }
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) {
        continue;
      }
      const payload = line.slice(6);
      if (payload === "[DONE]") {
        return;
      }
      // SSE frame boundary: the shape is guaranteed by the backend stream protocol;
      // one funnelled assertion before dispatching on the event field.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- runtime boundary funnel
      const data = JSON.parse(payload) as SseFrame & InterruptFrame;
      if ("event" in data) {
        if (data.event === "tool") {
          on.tool?.(data.name);
        } else if (data.event === "citations") {
          on.citations?.(data.items ?? []);
        } else if (data.event === "interrupt") {
          on.interrupt?.(data);
        } else if (data.event === "actions") {
          on.actions?.(data.items ?? []);
        } else if (data.event === "done") {
          on.done?.(data.conversation_id);
        }
      } else if ("delta" in data && data.delta !== undefined) {
        on.delta?.(data.delta);
      }
    }
  }
}
