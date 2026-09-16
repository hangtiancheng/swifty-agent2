// HTTP helpers: zod request validation and FastAPI-style error payloads.
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";

export async function parseJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "请求体不是合法 JSON" });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `(${first.path.join(".")})` : "";
    throw new HTTPException(400, { message: `${first?.message ?? "参数不合法"}${where}` });
  }
  return parsed.data;
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HTTPException(400, { message: first?.message ?? "参数不合法" });
  }
  return parsed.data;
}

export function parseParamInt(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HTTPException(400, { message: `${name}必须是正整数` });
  }
  return parsed;
}
