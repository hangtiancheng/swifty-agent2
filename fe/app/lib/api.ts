/** 统一取数封装:非 2xx 抛 Error(后端 detail 优先),与原 acceptance.js 的 api() 同契约 */
export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, opts);
  const body: unknown = await r.json().catch(() => ({}));
  if (!r.ok) {
    let detail: string | undefined;
    if (typeof body === "object" && body !== null && "detail" in body) {
      detail = String((body).detail);
    }
    throw new Error(detail ?? `HTTP ${r.status}`);
  }
  // 全站唯一取数边界:响应形状由后端(FastAPI schema)契约保证,调用方以泛型 T 声明。
  // 逐接口 zod 校验的收益撑不起成本,这里集中收口一次断言。
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- 见上
  return body as T;
}

/** POST + JSON body 的 RequestInit */
export function jsonPost(payload?: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
