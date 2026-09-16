import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useRevalidator } from "react-router";
import { Link } from "react-router";

import type { Route } from "./+types/topics";

import { Btn, MissingBox, PageShell } from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";


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
  | { ok: true; d: TopicDistribution }
  | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    return { ok: true, d: await api<TopicDistribution>("/api/topics/distribution") };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · 主题分布" },
    {
      name: "description",
      content: "低置信度问题经分类器旁路归类后的主题分布",
    },
  ];
}

/** classified_at 存的是 UTC(MySQL 容器时区),补 Z 后按本地时区渲染 */
function fmtLatest(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso + "Z").toLocaleString("zh-CN", {
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
  const href =
    "/topics/questions?label=" + encodeURIComponent(c.label) + "&page=1";
  return (
    <details
      className={cn(
        "group my-1.5",
        c.count === 0 && "opacity-45",
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
        <span className="w-24 shrink-0 text-right text-[13px] font-bold sm:w-28">
          {c.count ? (
            <Link
              to={href}
              className="border-b-2 border-fur text-inherit no-underline hover:bg-fur"
            >
              {c.label}
            </Link>
          ) : (
            c.label
          )}
        </span>
        <span className="relative h-5.5 flex-1 border-2 border-ink bg-paper">
          {c.count ? (
            <motion.span
              className={cn(
                "absolute inset-y-0 left-0 block border-r-2 border-ink",
                top1 ? "bg-coral" : "bg-fur",
              )}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            />
          ) : null}
        </span>
        <span className="w-10 shrink-0 text-[13px] font-bold tabular-nums">
          {c.count}
        </span>
      </summary>
      <div className="mt-1.5 mb-2.5 ml-0 border-2 border-dashed border-ink bg-paper px-3 py-2 text-[12.5px] sm:ml-[7.4rem]">
        {c.samples.length ? (
          <>
            {c.samples.map((s, i) => (
              <div key={i} className="my-0.5 break-words">
                · {s}
              </div>
            ))}
            <Link
              to={href}
              className="mt-2 inline-block border-3 border-ink bg-cream px-2.5 py-0.5 text-xs font-bold no-underline shadow-hard-xs hover:bg-fur-hover"
            >
              查看全部 {c.count} 条 →
            </Link>
          </>
        ) : (
          <div className="text-muted">暂无样例</div>
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
      title="主题分布"
      sub="低置信度问题 → 分类器旁路归类 → 哪类堆得多,先补哪块知识"
      active="/topics"
      maxW="max-w-[1080px]"
      actions={
        <Btn onClick={() => { void revalidate(); }} disabled={state === "loading"}>
          <RefreshCw
            className={state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            aria-hidden
          />
          刷新
        </Btn>
      }
    >
      {loaderData.ok && d ? (
        <>
          <div className="mt-4 flex flex-wrap gap-3.5">
            <div className="border-3 border-ink bg-paper px-4 py-2.5 text-[13px] shadow-hard-sm">
              已归类问题<b className="block text-xl">{d.total}</b>
            </div>
            <div className="border-3 border-ink bg-paper px-4 py-2.5 text-[13px] shadow-hard-sm">
              最近归类
              <b className="block text-sm leading-7">{fmtLatest(d.latest)}</b>
            </div>
            <div className="border-3 border-ink bg-paper px-4 py-2.5 text-[13px] shadow-hard-sm">
              命中类目数
              <b className="block text-xl">
                {hit} / {d.classes.length || 17}
              </b>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="mt-4 border-4 border-ink bg-cream p-4 shadow-hard"
          >
            <h2 className="mb-3 text-sm font-bold">
              {d.classes.length || 17} 类权威类目 ·
              问题量(降序,点行展开样例,点类目名看全部)
            </h2>
            <div>
              {classes.map((c, i) => (
                <TopicRow key={c.label} c={c} max={max} top1={i === 0 && c.count > 0} />
              ))}
            </div>
            <div className="mt-2.5 text-xs text-muted">
              数据来自 topic_classifications(make classify-pool
              旁路批量归类);多标签问题计入每个命中类目。
            </div>
          </motion.div>
        </>
      ) : (
        <MissingBox className="mt-4">
          拉取分布失败:{loaderData.ok ? "" : loaderData.error}
        </MissingBox>
      )}
    </PageShell>
  );
}
