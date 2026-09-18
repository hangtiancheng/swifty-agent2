import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { modules } from "./tools/index.ts";
import { version } from "./version.ts";

export const SERVER_NAME = "swifty-agent2-mcp";

// Surfaced to clients at initialize time; hosts inject it into the model's
// context, improving tool selection.
const INSTRUCTIONS =
  "swifty-agent2-mcp exposes GitHub repositories as MCP tools. " +
  "Use the github_* tools to inspect repositories (metadata, files, trees, " +
  "commits, branches, tags), search code and repositories, work with issues " +
  "and pull requests (list/create), and make changes (create repositories " +
  "and branches, write single files); they run through the local gh CLI when " +
  "it is authenticated and fall back to the GITHUB_TOKEN env var otherwise.";

// registerTool throws on duplicate names — with per-request server instances
// in HTTP mode that would surface as runtime errors, so fail fast at startup.
function assertUniqueModuleNames(): void {
  const seen = new Set<string>();
  for (const module of modules) {
    if (seen.has(module.name)) {
      throw new Error(`duplicate tool module name: ${module.name}`);
    }
    seen.add(module.name);
  }
}
assertUniqueModuleNames();

/**
 * Build an MCP server with every tool module registered. Cheap to call:
 * the HTTP transports create one instance per session/request while module
 * state stays in process-wide singletons.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version },
    { instructions: INSTRUCTIONS },
  );
  for (const module of modules) {
    module.register(server);
  }
  return server;
}
