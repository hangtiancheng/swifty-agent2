import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/index";

import { JobRow } from "~/components/job-row";
import {
  Btn,
  BtnLink,
  GateBar,
  MissingBox,
  PageShell,
  Pill,
  Stat,
  Tip,
  type PillTone,
} from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { EASE_DECEL } from "~/lib/motion";
import type { JobSpec } from "~/lib/types";

/* Classifier acceptance overview: all nine evidence checks run on this page — no terminal needed.
   The numbers here come from the same artifacts as `make` in the terminal; the API never
   recomputes them, so there is no second source of truth. */

interface Block {
  key: string;
  no: number;
  title: string;
  page: string | null;
  status: "pass" | "fail" | "missing";
  headline: string;
  note: string;
  jobs: string[];
}

interface Overview {
  blocks: Block[];
  passed: number;
  total: number;
  all_pass: boolean;
  classifier: { online: boolean; detail?: unknown };
  jobs: JobSpec[];
}

type LoaderData = { ok: true; d: Overview } | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    return { ok: true, d: await api<Overview>("/api/acceptance/overview") };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "MeowMeow Select · Acceptance Overview" },
    {
      name: "description",
      content: "All nine evidence checks run on the page — no terminal needed",
    },
  ];
}

const PILL: Record<Block["status"], [PillTone, string]> = {
  pass: ["pass", "Pass"],
  fail: ["fail", "Fail"],
  missing: ["missing", "No artifact"],
};

export default function AcceptancePage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();

  if (!loaderData.ok) {
    return (
      <PageShell title="Acceptance Overview" active="/acceptance">
        <MissingBox className="mt-4">
          Failed to load data: {loaderData.error}
        </MissingBox>
      </PageShell>
    );
  }
  const d = loaderData.d;
  const jobSpecs = Object.fromEntries(d.jobs.map((j) => [j.name, j]));
  const evalBlock = d.blocks.find((b) => b.key === "eval");

  return (
    <PageShell
      title="Acceptance Overview"
      sub="All nine evidence checks run on the page — no terminal needed"
      active="/acceptance"
      actions={
        <Btn
          onClick={() => {
            void revalidate();
          }}
          disabled={state === "loading"}
        >
          <RefreshCw
            className={state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            aria-hidden
          />
          Refresh
        </Btn>
      }
    >
      <GateBar>
        <Stat
          label="Gates"
          value={String(d.passed) + " / " + String(d.total)}
          tone={d.all_pass ? "pass" : "fail"}
        />
        <Stat
          label="Classifier :8110"
          value={d.classifier.online ? "Online" : "Offline"}
          tone={d.classifier.online ? "pass" : "fail"}
        />
        <Stat
          label="Eval verdict"
          value={
            !evalBlock || evalBlock.status === "missing"
              ? "—"
              : evalBlock.headline.split(" · ")[0]
          }
          small
        />
      </GateBar>

      <Tip>
        How to read this: <b>Pass</b> means the artifact exists and clears its
        bar; <b>Fail</b> means it ran but missed the bar — go fix the data;{" "}
        <b>No artifact</b> means it has not run yet — use the buttons on the
        card to run it now. The numbers here come from the same artifacts as
        terminal make — the API never recomputes them, so there is no second
        source of truth.
      </Tip>

      <div className="mt-4 grid [grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-3.5">
        {d.blocks.map((blk, i) => {
          const [tone, label] = PILL[blk.status] ?? ["plain", blk.status];
          const specs = blk.jobs
            .map((n) => jobSpecs[n])
            .filter((x): x is JobSpec => Boolean(x));
          return (
            <motion.div
              key={blk.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: Math.min(i * 0.04, 0.3),
                duration: 0.22,
                ease: EASE_DECEL,
              }}
              className="bg-card shadow-e1 hover:shadow-e2 flex flex-col rounded-lg p-3.5 transition-shadow duration-200"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className={cn(
                    "grid h-6.5 w-6.5 shrink-0 place-items-center rounded-full text-[13px] font-medium",
                    blk.status === "pass" && "bg-success text-on-success",
                    blk.status === "fail" && "bg-error text-on-error",
                    blk.status === "missing" &&
                      "bg-surface-container-high text-on-surface-variant",
                  )}
                >
                  {blk.no}
                </div>
                <h3 className="text-title-small">{blk.title}</h3>
                <Pill tone={tone}>{label}</Pill>
                <span className="flex-1" />
                {blk.page ? (
                  <BtnLink to={blk.page} size="sm">
                    Details →
                  </BtnLink>
                ) : null}
              </div>
              <div className="bg-surface-container-low mt-2.5 rounded-md px-2.5 py-1.5 text-[13px] leading-6">
                {blk.headline || "—"}
              </div>
              {blk.note ? (
                <div className="text-on-surface-variant mt-2 text-xs leading-6">
                  {blk.note}
                </div>
              ) : null}
              {specs.length ? (
                <div className="mt-auto pt-3">
                  <JobRow
                    specs={specs}
                    onFinish={() => {
                      void revalidate();
                    }}
                  />
                </div>
              ) : null}
            </motion.div>
          );
        })}
      </div>
    </PageShell>
  );
}
