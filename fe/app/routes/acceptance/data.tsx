import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/data";

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
} from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtBytes, fmtTime } from "~/lib/format";
import type { JobSpec } from "~/lib/types";


/* 分类器数据产物:语料血缘 · 三份考卷 · 训练与 ONNX 产物盘点。 */

interface FileStat {
  path: string;
  present: boolean;
  bytes?: number | null;
  mtime?: string | null;
  lines?: number | null;
}

interface LineageStep extends FileStat {
  file: string;
  stage: string;
  desc: string;
  make: string;
}

interface SplitStat {
  desc: string;
  size: number;
  multi_label: number;
  counts: Record<string, number>;
  file: FileStat;
}

interface ExportReport {
  present: boolean;
  hint?: string;
  passed?: boolean;
  checked?: number;
  mismatch?: number;
  opset?: number;
  onnx_bytes?: number;
  ran_at?: string;
}

interface DataDetail {
  lineage: LineageStep[];
  dataset: {
    splits: Record<"train" | "val" | "test", SplitStat>;
    leaks: { train_val: number; train_test: number; val_test: number };
    clean: boolean;
  };
  sample_review: FileStat;
  model: {
    files: FileStat[];
    threshold: number | null;
    threshold_file: FileStat;
    trio_ok: boolean;
  };
  onnx: { files: FileStat[]; report: ExportReport };
  topic_names: string[];
}

type LoaderData =
  | { ok: true; d: DataDetail; jobs: JobSpec[] }
  | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    const [d, j] = await Promise.all([
      api<DataDetail>("/api/acceptance/data"),
      api<{ jobs: JobSpec[] }>("/api/jobs"),
    ]);
    return { ok: true, d, jobs: j.jobs };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · 分类器数据产物" },
    { name: "description", content: "语料血缘 · 三份考卷 · 训练与 ONNX 产物盘点" },
  ];
}

const SPLIT_KEYS = ["train", "val", "test"] as const;
const SPLIT_LABEL: Record<string, string> = {
  train: "训练集",
  val: "验证集",
  test: "测试集",
};

function FileTable({ rows }: { rows: FileStat[] }) {
  return (
    <TableScroll className="mt-2.5">
      <Tbl>
        <thead>
          <tr>
            <Th>产物</Th>
            <Th>条数</Th>
            <Th>大小</Th>
            <Th>最后写入</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.path} bad={!r.present}>
              <Td className="break-all">{r.path}</Td>
              <Td num>{r.present ? String(r.lines ?? "—") : "缺失"}</Td>
              <Td num>{r.present ? fmtBytes(r.bytes) : "—"}</Td>
              <Td>{r.present ? fmtTime(r.mtime) : "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </Tbl>
    </TableScroll>
  );
}

