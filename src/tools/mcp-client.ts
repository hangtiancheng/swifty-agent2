// MCP client: tool lists are fetched per turn (server-side tool changes need no restart).
// Permissions and result formatting are decided on our side.
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { z } from "zod";

import { defineRawTool } from "./registry.ts";
import type { ResultFormatter, ToolSpec } from "./registry.ts";

import { settings } from "#/config.ts";
import { childLogger } from "#/logger.ts";

const log = childLogger("tools.mcp");

function connections(): Record<string, string> {
  return {
    logistics: settings.mcpLogisticsUrl,
    aftersales: settings.mcpAftersalesUrl,
  };
}

const jsonObjectSchema = z.record(z.string(), z.unknown());

const logisticsSchema = z.object({
  tracking_no: z.string().optional(),
  status_code: z.string().optional(),
  current_city: z.string().optional(),
  trace: z.array(z.string()).optional(),
});

const warrantySchema = z.object({
  order_id: z.string().optional(),
  warranty_code: z.string().optional(),
  warranty_until: z.string().optional(),
});

const returnSchema = z.object({
  order_id: z.string().optional(),
  return_code: z.string().optional(),
  updated_at: z.string().optional(),
});

function translate(mapping: Record<string, string>, code: unknown): unknown {
  return typeof code === "string" ? (mapping[code] ?? code) : code;
}

const fmtLogistics: ResultFormatter = (d) => {
  const v = logisticsSchema.safeParse(d);
  if (!v.success) {
    return d;
  }
  return {
    tracking_no: v.data.tracking_no,
    status: translate(
      {
        PICKED_UP: "Picked up",
        IN_TRANSIT: "In transit",
        DELIVERING: "Out for delivery",
        DELIVERED: "Delivered",
      },
      v.data.status_code,
    ),
    current_city: v.data.current_city,
    trace: v.data.trace,
  };
};

const fmtWarranty: ResultFormatter = (d) => {
  const v = warrantySchema.safeParse(d);
  if (!v.success) {
    return d;
  }
  return {
    order_id: v.data.order_id,
    warranty: translate(
      { IN_WARRANTY: "Under warranty", EXPIRED: "Warranty expired" },
      v.data.warranty_code,
    ),
    warranty_until: v.data.warranty_until,
  };
};

const fmtReturn: ResultFormatter = (d) => {
  const v = returnSchema.safeParse(d);
  if (!v.success) {
    return d;
  }
  return {
    order_id: v.data.order_id,
    return_status: translate(
      {
        AUDITING: "Under review",
        RETURNING: "Return in progress",
        REFUNDED: "Refunded",
        NONE: "No return record",
      },
      v.data.return_code,
    ),
    updated_at: v.data.updated_at,
  };
};

const FORMATTERS: Record<string, ResultFormatter> = {
  query_logistics: fmtLogistics,
  query_warranty: fmtWarranty,
  query_return_status: fmtReturn,
};

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("MCP request timed out"));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

async function withClient<T>(
  url: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: "swifty-agent2", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  return withTimeout(
    (async () => {
      await client.connect(transport);
      try {
        return await fn(client);
      } finally {
        await client.close().catch(() => undefined);
      }
    })(),
    settings.mcpToolTimeout * 1000,
    () => {
      void client.close().catch(() => undefined);
    },
  );
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (b): b is Record<string, unknown> =>
        typeof b === "object" && b !== null && !Array.isArray(b),
    )
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => String(b.text))
    .join("\n");
}

export async function fetchMcpSpecs(): Promise<ToolSpec[]> {
  const specs: ToolSpec[] = [];
  for (const [server, url] of Object.entries(connections())) {
    let tools: Awaited<ReturnType<Client["listTools"]>>;
    try {
      tools = await withClient(url, (client) => client.listTools());
    } catch (error) {
      log.warn(
        { server, err: error },
        "MCP server unreachable; skipping its tools this turn",
      );
      continue;
    }
    for (const tool of tools.tools) {
      const input = jsonObjectSchema.safeParse(tool.inputSchema);
      if (!input.success) {
        log.warn(
          { server, tool: tool.name },
          "MCP tool has a malformed input schema; skipping it",
        );
        continue;
      }
      specs.push(
        defineRawTool({
          name: tool.name,
          description: tool.description ?? "",
          jsonSchema: input.data,
          source: "mcp",
          mcpServer: server,
          formatResult: FORMATTERS[tool.name] ?? null,
          handler: async (args) => {
            // Fresh session per call: the adapters style of one connection per invocation.
            return withClient(url, async (client) => {
              const result = await client.callTool({
                name: tool.name,
                arguments: args,
              });
              if (result.isError === true) {
                throw new Error(`MCP tool error: ${textOf(result.content)}`);
              }
              return result.content;
            });
          },
        }),
      );
    }
  }
  return specs;
}
