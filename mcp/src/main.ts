// Entry point: the MCP server over stdio, or over HTTP with --http.
//
// There is no startup credential gate: the github_* tools resolve their
// backend (an authenticated `gh` CLI or the GITHUB_TOKEN env var) per call
// and answer with a clear unavailable error when neither is present, so the
// server always starts.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { startHttpServer } from "./http.ts";
import { createServer } from "./server.ts";
import { loadConfig } from "./shared/config.ts";
import { logger } from "./shared/logger.ts";
import { modules } from "./tools/index.ts";
import { version } from "./version.ts";

const USAGE = `MCP server exposing GitHub repositories as tools (stdio, or --http).

Options:
 -v, --version  Show the version and exit.
 --http         Serve over HTTP (Streamable HTTP + SSE) instead of stdio.
 -h, --help     Show this message and exit.`;

/**
 * Load the shared root .env (Node >= 20.12 built-in loader; no dependency).
 * Walks up from this file so the server finds the repo root's .env no
 * matter which directory it is started from. Existing variables win, same
 * contract as python-dotenv.
 */
function loadDotenv(): void {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

let shuttingDown = false;

/** Close transports and tool modules, then exit. Never runs twice. */
function shutdown(reason: string, closeTransport: () => Promise<void>): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ reason }, "shutting down");
  // Safety net: a wedged transport/module must never keep the process alive.
  setTimeout(() => {
    process.exit(0);
  }, 5000).unref();
  void (async () => {
    try {
      await closeTransport();
    } catch (err) {
      logger.warn({ err }, "transport close failed");
    }
    for (const module of modules) {
      try {
        await module.shutdown?.();
      } catch (err) {
        logger.warn({ err, module: module.name }, "module shutdown failed");
      }
    }
    process.exit(0);
  })();
}

function registerSignalHandlers(closeTransport: () => Promise<void>): void {
  process.on("SIGINT", () => {
    shutdown("SIGINT", closeTransport);
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM", closeTransport);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("-v") || args.includes("--version")) {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  loadDotenv();

  const useHttp =
    args.includes("--http") ||
    (process.env.MCP_TRANSPORT ?? "").trim().toLowerCase() === "http";

  if (useHttp) {
    const { host, port } = loadConfig();
    const httpServer = await startHttpServer(host, port);
    registerSignalHandlers(() => httpServer.close());
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // When the client disconnects, open handles would keep the process alive
    // — exit through shutdown instead. The SDK transport does not self-close
    // on stdin EOF, so watch stdin directly.
    server.server.onclose = () => {
      shutdown("transport closed", () => Promise.resolve());
    };
    process.stdin.on("end", () => {
      shutdown("stdin closed", () => server.close());
    });
    process.stdin.on("close", () => {
      shutdown("stdin closed", () => server.close());
    });
    registerSignalHandlers(() => server.close());
    logger.info("MCP stdio server connected");
  }

  // Kick off module initialization only after the transport is up, so tools
  // are listable immediately; tool calls await the same init internally.
  for (const module of modules) {
    if (module.init) {
      void module.init().catch((err: unknown) => {
        logger.warn({ err, module: module.name }, "module init failed");
      });
    }
  }
}

void main().catch((err: unknown) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
