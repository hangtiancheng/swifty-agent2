import { RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";

import type { Route } from "./+types/review";

import { useToast } from "~/components/toast";
import { Btn, MissingBox, PageShell } from "~/components/ui";
import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";


/* Flywheel review queue: unanswerable questions → normalize & dedupe → human
   review → write back to the Knowledge Base. Status tabs ride the URL
   (?status=) so links are shareable; details (merged originals + recall
   snapshots) are fetched only when expanded. */

interface ReviewItem {
  id: number;
  normalized_question: string;
  ai_suggested_answer: string | null;
  occurrence_count: number;
  review_status: string; // Backend values: 待审 (pending) | 通过 (approved) | 驳回 (rejected)
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
  /** Three states: null = retrieval never ran; [] = ran with zero hits (a strong signal of a real knowledge gap); list = had recalls */
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
    { title: "MewMart · Review Queue" },
    {
      name: "description",
      content:
        "Unanswered questions go through human review and are written back to the Knowledge Base",
    },
  ];
}

const SRC_LABEL: Record<string, string> = {
  retrieval_low_conf: "Low retrieval confidence",
  self_check: "Failed model self-check",
  user_feedback: "User reported unresolved",
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

// Display labels for backend status values (keys are contract strings)
const ST_LABEL: Record<string, string> = {
  待审: "Pending",
  通过: "Approved",
  驳回: "Rejected",
};

const TABS: [string, string][] = [
  ["待审", "Pending"],
  ["通过", "Approved"],
  ["驳回", "Rejected"],
  ["", "All"],
];

function Snapshots({ chunks }: { chunks: SnapshotChunk[] | null }) {
  if (chunks === null || chunks === undefined) {
    return (
      <div className="border-2 border-dashed border-muted px-2.5 py-1.5 text-xs text-muted">
        Retrieval never ran for this entry — no recall snapshots
      </div>
    );
  }
  if (!chunks.length) {
    return (
      <div className="border-2 border-dashed border-muted px-2.5 py-1.5 text-xs text-muted">
        Retrieval ran with zero hits — the Knowledge Base truly has no
        relevant content
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
            <div className="font-bold">{c.question || "(untitled)"}</div>
            <div className="my-1 text-ink-soft">{c.answer ?? ""}</div>
            <div className="flex items-center gap-2 text-[11.5px] text-muted">
              <span>Rerank score {score.toFixed(3)}</span>
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
      toast("Rejected");
      void revalidate();
    } catch (e) {
      toast("Failed to reject: " + errMsg(e), true);
    } finally {
      setRejecting(null);
    }
  };

  const doApprove = async () => {
    if (!approving) {
      return;
    }
    if (!answer.trim()) {
      toast("The approved answer cannot be empty", true);
      return;
    }
    setSubmitting(true);
    try {
      await api(
        "/api/review/" + String(approving.id) + "/approve",
        jsonPost({ approved_answer: answer.trim() }),
      );
      setApproving(null);
      toast("Written back to the Knowledge Base — similar questions will now recall directly ✓");
      void revalidate();
    } catch (e) {
      toast("Failed to write back: " + errMsg(e), true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell
      title="Review Queue"
      sub="Unanswerable questions → normalize & dedupe → human review → write back to the Knowledge Base"
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
            Refresh
          </Btn>
        </>
      }
    >
      <div className="mt-4 border-3 border-dashed border-ink bg-paper px-3.5 py-2.5 text-[12.5px] leading-[1.8] [&_b]:mr-1 [&_b]:border-2 [&_b]:border-ink [&_b]:bg-fur [&_b]:px-1.5">
        Run three gates before reviewing: <b>① Spam filter</b> gibberish, stray
        test input, inappropriate content → reject; <b>② Timeliness</b>{" "}
        time-sensitive questions (promo deadlines) expire as soon as they are
        filled — do not persist them → reject; <b>③ Frequency</b> rare, niche
        questions are not worth Knowledge Base space or human time → reject.
        What remains is a real gap: fill in the approved answer and click
        Approve.
      </div>

      {!loaderData.ok ? (
        <MissingBox className="mt-4">Failed to load: {loaderData.error}</MissingBox>
      ) : !loaderData.items.length ? (
        <MissingBox className="mt-4">No items in this status yet</MissingBox>
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
                    title="Occurrence count (accumulated by dedupe merging); the higher it is, the sooner this should be filled"
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
                    {it.ai_suggested_answer ?? "(no suggested answer)"}
                  </div>
                  <span
                    className={cn(
                      "border-2.5 border-ink px-2 py-0.5 text-xs font-bold whitespace-nowrap",
                      ST_CLS[it.review_status] ?? "bg-paper",
                    )}
                  >
                    {ST_LABEL[it.review_status] ?? it.review_status}
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
                        Approve
                      </Btn>
                      <Btn
                        size="sm"
                        variant="no"
                        disabled={rejecting === it.id}
                        onClick={() => {
                          void doReject(it);
                        }}
                      >
                        {rejecting === it.id ? "Rejecting…" : "Reject"}
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
                          <div className="text-xs text-muted">Loading details…</div>
                        ) : detailErr[it.id] ? (
                          <div className="text-xs text-error">
                            Failed to load details: {detailErr[it.id]}
                          </div>
                        ) : detail ? (
                          <>
                            <div className="mb-2.5 text-xs text-muted">
                              Judge from the snapshots: is the Knowledge Base
                              truly missing this, or does it have the answer
                              but fail to recall it? Merged original questions:{" "}
                              {detail.raws.length} ↓
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
                                    “{r.raw_question}”
                                  </div>
                                  <Snapshots chunks={r.retrieved_chunks} />
                                </div>
                              ))
                            ) : (
                              <div className="border-2 border-dashed border-muted px-2.5 py-1.5 text-xs text-muted">
                                No merged originals yet (backfilled after the
                                flywheel batch runs)
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

      {/* Approve dialog: the approved answer is prefilled with the AI suggestion; a human reviews it before it is written back to the Knowledge Base */}
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
              aria-label="Approve & write back to Knowledge Base"
              className="w-[min(560px,92vw)] border-4 border-ink bg-cream p-4.5 shadow-hard-lg"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.16 }}
            >
              <h3 className="text-[15px] font-bold">
                Approve & write back to Knowledge Base
              </h3>
              <div className="mt-1 mb-2.5 text-[13px] text-ink-soft">
                Normalized question: {approving.normalized_question}
              </div>
              <textarea
                autoFocus
                className="min-h-32 w-full resize-y border-3 border-ink bg-paper p-2.5 text-[13px] outline-none focus:bg-paper"
                placeholder="Approved answer (prefilled with the AI suggestion — review it before submitting)"
                value={answer}
                onChange={(e) => { setAnswer(e.target.value); }}
              />
              <div className="mt-3 flex justify-end gap-2.5">
                <Btn onClick={() => { setApproving(null); }}>Cancel</Btn>
                <Btn
                  variant="ok"
                  disabled={submitting}
                  onClick={() => {
                    void doApprove();
                  }}
                >
                  {submitting ? "Writing back…" : "Approve"}
                </Btn>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </PageShell>
  );
}
