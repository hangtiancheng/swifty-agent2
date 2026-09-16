import { RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";

import type { Route } from "./+types/review";

import { useToast } from "~/components/toast";
import { Btn, MissingBox, PageShell } from "~/components/ui";
import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";


/* 飞轮待审队列:答不上的问题 → 标准化查重 → 人工审核 → 写回知识库。
   状态页签走地址栏(?status=),链接可分享;详情(归并原话+召回快照)点开才拉。 */

interface ReviewItem {
  id: number;
  normalized_question: string;
  ai_suggested_answer: string | null;
  occurrence_count: number;
  review_status: string; // 待审 | 通过 | 驳回
  created_at: string | null;
}

interface SnapshotChunk {
  question?: string;
  answer?: string;
  rerank_score?: number;
  section_path?: string;
}

interface ReviewRaw {
  raw_question: string;
  source: string;
  reason?: string | null;
  created_at: string | null;
  /** 三态:null=没走检索;[]=走了检索但零命中(真缺知识的强信号);列表=有召回 */
  retrieved_chunks: SnapshotChunk[] | null;
}

interface ReviewDetail {
  raws: ReviewRaw[];
}

type LoaderData =
  | { ok: true; items: ReviewItem[] }
  | { ok: false; error: string };

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "待审";
  const qs = status ? "?status=" + encodeURIComponent(status) : "";
  try {
    const d = await api<{ items: ReviewItem[] }>("/api/review/queue" + qs);
    return { ok: true, items: d.items };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · 飞轮待审队列" },
    { name: "description", content: "答不上的问题经人工审核后写回知识库" },
  ];
}

const SRC_LABEL: Record<string, string> = {
  retrieval_low_conf: "检索置信度低",
  self_check: "模型自评不足",
  user_feedback: "用户反馈没解决",
};

const SRC_CLS: Record<string, string> = {
  retrieval_low_conf: "bg-warn-bg",
  self_check: "bg-violet",
  user_feedback: "bg-pink",
};

const ST_CLS: Record<string, string> = {
  待审: "bg-fur",
  通过: "bg-online",
  驳回: "bg-error text-white",
};

const TABS: [string, string][] = [
  ["待审", "待审"],
  ["通过", "通过"],
  ["驳回", "驳回"],
  ["", "全部"],
];

