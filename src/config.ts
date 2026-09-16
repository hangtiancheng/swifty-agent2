// Runtime configuration loaded from .env (if present) plus process.env.
// Required upstream credentials are validated on server start; scripts that do not
// touch an upstream keep working without them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENV_FILE = path.join(ROOT, ".env");

if (fs.existsSync(ENV_FILE)) {
  // Node >= 20.12 built-in .env loader; no external dependency needed.
  process.loadEnvFile(ENV_FILE);
}

const str = (name: string, fallback = ""): string => (process.env[name] ?? fallback).trim();
const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
};

export const settings = {
  root: ROOT,

  // --- chat upstream (required at runtime) ---
  chatModel: str("CHAT_MODEL"),
  chatBaseUrl: str("CHAT_BASE_URL"),
  chatApiKey: str("CHAT_API_KEY"),
  chatThinking: str("CHAT_THINKING"),
  chatReasoningEffort: str("CHAT_REASONING_EFFORT"),
  chatReasoningSplit: str("CHAT_REASONING_SPLIT"),

  // --- embeddings upstream (required at runtime) ---
  embedBaseUrl: str("EMBED_BASE_URL", "https://api.siliconflow.cn/v1"),
  embedApiKey: str("EMBED_API_KEY"),
  embedModel: str("EMBED_MODEL", "BAAI/bge-m3"),

  // --- rerank upstream (required at runtime) ---
  rerankBaseUrl: str("RERANK_BASE_URL", "https://api.siliconflow.cn/v1"),
  rerankApiKey: str("RERANK_API_KEY"),
  rerankModel: str("RERANK_MODEL", "BAAI/bge-reranker-v2-m3"),

  tokenBudget: num("TOKEN_BUDGET", 2000),

  // --- database / checkpointer ---
  databaseUrl: str("DATABASE_URL", "file:./data/mewhelp.db"),
  checkpointerDbPath: str("CHECKPOINTER_DB_PATH", "data/ch05_checkpoints.sqlite"),

  // --- retrieval ---
  recallTopK: num("RECALL_TOP_K", 50),
  rerankTopK: num("RERANK_TOP_K", 10),
  subquerySplit: bool("SUBQUERY_SPLIT", true),
  rerankMinScore: num("RERANK_MIN_SCORE", 0.3),

  // --- graph orchestration ---
  maxAgentSteps: num("MAX_AGENT_STEPS", 6),

  // --- per-purpose model slots (empty = fall back to chat) ---
  intentModel: str("INTENT_MODEL"),
  intentBaseUrl: str("INTENT_BASE_URL"),
  intentApiKey: str("INTENT_API_KEY"),
  intentSmallModel: str("INTENT_SMALL_MODEL"),
  intentMode: str("INTENT_MODE", "accuracy"),
  intentConfThreshold: num("INTENT_CONF_THRESHOLD", 0.6),
  summaryModel: str("SUMMARY_MODEL"),
  summaryBaseUrl: str("SUMMARY_BASE_URL"),
  summaryApiKey: str("SUMMARY_API_KEY"),

  // --- context budget (tokens) ---
  contextWindowMaxTokens: num("CONTEXT_WINDOW_MAX_TOKENS", 0),
  modelContextWindow: num("MODEL_CONTEXT_WINDOW", 0),
  contextBudgetTurns: num("CONTEXT_BUDGET_TURNS", 20),
  maxUserInputTokens: num("MAX_USER_INPUT_TOKENS", 2000),
  maxOutputTokens: num("MAX_OUTPUT_TOKENS", 10000),
  systemPromptTokens: num("SYSTEM_PROMPT_TOKENS", 700),
  evidenceTokensPerChunk: num("EVIDENCE_TOKENS_PER_CHUNK", 160),
  layer1Ratio: num("LAYER1_RATIO", 0.7),
  layer2ReplyKeepChars: num("LAYER2_REPLY_KEEP_CHARS", 60),
  layer2ToolKeepTokens: num("LAYER2_TOOL_KEEP_TOKENS", 200),
  toolResultMaxTokens: num("TOOL_RESULT_MAX_TOKENS", 3000),
  agentStepAiTokens: num("AGENT_STEP_AI_TOKENS", 500),
  summaryInjectSegments: num("SUMMARY_INJECT_SEGMENTS", 3),
  summaryTokensPerSegment: num("SUMMARY_TOKENS_PER_SEGMENT", 250),
  budgetSafetyMargin: num("BUDGET_SAFETY_MARGIN", 1000),
  zhCharsPerToken: num("ZH_CHARS_PER_TOKEN", 1.2),

  // --- tools / MCP ---
  mcpLogisticsUrl: str("MCP_LOGISTICS_URL", "http://127.0.0.1:8101/mcp"),
  mcpAftersalesUrl: str("MCP_AFTERSALES_URL", "http://127.0.0.1:8102/mcp"),
  toolDefaultTimeout: num("TOOL_DEFAULT_TIMEOUT", 5.0),
  mcpToolTimeout: num("MCP_TOOL_TIMEOUT", 10.0),
  toolMaxRetries: num("TOOL_MAX_RETRIES", 2),
  demoTicketDelaySeconds: num("DEMO_TICKET_DELAY_SECONDS", 0.0),

  // --- observability (all three set = Langfuse enabled) ---
  langfusePublicKey: str("LANGFUSE_PUBLIC_KEY"),
  langfuseSecretKey: str("LANGFUSE_SECRET_KEY"),
  langfuseBaseUrl: str("LANGFUSE_BASE_URL"),

  // --- confidence gate ---
  evidenceConfidenceThreshold: num("EVIDENCE_CONFIDENCE_THRESHOLD", 0.26),

  // --- server ---
  port: num("PORT", 8000),
};

export function missingRuntimeConfig(): string[] {
  const required: Array<[string, string]> = [
    ["CHAT_MODEL", settings.chatModel],
    ["CHAT_BASE_URL", settings.chatBaseUrl],
    ["CHAT_API_KEY", settings.chatApiKey],
    ["EMBED_API_KEY", settings.embedApiKey],
    ["RERANK_API_KEY", settings.rerankApiKey],
  ];
  return required.filter(([, value]) => !value).map(([key]) => key);
}
