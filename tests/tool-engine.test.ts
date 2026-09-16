import { describe, expect, it, vi } from "vitest";

import { executeToolCall } from "#/tools/engine.ts";
import { defineRawTool } from "#/tools/registry.ts";

vi.mock("#/db/repository.ts", () => ({ insertToolAudit: vi.fn() }));

const emptyObjectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

function delayed(value: string, delayMs: number): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value);
    }, delayMs);
  });
}

describe("tool execution timeouts", () => {
  it("interprets configured tool timeouts as seconds", async () => {
    const spec = defineRawTool({
      name: "slow_read",
      description: "test",
      jsonSchema: emptyObjectSchema,
      source: "builtin",
      timeout: 0.05,
      maxRetries: 0,
      handler: () => delayed("ok", 10),
    });

    const run = await executeToolCall(
      { id: "call-1", name: spec.name, args: {} },
      1,
      new Map([[spec.name, spec]]),
    );

    expect(run.ok).toBe(true);
    expect(run.status).toBe("success");
  });

  it("reports a read timeout after the configured number of seconds", async () => {
    const spec = defineRawTool({
      name: "timed_read",
      description: "test",
      jsonSchema: emptyObjectSchema,
      source: "builtin",
      timeout: 0.005,
      maxRetries: 0,
      handler: () => delayed("late", 30),
    });

    const run = await executeToolCall(
      { id: "call-2", name: spec.name, args: {} },
      1,
      new Map([[spec.name, spec]]),
    );

    expect(run.ok).toBe(false);
    expect(run.status).toBe("timeout");
  });

  it("does not report a write timeout while the uncancellable write can commit", async () => {
    const spec = defineRawTool({
      name: "create_ticket",
      description: "test",
      jsonSchema: emptyObjectSchema,
      source: "builtin",
      timeout: 0.001,
      maxRetries: 0,
      handler: () => delayed("created", 15),
    });

    const run = await executeToolCall(
      { id: "call-3", name: spec.name, args: {} },
      1,
      new Map([[spec.name, spec]]),
      { confirmed: true },
    );

    expect(run.ok).toBe(true);
    expect(run.status).toBe("success");
  });
});
