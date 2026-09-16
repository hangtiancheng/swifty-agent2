// Background job runner for admin pages: start / tail / stop registered jobs only.
// argv is fixed here; the front end can only submit a job name, never a shell fragment.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { settings } from "#/config.ts";
import { childLogger } from "#/logger.ts";

const log = childLogger("jobs");

export const REPO_ROOT = settings.root;
export const LOG_DIR = path.join(REPO_ROOT, "log", "acceptance");
const TAIL_LINES = 400;

export interface JobSpec {
  name: string;
  title: string;
  argv: string[];
  needs: string;
  heavy: boolean;
}

const script = (name: string): string[] => [process.execPath, path.join("scripts", `${name}.ts`)];
// ch10 TS scripts live under scripts/ch10/; the three torch-dependent steps stay in Python and run
// through uv's ml dependency group; classifier-up/down are daemon management, so they go through make.
const ch10Script = (name: string, ...args: string[]): string[] => [
  process.execPath,
  path.join("scripts", "ch10", `${name}.ts`),
  ...args,
];
const pyScript = (name: string): string[] => [
  "uv",
  "run",
  "--group",
  "ml",
  "python",
  path.join("scripts", "ch10", "py", `${name}.py`),
];
const makeTarget = (...args: string[]): string[] => ["make", ...args];

function spec(name: string, title: string, argv: string[], needs: string, heavy = false): JobSpec {
  return { name, title, argv, needs, heavy };
}

export const JOBS: Record<string, JobSpec> = Object.fromEntries(
  [
    // knowledge base build pipeline
    spec("kb-preview", "Material list & chunk preview", script("kb-preview"), "Runs locally; writes nothing to the DB"),
    spec("kb-build", "Offline KB build (document chunking → pending)", script("kb-build"), "Requires the local DB"),
    spec("kb-mine", "Conversation knowledge mining (extract QA → dedup → pending)", script("kb-mine"), "Requires the local DB + chat upstream", true),
    spec("kb-vectorize", "Vectorization (embeddings → local vector store → mark done)", script("kb-vectorize"), "Requires the local DB + embedding upstream"),
    spec("kb-repatch", "Patch-style re-embed (md changes → update text in place)", script("kb-repatch"), "Requires the local DB; afterwards run \"Vectorize pending chunks\""),
    spec("seed-conv", "Seed historical conversations", script("seed-conv"), "Requires the local DB"),
    spec("kb-reset", "Wipe & rebuild (clear both tables + clear vectors)", script("kb-reset"), "Requires the local DB; empties the knowledge base", true),
    // RAG evaluation / flywheel / cost reports
    spec("eval-rag", "RAG evaluation (four-strategy comparison)", script("eval-rag"), "Requires the local vector store + a built KB + chat upstream; takes minutes", true),
    spec("cost-report", "Cost ledger by intent", script("cost-report"), "Requires Langfuse running with traces inside the window"),
    spec("eval-flywheel", "Evaluation pipeline (records one trend round)", script("eval-flywheel"), "Requires the local DB + a built KB + chat upstream; takes minutes", true),
    spec("calibrate-confidence", "Confidence threshold calibration", script("calibrate-confidence"), "Requires the local vector store + a built KB + rerank upstream; takes minutes", true),
    // ch10 topic classifier: corpus -> dataset -> train -> eval -> export -> threshold scan -> serve -> bypass classify
    spec("ch10-golden", "Golden sample gate", ch10Script("validate-golden"), "Requires chat upstream"),
    spec("ch10-corpus", "Corpus pipeline", ch10Script("build-corpus"), "Requires the local DB + chat upstream", true),
    spec("ch10-dataset", "Dataset split & augmentation", ch10Script("build-dataset"), "Requires chat upstream", true),
    spec("ch10-train", "Full-parameter fine-tune", pyScript("train"), "Requires the ml deps (uv); takes minutes", true),
    spec("train-eval", "Test set evaluation", pyScript("evaluate"), "Requires the ml deps + trained weights"),
    spec("ch10-export", "ONNX export & consistency check", pyScript("export_onnx"), "Requires the ml deps + trained weights", true),
    spec("ch10-threshold-scan", "Threshold scan replay", ch10Script("scan-threshold-replay"), "Requires the classifier service :8110"),
    spec("classifier-up", "Start the classifier service", makeTarget("classifier-up"), "Requires exported ONNX"),
    spec("classifier-down", "Stop the classifier service", makeTarget("classifier-down"), "—"),
    spec("classify-pool", "Bypass batch classification", ch10Script("classify-pool"), "Requires the local DB + :8110"),
    spec("classify-pool-force", "Bypass batch classification (force a partial batch)", ch10Script("classify-pool", "--force"), "Requires the local DB + :8110"),
  ].map((s) => [s.name, s]),
);

