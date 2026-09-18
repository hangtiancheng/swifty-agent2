#!/usr/bin/env node
/**
 * main.js — task runner for swifty-agent2 (replaces the old Makefile).
 *
 * Usage: node main.js <command> [extra args...]
 *
 * Two kinds of commands:
 *   - One-shot tasks run in the foreground, stream stdio and propagate the
 *     child's exit code. Extra CLI args are appended to the fixed argv, e.g.
 *     `node main.js eval-rag --skip-gen` (was `make eval-rag SKIP_GEN=1`).
 *   - Background services follow the repo convention: detached spawn with the
 *     log in log/<name>.log and the pid in data/<name>.pid, plus a readiness
 *     probe after start. `<name>-up` / `<name>-down` commands are generated
 *     from the SERVICES table, so adding a service is one table entry.
 *
 * POSIX-only (detached spawn + node_modules/.bin shims), same as the Makefile was.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(ROOT, "log");
const DATA_DIR = path.join(ROOT, "data");
// Daemon spawns use the .bin shim directly (it `exec`s node, so the recorded
// pid is the real server process); foreground tasks keep `pnpm exec tsx`.
const TSX_BIN = path.join(ROOT, "node_modules", ".bin", "tsx");
const TSX = ["pnpm", "exec", "tsx"];

/**
 * Readiness probe run right after a service is spawned.
 *
 * - `log`: poll the service log until `pattern` (plain substring) appears.
 * - `http`: poll `url` until it answers at all — any HTTP status counts as up,
 *   only connection-level failures keep it waiting.
 *
 * A probe timeout fails the start (exit code 1) unless `required: false`,
 * which downgrades it to a warning.
 *
 * @typedef {Object} ReadyCheck
 * @property {"log" | "http"} kind - Probe type.
 * @property {string} [pattern] - Substring to wait for (`kind: "log"` only).
 * @property {string} [url] - URL to probe (`kind: "http"` only).
 * @property {number} timeoutMs - Polling budget before giving up.
 * @property {boolean} [required] - `false` turns a timeout into a warning (default: required).
 */

/**
 * A long-running background service managed with the repo's pid/log-file convention.
 *
 * @typedef {Object} Service
 * @property {string} description - Human name used in help output.
 * @property {string[]} cmd - argv spawned detached from the repo root.
 * @property {string[]} [dirs] - Extra directories (relative to the repo root) to create before start.
 * @property {ReadyCheck} [ready] - Readiness probe; omit when there is nothing to check.
 * @property {string} startedMsg - Success line printed once the probe passes.
 */

/**
 * A CLI command exposed by this runner.
 *
 * @typedef {Object} Command
 * @property {string} description - One-line help text.
 * @property {(extraArgs: string[]) => void | Promise<void>} run - Handler; extra CLI args are passed through.
 */

/** @type {Record<string, Service>} */
const SERVICES = {
  milvus: {
    description: "the Milvus dense bridge (gRPC on 127.0.0.1:50051)",
    cmd: ["uv", "run", "python", "src/milvus/server.py"],
    dirs: ["data/milvus"],
    ready: { kind: "log", pattern: "listening", timeoutMs: 5_000 },
    startedMsg:
      "Milvus bridge started: 127.0.0.1:50051 (pid in data/milvus.pid)",
  },
  "mcp-logistics": {
    description: "the logistics MCP server (:8101)",
    cmd: [TSX_BIN, "src/mcp-servers/logistics.ts"],
    ready: {
      kind: "http",
      url: "http://127.0.0.1:8101/",
      timeoutMs: 5_000,
      required: false,
    },
    startedMsg:
      "MCP logistics server started: :8101 (pid in data/mcp-logistics.pid)",
  },
  "mcp-aftersales": {
    description: "the after-sales MCP server (:8102)",
    cmd: [TSX_BIN, "src/mcp-servers/aftersales.ts"],
    ready: {
      kind: "http",
      url: "http://127.0.0.1:8102/",
      timeoutMs: 5_000,
      required: false,
    },
    startedMsg:
      "MCP aftersales server started: :8102 (pid in data/mcp-aftersales.pid)",
  },
  classifier: {
    description: "the classifier service (:8110)",
    cmd: [TSX_BIN, "scripts/train/serve.ts"],
    ready: {
      kind: "http",
      url: "http://127.0.0.1:8110/healthz",
      timeoutMs: 10_000,
    },
    startedMsg:
      "Classifier service started: :8110 (pid in data/classifier.pid)",
  },
};

