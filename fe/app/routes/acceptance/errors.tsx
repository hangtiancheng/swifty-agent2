import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/errors";

import { JobRow } from "~/components/job-row";
import {
  Btn,
  GateBar,
  MissingBox,
  PageShell,
  Panel,
  Pill,
  Stat,
  TableScroll,
  Tbl,
  Td,
  Th,
  Tip,
  Tr,
  type PillTone,
} from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtTime } from "~/lib/format";
import type { JobSpec } from "~/lib/types";


/* 分类器错例复核:错在哪一类 · 是冤枉还是放跑 · 标注本身有没有毛病。 */

interface ErrorItem {
  text: string;
  gold: string[];
  pred: string[];
  missed: string[];
  extra: string[];
  kind: string; // 漏打 | 错位 | 多打
  matrix_entries: number;
}

interface ErrorsData {
  eval: {
    present: boolean;
    hint?: string;
    ran_at?: string;
    test_size?: number;
    threshold?: number;
  };
  errors: ErrorItem[];
  kinds: Record<string, number>;
  matrix_entries: number;
  total_fp: number;
  total_fn: number;
  pairs: {
    missed: string;
    grabbed: string;
    count: number;
    severity: string | null;
  }[];
  recipes: Record<string, string>;
}

type LoaderData =
  | { ok: true; d: ErrorsData; jobs: JobSpec[] }
  | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    const [d, j] = await Promise.all([
      api<ErrorsData>("/api/acceptance/errors"),
      api<{ jobs: JobSpec[] }>("/api/jobs"),
    ]);
    return { ok: true, d, jobs: j.jobs };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · 分类器错例复核" },
    { name: "description", content: "错在哪一类 · 是冤枉还是放跑 · 标注有没有毛病" },
  ];
}

const KIND_PILL: Record<string, PillTone> = {
  漏打: "info",
  错位: "fail",
  多打: "running",
};

const SEV_TONE: Record<string, PillTone> = {
  严: "sev-严",
  中: "sev-中",
  宽: "sev-宽",
};

/** 标签对照条:标准里被放跑的红、预测里多打的橙、对上的绿 */
function LabelRow({
  kind,
  labels,
  marks,
}: {
  kind: string;
  labels: string[];
  marks: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span className="text-muted">{kind}</span>
      {labels.length ? (
        labels.map((l) => (
          <span
            key={l}
            className={cn(
              "border-2 border-ink bg-cream px-1.5 py-px text-xs",
              marks[l] === "missed" &&
                "border-error bg-[#ffd4dc] text-error-deep dark:bg-error-bg",
              marks[l] === "extra" && "bg-fur",
              !marks[l] && "bg-online",
            )}
          >
            {l}
          </span>
        ))
      ) : (
        <span className="border-2 border-ink bg-paper px-1.5 py-px text-xs">
          (无)
        </span>
      )}
    </div>
  );
}

