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
import type { JobSpec } from "~/lib/types";


/* 分类器验收总览:九项实证全在页面上跑,不用回终端。
   页面上的数与终端 make 跑出来的是同一份产物,不在接口里重算,避免出现第二个真相。 */

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
    { title: "喵喵优选 · 分类器验收总览" },
    { name: "description", content: "九项实证全在页面上跑,不用回终端" },
  ];
}

const PILL: Record<Block["status"], [PillTone, string]> = {
  pass: ["pass", "通过"],
  fail: ["fail", "不达标"],
  missing: ["missing", "缺产物"],
};

export default function AcceptancePage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();

  if (!loaderData.ok) {
    return (
      <PageShell title="分类器验收总览" active="/acceptance">
        <MissingBox className="mt-4">加载失败:{loaderData.error}</MissingBox>
      </PageShell>
    );
  }
  const d = loaderData.d;
  const jobSpecs = Object.fromEntries(d.jobs.map((j) => [j.name, j]));
  const evalBlock = d.blocks.find((b) => b.key === "eval");

  return (
    <PageShell
      title="分类器验收总览"
      sub="九项实证全在页面上跑,不用回终端"
      active="/acceptance"
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
      <GateBar>
        <Stat
          label="闸门"
          value={String(d.passed) + " / " + String(d.total)}
          tone={d.all_pass ? "pass" : "fail"}
        />
        <Stat
          label="分类器 :8110"
          value={d.classifier.online ? "在线" : "离线"}
          tone={d.classifier.online ? "pass" : "fail"}
        />
        <Stat
          label="评测结论"
          value={
            !evalBlock || evalBlock.status === "missing"
              ? "—"
              : evalBlock.headline.split(" · ")[0]
          }
          small
        />
      </GateBar>

      <Tip>
        口径:<b>通过</b>产物已生成且过线;<b>不达标</b>跑过但没过线,回头搞数据;
        <b>缺产物</b>还没跑过,点卡片里的按钮现场跑。页面上的数与终端 make
        跑出来的是同一份产物,不在接口里重算,避免出现第二个真相。
      </Tip>

      <div className="mt-4 grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr))]">
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
              transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.22 }}
              className="flex flex-col border-4 border-ink bg-cream p-3.5 shadow-hard"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className={cn(
                    "grid h-6.5 w-6.5 shrink-0 place-items-center border-3 border-ink bg-paper text-[13px] font-bold",
                    blk.status === "pass" && "bg-online",
                    blk.status === "fail" && "bg-error text-white",
                  )}
                >
                  {blk.no}
                </div>
                <h3 className="text-sm font-bold">{blk.title}</h3>
                <Pill tone={tone}>{label}</Pill>
                <span className="flex-1" />
                {blk.page ? (
                  <BtnLink to={blk.page} size="sm">
                    详情 →
                  </BtnLink>
                ) : null}
              </div>
              <div className="mt-2.5 border-2 border-ink bg-paper px-2.5 py-1.5 text-[13px] leading-6">
                {blk.headline || "—"}
              </div>
              {blk.note ? (
                <div className="mt-2 text-xs leading-6 text-ink-soft">
                  {blk.note}
                </div>
              ) : null}
              {specs.length ? (
                <div className="mt-auto pt-3">
                  <JobRow specs={specs} onFinish={() => { void revalidate(); }} />
                </div>
              ) : null}
            </motion.div>
          );
        })}
      </div>
    </PageShell>
  );
}