function Snapshots({ chunks }: { chunks: SnapshotChunk[] | null }) {
  if (chunks === null || chunks === undefined) {
    return (
      <div className="border-2 border-dashed border-muted px-2.5 py-1.5 text-xs text-muted">
        该入口未走检索,无召回快照
      </div>
    );
  }
  if (!chunks.length) {
    return (
      <div className="border-2 border-dashed border-muted px-2.5 py-1.5 text-xs text-muted">
        已检索,零命中——知识库确实没有相关内容
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {chunks.map((c, i) => {
        const score = Number(c.rerank_score ?? 0);
        return (
          <div
            key={i}
            className="border-2 border-dashed border-ink bg-paper px-2.5 py-2 text-[12.5px]"
          >
            <div className="font-bold">{c.question || "(无标题)"}</div>
            <div className="my-1 text-ink-soft">{c.answer ?? ""}</div>
            <div className="flex items-center gap-2 text-[11.5px] text-muted">
              <span>精排分 {score.toFixed(3)}</span>
              <span className="h-2 w-35 border-2 border-ink bg-paper">
                <span
                  className="block h-full bg-coral"
                  style={{ width: `${Math.min(100, Math.round(score * 100))}%` }}
                />
              </span>
              {c.section_path ? <span>{c.section_path}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ReviewPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();
  const [params, setParams] = useSearchParams();
  const curStatus = params.get("status") ?? "待审";
  const toast = useToast();

  const [openId, setOpenId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, ReviewDetail>>({});
  const [detailErr, setDetailErr] = useState<Record<number, string>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [approving, setApproving] = useState<ReviewItem | null>(null);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState<number | null>(null);

  const toggleDetail = useCallback(
    async (id: number) => {
      if (openId === id) {
        setOpenId(null);
        return;
      }
      setOpenId(id);
      if (details[id] || detailErr[id] || loadingId === id) {
        return;
      }
      setLoadingId(id);
      try {
        const d = await api<ReviewDetail>("/api/review/" + String(id));
        setDetails((xs) => ({ ...xs, [id]: d }));
      } catch (e) {
        setDetailErr((xs) => ({ ...xs, [id]: errMsg(e) }));
      } finally {
        setLoadingId(null);
      }
    },
    [openId, details, detailErr, loadingId],
  );

  const doReject = async (it: ReviewItem) => {
    setRejecting(it.id);
    try {
      await api("/api/review/" + String(it.id) + "/reject", jsonPost());
      toast("已驳回");
      void revalidate();
    } catch (e) {
      toast("驳回失败:" + errMsg(e), true);
    } finally {
      setRejecting(null);
    }
  };

  const doApprove = async () => {
    if (!approving) {
      return;
    }
    if (!answer.trim()) {
      toast("核准答案不能为空", true);
      return;
    }
    setSubmitting(true);
    try {
      await api(
        "/api/review/" + String(approving.id) + "/approve",
        jsonPost({ approved_answer: answer.trim() }),
      );
      setApproving(null);
      toast("已写回知识库,下次同类问题可直接检索命中 ✓");
      void revalidate();
    } catch (e) {
      toast("写回失败:" + errMsg(e), true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell
      title="飞轮待审队列"
      sub="答不上的问题 → 标准化查重 → 人工审核 → 写回知识库"
      active="/review"
      maxW="max-w-[1080px]"
      actions={
        <>
          <div className="flex border-3 border-ink bg-paper">
            {TABS.map(([st, label], i) => (
              <button
                key={label}
                type="button"
                className={cn(
                  "cursor-pointer border-r-3 border-ink px-3 py-1.5 font-[inherit] text-[13px] last:border-r-0 hover:bg-fur-hover",
                  curStatus === st && "bg-fur font-bold",
                  i === 0 && "rounded-none",
                )}
                onClick={() => { setParams(st ? new URLSearchParams({ status: st }) : new URLSearchParams()); }
                }
              >
                {label}
              </button>
            ))}
          </div>
          <Btn onClick={() => { void revalidate(); }} disabled={state === "loading"}>
            <RefreshCw
              className={state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              aria-hidden
            />
            刷新
          </Btn>
        </>
      }
    >
      <div className="mt-4 border-3 border-dashed border-ink bg-paper px-3.5 py-2.5 text-[12.5px] leading-[1.8] [&_b]:mr-1 [&_b]:border-2 [&_b]:border-ink [&_b]:bg-fur [&_b]:px-1.5">
        审核前先过三道闸:<b>① 垃圾过滤</b>乱输入、测试胡打、不当言论 → 驳回;
        <b>② 时效</b>强时效问题(活动截止类)补了就过期,不沉淀 → 驳回;
        <b>③ 频次</b>低频冷门问题不值得占知识库、耗人工 →
        驳回。剩下的才是真缺口,补上核准答案点通过。
      </div>

      {!loaderData.ok ? (
        <MissingBox className="mt-4">加载失败:{loaderData.error}</MissingBox>
      ) : !loaderData.items.length ? (
        <MissingBox className="mt-4">这个状态下暂时没有条目喵~</MissingBox>
      ) : (
        <div className="mt-4 flex flex-col gap-3.5">
          {loaderData.items.map((it) => {
            const open = openId === it.id;
            const detail = details[it.id];
            return (
              <motion.div
                key={it.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="border-4 border-ink bg-cream shadow-hard"
              >
                <div
                  className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-paper"
                  onClick={() => {
                    void toggleDetail(it.id);
                  }}
                >
                  <span
                    title="出现次数(查重归并累加),越高越该优先补"
                    className={cn(
                      "border-2.5 border-ink bg-paper px-2 py-0.5 text-xs font-bold whitespace-nowrap",
                      it.occurrence_count >= 3 && "bg-coral text-white",
                    )}
                  >
                    ×{it.occurrence_count}
                  </span>
                  <div className="min-w-60 flex-1 text-[14.5px] font-bold">
                    {it.normalized_question}
                  </div>
                  <div className="hidden max-w-80 truncate text-xs text-muted lg:block">
                    {it.ai_suggested_answer ?? "(无示例答案)"}
                  </div>
                  <span
                    className={cn(
                      "border-2.5 border-ink px-2 py-0.5 text-xs font-bold whitespace-nowrap",
                      ST_CLS[it.review_status] ?? "bg-paper",
                    )}
                  >
                    {it.review_status}
                  </span>
                  {it.review_status === "待审" ? (
                    <div className="flex gap-2" onClick={(e) => { e.stopPropagation(); }}>
                      <Btn
                        size="sm"
                        variant="ok"
                        onClick={() => {
                          setApproving(it);
                          setAnswer(it.ai_suggested_answer ?? "");
                        }}
                      >
                        通过
                      </Btn>
                      <Btn
                        size="sm"
                        variant="no"
                        disabled={rejecting === it.id}
                        onClick={() => {
                          void doReject(it);
                        }}
                      >
                        {rejecting === it.id ? "驳回中…" : "驳回"}
                      </Btn>
                    </div>
                  ) : null}
                </div>
                <AnimatePresence initial={false}>
                  {open ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t-3 border-ink"
                    >
                      <div className="bg-paper px-4 py-3.5">
                        {loadingId === it.id && !detail ? (
                          <div className="text-xs text-muted">加载详情…</div>
                        ) : detailErr[it.id] ? (
                          <div className="text-xs text-error">
                            详情加载失败:{detailErr[it.id]}
                          </div>
                        ) : detail ? (
                          <>
                            <div className="mb-2.5 text-xs text-muted">
                              对着快照判断:知识库是真缺这块,还是有但没检到。归并原话{" "}
                              {detail.raws.length} 条↓
                            </div>
                            {detail.raws.length ? (
                              detail.raws.map((r, i) => (
                                <div
                                  key={i}
                                  className="mb-3 border-3 border-ink bg-cream p-2.5 last:mb-0"
                                >
                                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                    <span
                                      className={cn(
                                        "border-2 border-ink px-1.5 py-px text-[11.5px] font-bold",
                                        SRC_CLS[r.source] ?? "bg-paper",
                                      )}
                                    >
                                      {SRC_LABEL[r.source] ?? r.source}
                                    </span>
                                    <span className="text-[11.5px] text-muted">
                                      {(r.created_at ?? "")
                                        .replace("T", " ")
                                        .slice(0, 16)}
                                    </span>
                                  </div>
                                  <div className="mb-2 text-[13.5px]">
                                    「{r.raw_question}」
                                  </div>
                                  <Snapshots chunks={r.retrieved_chunks} />
                                </div>
                              ))
                            ) : (
                              <div className="border-2 border-dashed border-muted px-2.5 py-1.5 text-xs text-muted">
                                暂无归并原话(飞轮跑批后回填)
                              </div>
                            )}
                          </>
                        ) : null}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 通过弹框:核准答案预填 AI 示例,人工把关后提交写回知识库 */}
      <AnimatePresence>
        {approving ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setApproving(null);
              }
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="通过并写回知识库"
              className="w-[min(560px,92vw)] border-4 border-ink bg-cream p-4.5 shadow-hard-lg"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.16 }}
            >
              <h3 className="text-[15px] font-bold">通过并写回知识库</h3>
              <div className="mt-1 mb-2.5 text-[13px] text-ink-soft">
                标准化问题:{approving.normalized_question}
              </div>
              <textarea
                autoFocus
                className="min-h-32 w-full resize-y border-3 border-ink bg-paper p-2.5 text-[13px] outline-none focus:bg-paper"
                placeholder="核准答案(预填 AI 示例答案,请人工把关后提交)"
                value={answer}
                onChange={(e) => { setAnswer(e.target.value); }}
              />
              <div className="mt-3 flex justify-end gap-2.5">
                <Btn onClick={() => { setApproving(null); }}>取消</Btn>
                <Btn
                  variant="ok"
                  disabled={submitting}
                  onClick={() => {
                    void doApprove();
                  }}
                >
                  {submitting ? "写回中…" : "确认通过"}
                </Btn>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </PageShell>
  );
}
