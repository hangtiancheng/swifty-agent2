import { customElement } from "@swifty.js/lit-jsx";

import "~/components/job-row";
import {
  BtnLink,
  GateBar,
  MissingBox,
  PageLoading,
  PageShell,
  Pill,
  Stat,
  Tip,
  type PillTone,
} from "~/components/ui";
import { api } from "~/lib/api";
import { cn } from "~/lib/cn";
import { enterOnce } from "~/lib/motion";
import { DataLoaderElement } from "~/lib/page-element";
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

const PILL: Record<Block["status"], [PillTone, string]> = {
  pass: ["pass", "Pass"],
  fail: ["fail", "Fail"],
  missing: ["missing", "No artifact"],
};

@customElement("acceptance-page")
export class AcceptancePage extends DataLoaderElement<Overview> {
  protected override pageTitle = "MeowMeow Select · Acceptance Overview";

  protected override load(): Promise<Overview> {
    return api<Overview>("/api/acceptance/overview");
  }

  protected override render() {
    const d = this.data;
    const jobSpecs = d
      ? Object.fromEntries(d.jobs.map((j) => [j.name, j]))
      : {};
    const evalBlock = d?.blocks.find((b) => b.key === "eval");

    return (
      <PageShell
        title="Acceptance Overview"
        sub="All nine evidence checks run on the page — no terminal needed"
        active="/acceptance"
        actions={this.refreshBtn()}
      >
        {this.loadError ? (
          <MissingBox class="mt-4">
            Failed to load data: {this.loadError}
          </MissingBox>
        ) : d ? (
          <>
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
              How to read this: <b>Pass</b> means the artifact exists and clears
              its bar; <b>Fail</b> means it ran but missed the bar — go fix the
              data; <b>No artifact</b> means it has not run yet — use the
              buttons on the card to run it now. The numbers here come from the
              same artifacts as terminal make — the API never recomputes them,
              so there is no second source of truth.
            </Tip>

            <div class="mt-4 grid [grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-3.5">
              {d.blocks.map((blk, i) => {
                const [tone, label] = PILL[blk.status] ?? ["plain", blk.status];
                const specs = blk.jobs
                  .map((n) => jobSpecs[n])
                  .filter((x): x is JobSpec => Boolean(x));
                return (
                  <div
                    ref={(el: Element | undefined) => {
                      enterOnce(el, {
                        y: 12,
                        duration: 0.22,
                        delay: Math.min(i * 0.04, 0.3),
                      });
                    }}
                    class="bg-card shadow-e1 hover:shadow-e2 flex flex-col rounded-lg p-3.5 transition-shadow duration-200"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <div
                        class={cn(
                          "grid h-6.5 w-6.5 shrink-0 place-items-center rounded-full text-[13px] font-medium",
                          blk.status === "pass" && "bg-success text-on-success",
                          blk.status === "fail" && "bg-error text-on-error",
                          blk.status === "missing" &&
                            "bg-surface-container-high text-on-surface-variant",
                        )}
                      >
                        {blk.no}
                      </div>
                      <h3 class="text-title-small">{blk.title}</h3>
                      <Pill tone={tone}>{label}</Pill>
                      <span class="flex-1" />
                      {blk.page ? (
                        <BtnLink to={blk.page} size="sm">
                          Details →
                        </BtnLink>
                      ) : null}
                    </div>
                    <div class="bg-surface-container-low mt-2.5 rounded-md px-2.5 py-1.5 text-[13px] leading-6">
                      {blk.headline || "—"}
                    </div>
                    {blk.note ? (
                      <div class="text-on-surface-variant mt-2 text-xs leading-6">
                        {blk.note}
                      </div>
                    ) : null}
                    {specs.length ? (
                      <div class="mt-auto pt-3">
                        <job-row
                          specs={specs}
                          onFinish={() => {
                            void this.reload();
                          }}
                        ></job-row>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <PageLoading />
        )}
      </PageShell>
    );
  }
}
