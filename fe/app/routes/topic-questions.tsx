import { customElement, property } from "@swifty.js/lit-jsx";

import type { TopicDistribution } from "./topics";

import {
  Btn,
  BtnLink,
  MissingBox,
  PageLoading,
  PageShell,
  Pill,
} from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtTime } from "~/lib/format";
import { DataLoaderElement } from "~/lib/page-element";
import { navigate } from "~/lib/router";

/* Class and page live in the URL (?label=…&page=…): this page is a shareable
   link, paging goes through the URL, and a refresh lands back on the same
   page. All data comes from /api/topics/questions — nothing is filtered
   client-side. The route render callback feeds location.search in as a
   property; a change re-runs the load. */

const SIZE = 10;
const SOURCE_LABEL: Record<string, string> = {
  retrieval_low_conf: "Low retrieval confidence",
  self_check: "Failed model self-check",
  user_feedback: "User reported unresolved",
};

// Display labels for backend review statuses (keys are contract strings)
const REVIEW_LABEL: Record<string, string> = {
  pending_review: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

interface QuestionItem {
  question_id: number;
  text: string;
  labels: string[];
  source: string;
  occurrence_count: number;
  review_status: string | null;
  classified_at: string | null;
  normalized: boolean;
  raw_question: string | null;
}

interface QuestionsPage {
  label: string;
  page: number;
  pages: number;
  total: number;
  size: number;
  items: QuestionItem[];
}

type PageData =
  | { kind: "nolabel"; dist: TopicDistribution | null }
  | {
      kind: "ok";
      label: string;
      d: QuestionsPage;
      dist: TopicDistribution | null;
    }
  | {
      kind: "error";
      label: string;
      error: string;
      dist: TopicDistribution | null;
    };

function QuestionRow({ it, label }: { it: QuestionItem; label: string }) {
  return (
    <div class="bg-card border-outline-variant shadow-e1 mt-2.5 rounded-lg border p-3">
      <div class="text-[13.5px] leading-6 font-medium">
        <span class="text-on-surface-variant mr-1.5 text-[11px] font-normal">
          #{it.question_id}
        </span>
        {it.text}
      </div>
      <div class="text-on-surface-variant mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11.5px]">
        {(it.labels ?? []).map((lb) => (
          <span
            class={cn(
              "text-label-small rounded-full px-2.5 py-0.5",
              lb === label
                ? "bg-primary-container text-on-primary-container font-medium"
                : "bg-surface-container-high text-on-surface-variant",
            )}
          >
            {lb}
          </span>
        ))}
        <span>
          Source{" "}
          <b class="text-on-surface font-medium">
            {SOURCE_LABEL[it.source] ?? it.source}
          </b>
        </span>
        <span>
          Synonym merge{" "}
          <b class="text-on-surface font-medium">
            {it.occurrence_count
              ? String(it.occurrence_count) + " originals"
              : "not merged"}
          </b>
        </span>
        <span>
          Review{" "}
          <b class="text-on-surface font-medium">
            {it.review_status
              ? (REVIEW_LABEL[it.review_status] ?? it.review_status)
              : "Not queued"}
          </b>
        </span>
        <span>
          Classified at{" "}
          <b class="text-on-surface font-medium">
            {fmtTime(it.classified_at).slice(5, 16)}
          </b>
        </span>
      </div>
      {/* Merged questions show the normalized phrasing; keep the user's original wording visible so the entry's origin stays clear */}
      {it.normalized && it.raw_question && it.raw_question !== it.text ? (
        <div class="text-on-surface-variant mt-1.5 text-xs leading-6">
          <span class="text-on-surface-variant block text-[10.5px]">
            Original wording
          </span>
          {it.raw_question}
        </div>
      ) : null}
    </div>
  );
}

@customElement("topic-questions-page")
export class TopicQuestionsPage extends DataLoaderElement<PageData> {
  /** Current location.search, fed in by the route render callback */
  @property() search = "";

  protected override pageTitle = "MeowMeow Select · Topic Questions";
  private searchReady = false;

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

  protected override async load(): Promise<PageData> {
    const url = new URLSearchParams(this.search);
    const label = url.get("label") ?? "";
    const page = Math.max(1, Number.parseInt(url.get("page") ?? "1", 10) || 1);
    // The class picker fails independently: if the distribution fetch fails, only the picker is missing
    const dist = await api<TopicDistribution>("/api/topics/distribution").catch(
      () => null,
    );
    if (!label) {
      return { kind: "nolabel", dist };
    }
    try {
      const d = await api<QuestionsPage>(
        "/api/topics/questions?label=" +
          encodeURIComponent(label) +
          "&page=" +
          String(page) +
          "&size=" +
          String(SIZE),
      );
      return { kind: "ok", label, d, dist };
    } catch (e) {
      return { kind: "error", label, error: errMsg(e), dist };
    }
  }

  private go(nextLabel: string, page: number): void {
    const q = new URLSearchParams({ label: nextLabel, page: String(page) });
    navigate("/topics/questions?" + q.toString());
  }

  protected override render() {
    const data = this.data;
    const dist = data?.dist ?? null;
    const label = data?.kind === "ok" ? data.d.label : "";
    return (
      <PageShell
        title={data?.kind === "ok" ? data.d.label : "Topic Questions"}
        sub={
          data?.kind === "ok"
            ? "Questions the classifier grouped under “" +
              data.d.label +
              "” — " +
              String(data.d.total) +
              " in total"
            : "Questions the classifier grouped under this class, paginated"
        }
        active="/topics"
        maxW="max-w-[1080px]"
        actions={
          <>
            <BtnLink to="/topics">← Back to Topic Distribution</BtnLink>
            {this.refreshBtn()}
          </>
        }
      >
        {dist ? (
          <div class="mt-3 flex flex-wrap gap-1.5">
            {[...dist.classes]
              .sort((a, b) => b.count - a.count)
              .map((c) => (
                <a
                  href={
                    "/topics/questions?label=" +
                    encodeURIComponent(c.label) +
                    "&page=1"
                  }
                  class={cn(
                    "shadow-e1 hover:shadow-e2 text-label-small cursor-pointer rounded-full px-3 py-1 no-underline transition-all duration-200 active:scale-[0.97]",
                    c.label === label
                      ? "bg-primary-container text-on-primary-container font-medium"
                      : "bg-card text-on-surface hover:bg-card-hover",
                    c.count === 0 && "opacity-45",
                  )}
                >
                  {c.label}
                  <span
                    class={cn(
                      "ml-1.5",
                      c.label === label
                        ? "text-on-primary-container"
                        : "text-on-surface-variant",
                    )}
                  >
                    {c.count}
                  </span>
                </a>
              ))}
          </div>
        ) : null}

        {!data ? (
          this.loadError ? (
            <MissingBox class="mt-4">
              Failed to load data: {this.loadError}
            </MissingBox>
          ) : (
            <PageLoading />
          )
        ) : data.kind === "nolabel" ? (
          <MissingBox class="mt-4">
            No class specified. Go back to Topic Distribution and click a class
            name to get here.
          </MissingBox>
        ) : data.kind === "error" ? (
          <MissingBox class="mt-4">
            Failed to load data: {data.error}
          </MissingBox>
        ) : data.d.total === 0 ? (
          <MissingBox class="mt-4">
            No questions have been classified into this class yet. Try another
            class, or run the bypass batch classification first.
          </MissingBox>
        ) : (
          <div class="bg-card shadow-e1 mt-4 rounded-lg p-3.5 sm:p-4">
            <h2 class="text-title-small flex flex-wrap items-center gap-2.5">
              {data.d.label}
              <Pill tone="info">
                {data.d.total} questions · page {data.d.page}/{data.d.pages}
              </Pill>
            </h2>
            <p class="text-on-surface-variant mt-1 mb-1 text-[12.5px] leading-7">
              Lists the questions the classifier grouped into this class;
              multi-label questions appear under every class they hit. The
              phrasing shown is the normalized question from the merge stage —
              the original wording is on the line below.
            </p>
            {data.d.items.map((it) => (
              <QuestionRow it={it} label={data.d.label} />
            ))}
            <div class="mt-4 flex flex-wrap items-center gap-2.5">
              <Btn
                size="sm"
                disabled={data.d.page <= 1}
                onClick={() => {
                  this.go(data.d.label, data.d.page - 1);
                }}
              >
                ← Previous
              </Btn>
              <Btn
                size="sm"
                disabled={data.d.page >= data.d.pages}
                onClick={() => {
                  this.go(data.d.label, data.d.page + 1);
                }}
              >
                Next →
              </Btn>
              <span class="text-[12.5px]">
                Page <b class="font-medium tabular-nums">{data.d.page}</b>/{" "}
                {data.d.pages} ·{" "}
                <b class="font-medium tabular-nums">{data.d.total}</b> questions
                in this class · {data.d.size} per page
              </span>
            </div>
          </div>
        )}
      </PageShell>
    );
  }
}
