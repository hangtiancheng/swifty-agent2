import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useRevalidator } from "react-router";
import { Link } from "react-router";

import type { Route } from "./+types/topics";

import { Btn, BtnLink, MissingBox, PageShell } from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { EASE_DECEL, enterTransition } from "~/lib/motion";

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

type LoaderData =
  { ok: true; d: TopicDistribution } | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    return {
      ok: true,
      d: await api<TopicDistribution>("/api/topics/distribution"),
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "MeowMeow Select · Topic Distribution" },
    {
      name: "description",
      content:
        "Topic distribution of low-confidence questions classified by the classifier bypass",
    },
  ];
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

function TopicRow({
  c,
  max,
  top1,
}: {
  c: TopicClass;
  max: number;
  top1: boolean;
}) {
  const pct = Math.round((c.count / max) * 100);
  const href =
    "/topics/questions?label=" + encodeURIComponent(c.label) + "&page=1";
  return (
    <details className={cn("group my-1.5", c.count === 0 && "opacity-45")}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
        <span className="w-24 shrink-0 text-right text-[13px] font-medium sm:w-28">
          {c.count ? (
            <Link
              to={href}
              className="text-primary no-underline hover:underline"
            >
              {c.label}
            </Link>
          ) : (
            c.label
          )}
        </span>
        <span className="bg-surface-container-highest relative h-5.5 flex-1 overflow-hidden rounded-full">
          {c.count ? (
            <motion.span
              className={cn(
                "absolute inset-y-0 left-0 block rounded-full",
                top1 ? "bg-primary" : "bg-primary-container",
              )}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.45, ease: EASE_DECEL }}
            />
          ) : null}
        </span>
        <span className="w-10 shrink-0 text-[13px] font-medium tabular-nums">
          {c.count}
        </span>
      </summary>
      <div className="bg-surface-container-low text-on-surface mt-1.5 mb-2.5 ml-0 rounded-md px-3 py-2 text-[12.5px] sm:ml-[7.4rem]">
        {c.samples.length ? (
          <>
            {c.samples.map((s, i) => (
              <div key={i} className="my-0.5 break-words">
                · {s}
              </div>
            ))}
            <BtnLink to={href} size="sm" className="mt-2">
              View all {c.count} →
            </BtnLink>
          </>
        ) : (
          <div className="text-on-surface-variant">No examples yet</div>
        )}
      </div>
    </details>
  );
}

export default function TopicsPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();
  const d = loaderData.ok ? loaderData.d : null;
  const classes = d ? [...d.classes].sort((a, b) => b.count - a.count) : [];
  const max = Math.max(1, ...classes.map((c) => c.count));
  const hit = classes.filter((c) => c.count > 0).length;

  return (
    <PageShell
      title="Topic Distribution"
      sub="Low-confidence questions → classifier-bypass classification → top up knowledge where questions pile up most"
      active="/topics"
      maxW="max-w-[1080px]"
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
      {loaderData.ok && d ? (
        <>
          <div className="mt-4 flex flex-wrap gap-3.5">
            <div className="bg-card shadow-e1 text-label-medium text-on-surface-variant rounded-lg px-4 py-2.5">
              Classified questions
              <b className="text-title-large text-on-surface block font-medium">
                {d.total}
              </b>
            </div>
            <div className="bg-card shadow-e1 text-label-medium text-on-surface-variant rounded-lg px-4 py-2.5">
              Last classified
              <b className="text-title-small text-on-surface block leading-7">
                {fmtLatest(d.latest)}
              </b>
            </div>
            <div className="bg-card shadow-e1 text-label-medium text-on-surface-variant rounded-lg px-4 py-2.5">
              Classes hit
              <b className="text-title-large text-on-surface block font-medium">
                {hit} / {d.classes.length || 17}
              </b>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={enterTransition}
            className="bg-card shadow-e1 mt-4 rounded-lg p-4"
          >
            <h2 className="text-title-small mb-3">
              {d.classes.length || 17} authoritative classes · question volume
              (descending — click a row to expand samples, click a class name to
              view all)
            </h2>
            <div>
              {classes.map((c, i) => (
                <TopicRow
                  key={c.label}
                  c={c}
                  max={max}
                  top1={i === 0 && c.count > 0}
                />
              ))}
            </div>
            <div className="text-on-surface-variant mt-2.5 text-xs">
              Data comes from topic_classifications (make classify-pool runs the
              bypass batch classification); multi-label questions count toward
              every class they hit.
            </div>
          </motion.div>
        </>
      ) : (
        <MissingBox className="mt-4">
          Failed to load the distribution:{" "}
          {loaderData.ok ? "" : loaderData.error}
        </MissingBox>
      )}
    </PageShell>
  );
}
