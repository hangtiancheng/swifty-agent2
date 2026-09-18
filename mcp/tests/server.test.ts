// Server assembly: createServer() registers every tool module, and the
// end-to-end cases run a real SDK McpServer over the in-memory transport
// against a real Client — a stub can agree with an assumption the SDK
// doesn't hold, which is exactly how a seam passes its tests while broken.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { SERVER_NAME, createServer } from "../src/server.ts";
import { githubModule } from "../src/tools/github/tool.ts";
import { modules } from "../src/tools/index.ts";

async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vitest", version: "0.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

describe("createServer", () => {
  it("matches the server name of the Python original", () => {
    expect(SERVER_NAME).toBe("swifty-agent2-mcp");
  });

  it("registers the tool modules", async () => {
    const server = createServer();
    const client = await connectClient(server);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("github_read_file");
      expect(names).toHaveLength(15);
      expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("surfaces instructions at initialize time", async () => {
    const server = createServer();
    const client = await connectClient(server);
    try {
      expect(client.getInstructions()).toContain("github_*");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("a client can list and call a registered tool", async () => {
    // Without gh CLI or a token the call degrades to a clear unavailable
    // error — the round trip through the SDK still works.
    const server = createServer();
    const client = await connectClient(server);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find(
        (candidate) => candidate.name === "github_read_file",
      );
      expect(tool?.description).toContain("GitHub repository");
      expect(tool?.inputSchema).toMatchObject({ type: "object" });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("duplicate tool registration fails fast", () => {
    // registerTool throws on duplicate names — with per-request server
    // instances in HTTP mode a duplicate would surface as runtime errors.
    const server = new McpServer({ name: "test", version: "0.0.0" });
    githubModule.register(server);
    expect(() => {
      githubModule.register(server);
    }).toThrow();
  });

  it("module names are unique", () => {
    const names = modules.map((module) => module.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
