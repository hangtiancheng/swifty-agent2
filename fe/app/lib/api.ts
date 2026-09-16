/** Shared fetch wrapper: throws an Error on non-2xx (backend detail first);
    same contract as the original acceptance.js api(). */
export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, opts);
  const body: unknown = await r.json().catch(() => ({}));
  if (!r.ok) {
    let detail: string | undefined;
    if (typeof body === "object" && body !== null && "detail" in body) {
      detail = String(body.detail);
    }
    throw new Error(detail ?? `HTTP ${r.status}`);
  }
  // The single fetch boundary for the whole app: the response shape is guaranteed by
  // the backend (FastAPI schema) contract, and callers declare it via the generic T.
  // Per-endpoint zod validation isn't worth the cost, so the assertion is funnelled here once.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- see above
  return body as T;
}

/** RequestInit for a POST with a JSON body */
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
