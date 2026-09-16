// Logistics MCP server (mock data, separate process, Streamable HTTP on :8101).
// MOCK_DELAY_SECONDS>0 injects latency to exercise client timeouts and audits.
import { serve } from "@hono/node-server";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { z } from "zod";

const port = Number(process.env.PORT ?? "8101");
const delaySeconds = Number(process.env.MOCK_DELAY_SECONDS ?? "0");

const STATUS_CODES = ["PICKED_UP", "IN_TRANSIT", "DELIVERING", "DELIVERED"] as const;
const CITIES = ["深圳", "广州", "杭州", "上海", "成都"] as const;

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
      "用物流单号(tracking_no)查询物流状态、当前位置和轨迹。用于用户询问物流/快递到哪了时。" +
      "物流单号不是订单号,需先用 query_order 查订单拿到 tracking_no,再调用本工具。",
    inputSchema: z.object({
      tracking_no: z.string().describe("物流单号(形如 SF 开头),需先用 query_order 查订单拿到该单号"),
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
      trace: [`${city}分拨中心 已发出`, `内部状态码:${code}`],
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
