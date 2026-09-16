import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/observability";

import { ScanLineChart } from "~/components/charts";
import { JobRow } from "~/components/job-row";
import {
  Btn,
  MissingBox,
  PageShell,
  Panel,
  SectionHead,
  TableScroll,
  Tbl,
  Td,
  Th,
  Tr,
} from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmt3, fmtTime, pctFmt, thousands } from "~/lib/format";
import { ReadNote } from "~/lib/read-note";
import type { JobSpec } from "~/lib/types";


/* 三块报表各自只画 /api/observability/overview 端出来的那一份:
   成本与校准来自 make 落的产物,趋势来自 eval_runs 表,页面一个数都不重算。
   涨跌箭头是拿同一批行两两相减画出来的,不是另一份数据。 */

const METRIC_LABEL: Record<string, string> = {
  recall_at_5: "Recall@5",
  recall_at_10: "Recall@10",
  mrr: "MRR",
  faithfulness: "Faithfulness",
  refusal_rate: "拒答率",
};
const DELTA_EPS = 0.005; // 和终端趋势表同一条判定线:动静小于它算持平

interface CostRow {
  intent: string;
  count: number;
  tokens: number;
  avg_tokens: number;
  share: number;
}

interface CostBlock {
  present: boolean;
  status: string;
  job: JobSpec;
  make: string;
  hint: string | null;
  meta: { days?: number; generated_at?: string | null };
  rows: CostRow[];
  total_tokens: number | null;
  total_requests: number | null;
  top: CostRow | null;
  read_note: string | null;
}

interface TrendRun {
  id: number;
  triggered_by: string;
  dataset_size: number;
  metrics: Record<string, number | null>;
  created_at: string | null;
}

interface TrendBlock {
  present: boolean;
  status: string;
  job: JobSpec;
  make: string;
  hint?: string;
  note?: string;
  metric_names: string[];
  runs: TrendRun[];
  read_note: string | null;
}

interface DistStats {
  n: number;
  min: number;
  p25: number;
  p50: number;
  p75: number;
  max: number;
}

interface CalibrationBlock {
  present: boolean;
  status: string;
  job: JobSpec;
  make: string;
  hint?: string;
  weights: {
    top1: number;
    valid_count: number;
    margin: number;
    key_clause: number;
  };
  distribution: { answerable: DistStats; absent: DistStats };
  scan: { t: number; pass_rate: number; leak_rate: number }[];
  recommended: {
    threshold: number;
    youden_j: number;
    pass_rate: number;
    leak_rate: number;
  };
  read_note: string | null;
  in_use: number;
  in_sync: boolean;
}

interface Overview {
  cost: CostBlock;
  trend: TrendBlock;
  calibration: CalibrationBlock;
}

type LoaderData = { ok: true; d: Overview } | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    return {
      ok: true,
      d: await api<Overview>("/api/observability/overview"),
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · 观测与成本" },
    {
      name: "description",
      content: "钱花在哪类问题上 · 指标有没有劣化 · 兜底阈值怎么定的",
    },
  ];
}

function Kpis({
  items,
}: {
  items: { label: string; val: ReactNode; unit?: string; sub: ReactNode }[];
}) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((k) => (
        <div
          key={k.label}
          className="border-3 border-ink bg-paper px-3 pt-2.5 pb-3 shadow-hard-sm"
        >
          <div className="text-[11.5px] text-muted">{k.label}</div>
          <div className="text-2xl leading-snug font-bold tabular-nums">
            {k.val}
            {k.unit ? (
              <small className="ml-0.5 text-[13px]">{k.unit}</small>
            ) : null}
          </div>
          <div className="text-[11.5px] leading-6 text-ink-soft">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

function NoteBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-3 border-ink bg-paper p-3">
      <h3 className="mb-1 text-[12.5px] font-bold">{title}</h3>
      <p className="text-xs leading-7 text-ink-soft">{children}</p>
    </div>
  );
}