/**
 * Resolve a promise after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a foreground task, streaming stdio, and mirror the child's exit code
 * into `process.exitCode`.
 * @param {string[]} argv - Command and arguments.
 * @returns {void}
 */
function runForeground(argv) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(
      `Failed to start: ${argv.join(" ")} (${result.error.message})`,
    );
    process.exitCode = 1;
    return;
  }
  if (typeof result.status === "number") {
    process.exitCode = result.status;
  } else if (result.signal) {
    // Killed by a signal (e.g. Ctrl-C on `dev`) — report failure like make did.
    process.exitCode = 1;
  }
}

/**
 * Build a one-shot foreground command from a fixed argv; extra CLI args are appended.
 * @param {string} description - Help text.
 * @param {string[]} argv - Fixed command and arguments.
 * @returns {Command}
 */
const task = (description, argv) => ({
  description,
  run: (extraArgs) => {
    runForeground([...argv, ...extraArgs]);
  },
});

/**
 * Like `task`, but injects `flag value` unless the caller already passed `flag`
 * (replaces the Makefile's `$(or $(VAR),default)` parameters).
 * @param {string} description - Help text.
 * @param {string[]} argv - Fixed command and arguments.
 * @param {string} flag - Flag to default, e.g. "--days".
 * @param {string} value - Default value for the flag.
 * @returns {Command}
 */
const taskWithDefault = (description, argv, flag, value) => ({
  description,
  run: (extraArgs) => {
    const defaults = extraArgs.includes(flag) ? [] : [flag, value];
    runForeground([...argv, ...defaults, ...extraArgs]);
  },
});

/**
 * Check whether a process id is alive.
 * @param {number} pid
 * @returns {boolean}
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll a log file until it contains `pattern` or the budget runs out.
 * @param {string} file - Absolute log file path.
 * @param {string} pattern - Plain substring to look for.
 * @param {number} timeoutMs - Polling budget.
 * @returns {Promise<boolean>}
 */
async function waitForLog(file, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.readFileSync(file, "utf8").includes(pattern)) {
        return true;
      }
    } catch {
      // Log file not created yet — keep polling.
    }
    await sleep(200);
  }
  return false;
}

/**
 * Poll an HTTP endpoint until it answers (any status counts as up).
 * @param {string} url - Absolute URL to probe.
 * @param {number} timeoutMs - Polling budget.
 * @returns {Promise<boolean>}
 */
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_500) });
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

/**
 * Print the last `count` lines of a file to stderr (best effort).
 * @param {string} file - Absolute file path.
 * @param {number} count - Number of trailing lines to print.
 * @returns {void}
 */
function tail(file, count) {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const line of lines.slice(-count)) {
      console.error(line);
    }
  } catch {
    // No log yet — nothing to show.
  }
}

/**
 * Start a service detached: log to log/<name>.log (truncated), pid to
 * data/<name>.pid, then run its readiness probe. A failed probe sets exit
 * code 1 and shows the log tail.
 * @param {string} name - Service key from SERVICES.
 * @param {Service} service - Service definition.
 * @returns {Promise<void>}
 */
async function daemonUp(name, service) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const dir of service.dirs ?? []) {
    fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
  }

  const logFile = path.join(LOG_DIR, `${name}.log`);
  const fd = fs.openSync(logFile, "w");
  // Errors captured in an array: control-flow narrowing cannot see assignments
  // made inside the async 'error' callback, so a plain `let` would type as never.
  /** @type {Error[]} */
  const spawnErrors = [];
  /** @type {import("node:child_process").ChildProcess} */
  let child;
  try {
    child = spawn(service.cmd[0], service.cmd.slice(1), {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    fs.closeSync(fd);
  }
  child.once("error", (error) => {
    spawnErrors.push(error);
  });
  if (child.pid === undefined) {
    await sleep(100); // let the 'error' event arrive
    const reason = spawnErrors.length > 0 ? ` (${spawnErrors[0].message})` : "";
    console.error(
      `${name}: failed to spawn: ${service.cmd.join(" ")}${reason}`,
    );
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, `${name}.pid`), String(child.pid));
  child.unref();

  const ready = service.ready;
  if (ready === undefined) {
    console.log(service.startedMsg);
    return;
  }
  const up =
    ready.kind === "log"
      ? await waitForLog(logFile, ready.pattern ?? "", ready.timeoutMs)
      : await waitForHttp(ready.url ?? "", ready.timeoutMs);
  if (up) {
    console.log(service.startedMsg);
    return;
  }
  if (ready.required === false) {
    console.log(
      `${service.startedMsg} (not answering yet; see log/${name}.log)`,
    );
    return;
  }
  console.error(`Start failed; see log/${name}.log:`);
  if (spawnErrors.length > 0) {
    console.error(spawnErrors[0].message);
  }
  tail(logFile, 5);
  process.exitCode = 1;
}

