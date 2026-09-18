import { createRef, customElement, property, state } from "@swifty.js/lit-jsx";
import { animate } from "motion";

import { ModalShell } from "~/components/modal-shell";
import { toast } from "~/components/toast";
import { Btn, MissingBox, PageLoading, PageShell } from "~/components/ui";
import { api, errMsg, jsonPost } from "~/lib/api";
import { cn } from "~/lib/cn";
import { EASE_STANDARD, enterOnce } from "~/lib/motion";
import { DataLoaderElement } from "~/lib/page-element";
import { navigate } from "~/lib/router";

/* Flywheel review queue: unanswerable questions → normalize & dedupe → human
   review → write back to the Knowledge Base. Status tabs ride the URL
   (?status=) so links are shareable; details (merged originals + recall
   snapshots) are fetched only when expanded. */

interface ReviewItem {
  id: number;
  normalized_question: string;
  ai_suggested_answer: string | null;
  occurrence_count: number;
  review_status: string; // Backend values: pending_review | approved | rejected
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

interface Queue {
  items: ReviewItem[];
}

const SRC_LABEL: Record<string, string> = {
  retrieval_low_conf: "Low retrieval confidence",
  self_check: "Failed model self-check",
  user_feedback: "User reported unresolved",
};

const SRC_CLS: Record<string, string> = {
  retrieval_low_conf: "bg-warning-container text-on-warning-container",
  self_check: "bg-tertiary-container text-on-tertiary",
  user_feedback: "bg-error-container text-on-error-container",
};

const ST_CLS: Record<string, string> = {
  pending_review: "bg-primary-container text-on-primary-container",
  approved: "bg-success text-on-success",
  rejected: "bg-error text-on-error",
};

// Display labels for backend status values (keys are contract strings)
const ST_LABEL: Record<string, string> = {
  pending_review: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const TABS: [string, string][] = [
  ["pending_review", "Pending"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["", "All"],
];

function Snapshots({ chunks }: { chunks: SnapshotChunk[] | null }) {
  if (chunks === null || chunks === undefined) {
    return (
      <div class="border-outline-variant text-on-surface-variant rounded-md border border-dashed px-2.5 py-1.5 text-xs">
        Retrieval never ran for this entry — no recall snapshots
      </div>
    );
  }
  if (!chunks.length) {
    return (
      <div class="border-outline-variant text-on-surface-variant rounded-md border border-dashed px-2.5 py-1.5 text-xs">
        Retrieval ran with zero hits — the Knowledge Base truly has no relevant
        content
      </div>
    );
  }
  return (
    <div class="flex flex-col gap-2">
      {chunks.map((c) => {
        const score = Number(c.rerank_score ?? 0);
        return (
          <div class="bg-surface-container-low rounded-md px-2.5 py-2 text-[12.5px]">
            <div class="font-medium">{c.question || "(untitled)"}</div>
            <div class="text-on-surface-variant my-1">{c.answer ?? ""}</div>
            <div class="text-on-surface-variant flex items-center gap-2 text-[11.5px]">
              <span>Rerank score {score.toFixed(3)}</span>
              <span class="bg-surface-container-highest h-1.5 w-35 shrink-0 overflow-hidden rounded-full">
                <span
                  class="bg-primary block h-full rounded-full"
                  style={{
                    width: `${String(Math.min(100, Math.round(score * 100)))}%`,
                  }}
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

/* ---------- Approve dialog ---------- */

/** Approve dialog: the approved answer is prefilled with the AI suggestion; a human
    reviews it before it is written back to the Knowledge Base. */
@customElement("approve-dialog")
export class ApproveDialog extends ModalShell {
  @property({ attribute: false }) item: ReviewItem | null = null;
  @property({ attribute: false }) onApproved?: () => void;

  @state() private answer = "";
  @state() private submitting = false;
  private textareaRef = createRef<HTMLTextAreaElement>();

  protected override cardMaxW = "max-w-[560px]";

  protected override updated(
    changed: Map<string | number | symbol, unknown>,
  ): void {
    super.updated(changed);
    if (changed.has("open") && this.open) {
      this.answer = this.item?.ai_suggested_answer ?? "";
      this.submitting = false;
      void this.updateComplete.then(() => {
        const el = this.textareaRef.value;
        if (el) {
          // Uncontrolled textarea (see chat.tsx): seed the prefilled suggestion via the ref
          el.value = this.answer;
          el.focus();
        }
      });
    }
  }

  private async doApprove(): Promise<void> {
    if (!this.item) {
      return;
    }
    if (!this.answer.trim()) {
      toast("The approved answer cannot be empty", true);
      return;
    }
    this.submitting = true;
    try {
      await api(
        "/api/review/" + String(this.item.id) + "/approve",
        jsonPost({ approved_answer: this.answer.trim() }),
      );
      toast(
        "Written back to the Knowledge Base — similar questions will now recall directly ✓",
      );
      this.onApproved?.();
    } catch (e) {
      toast("Failed to write back: " + errMsg(e), true);
    } finally {
      this.submitting = false;
    }
  }

  protected override dialogTitle(): string {
    return "Approve & write back to Knowledge Base";
  }
  protected override dialogSub(): string {
    return "Normalized question: " + (this.item?.normalized_question ?? "");
  }

  protected override dialogBody() {
    return (
      <>
        <textarea
          ref={this.textareaRef}
          class="border-outline text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-primary text-body-medium min-h-32 w-full resize-y rounded-sm border bg-transparent px-3.5 py-2.5 transition-[border-color,box-shadow] duration-200 outline-none focus:ring-1"
          placeholder="Approved answer (prefilled with the AI suggestion — review it before submitting)"
          onInput={(e: Event) => {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            this.answer = (e.target as HTMLTextAreaElement).value;
          }}
        />
        <div class="mt-3 flex justify-end gap-2.5">
          <Btn onClick={() => this.onClose?.()}>Cancel</Btn>
          <Btn
            variant="ok"
            disabled={this.submitting}
            onClick={() => {
              void this.doApprove();
            }}
          >
            {this.submitting ? "Writing back…" : "Approve"}
          </Btn>
        </div>
      </>
    );
  }
}

/* ---------- Page ---------- */

@customElement("review-page")
export class ReviewPage extends DataLoaderElement<Queue> {
  /** Current location.search, fed in by the route render callback */
  @property() search = "";

  @state() private openId: number | null = null;
  @state() private details: Record<number, ReviewDetail> = {};
  @state() private detailErr: Record<number, string> = {};
  @state() private loadingId: number | null = null;
  @state() private approving: ReviewItem | null = null;
  @state() private rejecting: number | null = null;

  protected override pageTitle = "MeowMeow Select · Review Queue";
  private searchReady = false;
  private detailRef = createRef<HTMLDivElement>();

  protected override updated(
    changed: Map<string | number | symbol, unknown>,
  ): void {
    if (changed.has("search")) {
      if (this.searchReady) {
        void this.reload();
      } else {
        this.searchReady = true;
      }
    }
  }

  protected override async load(): Promise<Queue> {
    const status =
      new URLSearchParams(this.search).get("status") ?? "pending_review";
    const qs = status ? "?status=" + encodeURIComponent(status) : "";
    return api<Queue>("/api/review/queue" + qs);
  }

  private async toggleDetail(id: number): Promise<void> {
    if (this.openId === id) {
      // Collapse: animate the height down, then unmount
      const el = this.detailRef.value;
      if (el) {
        await animate(
          el,
          { height: [el.offsetHeight, 0], opacity: [1, 0] },
          { duration: 0.2, ease: EASE_STANDARD },
        ).then(() => undefined);
      }
      this.openId = null;
      return;
    }
    this.openId = id;
    void this.updateComplete.then(() => {
      const el = this.detailRef.value;
      if (el) {
        void animate(
          el,
          { height: [0, "auto"], opacity: [0, 1] },
          { duration: 0.2, ease: EASE_STANDARD },
        ).then(() => {
          // Let the box size naturally again — the detail fetch below changes its height
          el.style.height = "";
        });
      }
    });
    if (this.details[id] || this.detailErr[id] || this.loadingId === id) {
      return;
    }
    this.loadingId = id;
    try {
      const d = await api<ReviewDetail>("/api/review/" + String(id));
      this.details = { ...this.details, [id]: d };
    } catch (e) {
      this.detailErr = { ...this.detailErr, [id]: errMsg(e) };
    } finally {
      this.loadingId = null;
    }
  }

  private async doReject(it: ReviewItem): Promise<void> {
    this.rejecting = it.id;
    try {
      await api("/api/review/" + String(it.id) + "/reject", jsonPost());
      toast("Rejected");
      void this.reload();
    } catch (e) {
      toast("Failed to reject: " + errMsg(e), true);
    } finally {
      this.rejecting = null;
    }
  }

  protected override render() {
    const curStatus =
      new URLSearchParams(this.search).get("status") ?? "pending_review";
    return (
      <PageShell
        title="Review Queue"
        sub="Unanswerable questions → normalize & dedupe → human review → write back to the Knowledge Base"
        active="/review"
        maxW="max-w-[1080px]"
        actions={
          <>
            <div class="bg-surface-container-low flex rounded-full p-1">
              {TABS.map(([st, label]) => (
                <button
                  type="button"
                  class={cn(
                    "text-label-medium cursor-pointer rounded-full px-3.5 py-1.5 font-[inherit] transition-all duration-200",
                    curStatus === st
                      ? "bg-primary text-on-primary shadow-e1"
                      : "text-on-surface-variant hover:bg-on-surface/8",
                  )}
                  onClick={() => {
                    navigate(
                      st
                        ? "/review?status=" + encodeURIComponent(st)
                        : "/review",
                    );
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {this.refreshBtn()}
          </>
        }
      >
        <div class="bg-secondary-container text-on-secondary-container mt-4 rounded-lg px-4 py-3 text-[12.5px] leading-[1.8] [&_b]:font-semibold">
          Run three gates before reviewing: <b>① Spam filter</b> gibberish,
          stray test input, inappropriate content → reject; <b>② Timeliness</b>{" "}
          time-sensitive questions (promo deadlines) expire as soon as they are
          filled — do not persist them → reject; <b>③ Frequency</b> rare, niche
          questions are not worth Knowledge Base space or human time → reject.
          What remains is a real gap: fill in the approved answer and click
          Approve.
        </div>

        {this.loadError ? (
          <MissingBox class="mt-4">Failed to load: {this.loadError}</MissingBox>
        ) : !this.data ? (
          <PageLoading />
        ) : !this.data.items.length ? (
          <MissingBox class="mt-4">No items in this status yet</MissingBox>
        ) : (
          <div class="mt-4 flex flex-col gap-3.5">
            {this.data.items.map((it) => {
              const open = this.openId === it.id;
              const detail = this.details[it.id];
              return (
                <div
                  ref={(el: Element | undefined) => {
                    enterOnce(el, { y: 8, duration: 0.35 });
                  }}
                  class="bg-card shadow-e1 overflow-hidden rounded-lg"
                >
                  <div
                    class="hover:bg-on-surface/4 flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-150"
                    onClick={() => {
                      void this.toggleDetail(it.id);
                    }}
                  >
                    <span
                      title="Occurrence count (accumulated by dedupe merging); the higher it is, the sooner this should be filled"
                      class={cn(
                        "text-label-small rounded-full px-2.5 py-0.5 whitespace-nowrap",
                        it.occurrence_count >= 3
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container-high text-on-surface-variant",
                      )}
                    >
                      ×{it.occurrence_count}
                    </span>
                    <div class="min-w-60 flex-1 text-[14.5px] font-medium">
                      {it.normalized_question}
                    </div>
                    <div class="text-on-surface-variant hidden max-w-80 truncate text-xs lg:block">
                      {it.ai_suggested_answer ?? "(no suggested answer)"}
                    </div>
                    <span
                      class={cn(
                        "text-label-small rounded-full px-2.5 py-0.5 whitespace-nowrap",
                        ST_CLS[it.review_status] ??
                          "bg-surface-container-high text-on-surface-variant",
                      )}
                    >
                      {ST_LABEL[it.review_status] ?? it.review_status}
                    </span>
                    {it.review_status === "pending_review" ? (
                      <div
                        class="flex gap-2"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation();
                        }}
                      >
                        <Btn
                          size="sm"
                          variant="ok"
                          onClick={() => {
                            this.approving = it;
                          }}
                        >
                          Approve
                        </Btn>
                        <Btn
                          size="sm"
                          variant="no"
                          disabled={this.rejecting === it.id}
                          onClick={() => {
                            void this.doReject(it);
                          }}
                        >
                          {this.rejecting === it.id ? "Rejecting…" : "Reject"}
                        </Btn>
                      </div>
                    ) : null}
                  </div>
                  {open ? (
                    <div
                      ref={this.detailRef}
                      class="border-outline-variant overflow-hidden border-t"
                    >
                      <div class="bg-surface-container-low px-4 py-3.5">
                        {this.loadingId === it.id && !detail ? (
                          <div class="text-on-surface-variant text-xs">
                            Loading details…
                          </div>
                        ) : this.detailErr[it.id] ? (
                          <div class="text-error text-xs">
                            Failed to load details: {this.detailErr[it.id]}
                          </div>
                        ) : detail ? (
                          <>
                            <div class="text-on-surface-variant mb-2.5 text-xs">
                              Judge from the snapshots: is the Knowledge Base
                              truly missing this, or does it have the answer but
                              fail to recall it? Merged original questions:{" "}
                              {detail.raws.length} ↓
                            </div>
                            {detail.raws.length ? (
                              detail.raws.map((r) => (
                                <div class="bg-card shadow-e1 mb-3 rounded-md p-2.5 last:mb-0">
                                  <div class="mb-1.5 flex flex-wrap items-center gap-2">
                                    <span
                                      class={cn(
                                        "text-label-small rounded-full px-2.5 py-0.5",
                                        SRC_CLS[r.source] ??
                                          "bg-surface-container-high text-on-surface-variant",
                                      )}
                                    >
                                      {SRC_LABEL[r.source] ?? r.source}
                                    </span>
                                    <span class="text-on-surface-variant text-[11.5px]">
                                      {(r.created_at ?? "")
                                        .replace("T", " ")
                                        .slice(0, 16)}
                                    </span>
                                  </div>
                                  <div class="mb-2 text-[13.5px]">
                                    “{r.raw_question}”
                                  </div>
                                  {Snapshots({ chunks: r.retrieved_chunks })}
                                </div>
                              ))
                            ) : (
                              <div class="border-outline-variant text-on-surface-variant rounded-md border border-dashed px-2.5 py-1.5 text-xs">
                                No merged originals yet (backfilled after the
                                flywheel batch runs)
                              </div>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <approve-dialog
          open={this.approving !== null}
          item={this.approving}
          onClose={() => {
            this.approving = null;
          }}
          onApproved={() => {
            this.approving = null;
            void this.reload();
          }}
        ></approve-dialog>
      </PageShell>
    );
  }
}