export type JobStatus = "idle" | "running" | "ok" | "failed" | "stopped";

export interface JobRun {
  status: JobStatus;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  returncode: number | null;
  proc: ChildProcess | null;
}

const runs = new Map<string, JobRun>();

function runOf(name: string): JobRun {
  let run = runs.get(name);
  if (!run) {
    run = { status: "idle", pid: null, startedAt: null, finishedAt: null, returncode: null, proc: null };
    runs.set(name, run);
  }
  return run;
}

export function logPath(name: string): string {
  return path.join(LOG_DIR, `${name}.log`);
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19);
}

export function start(name: string): JobRun {
  const spec0 = JOBS[name];
  if (!spec0) {
    throw new Error(`unknown job: ${name}`);
  }
  const run = runOf(name);
  if (run.status === "running") {
    throw new Error(`${spec0.title} is already running (pid ${run.pid}); wait for it to finish before starting it again`);
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = logPath(name);
  fs.writeFileSync(file, `$ ${spec0.argv.join(" ")}\n# ${new Date().toISOString()} started from admin page\n\n`);
  const fd = fs.openSync(file, "a");
  let child: ChildProcess;
  try {
    child = spawn(spec0.argv[0], spec0.argv.slice(1), {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", fd, fd],
      detached: true,
    });
  } finally {
    fs.closeSync(fd);
  }
  run.status = "running";
  run.pid = child.pid ?? null;
  run.startedAt = nowIso();
  run.finishedAt = null;
  run.returncode = null;
  run.proc = child;
  child.once("exit", (code) => {
    run.returncode = code;
    run.finishedAt = nowIso();
    if (run.status !== "stopped") {
      run.status = code === 0 ? "ok" : "failed";
    }
    run.proc = null;
    log.info({ job: name, rc: code, status: run.status }, "job finished");
  });
  log.info({ job: name, pid: child.pid, argv: spec0.argv }, "job started");
  return run;
}

export async function stop(name: string): Promise<void> {
  const run = runOf(name);
  const child = run.proc;
  if (run.status !== "running" || child?.pid === undefined) {
    throw new Error("This job is not currently running");
  }
  run.status = "stopped";
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
  const done = new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => { resolve(); });
  });
  const timer = setTimeout(() => {
    try {
      process.kill(-(child.pid ?? 0), "SIGKILL");
    } catch {
      // already gone
    }
  }, 10_000);
  await done;
  clearTimeout(timer);
}

export function tail(name: string, lines = TAIL_LINES): string {
  const file = logPath(name);
  if (!fs.existsSync(file)) {
    return "";
  }
  const text = fs.readFileSync(file, "utf8");
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

export interface JobStatusView {
  name: string;
  title: string;
  cmd: string;
  needs: string;
  heavy: boolean;
  status: JobStatus;
  pid: number | null;
  started_at: string | null;
  finished_at: string | null;
  returncode: number | null;
  log_mtime: string | null;
  log?: string;
}

export function status(name: string, withLog = false): JobStatusView {
  const spec0 = JOBS[name];
  const run = runOf(name);
  const file = logPath(name);
  const view: JobStatusView = {
    name,
    title: spec0.title,
    cmd: spec0.argv.join(" "),
    needs: spec0.needs,
    heavy: spec0.heavy,
    status: run.status,
    pid: run.pid,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    returncode: run.returncode,
    log_mtime: fs.existsSync(file) ? new Date(fs.statSync(file).mtimeMs).toISOString().slice(0, 19) : null,
  };
  if (withLog) {
    view.log = tail(name);
  }
  return view;
}

export function statusAll(): JobStatusView[] {
  return Object.keys(JOBS).map((n) => status(n));
}
