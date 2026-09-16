// Context budget: allocate the model window across fixed blocks, then the sliding window.
//
// Two different per-turn numbers must not be conflated:
//   peak   turnPeakTokens()       transient usage of the current ReAct turn
//   steady historyPerTurn()       what the turn leaves behind once compressed into history
// The startup self-check asks about the peak; sliding-window coverage asks about the steady value.
import { settings } from "#/config.ts";

// OpenAI-compatible /v1/models does not expose context length; keep a local prefix table.
const KNOWN_WINDOWS: Record<string, number> = {
  "minimax-m3": 1_000_000,
  "minimax-m2": 204_800,
  "deepseek-v4-flash": 1_048_576,
  "deepseek-v4": 1_048_576,
  "deepseek-v3": 131_072,
  "deepseek-chat": 131_072,
  "deepseek-reasoner": 131_072,
  qwen3: 131_072,
  "qwen-max": 32_768,
  "glm-4": 131_072,
  "kimi-k2": 262_144,
  "moonshot-v1-128k": 131_072,
  "gpt-4.1": 1_047_576,
  "gpt-4o": 128_000,
  "claude-": 200_000,
};
const FALLBACK_WINDOW = 32_768;

export function lookupWindow(model: string): [number, boolean] {
  // Upstreams often carry a provider prefix (deepseek-ai/DeepSeek-V4-Flash); use the tail.
  const name = String(model ?? "")
    .trim()
    .toLowerCase()
    .split("/")
    .pop();
  let hit: string | null = null;
  for (const key of Object.keys(KNOWN_WINDOWS)) {
    if (name?.startsWith(key) && (hit === null || key.length > hit.length)) {
      hit = key;
    }
  }
  return hit ? [KNOWN_WINDOWS[hit], true] : [FALLBACK_WINDOW, false];
}

export function resolveWindow(): number {
  if (settings.modelContextWindow > 0) {
    return settings.modelContextWindow;
  }
  return lookupWindow(settings.chatModel)[0];
}

export function summaryTokens(): number {
  return settings.summaryInjectSegments * settings.summaryTokensPerSegment;
}

export function evidenceTokens(topK: number | null = null): number {
  const k = topK ?? settings.rerankTopK;
  return k * settings.evidenceTokensPerChunk;
}

export function turnPeakTokens(): number {
  return (
    settings.maxUserInputTokens +
    settings.maxAgentSteps *
      (settings.toolResultMaxTokens + settings.agentStepAiTokens)
  );
}

export function historyPerTurn(): number {
  return (
    settings.maxUserInputTokens +
    settings.maxOutputTokens +
    settings.maxAgentSteps * settings.layer2ToolKeepTokens
  );
}

export interface ContextBudget {
  window: number;
  fixed: number;
  sliding: number;
  turns: number;
  peak: number;
  limitedBy: "turns" | "window";
  healthy: boolean;
  perTurn: number;
}

export function compute(window: number | null = null): ContextBudget {
  const w = window ?? resolveWindow();
  const perTurn = historyPerTurn();
  const peak = turnPeakTokens();

  const fixed =
    settings.systemPromptTokens +
    evidenceTokens() +
    summaryTokens() +
    settings.maxOutputTokens +
    settings.budgetSafetyMargin;

  const room = w - fixed - peak;
  if (room <= 0) {
    return {
      window: w,
      fixed,
      sliding: 0,
      turns: 0,
      peak,
      limitedBy: "window",
      healthy: false,
      perTurn,
    };
  }
  const byTurns = settings.contextBudgetTurns * perTurn;
  const sliding = Math.min(byTurns, room);
  const limitedBy = sliding === byTurns ? "turns" : "window";
  const turns = Math.floor(sliding / perTurn);
  return {
    window: w,
    fixed,
    sliding,
    turns,
    peak,
    limitedBy,
    healthy: turns >= 1,
    perTurn,
  };
}

export function describe(b: ContextBudget): string {
  return (
    `window=${b.window} fixed=${b.fixed} turn_peak=${b.peak} sliding=${b.sliding} ` +
    `turns=${b.turns} (steady_per_turn=${b.perTurn}) limited_by=${b.limitedBy} ` +
    `healthy=${b.healthy ? "yes" : "no"}`
  );
}
