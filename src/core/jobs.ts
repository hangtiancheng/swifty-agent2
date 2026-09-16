// Background job runner for admin pages: start / tail / stop registered jobs only.
// argv is fixed here; the front end can only submit a job name, never a shell fragment.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { settings } from "../config.ts";
import { childLogger } from "../logger.ts";

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

function spec(name: string, title: string, argv: string[], needs: string, heavy = false): JobSpec {
  return { name, title, argv, needs, heavy };
}

export const JOBS: Record<string, JobSpec> = Object.fromEntries(
  [
    // knowledge base build pipeline
    spec("kb-preview", "材料清单与切块预览", script("show-kb"), "本地跑,不写库"),
    spec("kb-build", "离线建库(文档切块 → pending)", script("build-kb"), "需本地库"),
    spec("kb-mine", "对话挖知识(抽 QA → 去重 → pending)", script("mine-knowledge"), "需本地库 + 聊天上游", true),
    spec("kb-vectorize", "向量化(嵌入 → 本地向量库 → 回标 done)", script("vectorize-kb"), "需本地库 + 嵌入上游"),
    spec("kb-repatch", "补丁式重嵌(md 改动 → 原地改正文)", script("kb-repatch"), "需本地库;改完再按「向量化待补块」"),
    spec("seed-conv", "灌历史会话种子", script("seed-conv"), "需本地库"),
    spec("kb-reset", "清库重建(清两表 + 清向量)", script("kb-reset"), "需本地库;会清空知识库", true),
    // RAG evaluation / flywheel / cost reports
    spec("eval-rag", "RAG 评估(四策略对照)", script("eval-ch04"), "需本地向量库 + 已建库 + 聊天上游,分钟级", true),
    spec("cost-report", "意图成本账", script("cost-by-intent"), "需 Langfuse 在跑且窗口内有 trace"),
    spec("eval-flywheel", "评估流水线(落一轮趋势)", script("eval-flywheel"), "需本地库 + 已建库 + 聊天上游,分钟级", true),
    spec("calibrate-confidence", "置信度阈值校准", script("calibrate-confidence"), "需本地向量库 + 已建库 + 重排上游,分钟级", true),
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
    throw new Error(`${spec0.title}正在运行中(pid ${run.pid}),等它跑完再发起`);
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
  if (run.status !== "running" || child === null || child.pid === undefined) {
    throw new Error("该作业当前没有在运行");
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
    child.once("exit", () => resolve());
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
