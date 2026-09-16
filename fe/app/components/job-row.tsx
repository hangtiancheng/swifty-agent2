import { LoaderCircle, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useToast } from "./toast";
import { Btn } from "./ui";

import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import type { JobSpec, JobStatus } from "~/lib/types";

/* The "re-run" button machinery (ported from the original acceptance.js).
   Interaction contract: POST to start → poll status + log tail every 1.2s → on a
   terminal state (ok/failed/stopped) stop polling and tell the page to refetch.
   Job names are constants in the backend allowlist; the frontend only passes names. */

const STATUS_LABEL: Record<JobStatus, string> = {
  idle: "Not run",
  running: "Running",
  ok: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** Log-tail cache: when a job finishes it tells the page to refetch, and the refetch
    rebuilds the buttons and the log window wholesale. The cache is keyed by job name
    and pasted back on rebuild — otherwise the log vanishes the instant the job ends
    and the conclusion can't be read. */
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

  // After a refetch the spec is a new object: resync state, preferring the cached log.
  // Local run state must follow the server spec — an intentional prop→state sync.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync button state when the spec refreshes
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
            ": " +
            STATUS_LABEL[st.status] +
            (st.returncode !== null && st.returncode !== undefined
              ? " (exit code " + String(st.returncode) + ")"
              : ""),
          st.status !== "ok",
        );
        onFinishRef.current?.();
      }
    } catch (e) {
      stopPoll();
      toast("Polling failed: " + errMsg(e), true);
    }
  };

  const start = async () => {
    if (
      spec.heavy &&
      !window.confirm(
        '"' +
          spec.title +
          '" is a minutes-long heavy job (' +
          spec.cmd +
          ").\n" +
          (spec.needs && spec.needs !== "—"
            ? "Prerequisite: " + spec.needs + "\n"
            : "") +
          "Run it now?",
      )
    ) {
      return;
    }
    setState((s) => ({ ...s, status: "running" }));
    onLogRef.current("Starting…");
    try {
      const st = await api<RunState>("/api/jobs/" + spec.name, jsonPost());
      apply(st);
      timer.current = window.setInterval(() => {
        void poll();
      }, 1200);
    } catch (e) {
      setState((s) => ({ ...s, status: spec.status }));
      onLogRef.current("Failed to start: " + errMsg(e));
      toast("Failed to start: " + errMsg(e), true);
    }
  };

  // The job is already running when the page opens (started from another tab):
  // attach polling right away so it doesn't look stuck.
  useEffect(() => {
    if (spec.status === "running" && timer.current === null) {
      timer.current = window.setInterval(() => {
        void poll();
      }, 1200);
    }
    return stopPoll;
    // eslint ignores fe/app; depend only on the key identity so a parent re-render
    // doesn't interrupt polling.
  }, [spec.name]); // eslint-disable-line

  const running = state.status === "running";
  const label = running
    ? "Running… " + spec.title
    : (state.status === "idle" ? "Re-run " : "Run again ") + spec.title;

  return (
    <Btn
      variant="go"
      size="sm"
      disabled={running}
      onClick={() => {
        void start();
      }}
      title={
        spec.cmd +
        (spec.needs && spec.needs !== "—" ? "(" + spec.needs + ")" : "")
      }
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

/** A row of job buttons + the single log window they share */
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
        {note ? (
          <span className="text-on-surface-variant text-label-small">
            {note}
          </span>
        ) : null}
      </div>
      {log ? (
        <pre
          className={cn(
            "scroll-slim bg-terminal text-terminal-ink mt-3 max-h-70 overflow-auto rounded-lg p-3.5",
            "font-mono text-xs leading-relaxed break-all whitespace-pre-wrap",
          )}
        >
          {log}
        </pre>
      ) : null}
    </div>
  );
}
