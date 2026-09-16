import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/eval";

import { JobRow } from "~/components/job-row";
import { useToast } from "~/components/toast";
import {
  Btn,
  BtnLink,
  GateBar,
  MissingBox,
  PageShell,
  Panel,
  Pill,
  ScoreCell,
  Stat,
  TableScroll,
  Tbl,
  Td,
  Th,
  Tip,
  Tr,
  type PillTone,
} from "~/components/ui";
import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtTime } from "~/lib/format";
import type { JobSpec } from "~/lib/types";


/* 分类器评测详情:每类 P/R/F1 · 容错红线 · 混淆矩阵 · 阈值。 */

interface ClassMetric {
  name: string;
  severity: string; // 严 | 中 | 宽
  p: number;
  r: number;
  f1: number;
  support: number;
  red_line: number | null;
  passed: boolean;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
}

interface EvalReport {
  present: boolean;
  hint?: string;
  test_size?: number;
  threshold?: number;
  ran_at?: string;
  micro?: { p: number; r: number; f1: number };
  macro?: { p: number; r: number; f1: number };
  classes?: ClassMetric[];
  red_line_passed?: boolean;
  total_fp?: number;
  total_fn?: number;
  total_cells?: number;
}

interface ScanReport {
  present: boolean;
  hint?: string;
  scan?: { threshold: number; micro_f1: number }[];
  best_threshold?: number;
  best_micro_f1?: number;
  in_use_threshold?: number | null;
  consistent?: boolean;
  val_size?: number;
  ran_at?: string;
}

interface EvalData {
  eval: EvalReport;
  scan: ScanReport;
  threshold_in_use: number | null;
  severity: Record<string, string>;
  classifier: { online: boolean; detail?: unknown };
}

interface JobsData {
  jobs: JobSpec[];
}

interface ClassifyResult {
  text: string;
  threshold: number | null;
  labels: string[];
  scores: { label: string; score: number; hit: boolean }[];
  fallback: boolean;
}

type LoaderData =
  | { ok: true; d: EvalData; jobs: JobsData }
  | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    const [d, j] = await Promise.all([
      api<EvalData>("/api/acceptance/eval"),
      api<JobsData>("/api/jobs"),
    ]);
    return { ok: true, d, jobs: j };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · 分类器评测详情" },
    { name: "description", content: "每类 P/R/F1 · 容错红线 · 混淆矩阵 · 阈值" },
  ];
}

const SEV_TONE: Record<string, PillTone> = { 严: "sev-严", 中: "sev-中", 宽: "sev-宽" };

