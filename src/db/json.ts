// JSON column helpers. Values crossing the DB boundary are validated with zod
// instead of type assertions.
import { z } from "zod";

const rawParse: (text: string) => unknown = JSON.parse;

export function parseJson(text: string | null): unknown {
  if (text === null || text === "") {
    return null;
  }
  try {
    return rawParse(text);
  } catch {
    return null;
  }
}

export function parseWith<T>(schema: z.ZodType<T>, text: string | null): T | null {
  const result = schema.safeParse(parseJson(text));
  return result.success ? result.data : null;
}

export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

export const stringArraySchema = z.array(z.string());
export const numberArraySchema = z.array(z.number());
export const citationSchema = z.array(
  z.object({
    n: z.number(),
    chunk_id: z.number().nullable().optional(),
    section_path: z.string().optional(),
    question: z.string().optional(),
    answer: z.string().optional(),
  }),
);
export type CitationSnapshot = z.infer<typeof citationSchema>;
