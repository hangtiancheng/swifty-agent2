import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/kb";

import { JobRow } from "~/components/job-row";
import { useToast } from "~/components/toast";
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
import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import type { JobSpec } from "~/lib/types";


/* 知识库录入:贴一段文档就能进库——切块 → 双写 MySQL 与 Milvus → 现场检索自测。
   页面读 /api/kb/overview 的产物;重跑走 /api/jobs 运行器。 */

interface KbChunkStats {
  total: number | null;
  pending: number | null;
  done: number | null;
  by_content_type: Record<string, number>;
  key_clause: number | null;
}

interface KbMilvus {
  online: boolean;
  count: number | null;
  collection?: string;
  detail?: string;
}

interface KbSource {
  file: string;
  content_type: string;
  present: boolean;
  path: string;
  chars?: number;
  lines?: number;
  chunks?: number;
  key_clause?: number;
  features?: { sections: number; table_split: boolean; overlap: boolean };
}

interface KbStagingStats {
  counts: { extracted: number; kept: number; discarded: number };
  batches: number;
  total: number;
  latest_batch: string | null;
}

interface KbRecent {
  id: number;
  questions: string;
  answer: string;
  section_path: string | null;
  content_type: string | null;
  is_key_clause: boolean;
  status: string;
}

interface KbOverview {
  chunks: KbChunkStats;
  recent: KbRecent[];
  staging: KbStagingStats | null;
  db_error: string | null;
  milvus: KbMilvus;
  consistent: boolean | null;
  sources: KbSource[];
  content_types: { key: string; desc: string }[];
  jobs: JobSpec[];
}

interface KbPreview {
  source: string;
  total: number;
  duplicates: number;
  key_clause: number;
  features: { sections: number; table_split: boolean; overlap: boolean };
  chunks: {
    seq: number;
    section_path: string;
    questions: string;
    answer: string;
    chars: number;
    is_key_clause: boolean;
    is_table: boolean;
    duplicate: boolean;
  }[];
  dedup_known: boolean;
}

interface KbStagingRow {
  id: number;
  batch_no: string;
  source_ref: string | null;
  question: string;
  answer: string;
}

type StagingKey = "kept" | "extracted" | "discarded" | "approved" | "rejected";

interface KbStagingRows {
  rows: Record<StagingKey, KbStagingRow[]>;
}

interface KbHit {
  id: number | null;
  question: string;
  answer: string;
  score: number | null;
  rerank_score: number | null;
  section_path: string | null;
  content_type: string | null;
}

type LoaderData = { ok: true; d: KbOverview } | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    return { ok: true, d: await api<KbOverview>("/api/kb/overview") };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · 知识库录入" },
    { name: "description", content: "贴一段文档就能进库:切块、双写、检索自测" },
  ];
}

const SAMPLE =
  "# 会员权益\n\n## 运费与包邮\n\n满 99 元包邮,未满收 10 元运费。偏远地区(新疆、西藏、内蒙)运费 20 元,不参与包邮。\n\n## 会员等级\n\n| 等级 | 年消费 | 折扣 | 生日礼 |\n|---|---|---|---|\n| 喵铜 | 0 元起 | 无 | 无 |\n| 喵银 | 1000 元起 | 95 折 | 优惠券 |\n| 喵金 | 5000 元起 | 9 折 | 猫罐头礼盒 |\n";

const STAGING_LABEL: Record<StagingKey, string> = {
  kept: "待审(人工采纳才入库)",
  extracted: "已抽出待去重",
  discarded: "去重丢弃",
  approved: "已采纳入库",
  rejected: "已弃用",
};
const STAGING_ORDER: StagingKey[] = [
  "kept",
  "extracted",
  "discarded",
  "approved",
  "rejected",
];

const FIELD =
  "border-3 border-ink bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:bg-cream";

const ANSWER_CELL =
  "scroll-cat max-h-32 overflow-auto text-xs leading-7 whitespace-pre-wrap break-words";

