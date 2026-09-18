import { customElement, nothing, property, state } from "@swifty.js/lit-jsx";
import type { PropertyValues } from "lit";

import { toast } from "./toast";
import { Btn } from "./ui";

import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import { Icon } from "~/lib/icons";
import { LightElement } from "~/lib/light-element";
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

@customElement("job-button")
export class JobButton extends LightElement {
  @property({ attribute: false }) spec?: JobSpec;
  @property({ attribute: false }) onLog?: (log: string) => void;
  @property({ attribute: false }) onFinish?: () => void;

  @state() private status: JobStatus = "idle";
  @state() private returncode?: number | null;
  private timer: number | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // The job may already be running when the page opens (started from another
    // tab): attach polling right away so it doesn't look stuck.
    this.syncFromSpec();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopPoll();
  }

  protected override updated(changed: PropertyValues): void {
    // After a refetch the spec is a new object: resync state, preferring the cached log.
    if (changed.has("spec")) {
      this.syncFromSpec();
    }
  }

  private syncFromSpec(): void {
    const spec = this.spec;
    if (!spec) {
      return;
    }
    this.status = spec.status;
    this.returncode = spec.returncode;
    if (spec.log) {
      JOB_LOGS.set(spec.name, spec.log);
    }
    if (spec.status === "running" && this.timer === null) {
      this.startPolling();
    }
  }

  private stopPoll(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startPolling(): void {
    this.stopPoll();
    this.timer = window.setInterval(() => {
      void this.poll();
    }, 1200);
  }

  private apply(st: RunState): void {
    const spec = this.spec;
    if (!spec) {
      return;
    }
    if (st.log) {
      JOB_LOGS.set(spec.name, st.log);
      this.onLog?.(st.log);
    }
    this.status = st.status;
    this.returncode = st.returncode;
  }

  private async poll(): Promise<void> {
    const spec = this.spec;
    if (!spec) {
      return;
    }
    try {
      const st = await api<RunState>("/api/jobs/" + spec.name);
      this.apply(st);
      if (st.status !== "running") {
        this.stopPoll();
        toast(
          spec.title +
            ": " +
            STATUS_LABEL[st.status] +
            (st.returncode !== null && st.returncode !== undefined
              ? " (exit code " + String(st.returncode) + ")"
              : ""),
          st.status !== "ok",
        );
        this.onFinish?.();
      }
    } catch (e) {
      this.stopPoll();
      toast("Polling failed: " + errMsg(e), true);
    }
  }

  private async start(): Promise<void> {
    const spec = this.spec;
    if (!spec) {
      return;
    }
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
    this.status = "running";
    this.onLog?.("Starting…");
    try {
      const st = await api<RunState>("/api/jobs/" + spec.name, jsonPost());
      this.apply(st);
      this.startPolling();
    } catch (e) {
      this.status = spec.status;
      this.onLog?.("Failed to start: " + errMsg(e));
      toast("Failed to start: " + errMsg(e), true);
    }
  }

  protected override render() {
    const spec = this.spec;
    if (!spec) {
      return nothing;
    }
    const running = this.status === "running";
    const label = running
      ? "Running… " + spec.title
      : (this.status === "idle" ? "Re-run " : "Run again ") + spec.title;
    return (
      <Btn
        variant="go"
        size="sm"
        disabled={running}
        onClick={() => {
          void this.start();
        }}
        title={
          spec.cmd +
          (spec.needs && spec.needs !== "—" ? "(" + spec.needs + ")" : "")
        }
      >
        <Icon
          name={running ? "loader-circle" : "rotate-cw"}
          class={cn("h-3.5 w-3.5", running && "animate-spin")}
        />
        {label}
      </Btn>
    );
  }
}

/** A row of job buttons + the single log window they share */
@customElement("job-row")
export class JobRow extends LightElement {
  @property({ attribute: false }) specs: JobSpec[] = [];
  @property({ attribute: false }) onFinish?: () => void;
  @property() note = "";

  @state() private log = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this.seedLog();
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has("specs")) {
      this.seedLog();
    }
  }

  /** Prefer the freshest log we know about (spec tail, then cross-rebuild cache);
      never clobber a live log with an empty seed. */
  private seedLog(): void {
    let l = "";
    for (const s of this.specs) {
      const c = s.log ?? JOB_LOGS.get(s.name);
      if (c) {
        l = c;
      }
    }
    if (l) {
      this.log = l;
    }
  }

  protected override render() {
    if (!this.specs.length && !this.note) {
      return nothing;
    }
    return (
      <div>
        <div class="mt-2.5 flex flex-wrap items-center gap-2">
          {this.specs.map((s) => (
            <job-button
              key={s.name}
              spec={s}
              onLog={(log: string) => {
                this.log = log;
              }}
              onFinish={this.onFinish}
            />
          ))}
          {this.note ? (
            <span class="text-on-surface-variant text-label-small">
              {this.note}
            </span>
          ) : null}
        </div>
        {this.log ? (
          <pre
            class={cn(
              "scroll-slim bg-terminal text-terminal-ink mt-3 max-h-70 overflow-auto rounded-lg p-3.5",
              "font-mono text-xs leading-relaxed break-all whitespace-pre-wrap",
            )}
          >
            {this.log}
          </pre>
        ) : null}
      </div>
    );
  }
}
