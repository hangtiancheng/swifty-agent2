// Standard pino logger writing to stderr only: the stdio MCP transport owns
// stdout for JSON-RPC frames, so any stray stdout write would corrupt the
// protocol stream.

import pino, { type Logger } from "pino";

const KNOWN_LEVELS = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

// LOG_LEVEL mirrors the Python original's structlog level switch; an unknown
// value degrades to "info" instead of crashing at startup.
function resolveLevel(): string {
  const configured = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  return KNOWN_LEVELS.has(configured) ? configured : "info";
}

export const logger: Logger = pino(
  {
    name: "swifty-agent2-mcp",
    errorKey: "err",
    level: resolveLevel(),
  },
  pino.destination(2),
);