export default function ObservabilityPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();

  /** 三块共用的收尾:重跑按钮 + 日志窗口,按的就是终端那条 make */
  const jobFoot = (block: { job: JobSpec; make: string }) => (
    <>
      <SectionHead>在页面上重跑</SectionHead>
      <JobRow
        specs={[block.job]}
        onFinish={() => { void revalidate(); }}
        note={block.make}
      />
    </>
  );

  const costPanel = (d: CostBlock) => {
    const body: ReactNode[] = [];
    if (!d.present || !d.rows.length) {
      body.push(<MissingBox key="m">{d.hint}</MissingBox>);
    } else {
      const m = d.meta;
      const top = d.top;
      body.push(
        <Kpis
          key="k"
          items={[
            {
              label: "最烧钱意图",
              val: top?.intent ?? "—",
              sub: top
                ? "占 " +
                  pctFmt(top.share) +
                  " · 单均 " +
                  thousands(top.avg_tokens) +
                  " token"
                : "—",
            },
            {
              label: "总 token",
              val: thousands(d.total_tokens),
              sub:
                String(d.total_requests ?? 0) +
                " 次提问 · 近 " +
                String(m.days ?? "—") +
                " 天",
            },
            {
              label: "意图路数",
              val: String(d.rows.length),
              sub: "窗口内有 trace 的意图",
            },
            {
              label: "上次跑于",
              val: (m.generated_at ?? "—").slice(5),
              sub: "页面只读产物,不查 Langfuse",
            },
          ]}
        />,
      );
      body.push(
        <div key="s" className="mt-3.5 flex flex-col gap-3">
          {d.rows.map((r) => (
            <div key={r.intent}>
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <div>
                  <b className="font-bold">{r.intent}</b>
                  <span className="ml-2 text-[11px] text-muted">
                    {r.count} 次 · 单均 {thousands(r.avg_tokens)} token
                  </span>
                </div>
                <div className="font-bold tabular-nums">
                  {pctFmt(r.share)} · {thousands(r.tokens)}
                </div>
              </div>
              <div className="mt-1 h-4 border-2 border-ink bg-cream">
                <motion.span
                  className={cn(
                    "block h-full",
                    top === r ? "bg-coral" : "bg-sky",
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(1.5, r.share * 100)}%` }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                />
              </div>
            </div>
          ))}
        </div>,
      );
      body.push(<SectionHead key="h">明细</SectionHead>);
      body.push(
        <TableScroll key="t">
          <Tbl>
            <thead>
              <tr>
                <Th>意图</Th>
                <Th>请求数</Th>
                <Th>总 token</Th>
                <Th>单均 token</Th>
                <Th>占比</Th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <Tr key={r.intent}>
                  <Td>{r.intent}</Td>
                  <Td num>{r.count}</Td>
                  <Td num>{thousands(r.tokens)}</Td>
                  <Td num>{thousands(r.avg_tokens)}</Td>
                  <Td num>{pctFmt(r.share)}</Td>
                </Tr>
              ))}
            </tbody>
          </Tbl>
        </TableScroll>,
      );
      if (top) {
        const most = d.rows.reduce<CostRow>(
          (a, b) => (b.avg_tokens > a.avg_tokens ? b : a),
          d.rows[0],
        );
        body.push(
          <ReadNote
            key="r"
            note={d.read_note}
            fallback={
              <>
                总账里 <b>{top.intent}</b> 占 <b>{pctFmt(top.share)}</b>
                ,要瘦成本先瘦它的 prompt 或给它换小模型。单均最高的是{" "}
                <b>
                  {most.intent} {thousands(most.avg_tokens)}
                </b>{" "}
                token,单均高说明一次提问背后是多次模型调用(ReAct
                那类多步工具链就是这样),看的是链路长短,不是问题多。
              </>
            }
          />,
        );
      }
    }
    body.push(<div key="j">{jobFoot(d)}</div>);
    return (
      <Panel
        title="意图成本账"
        pill={
          <span className="inline-block border-2.5 border-ink bg-sky px-2 py-px text-[11.5px] font-bold whitespace-nowrap">
            数据源 Langfuse
          </span>
        }
        lede="意图分类节点跑完会给 trace 打一个 intent 标签,按这个标签把 token 分堆一算,哪类问题最烧钱就现形了。优化成本先动最贵那条路,不必全局换模型。"
      >
        {body}
      </Panel>
    );
  };

  const trendPanel = (d: TrendBlock) => {
    const body: ReactNode[] = [];
    if (d.status === "error") {
      body.push(
        <MissingBox key="m">趋势读不到:{d.note ?? ""}</MissingBox>,
      );
    } else if (!d.present) {
      body.push(<MissingBox key="m">{d.hint}</MissingBox>);
    } else {
      const runs = d.runs;
      const latest = runs[0];
      const prev = runs[1];
      const drops = prev
        ? d.metric_names.filter(
            (n) =>
              (latest.metrics[n] ?? 0) < (prev.metrics[n] ?? 0) - DELTA_EPS,
          )
        : [];
      body.push(
        <Kpis
          key="k"
          items={[
            {
              label: "已跑轮次",
              val: String(runs.length),
              sub: "最多留最近十轮",
            },
            {
              label: "最近一轮",
              val: fmt3(latest.metrics.faithfulness),
              sub: "Faithfulness · 生成段有没有编",
            },
            {
              label: "检索 MRR",
              val: fmt3(latest.metrics.mrr),
              sub:
                latest.metrics.recall_at_5 !== undefined
                  ? "Recall@5 " + fmt3(latest.metrics.recall_at_5)
                  : "Recall@10 " + fmt3(latest.metrics.recall_at_10),
            },
            {
              label: "对比上轮",
              val: drops.length ? String(drops.length) : "0",
              unit: " 项下滑",
              sub: drops.length
                ? drops.map((n) => METRIC_LABEL[n] ?? n).join("、") + " 掉了"
                : "持平或上涨",
            },
          ]}
        />,
      );
      body.push(
        <SectionHead key="h" unit="新在上">
          最近十轮
        </SectionHead>,
      );
      body.push(
        <TableScroll key="t">
          <Tbl>
            <thead>
              <tr>
                <Th>轮次</Th>
                <Th>时间</Th>
                <Th>触发</Th>
                <Th>评估集</Th>
                {d.metric_names.map((n) => (
                  <Th key={n}>{METRIC_LABEL[n] ?? n}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => {
                const older = runs[i + 1];
                return (
                  <Tr key={r.id}>
                    <Td>#{r.id}</Td>
                    <Td>{fmtTime(r.created_at).slice(5, 16)}</Td>
                    <Td>{r.triggered_by}</Td>
                    <Td num>{r.dataset_size}</Td>
                    {d.metric_names.map((n) => {
                      const v = r.metrics[n];
                      const o = older ? older.metrics[n] : undefined;
                      let cls = "";
                      let arrow = "";
                      if (
                        v !== undefined &&
                        v !== null &&
                        o !== undefined &&
                        o !== null
                      ) {
                        const delta = v - o;
                        if (delta > DELTA_EPS) {
                          cls = "text-online-deep";
                          arrow = "↑";
                        } else if (delta < -DELTA_EPS) {
                          cls = "bg-error-bg font-bold text-error";
                          arrow = "⚠↓";
                        } else {
                          cls = "text-muted";
                          arrow = "→";
                        }
                      }
                      return (
                        <Td key={n} num className={cls}>
                          {fmt3(v)}
                          {arrow ? (
                            <span className="ml-1.5">{arrow}</span>
                          ) : null}
                        </Td>
                      );
                    })}
                  </Tr>
                );
              })}
            </tbody>
          </Tbl>
        </TableScroll>,
      );
      body.push(
        <ReadNote
          key="r"
          note={d.read_note}
          fallback={
            drops.length ? (
              <>
                对比上一轮,
                <b>{drops.map((n) => METRIC_LABEL[n] ?? n).join("、")}</b>
                在下滑。先去待审队列翻最近通过的那几条,脏知识进库最常见的表现就是忠实度掉。
              </>
            ) : (
              <>
                四个指标对上一轮都没退步。趋势的价值不在单轮的绝对分,而在
                <b>下一轮别掉</b>——定时跑起来(cron 每天一轮),劣化才有人看见。
              </>
            )
          }
        />,
      );
    }
    body.push(<div key="j">{jobFoot(d)}</div>);
    return (
      <Panel
        title="评估趋势"
        pill={
          <span className="inline-block border-2.5 border-ink bg-sky px-2 py-px text-[11.5px] font-bold whitespace-nowrap">
            数据源 eval_runs 表
          </span>
        }
        lede="飞轮持续往知识库写东西,评估流水线就是拿来防劣化的。每轮复用 ch04 那套评估集,分数落一行,连起来就是趋势。哪天审核放进脏知识把忠实度拉下来,这张表第一时间标出来。"
      >
        {body}
      </Panel>
    );
  };

  const calibrationPanel = (d: CalibrationBlock) => {
    const w = d.weights;
    const wnote = (
      <NoteBox title="置信度怎么算出来的">
        四信号加权:Top1 精排分 {w.top1} / 有效证据数 {w.valid_count} /
        Top1-Top2 分差 {w.margin} / 关键条款命中 {w.key_clause}
        。权重是代码里的常量,校准校的是这条线该划在哪。
      </NoteBox>
    );
    const body: ReactNode[] = [];
    if (!d.present) {
      body.push(<MissingBox key="m">{d.hint}</MissingBox>);
      body.push(<div key="w">{wnote}</div>);
    } else {
      const rec = d.recommended;
      const dist = d.distribution;
      body.push(
        <Kpis
          key="k"
          items={[
            {
              label: "推荐阈值",
              val: rec.threshold.toFixed(2),
              sub:
                "Youden J " +
                fmt3(rec.youden_j) +
                " · 两拨分得最开的那条线",
            },
            {
              label: "在用阈值",
              val: Number(d.in_use).toFixed(2),
              sub: d.in_sync
                ? "与推荐一致"
                : "与推荐不一致,该回填 app/config.py",
            },
            {
              label: "可答通过率",
              val: pctFmt(rec.pass_rate),
              sub: "库里有答案且这次召回够硬的占比",
            },
            {
              label: "应拒放行率",
              val: pctFmt(rec.leak_rate),
              sub: "库外问题被放进来答的占比",
            },
          ]}
        />,
      );
      body.push(<SectionHead key="h">证据置信度分布</SectionHead>);
      body.push(
        <TableScroll key="t">
          <Tbl>
            <thead>
              <tr>
                <Th>题型</Th>
                <Th>题数</Th>
                <Th>最低</Th>
                <Th>p25</Th>
                <Th>中位</Th>
                <Th>p75</Th>
                <Th>最高</Th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "可答(A/B/C 桶)", s: dist.answerable },
                { name: "应拒(D 桶)", s: dist.absent },
              ].map(({ name, s }) => (
                <Tr key={name}>
                  <Td>{name}</Td>
                  <Td num>{s.n}</Td>
                  <Td num>{fmt3(s.min)}</Td>
                  <Td num>{fmt3(s.p25)}</Td>
                  <Td num>{fmt3(s.p50)}</Td>
                  <Td num>{fmt3(s.p75)}</Td>
                  <Td num>{fmt3(s.max)}</Td>
                </Tr>
              ))}
            </tbody>
          </Tbl>
        </TableScroll>,
      );
      body.push(
        <SectionHead key="sh" unit="0.05 → 0.95,步进 0.01">
          阈值扫描
        </SectionHead>,
      );
      body.push(
        <div key="lg" className="mt-2.5 mb-0.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {[
            { label: "可答通过率", color: "bg-online" },
            { label: "应拒放行率", color: "bg-error" },
            { label: "选定阈值", color: "bg-ink" },
            { label: "在用阈值", color: "bg-violet" },
          ].map(({ label, color }) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <i className={cn("h-3 w-3 border-2 border-ink", color)} />
              {label}
            </span>
          ))}
        </div>,
      );
      body.push(
        <div key="c">
          <ScanLineChart
            scan={d.scan}
            pick={rec.threshold}
            inUse={d.in_use}
          />
        </div>,
      );
      body.push(
        <ReadNote
          key="r"
          note={d.read_note}
          fallback={
            <>
              红线先陡降后贴地:阈值抬到{" "}
              <b>{rec.threshold.toFixed(2)}</b> 时应拒放行率归零,库外问题一条都进不来,代价是{" "}
              <b>{pctFmt(1 - rec.pass_rate)}</b>{" "}
              的可答被误拦。误拦的那些走兜底进问题池,恰好是飞轮的燃料,所以这笔账划得来。要更宽松就把线往左挪,得先接受有库外问题被硬答。
            </>
          }
        />,
      );
      body.push(
        <div key="sp" className="mt-3.5 grid gap-3.5 md:grid-cols-2">
          {wnote}
          <NoteBox title="什么是「可答被误拦」">
            库里其实有答案,但那一次召回的证据太散(库里写「猫窝清洗保养说明」,用户问「能扔洗衣机里洗吗」),精排分上不去,置信度算出来低于线。闸只看证据分,不知道「库里有」,于是当成答不上处理。这条问题落池、归并、审核补进知识库,下次同样问法就召回得动了。
          </NoteBox>
        </div>,
      );
    }
    body.push(<div key="j">{jobFoot(d)}</div>);
    return (
      <Panel
        title="置信度阈值校准"
        pill={
          <span className="inline-block border-2.5 border-ink bg-sky px-2 py-px text-[11.5px] font-bold whitespace-nowrap">
            ch04 评估集实跑
          </span>
        }
        lede="兜底那道闸卡在什么分上,不是拍脑袋定的。拿评估集里可答的和该拒的两拨题各算一遍证据置信度,再扫一遍阈值,看哪条线把两拨分得最开。"
      >
        {body}
      </Panel>
    );
  };

  return (
    <PageShell
      title="观测与成本"
      sub="钱花在哪类问题上 · 指标有没有劣化 · 兜底阈值怎么定的"
      active="/observability"
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
      {loaderData.ok ? (
        <>
          {costPanel(loaderData.d.cost)}
          {trendPanel(loaderData.d.trend)}
          {calibrationPanel(loaderData.d.calibration)}
        </>
      ) : (
        <MissingBox className="mt-4">取数失败:{loaderData.error}</MissingBox>
      )}
    </PageShell>
  );
}