/**
 * Stop a service by pid file (SIGTERM, best effort), then remove the pid file.
 * @param {string} name - Service key from SERVICES.
 * @returns {void}
 */
function daemonDown(name) {
  const pidFile = path.join(DATA_DIR, `${name}.pid`);
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // No pid file or already gone — nothing to stop.
  }
  fs.rmSync(pidFile, { force: true });
  console.log(`${name} stopped`);
}

/**
 * Start both MCP servers (logistics + after-sales).
 * @returns {Promise<void>}
 */
async function mcpUp() {
  await daemonUp("mcp-logistics", SERVICES["mcp-logistics"]);
  await daemonUp("mcp-aftersales", SERVICES["mcp-aftersales"]);
}

/** @type {Record<string, Command>} */
const COMMANDS = {
  help: {
    description: "Show this help",
    run: () => {
      printHelp();
    },
  },
  dev: {
    description: "Start MCP servers and the API",
    run: async () => {
      await mcpUp();
      if (process.exitCode) {
        return;
      }
      runForeground(["pnpm", "dev"]);
    },
  },
  "dev-down": {
    description: "Stop background development services",
    run: () => {
      COMMANDS["mcp-down"].run([]);
    },
  },
  "mcp-up": {
    description: "Start both MCP servers",
    run: mcpUp,
  },
  "mcp-down": {
    description: "Stop both MCP servers",
    run: () => {
      daemonDown("mcp-logistics");
      daemonDown("mcp-aftersales");
    },
  },
  "mcp-logistics": task("Run the logistics MCP server in the foreground", [
    ...TSX,
    "src/mcp-servers/logistics.ts",
  ]),
  "mcp-aftersales": task("Run the after-sales MCP server in the foreground", [
    ...TSX,
    "src/mcp-servers/aftersales.ts",
  ]),
  "agent2-mcp": task("Run the GitHub MCP server over stdio", [
    ...TSX,
    "mcp/src/main.ts",
  ]),
  "agent2-mcp-http": task(
    "Run the GitHub MCP server over HTTP (Streamable HTTP + SSE)",
    [...TSX, "mcp/src/main.ts", "--http"],
  ),
  "kb-build": task("Build the knowledge base from data/kb/ materials", [
    ...TSX,
    "scripts/kb-build.ts",
  ]),
  "kb-vectorize": task("Embed pending chunks into the vector store", [
    ...TSX,
    "scripts/kb-vectorize.ts",
  ]),
  "kb-mine": task("Mine QA knowledge from historical conversations", [
    ...TSX,
    "scripts/kb-mine.ts",
  ]),
  "kb-reset": task("Wipe both KB tables and the vector store", [
    ...TSX,
    "scripts/kb-reset.ts",
  ]),
  "kb-preview": task(
    "Preview the material list and chunking (writes nothing)",
    [...TSX, "scripts/kb-preview.ts"],
  ),
  "kb-repatch": task("Re-embed changed md text in place (patch style)", [
    ...TSX,
    "scripts/kb-repatch.ts",
  ]),
  "milvus-proto": {
    description: "Regenerate Python gRPC stubs from kb_store.proto",
    run: () => {
      fs.mkdirSync(path.join(ROOT, "src", "milvus", "pb"), { recursive: true });
      runForeground([
        "uv",
        "run",
        "python",
        "-m",
        "grpc_tools.protoc",
        "-I",
        "src/milvus",
        "--python_out=src/milvus/pb",
        "--grpc_python_out=src/milvus/pb",
        "--mypy_out=src/milvus/pb",
        "--mypy_grpc_out=src/milvus/pb",
        "src/milvus/kb_store.proto",
      ]);
      if (!process.exitCode) {
        console.log(
          "Regenerated src/milvus/pb/kb_store_pb2.py/.pyi and kb_store_pb2_grpc.py/.pyi",
        );
      }
    },
  },
  "seed-conv": task("Seed historical conversations into the DB", [
    ...TSX,
    "scripts/seed-conv.ts",
  ]),
  flywheel: task("Run the data flywheel pass", [...TSX, "scripts/flywheel.ts"]),
  "eval-rag": task(
    "RAG evaluation (extra args pass through, e.g. --skip-gen)",
    [...TSX, "scripts/eval-rag.ts"],
  ),
  "eval-flywheel": taskWithDefault(
    "Evaluation pipeline (records one trend round)",
    [...TSX, "scripts/eval-flywheel.ts"],
    "--triggered-by",
    "manual",
  ),
  "eval-retrieval": task("Retrieval-only evaluation", [
    ...TSX,
    "scripts/eval-retrieval.ts",
  ]),
  "eval-judge": task("Judge-only evaluation", [
    ...TSX,
    "scripts/eval-judge.ts",
  ]),
  "calibrate-confidence": task("Confidence threshold calibration", [
    ...TSX,
    "scripts/calibrate-confidence.ts",
  ]),
  "cost-report": taskWithDefault(
    "Cost ledger by intent",
    [...TSX, "scripts/cost-report.ts"],
    "--days",
    "7",
  ),
  "train-golden": task("Golden sample gate", [
    ...TSX,
    "scripts/train/validate-golden.ts",
  ]),
  "train-corpus": task("Build the classifier corpus", [
    ...TSX,
    "scripts/train/build-corpus.ts",
  ]),
  "train-dataset": task("Split & augment the classifier dataset", [
    ...TSX,
    "scripts/train/build-dataset.ts",
  ]),
  train: task("Full-parameter fine-tune (Python/torch)", [
    "uv",
    "run",
    "python",
    "scripts/train/py/train.py",
  ]),
  "train-eval": task("Test set evaluation (Python)", [
    "uv",
    "run",
    "python",
    "scripts/train/py/evaluate.py",
  ]),
  "train-export": task("ONNX export & consistency check (Python)", [
    "uv",
    "run",
    "python",
    "scripts/train/py/export_onnx.py",
  ]),
  "train-typecheck": task("mypy (strict) over scripts/train/py", [
    "uv",
    "run",
    "--with",
    "mypy",
    "mypy",
    "scripts/train/py",
  ]),
  "train-threshold-scan": task("Threshold scan replay against :8110", [
    ...TSX,
    "scripts/train/scan-threshold-replay.ts",
  ]),
  "classify-pool": task("Bypass batch classification of the pool", [
    ...TSX,
    "scripts/train/classify-pool.ts",
  ]),
  "classify-pool-force": task("classify-pool with --force (partial batch)", [
    ...TSX,
    "scripts/train/classify-pool.ts",
    "--force",
  ]),
};

