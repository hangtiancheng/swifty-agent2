import { describe, expect, it } from "vitest";

import { normalizeOrderId } from "#/api/schemas.ts";
import { createApp } from "#/server.ts";

const app = createApp();

describe("backend API contracts", () => {
  it("rejects malformed staging limits before querying the database", async () => {
    const response = await app.request("/api/kb/staging?limit=abc");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      detail: "limit must be a positive integer",
    });
  });

  it("normalizes legacy no-order placeholders", () => {
    expect(normalizeOrderId("none")).toBeNull();
    expect(normalizeOrderId("无")).toBeNull();
    expect(normalizeOrderId(" A-100 ")).toBe("A-100");
  });
});
