// Unified tool execution engine: the single channel for every tool call.
// Pipeline: lookup -> JSON Schema validation -> permission gate -> execute (timeout/retry)
// -> triage -> format + audit. Errors are fed back to the model as tool messages.
import { ToolMessage } from "@langchain/core/messages";
import { Ajv } from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";

import { settings } from "../config.ts";
import * as memory from "../core/memory.ts";
import * as repository from "../db/repository.ts";
import { childLogger } from "../logger.ts";

import type { ToolSpec } from "./registry.ts";

const log = childLogger("tools.engine");

const ajv = new Ajv({ strict: false, allErrors: false });
const validators = new WeakMap<ToolSpec, ValidateFunction>();

const SUMMARY_LIMIT = 500;

export class ToolTimeoutError extends Error {
  constructor() {
    super("tool execution timed out");
    this.name = "ToolTimeoutError";
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof ToolTimeoutError) {
    return true;
  }
  if (error instanceof TypeError) {
    return true; // fetch/network failures surface as TypeError
  }
  return error instanceof Error && error.name === "AbortError";
}

const rawParse: (text: string) => unknown = JSON.parse;

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: rawParse(text) };
  } catch {
    return { ok: false };
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, v: unknown) => (typeof v === "bigint" ? String(v) : v));
}

function bestMatch(errors: ErrorObject[] | null | undefined): ErrorObject | null {
  if (!errors || errors.length === 0) {
    return null;
  }
  let best = errors[0];
  for (const err of errors) {
    if (err.instancePath.length > best.instancePath.length) {
      best = err;
    }
  }
  return best;
}

export function validateArgs(spec: ToolSpec, args: Record<string, unknown>): string | null {
  // Validate the model-provided args against the visible JSON Schema.
  let validate = validators.get(spec);
  if (validate === undefined) {
    validate = ajv.compile(spec.jsonSchema);
    validators.set(spec, validate);
  }
  const ok = validate(args);
  if (ok) {
    return null;
  }
  const err = bestMatch(validate.errors);
  if (err === null) {
    return "参数不符合 schema";
  }
  const where = err.instancePath ? ` (字段 ${err.instancePath})` : "";
  return `${err.message ?? "invalid arguments"}${where}`;
}

function timeoutOf(spec: ToolSpec): number {
  if (spec.timeout !== null) {
    return spec.timeout;
  }
  return spec.source === "mcp" ? settings.mcpToolTimeout : settings.toolDefaultTimeout;
}

