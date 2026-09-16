import type { ActionItem, Citation, InterruptFrame } from "./types";

/** SSE 帧(与原后端 /api/chat、/api/actions/resume 的帧格式一致) */
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

/** 读一条 SSE 流,按帧分发。event: error 抛错;data: [DONE] 结束。
 *  用 fetch + reader 而不是 EventSource:请求是 POST 带 body。 */
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
      // SSE 帧边界:形状由后端流协议保证,按 event 字段分发前做一次集中断言
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- 运行时边界收口
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