export default function AcceptanceErrorsPage({
  loaderData,
}: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();

  if (!loaderData.ok) {
    return (
      <PageShell title="分类器错例复核" active="/acceptance/errors">
        <MissingBox className="mt-4">加载失败:{loaderData.error}</MissingBox>
      </PageShell>
    );
  }
  const { d, jobs } = loaderData;
  const jobSpecs = Object.fromEntries(jobs.map((j) => [j.name, j]));

  return (
    <PageShell
      title="分类器错例复核"
      sub="错在哪一类 · 是冤枉还是放跑 · 标注本身有没有毛病"
      active="/acceptance/errors"
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
        {!d.eval.present ? (
          <Stat label="评测产物" value="未生成" tone="fail" />
        ) : (
          <>
            <Stat label="错例" value={String(d.errors.length) + " 条"} />
            <Stat label="矩阵笔数" value={String(d.matrix_entries) + " 笔"} />
            <Stat label="冤枉 FP" value={String(d.total_fp) + " 次"} />
            <Stat label="放跑 FN" value={String(d.total_fn) + " 次"} />
            <Stat label="测试集" value={String(d.eval.test_size ?? 0) + " 条"} />
            <Stat
              label="评测于"
              value={fmtTime(d.eval.ran_at).slice(5, 16)}
              small
            />
          </>
        )}
      </GateBar>

      {!d.eval.present ? (
        <Panel title="错例复核">
          <MissingBox>
            {d.eval.hint ?? "评测产物还没生成,先跑 make ch10-eval"}
          </MissingBox>
          {jobSpecs["ch10-eval"] ? (
            <JobRow specs={[jobSpecs["ch10-eval"]]} onFinish={() => { void revalidate(); }} />
          ) : null}
        </Panel>
      ) : (
        <>
          {/* ① 记账口径:错例条数 ≠ 矩阵笔数 */}
          <Panel
            title="这笔账怎么算:错例条数 ≠ 矩阵笔数"
            lede="错有三种:漏打——该打的没打,只记 1 次放跑;多打——不该打的多打一个,只记 1 笔冤枉;错位——该打的没打、反而打了别的类,一次记 2 笔(被抢的类放跑 +1、抢标签的类冤枉 +1)。所以清单条数比矩阵笔数少,差额全在错位上。"
          >
            <div className="flex flex-wrap gap-3">
              {Object.entries(d.kinds).map(([kind, n], i) => (
                <motion.div
                  key={kind}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.2 }}
                  className="min-w-50 flex-1 border-3 border-ink bg-paper px-3 py-2"
                >
                  <div>
                    <Pill tone={KIND_PILL[kind] ?? "info"}>{kind}</Pill>{" "}
                    <span className="text-xl font-bold">{n} 条</span>
                  </div>
                  <div className="mt-1 text-[11.5px] leading-6 text-ink-soft">
                    修法:{d.recipes[kind] ?? "—"}
                  </div>
                </motion.div>
              ))}
            </div>
            <Tip>
              {d.errors.length} 条错例 → 矩阵记 {d.matrix_entries}{" "}
              笔:冤枉 {d.total_fp} 次、放跑 {d.total_fn}{" "}
              次。由于目前才寥寥几条,不值得为此重新训练——攒到一定数量再重训,训练是有成本的。
            </Tip>
          </Panel>

          {/* ② 边界摩擦配对 */}
          <Panel
            title="边界摩擦:哪两类在抢标签"
            lede="把「该打没打的类 ← 反而打了的类」按对计数。同一对反复出现,说明有个词横跨两类、句子正好踩在分界线上,模型两边都觉得是。这种要成对补对照句,两边同时喂才学得会看语境。"
          >
            {d.pairs.length ? (
              <>
                <TableScroll>
                  <Tbl>
                    <thead>
                      <tr>
                        <Th>被抢的类(该打没打)</Th>
                        <Th>档位</Th>
                        <Th>抢标签的类(冤枉打上)</Th>
                        <Th>次数</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.pairs.map((p, i) => (
                        <Tr key={i} bad={p.count > 1}>
                          <Td>
                            <span className="border-2 border-error bg-[#ffd4dc] px-1.5 py-px text-xs text-error-deep dark:bg-error-bg">
                              {p.missed}
                            </span>
                          </Td>
                          <Td>
                            {p.severity ? (
                              <Pill
                                tone={
                                  SEV_TONE[p.severity] ??
                                  "plain"
                                }
                              >
                                {p.severity}
                              </Pill>
                            ) : null}
                          </Td>
                          <Td>
                            <span className="border-2 border-ink bg-fur px-1.5 py-px text-xs">
                              {p.grabbed}
                            </span>
                          </Td>
                          <Td num>×{p.count}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Tbl>
                </TableScroll>
                <Tip>出现 2 次以上的配对已标红——那是稳定复现的系统性偏差,优先补它的对照句。</Tip>
              </>
            ) : (
              <MissingBox>本轮没有错位型错误,没有类目在互抢标签</MissingBox>
            )}
          </Panel>

          {/* ③ 逐条错例 */}
          <Panel
            title="逐条对照:标准答案 vs 模型预测"
            lede="标准答案里被放跑的类标红、模型多打上的类标橙、两边都对上的标绿。语料里故意掺了错别字和方言模拟真实用户的键盘,噪声下的错例照样算错例,不给豁免。"
          >
            {d.errors.map((e, i) => {
              const marksGold: Record<string, string> = {};
              const marksPred: Record<string, string> = {};
              for (const l of e.missed) {
                marksGold[l] = "missed";
              }
              for (const l of e.extra) {
                marksPred[l] = "extra";
              }
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.25), duration: 0.2 }}
                  className="mt-2.5 border-3 border-ink bg-paper px-3 py-2.5 first:mt-0"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <Pill tone={KIND_PILL[e.kind] ?? "info"}>{e.kind}</Pill>
                    <span className="text-muted">
                      记 {e.matrix_entries} 笔矩阵账
                    </span>
                  </div>
                  <div className="mt-1.5 text-[13.5px] leading-7 font-bold">
                    「{e.text}」
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <LabelRow kind="标准" labels={e.gold} marks={marksGold} />
                    <LabelRow kind="预测" labels={e.pred} marks={marksPred} />
                  </div>
                  <div className="mt-2 text-xs leading-6 text-ink-soft">
                    {[
                      ...(e.missed.length
                        ? ["放跑:" + e.missed.join("、")]
                        : []),
                      ...(e.extra.length
                        ? ["冤枉:" + e.extra.join("、")]
                        : []),
                      "修法:" + (d.recipes[e.kind] ?? "—"),
                    ].join(" | ")}
                  </div>
                </motion.div>
              );
            })}
            {jobSpecs["ch10-eval"] ? (
              <JobRow
                specs={[jobSpecs["ch10-eval"]]}
                onFinish={() => { void revalidate(); }}
                note="重跑评测会刷新这份错例清单"
              />
            ) : null}
          </Panel>
        </>
      )}
    </PageShell>
  );
}