export default function AcceptanceEvalPage({
  loaderData,
}: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();
  const toast = useToast();

  const [tryText, setTryText] = useState("买大了想退");
  const [tryResult, setTryResult] = useState<ClassifyResult | null>(null);
  const [trying, setTrying] = useState(false);
  const autoRan = useRef(false);

  const tryIt = async (text: string) => {
    const t = text.trim();
    if (!t) {
      toast("先输入一句话", true);
      return;
    }
    setTrying(true);
    try {
      setTryResult(
        await api<ClassifyResult>(
          "/api/acceptance/classify",
          jsonPost({ text: t }),
        ),
      );
    } catch (e) {
      toast("试分类失败:" + errMsg(e), true);
      setTryResult(null);
    } finally {
      setTrying(false);
    }
  };

  // 分类器在线时进页面自动来一发,让多标签机制当场可见
  useEffect(() => {
    if (
      loaderData.ok &&
      loaderData.d.classifier.online &&
      !autoRan.current
    ) {
      autoRan.current = true;
      void tryIt("买大了想退");
    }
    // 仅首次挂载执行一次;tryIt 只依赖稳定的 setState 与 api
  }, []); // eslint-disable-line

  if (!loaderData.ok) {
    return (
      <PageShell title="分类器评测详情" active="/acceptance/eval">
        <MissingBox className="mt-4">加载失败:{loaderData.error}</MissingBox>
      </PageShell>
    );
  }
  const { d, jobs } = loaderData;
  const ev = d.eval;
  const scan = d.scan;
  const jobSpecs = Object.fromEntries(jobs.jobs.map((j) => [j.name, j]));

  const gap =
    ev.present && ev.micro && ev.macro
      ? Math.abs(ev.micro.f1 - ev.macro.f1)
      : 0;

  return (
    <PageShell
      title="分类器评测详情"
      sub="每类 P/R/F1 · 容错红线 · 混淆矩阵 · 阈值"
      active="/acceptance/eval"
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
        {ev.present ? (
          <>
            <Stat label="测试集" value={String(ev.test_size ?? 0) + " 条"} />
            <Stat label="判定阈值" value={String(ev.threshold ?? "—")} />
            <Stat
              label="micro-F1"
              value={ev.micro?.f1.toFixed(3) ?? "—"}
              tone={ev.red_line_passed ? "pass" : undefined}
            />
            <Stat label="macro-F1" value={ev.macro?.f1.toFixed(3) ?? "—"} />
            <Stat
              label="容错红线"
              value={ev.red_line_passed ? "全过" : "有不达标"}
              tone={ev.red_line_passed ? "pass" : "fail"}
            />
            <Stat
              label="评测于"
              value={fmtTime(ev.ran_at).slice(5, 16)}
              small
            />
          </>
        ) : (
          <Stat label="评测产物" value="未生成" tone="fail" />
        )}
      </GateBar>

      {/* ① micro vs macro */}
      <Panel
        title="总分:micro 与 macro 一起看"
        lede="micro 不分科——17 类的所有对错混进一个大桶算总分,量大的类目话语权大。macro 分科——先给 17 类各算一个 F1 再简单平均,小类目和大类目一样权重。两个数差不多,说明各类成绩均匀,没有小类目被大类目的好成绩盖住。"
      >
        {!ev.present ? (
          <MissingBox>{ev.hint}</MissingBox>
        ) : (
          <>
            <div className="flex flex-wrap gap-3.5">
              {[
                { key: "micro", way: "不分科:所有对错混一个桶", nums: ev.micro },
                { key: "macro", way: "分科:17 类各算再平均", nums: ev.macro },
              ].map(({ key, way, nums }) => (
                <div
                  key={key}
                  className="min-w-65 flex-1 border-3 border-ink bg-paper p-3"
                >
                  <h3 className="text-[13px] font-bold">{key}</h3>
                  <div className="text-[11px] text-muted">{way}</div>
                  <div className="mt-2 flex gap-3.5 text-[13px]">
                    {nums
                      ? (["p", "r", "f1"] as const).map((k) => (
                          <div key={k}>
                            <b className="block text-[17px] tabular-nums">
                              {nums[k].toFixed(3)}
                            </b>
                            {k.toUpperCase()}
                          </div>
                        ))
                      : null}
                  </div>
                </div>
              ))}
            </div>
            <Tip>
              两者相差 {gap.toFixed(3)}:
              {gap <= 0.02
                ? "各类成绩均匀,没有类目出问题被总分盖住。"
                : "差距偏大,micro 高 macro 低说明有小类目被牺牲,去下面每类指标里找是哪个。"}
            </Tip>
          </>
        )}
        {jobSpecs["ch10-eval"] ? (
          <JobRow
            specs={[jobSpecs["ch10-eval"]]}
            onFinish={() => { void revalidate(); }}
            note={
              "评测集 " + (ev.present ? String(ev.test_size ?? 0) + " 条" : "test.jsonl")
            }
          />
        ) : null}
      </Panel>

      {/* ② 每类指标 + 容错红线 */}
      <Panel
        title="每类指标与容错红线"
        pill={
          ev.present ? (
            ev.red_line_passed ? (
              <Pill tone="pass">红线全过</Pill>
            ) : (
              <Pill tone="fail">有类目跌破红线</Pill>
            )
          ) : undefined
        }
        lede="容错红线不是每类一条,而是按档位设闸:17 类按「归错了会不会带偏补知识的优先级」分严/中/宽三档,严档 F1 ≥ 0.9、中档 ≥ 0.8,宽档归错影响小、不设线(画 — 而不是 ✅)。support 是这一类在测试集里有多少道题,与混淆矩阵对得上:support = TP + FN。"
      >
        {!ev.present ? (
          <MissingBox>{ev.hint}</MissingBox>
        ) : (
          <TableScroll>
            <Tbl>
              <thead>
                <tr>
                  <Th>类目</Th>
                  <Th>档位</Th>
                  <Th>P</Th>
                  <Th>R</Th>
                  <Th>F1</Th>
                  <Th>support</Th>
                  <Th>红线</Th>
                </tr>
              </thead>
              <tbody>
                {(ev.classes ?? []).map((c) => (
                  <Tr key={c.name} bad={!c.passed}>
                    <Td>{c.name}</Td>
                    <Td>
                      <Pill tone={SEV_TONE[c.severity] ?? "plain"}>
                        {c.severity}
                      </Pill>
                    </Td>
                    <ScoreCell v={c.p} />
                    <ScoreCell v={c.r} />
                    <ScoreCell v={c.f1} redLine={c.red_line} />
                    <Td num>{c.support}</Td>
                    <Td>
                      {c.red_line === null ? (
                        "—"
                      ) : (
                        <Pill tone={c.passed ? "pass" : "fail"}>
                          {String(c.red_line) + (c.passed ? " ✅" : " 🔴 回头搞数据")}
                        </Pill>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Tbl>
          </TableScroll>
        )}
      </Panel>

      {/* ③ 阈值扫描九候选线 */}
      <Panel
        title="判定阈值:九候选线扫描重演"
        pill={
          scan.present ? (
            scan.consistent ? (
              <Pill tone="pass">与在用阈值一致</Pill>
            ) : (
              <Pill tone="fail">与在用阈值不一致</Pill>
            )
          ) : undefined
        }
        lede="模型对每句话给 17 个类各打一个 0~1 的分,过线的类才算命中,这条线就是判定阈值。定太低会冤枉、定太高会放跑。验证集打分一次、分数表固定,九个候选线(0.30~0.70 步进 0.05)套同一张表各算一遍 micro-F1,谁高谁当选;打平时先到的留任,所以 0.45 压住 0.50。"
      >
        {!scan.present ? (
          <MissingBox>{scan.hint}</MissingBox>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              {(scan.scan ?? []).map((s) => {
                const lo = Math.min(...(scan.scan ?? []).map((x) => x.micro_f1));
                const hi = Math.max(...(scan.scan ?? []).map((x) => x.micro_f1));
                const win =
                  Math.abs(s.threshold - (scan.best_threshold ?? -1)) < 1e-9;
                const inuse =
                  Math.abs(s.threshold - (scan.in_use_threshold ?? -1)) < 1e-9;
                return (
                  <div key={s.threshold} className="flex items-center gap-2.5 text-[12.5px]">
                    <span
                      className={cn(
                        "w-14 text-right font-bold tabular-nums",
                        inuse && "text-coral",
                      )}
                    >
                      {s.threshold.toFixed(2)}
                      {inuse ? " ◀" : ""}
                    </span>
                    <span className="h-4.5 flex-1 border-2 border-ink bg-paper">
                      <motion.span
                        className={cn(
                          "block h-full",
                          win ? "bg-online" : "bg-fur",
                        )}
                        initial={{ width: 0 }}
                        animate={{
                          // 九条分数挤在小数第三位,按 min~max 拉伸才看得出高低
                          width: `${hi > lo ? 8 + (92 * (s.micro_f1 - lo)) / (hi - lo) : 100}%`,
                        }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                      />
                    </span>
                    <span className="w-18 tabular-nums">
                      {s.micro_f1.toFixed(4)}
                    </span>
                    <span className="w-40 text-[11px] text-muted">
                      {(win ? "当选" : "") +
                        (inuse
                          ? win
                            ? " · threshold.json 在用"
                            : "threshold.json 在用"
                          : "")}
                    </span>
                  </div>
                );
              })}
            </div>
            <Tip>
              重演当选 {scan.best_threshold?.toFixed(2)}(验证集 micro-F1{" "}
              {scan.best_micro_f1?.toFixed(4)}),threshold.json 在用{" "}
              {scan.in_use_threshold}
              {scan.consistent
                ? ",两者一致 ✅——扫描可复算,不是拍的。"
                : ",两者不一致 🔴——重新导出或重跑扫描。"}
              验证集 {scan.val_size} 条,跑于 {fmtTime(scan.ran_at)}。
            </Tip>
          </>
        )}
        {jobSpecs["ch10-threshold-scan"] ? (
          <JobRow
            specs={[jobSpecs["ch10-threshold-scan"]]}
            onFinish={() => { void revalidate(); }}
            note={
              d.classifier.online
                ? ":8110 在线"
                : ":8110 离线,先去总览页拉起服务"
            }
          />
        ) : null}
      </Panel>

      {/* ④ 混淆矩阵 */}
      <Panel
        title="每类混淆矩阵:错题本"
        lede="P/R/F1 是分数,混淆矩阵是错题本——分数说考得好不好,错题本说错在哪个方向、该回头改什么。TP 该打打对了、TN 不该打也没打、FP 冤枉(不该打却打了)、FN 放跑(该打却没打)。要紧的不是错几个,是错的方向性。"
      >
        {!ev.present ? (
          <MissingBox>{ev.hint}</MissingBox>
        ) : (
          <>
            <Tip className="mt-0">
              全表 {ev.total_cells} 道是非题({ev.test_size} 条 × 17 类)错{" "}
              {String((ev.total_fp ?? 0) + (ev.total_fn ?? 0))} 道:冤枉{" "}
              {ev.total_fp} 次、放跑 {ev.total_fn} 次。
            </Tip>
            <div className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(158px,1fr))]">
              {(ev.classes ?? []).map((c) => (
                <div key={c.name} className="border-3 border-ink bg-paper">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 border-b-2 border-ink px-2 py-1 text-[12.5px] font-bold",
                      (c.fp > 0 || c.fn > 0) && "bg-error-bg",
                    )}
                  >
                    {c.name}
                    <span className="flex-1" />
                    <Pill tone={SEV_TONE[c.severity] ?? "plain"}>
                      {c.severity}
                    </Pill>
                  </div>
                  <div className="grid grid-cols-2">
                    {(
                      [
                        { k: "tn", label: "TN 不该打", cls: "text-muted" },
                        { k: "fp", label: "FP 冤枉", cls: "text-error" },
                        { k: "fn", label: "FN 放跑", cls: "text-error" },
                        { k: "tp", label: "TP 打对", cls: "text-online-deep" },
                      ] satisfies {
                        k: keyof ClassMetric;
                        label: string;
                        cls: string;
                      }[]
                    ).map(({ k, label, cls }) => (
                      <div
                        key={k}
                        className="border-r-2 border-b-2 border-ink px-2 py-1.5 text-[11.5px] whitespace-nowrap [&:nth-child(2n)]:border-r-0 [&:nth-child(n+3)]:border-b-0"
                      >
                        <b className={cn("block text-[15px] tabular-nums", cls)}>
                          {String(c[k])}
                        </b>
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <BtnLink to="/acceptance/errors" size="sm">
                去错例复核页看这些错具体错在哪 →
              </BtnLink>
            </div>
          </>
        )}
      </Panel>

      {/* ⑤ 单句试分类 */}
      <Panel
        title="单句试分类:多标签机制现场看"
        pill={
          d.classifier.online ? (
            <Pill tone="pass">:8110 在线</Pill>
          ) : (
            <Pill tone="missing">:8110 离线</Pill>
          )
        }
        lede="17 个类各自独立过线,过几个打几个——这就是多标签的机制来源。要是 17 个分全都不过线,取分数最高的那个类兜底,保证每道题至少有一个标签。"
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            className="min-w-60 flex-1 border-3 border-ink bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:bg-cream"
            placeholder="输入一句用户问题,比如:买大了想退"
            value={tryText}
            onChange={(e) => { setTryText(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void tryIt(tryText);
              }
            }}
          />
          <Btn
            variant="go"
            disabled={trying}
            onClick={() => {
              void tryIt(tryText);
            }}
          >
            {trying ? "打分中…" : "试分类"}
          </Btn>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            "买大了想退",
            "猫粮颗粒大不大,牙口不好的猫嚼得动吗",
            "积分可以拿来抵运费吗,要是退货运费又是谁承担",
            "旧猫笼你们回收吗",
          ].map((t) => (
            <Btn
              key={t}
              size="sm"
              title={t}
              onClick={() => {
                setTryText(t);
                void tryIt(t);
              }}
            >
              {t.length > 14 ? t.slice(0, 14) + "…" : t}
            </Btn>
          ))}
        </div>
        {tryResult ? (
          <div>
            <div className="mt-3 border-2 border-ink bg-paper px-2.5 py-2 text-[13px] leading-7">
              <b className="font-bold">
                命中标签:{tryResult.labels.join(" + ") || "(无)"}
              </b>
              <div>
                判定阈值 {tryResult.threshold}
                {tryResult.fallback
                  ? ";17 类全部不过线,已走「取最高分兜底」"
                  : ";过线的类全部打上"}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              {tryResult.scores.map((s) => (
                <div
                  key={s.label}
                  className={cn(
                    "flex items-center gap-2 text-[12.5px]",
                    !s.hit && "opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "w-24 shrink-0 text-right",
                      s.hit && "font-bold",
                    )}
                  >
                    {s.label}
                  </span>
                  <span className="relative h-4 flex-1 border-2 border-ink bg-paper">
                    <span
                      className={cn(
                        "block h-full",
                        s.hit ? "bg-online" : "bg-track",
                      )}
                      style={{
                        width: `${Math.max(1, Math.round(s.score * 100))}%`,
                      }}
                    />
                    {tryResult.threshold !== null ? (
                      <span
                        className="absolute -top-0.75 -bottom-0.75 w-0.75 bg-coral"
                        style={{ left: (tryResult.threshold * 100).toFixed(1) + "%" }}
                        title={"判定阈值 " + String(tryResult.threshold)}
                      />
                    ) : null}
                  </span>
                  <span className="w-14 tabular-nums">{s.score.toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Panel>
    </PageShell>
  );
}
