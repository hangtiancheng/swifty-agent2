// Chat model factory and structured-output helper.
//
// Three upstreams (chat / intent / summary) are configured as independent slots: an
// empty slot setting falls back to the chat group, so a single upstream needs no extra config.
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { RunnableLambda } from "@langchain/core/runnables";
import type { Runnable } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { settings } from "#/config.ts";
import { childLogger } from "#/logger.ts";

const log = childLogger("llm");
const TRUTHY = new Set(["1", "true", "yes", "on"]);

function slotSettings(slot: string): {
  model: string;
  baseUrl: string;
  apiKey: string;
} {
  if (slot === "intent") {
    return {
      model: settings.intentModel,
      baseUrl: settings.intentBaseUrl,
      apiKey: settings.intentApiKey,
    };
  }
  if (slot === "summary") {
    return {
      model: settings.summaryModel,
      baseUrl: settings.summaryBaseUrl,
      apiKey: settings.summaryApiKey,
    };
  }
  return { model: "", baseUrl: "", apiKey: "" };
}

export function resolveSlot(slot = "chat"): [string, string, string] {
  if (slot === "chat") {
    return [settings.chatModel, settings.chatBaseUrl, settings.chatApiKey];
  }
  const named = slotSettings(slot);
  return [
    named.model || settings.chatModel,
    named.baseUrl || settings.chatBaseUrl,
    named.apiKey || settings.chatApiKey,
  ];
}

interface ThinkingOptions {
  modelKwargs?: Record<string, unknown>;
  reasoningEffort?: string;
}

function thinkingKwargs(): ThinkingOptions {
  // thinking / reasoning_split are not part of the OpenAI protocol and go through modelKwargs.
  // Unsupported upstreams silently ignore them, so no provider branching here.
  const extra: Record<string, unknown> = {};
  if (settings.chatThinking) {
    extra.thinking = { type: settings.chatThinking };
  }
  if (settings.chatReasoningSplit) {
    extra.reasoning_split = TRUTHY.has(
      settings.chatReasoningSplit.trim().toLowerCase(),
    );
  }
  const kwargs: ThinkingOptions = {};
  if (Object.keys(extra).length > 0) {
    kwargs.modelKwargs = extra;
  }
  const effort = z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .safeParse(settings.chatReasoningEffort);
  if (effort.success) {
    kwargs.reasoningEffort = effort.data;
  }
  return kwargs;
}

export interface GetModelOptions {
  streaming?: boolean;
  model?: string | null;
  temperature?: number | null;
  slot?: string;
  thinking?: boolean;
}

export function getChatModel(options: GetModelOptions = {}): ChatOpenAI {
  const {
    streaming = false,
    model = null,
    temperature = null,
    slot = "chat",
    thinking = true,
  } = options;
  const [slotModel, baseURL, apiKey] = resolveSlot(slot);
  if (!apiKey) {
    throw new Error(
      `missing API key for slot "${slot}" (set CHAT_API_KEY or ${slot.toUpperCase()}_API_KEY)`,
    );
  }
  const thinkingOptions = thinking
    ? thinkingKwargs()
    : { modelKwargs: { thinking: { type: "disabled" } } };
  return new ChatOpenAI({
    model: model || slotModel,
    apiKey,
    configuration: { baseURL },
    streaming,
    streamUsage: true,
    maxTokens: settings.maxOutputTokens,
    temperature: temperature ?? 0.3,
    ...thinkingOptions,
  });
}

// Structured output only goes through function calling. Non-streaming
// OpenAI-compatible proxies corrupt tool_call arguments; json_schema parses the
// message body and can be derailed by extra reasoning text. Failures retry once,
// then throw so the call site can fall back to a safe default.
const NO_STREAM_TOOLCALL_FAMILIES = ["minimax"];

export function needsNonStreamingTools(
  model: string | null = null,
  slot = "chat",
): boolean {
  const name = String(model || resolveSlot(slot)[0] || "").toLowerCase();
  return NO_STREAM_TOOLCALL_FAMILIES.some((f) => name.includes(f));
}

export interface StructuredOptions {
  model?: string | null;
  streaming?: boolean;
  temperature?: number | null;
  slot?: string;
}

export function structured<S extends z.ZodType>(
  schema: S,
  options: StructuredOptions = {},
): Runnable<BaseLanguageModelInput, z.infer<S>> {
  const { model = null, temperature = null, slot = "chat" } = options;
  let streaming = options.streaming ?? true;
  const [slotModel, slotBase] = resolveSlot(slot);
  const name = String(model || slotModel || "").toLowerCase();
  if (needsNonStreamingTools(model, slot)) {
    streaming = false;
  }

  const m = getChatModel({
    streaming,
    model,
    temperature,
    slot,
    thinking: false,
  });
  const fc = m.withStructuredOutput(schema, { method: "functionCalling" });

  const warn = (attempt: number, why: string): void => {
    log.warn(
      { model: name, base_url: slotBase, attempt, why },
      `structured output attempt ${attempt} failed; ${attempt === 1 ? "retrying once" : "giving up"}`,
    );
  };

  const run = async (input: BaseLanguageModelInput): Promise<z.infer<S>> => {
    for (const attempt of [1, 2]) {
      try {
        const raw = await fc.invoke(input);
        if (raw !== null && raw !== undefined) {
          return schema.parse(raw);
        }
        warn(attempt, "no tool_calls in response");
      } catch (error) {
        warn(
          attempt,
          error instanceof Error ? error.constructor.name : "Error",
        );
        if (attempt === 2) {
          throw error;
        }
      }
    }
    throw new Error(
      `${name} via ${slotBase} did not return tool_calls after two attempts`,
    );
  };

  return RunnableLambda.from(run);
}
