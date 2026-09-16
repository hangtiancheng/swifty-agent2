import { LoaderCircle, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useToast } from "./toast";
import { Btn } from "./ui";

import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import type { JobSpec, JobStatus } from "~/lib/types";


/* 「重跑」按钮那一套(原 acceptance.js 的移植)。
   交互契约:POST 发起 → 每 1.2s 轮询状态与日志尾 → 收到终态(ok/failed/stopped)
   停止轮询、回调页面重新取数。作业名是后端白名单里的常量,前端只传名字。 */

const STATUS_LABEL: Record<JobStatus, string> = {
  idle: "未跑过",
  running: "运行中",
  ok: "已完成",
  failed: "失败",
  stopped: "已停止",
};

/** 日志尾缓存:作业跑完会回调页面重新取数,取数把按钮和日志窗口整个重建。
    缓存按作业名留着,重建时贴回去——不然日志恰好在跑完那一刻消失,结论就读不到了。 */
const JOB_LOGS = new Map<string, string>();

interface RunState {
  status: JobStatus;
  log?: string;
  returncode?: number | null;
}

function JobButton({
  spec,
  onLog,
  onFinish,
}: {
  spec: JobSpec;
  onLog: (log: string) => void;
  onFinish?: () => void;
}) {
  const toast = useToast();
  const [state, setState] = useState<RunState>(() => ({
    status: spec.status,
    log: spec.log ?? JOB_LOGS.get(spec.name),
  }));
  const timer = useRef<number | null>(null);
  const onFinishRef = useRef(onFinish);
  const onLogRef = useRef(onLog);

  useEffect(() => {
    onFinishRef.current = onFinish;
    onLogRef.current = onLog;
  });

  // 页面重新取数后 spec 换了新对象:同步状态,日志优先用缓存。
  // 本地 run 状态必须跟随服务端 spec 重置,这是有意的 prop→state 同步
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- spec 刷新时重同步按钮状态
    setState({
      status: spec.status,
      log: spec.log ?? JOB_LOGS.get(spec.name),
      returncode: spec.returncode,
    });
  }, [spec]);

  const stopPoll = () => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  const apply = (st: RunState) => {
    if (st.log) {
      JOB_LOGS.set(spec.name, st.log);
      onLogRef.current(st.log);
    }
    setState({ status: st.status, log: st.log, returncode: st.returncode });
  };

  const poll = async () => {
    try {
      const st = await api<RunState>("/api/jobs/" + spec.name);
      apply(st);
      if (st.status !== "running") {
        stopPoll();
        toast(
          spec.title +
            ":" +
            STATUS_LABEL[st.status] +
            (st.returncode !== null && st.returncode !== undefined
              ? "(退出码 " + String(st.returncode) + ")"
              : ""),
          st.status !== "ok",
        );
        onFinishRef.current?.();
      }
    } catch (e) {
      stopPoll();
      toast("轮询失败:" + errMsg(e), true);
    }
  };

  const start = async () => {
    if (
      spec.heavy &&
      !window.confirm(
        "「" +
          spec.title +
          "」是分钟级重活(" +
          spec.cmd +
          ")。\n" +
          (spec.needs && spec.needs !== "—" ? "前置:" + spec.needs + "\n" : "") +
          "确认现在跑?",
      )
    ) {
      return;
    }
    setState((s) => ({ ...s, status: "running" }));
    onLogRef.current("发起中…");
    try {
      const st = await api<RunState>("/api/jobs/" + spec.name, jsonPost());
      apply(st);
      timer.current = window.setInterval(() => {
        void poll();
      }, 1200);
    } catch (e) {
      setState((s) => ({ ...s, status: spec.status }));
      onLogRef.current("发起失败:" + errMsg(e));
      toast("发起失败:" + errMsg(e), true);
    }
  };

  // 页面打开时作业正在跑(上一个标签页发起的):直接接上轮询,别让它看着像卡住
  useEffect(() => {
    if (spec.status === "running" && timer.current === null) {
      timer.current = window.setInterval(() => {
        void poll();
      }, 1200);
    }
    return stopPoll;
    // eslint 忽略 fe/app;此处仅依赖关键标识,避免父级重渲染打断轮询
  }, [spec.name]); // eslint-disable-line

  const running = state.status === "running";
  const label = running
    ? "运行中… " + spec.title
    : (state.status === "idle" ? "重跑 " : "再跑一次 ") + spec.title;

  return (
    <Btn
      variant="go"
      size="sm"
      disabled={running}
      onClick={() => {
        void start();
      }}
      title={spec.cmd + (spec.needs && spec.needs !== "—" ? "(" + spec.needs + ")" : "")}
    >
      {running ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
      )}
      {label}
    </Btn>
  );
}

/** 一排作业按钮 + 它们共用的一个日志窗口 */
export function JobRow({
  specs,
  onFinish,
  note,
}: {
  specs: JobSpec[];
  onFinish?: () => void;
  note?: string;
}) {
  const [log, setLog] = useState<string>(() => {
    let l = "";
    for (const s of specs) {
      const c = s.log ?? JOB_LOGS.get(s.name);
      if (c) {
        l = c;
      }
    }
    return l;
  });

  if (specs.length === 0 && !note) {
    return null;
  }
  return (
    <div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {specs.map((s) => (
          <JobButton key={s.name} spec={s} onLog={setLog} onFinish={onFinish} />
        ))}
        {note ? <span className="text-[11.5px] text-muted">{note}</span> : null}
      </div>
      {log ? (
        <pre
          className={cn(
            "scroll-cat mt-2.5 max-h-70 overflow-auto border-3 border-ink bg-ink p-2.5",
            "text-xs leading-relaxed whitespace-pre-wrap break-all text-[#f3ead9]",
          )}
        >
          {log}
        </pre>
      ) : null}
    </div>
  );
}
