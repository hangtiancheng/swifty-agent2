// Logistics MCP server (mock data, separate process, Streamable HTTP on :8101).
// MOCK_DELAY_SECONDS>0 injects latency to exercise client timeouts and audits.
import { serve } from "@hono/node-server";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { z } from "zod";

const port = Number(process.env.PORT ?? "8101");
const delaySeconds = Number(process.env.MOCK_DELAY_SECONDS ?? "0");

const STATUS_CODES = ["PICKED_UP", "IN_TRANSIT", "DELIVERING", "DELIVERED"] as const;
const CITIES = ["Shenzhen", "Guangzhou", "Hangzhou", "Shanghai", "Chengdu"] as const;

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

const server = new McpServer({ name: "logistics", version: "0.1.0" });

server.registerTool(
  "query_logistics",
  {
    description:
      "Query the logistics status, current location, and trace by tracking number (tracking_no). Use it when the user asks where a shipment or courier package is. " +
      "The tracking number is not the order number: first use query_order to fetch the order's tracking_no, then call this tool.",
    inputSchema: z.object({
      tracking_no: z.string().describe("Tracking number (starts with SF); obtain it first via query_order"),
    }),
  },
  async ({ tracking_no }) => {
    if (delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
    const rng = seedFrom(`logistics:${tracking_no}`);
    const code = STATUS_CODES[Math.floor(rng() * STATUS_CODES.length)];
    const city = CITIES[Math.floor(rng() * CITIES.length)];
    const payload = {
      tracking_no,
      status_code: code, // internal enum; translated on the client side
      current_city: city,
      trace: [`${city} sorting center: dispatched`, `Internal status code: ${code}`],
      carrier_code: "SF-EXP-01", // internal carrier code; dropped by the client formatter
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