function summarize(content: string): string {
  return content.length <= SUMMARY_LIMIT ? content : `${content.slice(0, SUMMARY_LIMIT)}…(截断)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatContent(spec: ToolSpec, result: unknown): string {
  let value = result;
  if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) {
    const texts = value
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text);
    if (texts.length > 0) {
      value = texts.join("\n");
    }
  }
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (!parsed.ok) {
      return value; // plain-text result passes through
    }
    value = parsed.value;
  }
  if (spec.formatResult !== null && isRecord(value)) {
    try {
      value = spec.formatResult(value);
    } catch (error) {
      log.error({ err: error, tool: spec.name }, "result formatter failed; passing the raw result through");
    }
  }
  return stringifyJson(value);
}

function capTokens(content: string): string {
  // Cap what is fed back to the model; the audit keeps only a summary anyway.
  const limit = memory.tokensToChars(settings.toolResultMaxTokens);
  if (content.length <= limit) {
    return content;
  }
  const cut = content.lastIndexOf("\n", limit);
  const head = content.slice(0, cut > limit / 2 ? cut : limit);
  return `${head}\n…(结果过长已截断,需要完整数据请缩小查询范围)`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function audit(
  conversationId: number,
  toolCallId: string,
  name: string,
  spec: ToolSpec | null,
  args: Record<string, unknown>,
  resultSummary: string | null,
  status: string,
  errorMessage: string | null,
  retryCount: number,
  durationMs: number,
): Promise<void> {
  log.info(
    {
      conv: conversationId || "-",
      tool: name,
      source: spec?.source ?? "unknown",
      server: spec?.mcpServer ?? "-",
      status,
      retry: retryCount,
      duration_ms: durationMs,
      err: errorMessage ? errorMessage.slice(0, 80) : undefined,
    },
    "tool_run",
  );
  try {
    await repository.insertToolAudit({
      conversationId: conversationId || null,
      toolCallId: toolCallId ? toolCallId.slice(0, 64) : null,
      toolName: name.slice(0, 128),
      toolSource: spec?.source ?? "builtin",
      mcpServer: spec?.mcpServer ?? null,
      arguments: args,
      resultSummary,
      status,
      errorMessage: errorMessage ? errorMessage.slice(0, 500) : null,
      retryCount,
      durationMs,
    });
  } catch (error) {
    log.error({ err: error, tool: name, status }, "audit write failed (tool execution unaffected)");
  }
}

export interface ToolCallRequest {
  name?: string;
  id?: string;
  args?: Record<string, unknown> | null;
}

export interface ExecuteOptions {
  confirmed?: boolean;
  denyNote?: string | null;
  userId?: string;
}

export interface ToolRun {
  toolCallId: string;
  name: string;
  ok: boolean;
  toolMessage: ToolMessage;
  status: string;
  retryCount: number;
  durationMs: number;
}

export async function executeToolCall(
  toolCall: ToolCallRequest,
  conversationId: number,
  specs: Map<string, ToolSpec>,
  options: ExecuteOptions = {},
): Promise<ToolRun> {
  const name = toolCall.name ?? "";
  const tcId = toolCall.id ?? "";
  const args: Record<string, unknown> = { ...(toolCall.args ?? {}) };
  const started = Date.now();

  const make = (ok: boolean, content: string, status: string, retryCount = 0): ToolRun => ({
    toolCallId: tcId,
    name,
    ok,
    status,
    retryCount,
    durationMs: Date.now() - started,
    toolMessage: new ToolMessage({
      content,
      tool_call_id: tcId,
      name: name || "unknown",
      status: ok ? "success" : "error",
    }),
  });

  const spec = specs.get(name);
  if (!spec) {
    const run = make(false, `工具执行失败:未知工具 ${name}`, "失败");
    await audit(conversationId, tcId, name || "unknown", null, args, null, "失败", `未知工具 ${name}`, 0, run.durationMs);
    return run;
  }

  let verr: string | null;
  try {
    verr = validateArgs(spec, args);
  } catch (error) {
    log.error({ err: error, tool: name }, "arg validator crashed (usually a malformed MCP schema)");
    const run = make(false, `工具暂时不可用:参数定义异常(${error instanceof Error ? error.name : "Error"}),请如实告知用户。`, "失败");
    await audit(conversationId, tcId, name, spec, args, null, "失败", `schema 异常`, 0, run.durationMs);
    return run;
  }
  if (verr !== null) {
    const run = make(false, `参数校验未通过:${verr}。请修正参数重新调用;缺少的信息请先向用户追问,不要编造。`, "校验拦下");
    await audit(conversationId, tcId, name, spec, args, null, "校验拦下", verr, 0, run.durationMs);
    return run;
  }

  // Write operations need the confirmation token issued after an interrupt.
  if (spec.permission === "write" && options.confirmed !== true) {
    const note = options.denyNote ?? "该写操作需要用户确认,未确认前拒绝执行。请勿再次发起,除非用户明确要求。";
    const run = make(false, `${name} 未执行:${note}`, "权限拒绝");
    await audit(conversationId, tcId, name, spec, args, null, "权限拒绝", note.slice(0, 500), 0, run.durationMs);
    return run;
  }

  // Injected args are added after validation: they are not in the visible schema.
  if (spec.injectConversation) {
    args.conversation_id = conversationId;
  }
  if (spec.injectUserId) {
    args.user_id = options.userId ?? "";
  }

  const retries = spec.permission === "write" ? 0 : spec.maxRetries ?? settings.toolMaxRetries;
  const toolTimeout = timeoutOf(spec);
  let attempt = 0;
  for (;;) {
    try {
      const result = await withTimeout(Promise.resolve(spec.invoke(args)), toolTimeout);
      const content = capTokens(formatContent(spec, result));
      const run = make(true, content, "成功", attempt);
      await audit(conversationId, tcId, name, spec, args, summarize(content), "成功", null, attempt, run.durationMs);
      return run;
    } catch (error) {
      if (isTransient(error) && attempt < retries) {
        attempt += 1;
        log.warn({ tool: name, attempt, err: error instanceof Error ? error.name : "Error" }, "transient tool failure; retrying");
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      const isTimeout = error instanceof ToolTimeoutError;
      const status = isTimeout ? "超时" : "失败";
      const label = isTimeout ? "执行超时" : error instanceof Error ? error.name : "Error";
      const run = make(false, `工具暂时不可用:${isTimeout ? "执行超时" : label},请稍后再试或如实告知用户。`, status, attempt);
      await audit(conversationId, tcId, name, spec, args, null, status, label, attempt, run.durationMs);
      return run;
    }
  }
}