export default function KbPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();
  const toast = useToast();

  const [text, setText] = useState("");
  const [ctype, setCtype] = useState("");
  const [vecAfter, setVecAfter] = useState(true);
  const [preview, setPreview] = useState<KbPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [stagingRows, setStagingRows] = useState<KbStagingRows | null>(null);
  const [stagingLoading, setStagingLoading] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [q, setQ] = useState("");
  const [strategy, setStrategy] = useState("vector");
  const [topk, setTopk] = useState(5);
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [hitStrategy, setHitStrategy] = useState("");
  const [searching, setSearching] = useState(false);

  if (!loaderData.ok) {
    return (
      <PageShell title="知识库录入" active="/kb">
        <MissingBox className="mt-4">取数失败:{loaderData.error}</MissingBox>
      </PageShell>
    );
  }
  const d = loaderData.d;
  const jobSpecs = Object.fromEntries(d.jobs.map((j) => [j.name, j]));
  const pick = (names: string[]) =>
    names.map((n) => jobSpecs[n]).filter((x): x is JobSpec => Boolean(x));
  const ct = ctype || d.content_types[0]?.key || "";
  const ctDesc = d.content_types.find((x) => x.key === ct)?.desc ?? "";

  const doPreview = async (payload: Record<string, unknown>) => {
    setPreviewing(true);
    setPreview(null);
    try {
      setPreview(await api<KbPreview>("/api/kb/preview", jsonPost(payload)));
    } catch (e) {
      toast("预览失败:" + errMsg(e), true);
    } finally {
      setPreviewing(false);
    }
  };

  const doIngest = async () => {
    const body = text.trim();
    if (!body) {
      toast("先贴一段正文", true);
      return;
    }
    const n = preview?.source === "手工录入" ? preview.total : null;
    if (
      !window.confirm(
        "确认把这段正文录入知识库?" +
          (n
            ? "\n预览切出 " +
              String(n) +
              " 块" +
              (preview?.duplicates
                ? ",其中 " + String(preview.duplicates) + " 块库里已有会跳过"
                : "")
            : "") +
          (vecAfter
            ? "\n入库后立刻向量化(要调嵌入上游)"
            : "\n只入库记 pending,稍后补向量"),
      )
    ) {
      return;
    }
    setIngesting(true);
    try {
      const r = await api<{
        inserted: number;
        skipped: number;
        vectorized: number | null;
      }>(
        "/api/kb/ingest",
        jsonPost({ text: body, content_type: ct, vectorize: vecAfter }),
      );
      toast(
        "入库 " +
          String(r.inserted) +
          " 块" +
          (r.skipped ? ",跳过重复 " + String(r.skipped) + " 块" : "") +
          (r.vectorized !== null
            ? ",向量化 " + String(r.vectorized) + " 块"
            : "(未向量化)"),
      );
      void revalidate();
      if (r.inserted) {
        void doPreview({ text: body, content_type: ct });
      }
    } catch (e) {
      toast("录入失败:" + errMsg(e), true);
    } finally {
      setIngesting(false);
    }
  };

  const loadStaging = async () => {
    setStagingLoading(true);
    try {
      setStagingRows(await api<KbStagingRows>("/api/kb/staging"));
    } catch (e) {
      toast("暂存表取数失败:" + errMsg(e), true);
    } finally {
      setStagingLoading(false);
    }
  };

  /** 采纳 / 弃用:挖知识唯一的入库口,点了才写 knowledge_chunks */
  const reviewAction = async (kind: "approve" | "reject", id: number) => {
    try {
      const r = await api<{ approved?: number; rejected?: number }>(
        "/api/kb/staging/" + kind,
        jsonPost({ ids: [id] }),
      );
      toast(
        kind === "approve"
          ? "已采纳入库 " + String(r.approved ?? 0) + " 条"
          : "已弃用 " + String(r.rejected ?? 0) + " 条",
      );
      await loadStaging(); // 重拉:这一行会从待审挪到已采纳/已弃用
      void revalidate();
    } catch (e) {
      toast((kind === "approve" ? "采纳" : "弃用") + "失败:" + errMsg(e), true);
    }
  };

  const doVectorize = async () => {
    setVectorizing(true);
    try {
      const r = await api<{
        vectorized: number;
        chunk_stats: { pending: number | null };
      }>("/api/kb/vectorize", jsonPost());
      toast(
        "本次向量化 " +
          String(r.vectorized) +
          " 块,剩余 pending " +
          String(r.chunk_stats.pending ?? "—"),
      );
      void revalidate();
    } catch (e) {
      toast("向量化失败:" + errMsg(e), true);
    } finally {
      setVectorizing(false);
    }
  };

  const runSearch = async (query: string) => {
    setSearching(true);
    setHits(null);
    try {
      const r = await api<{ strategy: string; hits: KbHit[] }>(
        "/api/kb/search",
        jsonPost({ q: query.trim() || "邮费是多少", strategy, top_k: topk }),
      );
      setHits(r.hits);
      setHitStrategy(r.strategy);
    } catch (e) {
      toast("检索失败:" + errMsg(e), true);
    } finally {
      setSearching(false);
    }
  };

  const c = d.chunks;
  const totalSources = d.sources.reduce(
    (acc, s) => acc + (s.present ? (s.chunks ?? 0) : 0),
    0,
  );

  return (
    <PageShell
      title="知识库录入"
      sub="贴一段文档就能进库:切块 → 双写 MySQL 与 Milvus → 现场检索自测"
      active="/kb"
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
      {/* 顶部闸条 */}
      <GateBar>
        <Stat label="知识块(MySQL)" value={c.total ?? "—"} />
        <Stat
          label="待向量化"
          value={c.pending ?? "—"}
          tone={c.pending ? "fail" : "pass"}
        />
        <Stat
          label="Milvus 条数"
          value={d.milvus.online ? (d.milvus.count ?? "—") : "离线"}
          tone={d.milvus.online ? undefined : "fail"}
        />
        <Stat label="关键条款" value={c.key_clause ?? "—"} />
        <Stat
          label="双写"
          value={
            d.consistent === null ? "读不到" : d.consistent ? "一致" : "对不上"
          }
          tone={
            d.consistent === null
              ? undefined
              : d.consistent
                ? "pass"
                : "fail"
          }
        />
        {d.db_error ? (
          <Stat label="MySQL" value={d.db_error} tone="fail" />
        ) : null}
      </GateBar>

      <Tip>
        两条路:<b>手工录入</b>正文贴在这一页上,预览什么样就入库什么样;
        <b>离线建库</b>把 data/kb/ 那几份材料交给 make
        目标跑,页面按的和终端敲的是同一条命令。
        两条路共用一套切块逻辑与双写顺序——先写 MySQL 记「待向量化」,再进 Milvus
        回标「已向量化」,中途挂了重跑捡 pending 就能补齐。
      </Tip>

      {/* ① 手工录入 */}
      <Panel
        title="① 手工录入"
        pill={<Pill tone="info">正文贴这里</Pill>}
        lede="按标题层级切、超长递归切、块间重叠裁到最近句号、大表格按行拆并复制表头——这四条在下面的预览里逐块标出来。查重按「问法 + 正文」的指纹,同一份正文重复录入会全跳过。"
      >
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="text-[12.5px] font-bold" htmlFor="ctype">
              内容类型
            </label>
            <select
              id="ctype"
              className={FIELD}
              value={ct}
              onChange={(e) => { setCtype(e.target.value); }}
            >
              {d.content_types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key}
                </option>
              ))}
            </select>
            <span className="text-[11.5px] text-ink-soft">{ctDesc}</span>
            <span className="flex-1" />
            <Btn size="sm" onClick={() => { setText(SAMPLE); }}>
              填一段示例
            </Btn>
            <Btn
              size="sm"
              onClick={() => {
                setText("");
                setPreview(null);
              }}
            >
              清空
            </Btn>
          </div>
          <textarea
            className={cn(FIELD, "min-h-44 w-full resize-y leading-7")}
            placeholder="贴 Markdown。带 # / ## 标题层级效果最好——政策手册这类没有天然问法的,questions 就落章节标题、category 落上级路径。"
            value={text}
            onChange={(e) => { setText(e.target.value); }}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <Btn
              variant="go"
              disabled={previewing}
              onClick={() => {
                void doPreview({ text, content_type: ct });
              }}
            >
              {previewing ? "切块中…" : "切块预览(不写库)"}
            </Btn>
            <Btn
              disabled={ingesting}
              onClick={() => {
                void doIngest();
              }}
            >
              {ingesting ? "录入中…" : "录入入库"}
            </Btn>
            <label className="flex cursor-pointer items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-(--coral)"
                checked={vecAfter}
                onChange={(e) => { setVecAfter(e.target.checked); }}
              />
              入库后顺手向量化
            </label>
          </div>
        </div>

        {preview ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              <Pill tone="info">来源 {preview.source}</Pill>
              <Pill tone="info">
                共 {preview.total} 块 / {preview.features.sections} 节
              </Pill>
              <Pill tone={preview.features.table_split ? "pass" : "missing"}>
                {preview.features.table_split
                  ? "表格按行拆已触发"
                  : "表格按行拆未触发"}
              </Pill>
              <Pill tone={preview.features.overlap ? "pass" : "missing"}>
                {preview.features.overlap
                  ? "句末重叠已触发"
                  : "句末重叠未触发(单节未超 400 字)"}
              </Pill>
              <Pill tone={preview.key_clause ? "pass" : "missing"}>
                关键条款 {preview.key_clause} 块
              </Pill>
              {preview.dedup_known ? (
                <Pill tone={preview.duplicates ? "fail" : "pass"}>
                  {preview.duplicates
                    ? "库里已有 " +
                      String(preview.duplicates) +
                      " 块,入库会跳过"
                    : "无重复,可入库"}
                </Pill>
              ) : (
                <Pill tone="missing">查重未知(MySQL 读不到)</Pill>
              )}
            </div>
            <TableScroll className="mt-3">
              <Tbl>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>节(section_path)</Th>
                    <Th>问法 questions</Th>
                    <Th>正文 answer</Th>
                    <Th>字数</Th>
                    <Th>标记</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.chunks.map((ch) => (
                    <Tr key={ch.seq} bad={ch.duplicate}>
                      <Td num>{ch.seq}</Td>
                      <Td>{ch.section_path}</Td>
                      <Td>{ch.questions}</Td>
                      <Td>
                        <div className={ANSWER_CELL}>{ch.answer}</div>
                      </Td>
                      <Td num>{ch.chars}</Td>
                      <Td className="whitespace-nowrap">
                        {ch.is_key_clause ? (
                          <Pill tone="fail" className="mr-1">
                            关键条款
                          </Pill>
                        ) : null}
                        {ch.is_table ? (
                          <Pill tone="info" className="mr-1">
                            表格块
                          </Pill>
                        ) : null}
                        {ch.duplicate ? <Pill tone="missing">重复</Pill> : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Tbl>
            </TableScroll>
          </div>
        ) : null}
      </Panel>

      {/* ② 建库材料 */}
      <Panel
        title="② 建库材料"
        pill={
          <Pill tone="info">
            {d.sources.length} 份材料 / 共切 {totalSources} 块
          </Pill>
        }
        lede="data/kb/ 下的文档是离线建库的输入。这里的块数是就地切出来的(dry-run,不写库、不碰 Milvus、不调上游),点「看切块」把结果送到上面的预览区逐块看。"
      >
        <TableScroll>
          <Tbl>
            <thead>
              <tr>
                <Th>文件</Th>
                <Th>类型</Th>
                <Th>字符</Th>
                <Th>行</Th>
                <Th>切出块数</Th>
                <Th>关键条款</Th>
                <Th>特性</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {d.sources.map((s) => (
                <Tr key={s.file} bad={!s.present}>
                  <Td>{s.path}</Td>
                  <Td>{s.content_type}</Td>
                  {!s.present ? (
                    <Td colSpan={6}>文件不在</Td>
                  ) : (
                    <>
                      <Td num>{s.chars}</Td>
                      <Td num>{s.lines}</Td>
                      <Td num>{s.chunks}</Td>
                      <Td num>{s.key_clause}</Td>
                      <Td className="whitespace-nowrap">
                        {s.features?.table_split ? (
                          <Pill tone="info" className="mr-1">
                            拆表
                          </Pill>
                        ) : null}
                        {s.features?.overlap ? (
                          <Pill tone="info" className="mr-1">
                            重叠
                          </Pill>
                        ) : null}
                        <Pill tone="missing">
                          {s.features?.sections ?? 0} 节
                        </Pill>
                      </Td>
                      <Td>
                        <Btn
                          size="sm"
                          onClick={() => {
                            void doPreview({ file: s.file });
                          }}
                        >
                          看切块
                        </Btn>
                      </Td>
                    </>
                  )}
                </Tr>
              ))}
            </tbody>
          </Tbl>
        </TableScroll>
        <JobRow
          specs={pick(["kb-preview", "kb-build", "kb-repatch"])}
          onFinish={() => { void revalidate(); }}
          note="kb-build 有幂等守卫:已存在同类型块就跳过;改过 md 用 kb-repatch 原地改,改完记得向量化"
        />
      </Panel>

      {/* ③ 对话挖知识 */}
      <Panel
        title="③ 对话挖知识"
        pill={
          <Pill tone="info">
            {d.staging
              ? d.staging.total
                ? "累计 " +
                  String(d.staging.total) +
                  " 条,最近批次 " +
                  (d.staging.latest_batch ?? "—")
                : "还没挖过"
              : "读不到"}
          </Pill>
        }
        lede="历史客服对话分批喂给 LLM 抽问答对,先落暂存表,再整体去重入库。三个状态的落差就是去重那一刀:抽出多少、留下多少、丢了多少。"
      >
        {d.staging ? (
          <div className="flex flex-wrap gap-2">
            {[
              { label: "已抽出待去重", v: d.staging.counts.extracted },
              { label: "去重保留(已入库)", v: d.staging.counts.kept },
              { label: "去重丢弃", v: d.staging.counts.discarded },
              { label: "批次数", v: d.staging.batches },
            ].map(({ label, v }) => (
              <div
                key={label}
                className="min-w-21 border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px]"
              >
                <b className="block text-[17px] leading-snug">{v}</b>
                {label}
              </div>
            ))}
          </div>
        ) : (
          <MissingBox>MySQL 读不到,暂存表数看不了</MissingBox>
        )}
        <JobRow
          specs={pick(["seed-conv", "kb-mine"])}
          onFinish={() => { void revalidate(); }}
          note="挖知识要调 LLM,分钟级"
        />
        <div className="mt-3">
          <Btn
            size="sm"
            disabled={stagingLoading}
            onClick={() => {
              void loadStaging();
            }}
          >
            {stagingLoading ? "取数中…" : "看暂存表逐条"}
          </Btn>
        </div>
        {stagingRows ? (
          <div className="mt-2">
            {STAGING_ORDER.map((st) => {
              const rows = stagingRows.rows[st] ?? [];
              if (!rows.length) {
                return null;
              }
              return (
                <div key={st}>
                  <h3 className="mt-3.5 mb-1.5 text-[13px] font-bold">
                    {STAGING_LABEL[st]}({rows.length} 条)
                  </h3>
                  {st === "kept" ? (
                    <p className="mb-2 text-[12.5px] leading-6 text-ink-soft">
                      这些是模型从历史对话里归纳出来的,质量参差。逐条看清楚再采纳,
                      只对单笔订单成立的、夹带订单号的、答非所问的,都别放进知识库。
                    </p>
                  ) : null}
                  <TableScroll>
                    <Tbl>
                      <thead>
                        <tr>
                          <Th>批次</Th>
                          <Th>来源</Th>
                          <Th>问法</Th>
                          <Th>答案</Th>
                          {st === "kept" ? <Th>处理</Th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <Tr key={r.id}>
                            <Td>{r.batch_no}</Td>
                            <Td>{r.source_ref ?? "—"}</Td>
                            <Td>{r.question}</Td>
                            <Td>
                              <div className={ANSWER_CELL}>{r.answer}</div>
                            </Td>
                            {st === "kept" ? (
                              <Td className="whitespace-nowrap">
                                <Btn
                                  size="sm"
                                  variant="ok"
                                  className="mr-1.5"
                                  onClick={() => {
                                    void reviewAction("approve", r.id);
                                  }}
                                >
                                  采纳
                                </Btn>
                                <Btn
                                  size="sm"
                                  variant="no"
                                  onClick={() => {
                                    void reviewAction("reject", r.id);
                                  }}
                                >
                                  弃用
                                </Btn>
                              </Td>
                            ) : null}
                          </Tr>
                        ))}
                      </tbody>
                    </Tbl>
                  </TableScroll>
                </div>
              );
            })}
            {STAGING_ORDER.every(
              (st) => (stagingRows.rows[st] ?? []).length === 0,
            ) ? (
              <MissingBox>暂存表是空的,先跑一次对话挖知识</MissingBox>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {/* ④ 向量化与双写 */}
      <Panel
        title="④ 向量化与双写"
        pill={
          d.consistent === null ? (
            <Pill tone="missing">读不到,不下结论</Pill>
          ) : d.consistent ? (
            <Pill tone="pass">两边对得上</Pill>
          ) : (
            <Pill tone="fail">对不上,按下面补齐</Pill>
          )
        }
        lede="MySQL 是原文权威源,Milvus 只存向量。幂等靠 vectorize_status:写 MySQL 记 pending,嵌入后按主键 upsert 进 Milvus、回标 done。故意中断建库再按「向量化待补块」,漏掉的块会被捡起来补齐——这一条不用回终端演。"
      >
        <div className="flex flex-wrap gap-2">
          {[
            { label: "pending 待补", v: c.pending },
            { label: "done 已向量化", v: c.done },
            {
              label: "Milvus 条数",
              v: d.milvus.online ? d.milvus.count : null,
            },
            { label: "集合", v: d.milvus.collection ?? "knowledge" },
          ].map(({ label, v }) => (
            <div
              key={label}
              className="min-w-21 border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px]"
            >
              <b className="block text-[17px] leading-snug">
                {v === null || v === undefined ? "—" : String(v)}
              </b>
              {label}
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Btn
            variant="go"
            disabled={vectorizing}
            onClick={() => {
              void doVectorize();
            }}
          >
            {vectorizing ? "向量化中…" : "向量化待补块"}
          </Btn>
          <span className="text-[11.5px] text-muted">
            {d.milvus.online
              ? "in-process 直接跑,与 make kb-vectorize 同一个函数"
              : "Milvus 离线:" + (d.milvus.detail ?? "")}
          </span>
        </div>
        <JobRow
          specs={pick(["kb-vectorize", "kb-reset"])}
          onFinish={() => { void revalidate(); }}
          note="清库会清空两表并 drop 集合,之后要重新建库"
        />
      </Panel>

      {/* ⑤ 检索自测 */}
      <Panel
        title="⑤ 检索自测"
        pill={<Pill tone="info">换个说法问一句</Pill>}
        lede="问题向量化后到 Milvus 按相似度取 Top-K。「邮费是多少」库里一个字都没写过,靠的是与「运费」那块语义相近——词面查表做不到这件事。"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            className={cn(FIELD, "min-w-55 flex-1")}
            placeholder="邮费是多少"
            value={q}
            onChange={(e) => { setQ(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void runSearch(q);
              }
            }}
          />
          <label className="text-[12.5px] font-bold" htmlFor="strategy">
            路线
          </label>
          <select
            id="strategy"
            className={FIELD}
            value={strategy}
            onChange={(e) => { setStrategy(e.target.value); }}
          >
            <option value="vector">dense 向量单路(本章)</option>
            <option value="bm25">BM25 关键词</option>
            <option value="hybrid">混合召回</option>
            <option value="hybrid_rerank">混合 + 重排</option>
          </select>
          <label className="text-[12.5px] font-bold" htmlFor="topk">
            Top-K
          </label>
          <input
            id="topk"
            type="number"
            min={1}
            max={20}
            className={cn(FIELD, "w-18")}
            value={topk}
            onChange={(e) => { setTopk(Number(e.target.value) || 5); }}
          />
          <Btn
            variant="go"
            disabled={searching}
            onClick={() => {
              void runSearch(q);
            }}
          >
            <Search className="h-4 w-4" aria-hidden />
            {searching ? "检索中…" : "检索"}
          </Btn>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {["邮费是多少", "运费怎么算", "多久发货", "猫粮过期了能退吗"].map(
            (preset) => (
              <Btn
                key={preset}
                size="sm"
                onClick={() => {
                  setQ(preset);
                  void runSearch(preset);
                }}
              >
                {preset}
              </Btn>
            ),
          )}
        </div>
        {hits ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              <Pill tone="info">路线 {hitStrategy}</Pill>
              <Pill tone={hits.length ? "pass" : "fail"}>
                召回 {hits.length} 块
              </Pill>
            </div>
            {hits.length ? (
              <div className="mt-2.5 grid gap-2.5">
                {hits.map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      "border-3 border-ink bg-paper px-3 py-2 text-[12.5px]",
                      i === 0 && "bg-cream shadow-hard-sm",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={i === 0 ? "pass" : "info"}>#{i + 1}</Pill>
                      <span className="font-bold">{h.question}</span>
                      <span className="flex-1" />
                      {h.score !== null && h.score !== undefined ? (
                        <Pill tone="info">
                          score {Number(h.score).toFixed(4)}
                        </Pill>
                      ) : null}
                      {h.rerank_score !== null &&
                      h.rerank_score !== undefined ? (
                        <Pill tone="info">
                          rerank {Number(h.rerank_score).toFixed(4)}
                        </Pill>
                      ) : null}
                    </div>
                    <div className="mt-1.5 leading-7 whitespace-pre-wrap">
                      {h.answer}
                    </div>
                    <div className="mt-1.5 text-[11.5px] text-muted">
                      {[
                        h.section_path ?? "—",
                        h.content_type ?? "—",
                        "id " + String(h.id ?? "—"),
                      ].join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <MissingBox className="mt-2.5">
                一条都没召回:库里可能还没有货,或者 pending 还没向量化
              </MissingBox>
            )}
          </div>
        ) : null}
      </Panel>

      {/* ⑥ 最近入库 */}
      <Panel
        title="⑥ 最近入库"
        lede="按 id 倒序取最近 12 块,看录进去的东西长什么样、状态到哪一步了。"
      >
        <TableScroll>
          <Tbl>
            <thead>
              <tr>
                <Th>id</Th>
                <Th>类型</Th>
                <Th>节</Th>
                <Th>问法</Th>
                <Th>正文(截断)</Th>
                <Th>状态</Th>
              </tr>
            </thead>
            <tbody>
              {d.recent.length ? (
                d.recent.map((r) => (
                  <Tr key={r.id} bad={r.status === "pending"}>
                    <Td num>{r.id}</Td>
                    <Td>{r.content_type ?? "—"}</Td>
                    <Td>{r.section_path ?? "—"}</Td>
                    <Td>{r.questions}</Td>
                    <Td>
                      <div className={ANSWER_CELL}>{r.answer}</div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Pill
                        tone={r.status === "done" ? "pass" : "fail"}
                        className="mr-1"
                      >
                        {r.status === "done" ? "已向量化" : "待向量化"}
                      </Pill>
                      {r.is_key_clause ? (
                        <Pill tone="fail">关键条款</Pill>
                      ) : null}
                    </Td>
                  </Tr>
                ))
              ) : (
                <Tr>
                  <Td colSpan={6}>
                    库里还没有块。上面贴一段录进来,或者跑一次离线建库。
                  </Td>
                </Tr>
              )}
            </tbody>
          </Tbl>
        </TableScroll>
      </Panel>
    </PageShell>
  );
}
