import { customElement } from "@swifty.js/lit-jsx";

import { BtnLink, MissingBox, PageLoading, PageShell } from "~/components/ui";
import { api } from "~/lib/api";
import { cn } from "~/lib/cn";
import { enterOnce, growOnce } from "~/lib/motion";
import { DataLoaderElement } from "~/lib/page-element";

export interface TopicClass {
  label: string;
  count: number;
  samples: string[];
}

export interface TopicDistribution {
  total: number;
  latest: string | null;
  classes: TopicClass[];
}

/** classified_at is stored as UTC (MySQL container timezone); append Z and render in local time */
function fmtLatest(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso + "Z").toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function TopicRow({ c, max, top1 }: { c: TopicClass; max: number; top1: boolean }) {
  const pct = Math.round((c.count / max) * 100);
  const href = "/topics/questions?label=" + encodeURIComponent(c.label) + "&page=1";
  return (
    <details class={cn("group my-1.5", c.count === 0 && "opacity-45")}>
      <summary class="flex cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
        <span class="w-24 shrink-0 text-right text-[13px] font-medium sm:w-28">
          {c.count ? (
            <a href={href} class="text-primary no-underline hover:underline">
              {c.label}
            </a>
          ) : (
            c.label
          )}
        </span>
        <span class="bg-surface-container-highest relative h-5.5 flex-1 overflow-hidden rounded-full">
          {c.count ? (
            <span
              ref={(el: Element | undefined) => {
                growOnce(el, `${String(pct)}%`);
              }}
              class={cn("absolute inset-y-0 left-0 block rounded-full", top1 ? "bg-primary" : "bg-primary-container")}
            />
          ) : null}
        </span>
        <span class="w-10 shrink-0 text-[13px] font-medium tabular-nums">{c.count}</span>
      </summary>
      <div class="bg-surface-container-low text-on-surface mt-1.5 mb-2.5 ml-0 rounded-md px-3 py-2 text-[12.5px] sm:ml-[7.4rem]">
        {c.samples.length ? (
          <>
            {c.samples.map((s) => (
              <div class="my-0.5 break-words">· {s}</div>
            ))}
            <BtnLink to={href} size="sm" class="mt-2">
              View all {c.count} →
            </BtnLink>
          </>
        ) : (
          <div class="text-on-surface-variant">No examples yet</div>
        )}
      </div>
    </details>
  );
}

@customElement("topics-page")
export class TopicsPage extends DataLoaderElement<TopicDistribution> {
  protected override pageTitle = "MeowMeow Select · Topic Distribution";

  protected override load(): Promise<TopicDistribution> {
    return api<TopicDistribution>("/api/topics/distribution");
  }

  protected override render() {
    const d = this.data;
    const classes = d ? [...d.classes].sort((a, b) => b.count - a.count) : [];
    const max = Math.max(1, ...classes.map((c) => c.count));
    const hit = classes.filter((c) => c.count > 0).length;

    return (
      <PageShell
        title="Topic Distribution"
        sub="Low-confidence questions → classifier-bypass classification → top up knowledge where questions pile up most"
        active="/topics"
        maxW="max-w-[1080px]"
        actions={this.refreshBtn()}
      >
        {this.loadError ? (
          <MissingBox class="mt-4">Failed to load the distribution: {this.loadError}</MissingBox>
        ) : d ? (
          <>
            <div class="mt-4 flex flex-wrap gap-3.5">
              <div class="bg-card shadow-e1 text-label-medium text-on-surface-variant rounded-lg px-4 py-2.5">
                Classified questions
                <b class="text-title-large text-on-surface block font-medium">{d.total}</b>
              </div>
              <div class="bg-card shadow-e1 text-label-medium text-on-surface-variant rounded-lg px-4 py-2.5">
                Last classified
                <b class="text-title-small text-on-surface block leading-7">{fmtLatest(d.latest)}</b>
              </div>
              <div class="bg-card shadow-e1 text-label-medium text-on-surface-variant rounded-lg px-4 py-2.5">
                Classes hit
                <b class="text-title-large text-on-surface block font-medium">
                  {hit} / {d.classes.length || 17}
                </b>
              </div>
            </div>

            <div
              ref={(el: Element | undefined) => {
                enterOnce(el, { y: 10, duration: 0.35 });
              }}
              class="bg-card shadow-e1 mt-4 rounded-lg p-4"
            >
              <h2 class="text-title-small mb-3">
                {d.classes.length || 17} authoritative classes · question volume (descending — click a row to expand
                samples, click a class name to view all)
              </h2>
              <div>
                {classes.map((c, i) => (
                  <TopicRow c={c} max={max} top1={i === 0 && c.count > 0} />
                ))}
              </div>
              <div class="text-on-surface-variant mt-2.5 text-xs">
                Data comes from topic_classifications (make classify-pool runs the bypass batch classification);
                multi-label questions count toward every class they hit.
              </div>
            </div>
          </>
        ) : (
          <PageLoading />
        )}
      </PageShell>
    );
  }
}