export default function AcceptanceDataPage({
  loaderData,
}: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();

  if (!loaderData.ok) {
    return (
      <PageShell title="分类器数据产物" active="/acceptance/data">
        <MissingBox className="mt-4">加载失败:{loaderData.error}</MissingBox>
      </PageShell>
    );
  }
  const { d, jobs } = loaderData;
  const jobSpecs = Object.fromEntries(jobs.map((j) => [j.name, j]));
  const pick = (names: string[]) =>
    names.map((n) => jobSpecs[n]).filter((x): x is JobSpec => Boolean(x));
  const ds = d.dataset;
  const sp = ds.splits;
  const ex = d.onnx.report;
  const labeled = d.lineage.find((x) => x.file === "corpus_labeled.jsonl");

  return (
    <PageShell
      title="分类器数据产物"
      sub="语料血缘 · 三份考卷 · 训练与 ONNX 产物盘点"
      active="/acceptance/data"
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
          label="语料总量"
          value={
            (labeled?.present ? String(labeled.lines ?? "—") : "—") +
            " 条"
          }
        />
        {SPLIT_KEYS.map((k) => (
          <Stat key={k} label={SPLIT_LABEL[k]} value={String(sp[k].size) + " 条"} />
        ))}
        <Stat
          label="考卷泄漏"
          value={ds.clean ? "0 条" : "有"}
          tone={ds.clean ? "pass" : "fail"}
        />
        <Stat label="在用阈值" value={String(d.model.threshold ?? "—")} />
      </GateBar>

      {/* ① 语料血缘 */}
      <Panel
        title="语料血缘:一条问题从池子走到考卷"
        lede="每一段都能对上一个产物文件,数不是口述的。捞池拿的是数据飞轮归并阶段产出的标准化问法,不是用户原话——分类器接手的必须是一句语义完整的话。"
      >
        <div className="flex flex-wrap items-stretch gap-1.5">
          {d.lineage.map((s, i) => (
            <motion.div
              key={s.file}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.2 }}
              className="flex flex-1 items-stretch gap-1.5"
            >
              <div
                className={cn(
                  "min-w-36 flex-1 border-3 border-ink bg-paper px-3 py-2",
                  !s.present && "text-muted",
                )}
              >
                <div className="text-[11.5px] text-muted">{s.stage}</div>
                <b className="block text-2xl leading-tight tabular-nums">
                  {s.present ? String(s.lines ?? "—") : "缺失"}
                </b>
                <div className="mt-0.5 text-[11.5px] leading-5">{s.desc}</div>
                <div className="mt-1 text-[11px] break-all text-muted">
                  {s.path}
                </div>
              </div>
              <div className="self-center text-xl font-bold">→</div>
            </motion.div>
          ))}
          <div className="min-w-36 flex-1 border-3 border-ink bg-cream px-3 py-2">
            <div className="text-[11.5px] text-muted">分层切卷 80/10/10</div>
            <b className="block text-2xl leading-tight tabular-nums">
              {SPLIT_KEYS.map((k) => String(sp[k].size)).join(" / ")}
            </b>
            <div className="mt-0.5 text-[11.5px] leading-5">
              训练 / 验证 / 测试;训练集另做增强与定向补数
            </div>
            <div className="mt-1 text-[11px] break-all text-muted">
              data/train/dataset/*.jsonl
            </div>
          </div>
        </div>
        <FileTable rows={[...d.lineage, d.sample_review]} />
        <Tip>
          人工抽审文件 sample_review.md 是给人读的那一份(真实池全量 + 每类模拟抽
          5),看到错标就直接改语料,不许改考卷去凑分。
        </Tip>
        <JobRow
          specs={pick(["train-corpus", "train-dataset"])}
          onFinish={() => { void revalidate(); }}
        />
      </Panel>

      {/* ② 三份考卷 + 泄漏自检 */}
      <Panel
        title="三份考卷与泄漏自检"
        pill={
          ds.clean ? (
            <Pill tone="pass">零重叠</Pill>
          ) : (
            <Pill tone="fail">有重叠,分数不作数</Pill>
          )
        }
        lede="增强只扩训练集——验证/测试是考题,不许照练习题变。重叠必须是 0:考题一旦被训练集见过,后面所有分数都不作数,所以这一栏是硬闸,不是提示。"
      >
        <div className="flex flex-wrap gap-3">
          {(
            [
              { k: "train_val", label: "训练 ∩ 验证" },
              { k: "train_test", label: "训练 ∩ 测试" },
              { k: "val_test", label: "验证 ∩ 测试" },
            ] satisfies { k: keyof typeof ds.leaks; label: string }[]
          ).map(({ k, label }) => (
            <Stat
              key={k}
              label={label}
              value={String(ds.leaks[k]) + " 条"}
              tone={ds.leaks[k] === 0 ? "pass" : "fail"}
            />
          ))}
          {SPLIT_KEYS.map((k) => (
            <Stat
              key={k}
              label={SPLIT_LABEL[k] + " 多标签"}
              value={String(sp[k].multi_label) + " 条"}
            />
          ))}
        </div>
        <TableScroll className="mt-3">
          <Tbl>
            <thead>
              <tr>
                <Th>类目</Th>
                {SPLIT_KEYS.map((k) => (
                  <Th key={k}>
                    {SPLIT_LABEL[k]}({sp[k].size})
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.topic_names.map((name) => (
                <Tr key={name}>
                  <Td>{name}</Td>
                  {SPLIT_KEYS.map((k) => {
                    const maxOf = Math.max(
                      1,
                      ...Object.values(sp[k].counts),
                    );
                    const cnt = sp[k].counts[name] ?? 0;
                    return (
                      <Td key={k} className="p-0">
                        <div className="flex items-center gap-1.5 px-2 py-0.5">
                          <span className="h-2.25 min-w-10 flex-1 border-2 border-ink bg-cream">
                            <motion.span
                              className="block h-full bg-fur"
                              initial={{ width: 0 }}
                              animate={{
                                width: `${Math.round((cnt / maxOf) * 100)}%`,
                              }}
                              transition={{ duration: 0.4, ease: "easeOut" }}
                            />
                          </span>
                          <span className="w-10 text-right tabular-nums">
                            {cnt}
                          </span>
                        </div>
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </tbody>
          </Tbl>
        </TableScroll>
        <Tip>
          标签计数按「命中即计」算,多标签句给命中的每类各记一次,所以各列合计会大于条数。
        </Tip>
      </Panel>

      {/* ③ 训练产物 */}
      <Panel
        title="训练产物三件套"
        pill={
          d.model.trio_ok ? (
            <Pill tone="pass">三件套齐全</Pill>
          ) : (
            <Pill tone="fail">三件套不全</Pill>
          )
        }
        lede="权重 + tokenizer + threshold.json。阈值和验证集成绩就落在那个几十字节的小文件里,评测和服务启动都读它——它才是「上线的完整分类器」的另一半。"
      >
        <FileTable rows={d.model.files} />
        <Tip>
          <b>threshold.json</b> 在用判定阈值 {String(d.model.threshold)};写入于{" "}
          {fmtTime(d.model.threshold_file.mtime)},{" "}
          {fmtBytes(d.model.threshold_file.bytes)}。
        </Tip>
        <JobRow
          specs={pick(["train-train"])}
          onFinish={() => { void revalidate(); }}
          note="训练是分钟级重活,会覆盖现有权重"
        />
      </Panel>

      {/* ④ ONNX 产物 */}
      <Panel
        title="ONNX 导出产物与一致性校验"
        pill={
          ex.present ? (
            ex.passed ? (
              <Pill tone="pass">预测完全一致</Pill>
            ) : (
              <Pill tone="fail">有不一致</Pill>
            )
          ) : (
            <Pill tone="missing">未导出</Pill>
          )
        }
        lede="导出后拿测试集全量逐条对齐 torch,过线标签必须完全一致才放行;服务侧只背 onnxruntime + tokenizers,不背 torch。"
      >
        <FileTable rows={d.onnx.files} />
        {ex.present ? (
          <Tip>
            校验 {ex.checked} 条,不一致 {ex.mismatch} 条;opset {ex.opset}
            ,model.onnx {fmtBytes(ex.onnx_bytes)},导出于 {fmtTime(ex.ran_at)}。
          </Tip>
        ) : (
          <MissingBox className="mt-2.5">{ex.hint}</MissingBox>
        )}
        <JobRow
          specs={pick(["train-export", "classifier-up", "classifier-down"])}
          onFinish={() => { void revalidate(); }}
        />
      </Panel>
    </PageShell>
  );
}
