// HTTP helpers: zod request validation and FastAPI-style error payloads.
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";

export async function parseJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Request body is not valid JSON" });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `(${first.path.join(".")})` : "";
    throw new HTTPException(400, { message: `${first?.message ?? "Invalid parameters"}${where}` });
  }
  return parsed.data;
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HTTPException(400, { message: first?.message ?? "Invalid parameters" });
  }
  return parsed.data;
}

export function parseParamInt(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HTTPException(400, { message: `${name} must be a positive integer` });
  }
  return parsed;
}
