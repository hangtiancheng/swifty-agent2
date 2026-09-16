import { describe, expect, it } from "vitest";
import { z } from "zod";

import { numberArraySchema, parseJson, parseWith, stringArraySchema, toJson } from "../src/db/json.ts";

describe("json helpers", () => {
  it("serializes undefined and null to null", () => {
    expect(toJson(undefined)).toBeNull();
    expect(toJson(null)).toBeNull();
    expect(toJson({ a: 1 })).toBe('{"a":1}');
  });

  it("parses valid JSON and hides failures", () => {
    expect(parseJson("[1,2]")).toEqual([1, 2]);
    expect(parseJson("{broken")).toBeNull();
    expect(parseJson(null)).toBeNull();
  });

  it("validates typed payloads", () => {
    expect(parseWith(stringArraySchema, '["a","b"]')).toEqual(["a", "b"]);
    expect(parseWith(numberArraySchema, '["a"]')).toBeNull();
    expect(parseWith(z.object({ n: z.number() }), '{"n":2}')).toEqual({ n: 2 });
  });
});
