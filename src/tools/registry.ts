// Tool registry: builtin (scan on startup) + MCP (fetched per turn) unified as ToolSpec.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { childLogger } from "#/logger.ts";

const log = childLogger("tools.registry");

// Permissions are decided on our side, never by the server-provided description.
export const WRITE_TOOLS = new Set(["create_ticket"]);

export type ToolPermission = "read" | "write";
export type ToolSource = "builtin" | "mcp";
export type ToolHandler = (args: Record<string, unknown>) => unknown;
export type ResultFormatter = (data: Record<string, unknown>) => Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  invoke: ToolHandler;
  permission: ToolPermission;
  source: ToolSource;
  mcpServer: string | null;
  timeout: number | null;
  maxRetries: number | null;
  injectConversation: boolean;
  injectUserId: boolean;
  formatResult: ResultFormatter | null;
}

export interface DefineToolOptions {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: ToolHandler;
  source?: ToolSource;
  mcpServer?: string | null;
  timeout?: number | null;
  maxRetries?: number | null;
  injectConversation?: boolean;
  injectUserId?: boolean;
  formatResult?: ResultFormatter | null;
}

export function permissionFor(name: string): ToolPermission {
  return WRITE_TOOLS.has(name) ? "write" : "read";
}

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema);
  const out: Record<string, unknown> = { ...json };
  delete out.$schema;
  return out;
}

export function defineTool(options: DefineToolOptions): ToolSpec {
  return {
    name: options.name,
    description: options.description,
    jsonSchema: jsonSchemaOf(options.schema),
    invoke: options.handler,
    permission: permissionFor(options.name),
    source: options.source ?? "builtin",
    mcpServer: options.mcpServer ?? null,
    timeout: options.timeout ?? null,
    maxRetries: options.maxRetries ?? null,
    injectConversation: options.injectConversation ?? false,
    injectUserId: options.injectUserId ?? false,
    formatResult: options.formatResult ?? null,
  };
}

export interface DefineRawToolOptions {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  handler: ToolHandler;
  source: ToolSource;
  mcpServer?: string | null;
  timeout?: number | null;
  maxRetries?: number | null;
  formatResult?: ResultFormatter | null;
}

export function defineRawTool(options: DefineRawToolOptions): ToolSpec {
  // For tools whose schema is already JSON Schema (MCP server definitions).
  return {
    name: options.name,
    description: options.description,
    jsonSchema: options.jsonSchema,
    invoke: options.handler,
    permission: permissionFor(options.name),
    source: options.source,
    mcpServer: options.mcpServer ?? null,
    timeout: options.timeout ?? null,
    maxRetries: options.maxRetries ?? null,
    injectConversation: false,
    injectUserId: false,
    formatResult: options.formatResult ?? null,
  };
}

const builtin = new Map<string, ToolSpec>();
let scanned = false;

export function register(spec: ToolSpec): void {
  if (builtin.has(spec.name)) {
    log.warn({ name: spec.name }, "duplicate tool name; keeping the first registration");
    return;
  }
  builtin.set(spec.name, spec);
}

export async function scanBuiltin(): Promise<void> {
  // Import every module in builtin/; each module registers its tools on import.
  if (scanned) {
    return;
  }
  scanned = true;
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin");
  const files = fs
    .readdirSync(dir)
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.startsWith("index."))
    .sort();
  for (const file of files) {
    try {
      await import(new URL(`./builtin/${file}`, import.meta.url).href);
    } catch (error) {
      log.error({ err: error, file }, "failed to import builtin tool module; skipping");
    }
  }
  log.info({ tools: [...builtin.keys()].sort() }, "builtin tools registered");
}

export async function builtinSpecs(): Promise<ToolSpec[]> {
  await scanBuiltin();
  return [...builtin.values()];
}

export async function getBuiltinSpec(name: string): Promise<ToolSpec | null> {
  await scanBuiltin();
  return builtin.get(name) ?? null;
}

export async function getAllSpecs(): Promise<ToolSpec[]> {
  // Order must stay stable: tool definitions live in the model's cacheable prefix.
  const merged = new Map<string, ToolSpec>();
  for (const spec of await builtinSpecs()) {
    merged.set(spec.name, spec);
  }
  const { fetchMcpSpecs } = await import("./mcp-client.ts");
  for (const spec of await fetchMcpSpecs()) {
    if (merged.has(spec.name)) {
      log.warn({ name: spec.name, server: spec.mcpServer }, "MCP tool name collides with a builtin; dropping it");
      continue;
    }
    merged.set(spec.name, spec);
  }
  return [...merged.values()];
}