// Generate <name>-up / <name>-down for every entry in SERVICES.
for (const [name, service] of Object.entries(SERVICES)) {
  COMMANDS[`${name}-up`] = {
    description: `Start ${service.description}`,
    run: () => daemonUp(name, service),
  };
  COMMANDS[`${name}-down`] = {
    description: `Stop ${service.description}`,
    run: () => {
      daemonDown(name);
    },
  };
}

/**
 * Print the command list, aligned like the old `make help`.
 * @returns {void}
 */
function printHelp() {
  const names = Object.keys(COMMANDS).sort();
  const width = Math.max(...names.map((name) => name.length)) + 2;
  console.log("Usage: node main.js <command> [extra args]\n");
  console.log("Commands:");
  for (const name of names) {
    console.log(`  ${name.padEnd(width)}${COMMANDS[name].description}`);
  }
}

/**
 * CLI entry: dispatch argv to a command; no args prints help
 * (the old Makefile's default goal).
 * @returns {Promise<void>}
 */
async function main() {
  const [name, ...extraArgs] = process.argv.slice(2);
  if (name === undefined || name === "--help" || name === "-h") {
    printHelp();
    return;
  }
  const command = COMMANDS[name];
  if (command === undefined) {
    console.error(`Unknown command: ${name}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  await command.run(extraArgs);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
