// After-sales MCP server (mock data, separate process, Streamable HTTP on :8102).
// Tools: warranty status and return progress.
import { serve } from "@hono/node-server";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { z } from "zod";

const port = Number(process.env.PORT ?? "8102");
const delaySeconds = Number(process.env.MOCK_DELAY_SECONDS ?? "0");

function seedFrom(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

const server = new McpServer({ name: "aftersales", version: "0.1.0" });

server.registerTool(
  "query_warranty",
  {
    description:
      "Query whether an order's product is still under warranty (warranty status and expiry date). Use it when the user asks about warranty coverage.",
    inputSchema: z.object({
      order_id: z.string().describe("Order number, e.g. 1001"),
    }),
  },
  async ({ order_id }) => {
    if (delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
    const rng = seedFrom(`warranty:${order_id}`);
    const code = pick(rng, ["IN_WARRANTY", "EXPIRED"]);
    const payload = {
      order_id,
      warranty_code: code, // internal enum; translated on the client side
      warranty_until: `2026-${String(Math.floor(rng() * 5) + 8).padStart(2, "0")}-${String(Math.floor(rng() * 28) + 1).padStart(2, "0")}`,
      policy_ref: "AS-POLICY-07", // internal policy ref; dropped by the client formatter
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
);

server.registerTool(
  "query_return_status",
  {
    description:
      "Query an order's return progress (under review / return in progress / refunded / no return record). Use it when the user asks which step a return has reached.",
    inputSchema: z.object({
      order_id: z.string().describe("Order number, e.g. 1001"),
    }),
  },
  async ({ order_id }) => {
    if (delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
    const rng = seedFrom(`return:${order_id}`);
    const code = pick(rng, ["AUDITING", "RETURNING", "REFUNDED", "NONE"]);
    const payload = {
      order_id,
      return_code: code,
      updated_at: `2026-07-${String(Math.floor(rng() * 16) + 1).padStart(2, "0")} 10:00`,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
);

const handler = createMcpHandler(() => server);
const app = new Hono();
app.all("/mcp", (c) => handler.fetch(c.req.raw));

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
