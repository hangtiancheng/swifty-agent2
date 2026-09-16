import { RefreshCw } from "lucide-react";
import { useRevalidator, useSearchParams, Link } from "react-router";

import type { Route } from "./+types/topic-questions";
import type { TopicDistribution } from "./topics";

import { Btn, BtnLink, MissingBox, PageShell, Pill } from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtTime } from "~/lib/format";



/* Class and page live in the URL (?label=…&page=…): this page is a shareable
   link, paging goes through the URL, and a refresh lands back on the same
   page. All data comes from /api/topics/questions — nothing is filtered
   client-side. */

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

type LoaderData =
  | { kind: "nolabel" }
  | { kind: "ok"; label: string; page: number; d: QuestionsPage; dist: TopicDistribution | null }
  | { kind: "error"; label: string; error: string; dist: TopicDistribution | null };

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const label = url.searchParams.get("label") ?? "";
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );
  if (!label) {
    return { kind: "nolabel" };
  }
  // The class picker fails independently: if the distribution fetch fails, only the picker is missing — this page's list is unaffected
  const dist = await api<TopicDistribution>("/api/topics/distribution").catch(
    () => null,
  );
  try {
    const d = await api<QuestionsPage>(
      "/api/topics/questions?label=" +
        encodeURIComponent(label) +
        "&page=" +
        String(page) +
        "&size=" +
        String(SIZE),
    );
    return { kind: "ok", label, page, d, dist };
  } catch (e) {
    return { kind: "error", label, error: errMsg(e), dist };
  }
}

export function meta() {
  return [{ title: "MeowMeow Select · Topic Questions" }];
}

function QuestionRow({ it, label }: { it: QuestionItem; label: string }) {
  return (
    <div className="mt-2.5 border-3 border-ink bg-paper p-3 shadow-hard-sm">
      <div className="text-[13.5px] leading-6 font-bold">
        <span className="mr-1.5 text-[11px] font-normal text-muted">
          #{it.question_id}
        </span>
        {it.text}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11.5px] text-ink-soft">
        {(it.labels ?? []).map((lb) => (
          <span
            key={lb}
            className={cn(
              "border-2 border-ink bg-cream px-1 text-[11px]",
              lb === label && "bg-fur font-bold",
            )}
          >
            {lb}
          </span>
        ))}
        <span>
          Source{" "}
          <b className="text-ink">
            {SOURCE_LABEL[it.source] ?? it.source}
          </b>
        </span>
        <span>
          Synonym merge{" "}
          <b className="text-ink">
            {it.occurrence_count
              ? String(it.occurrence_count) + " originals"
              : "not merged"}
          </b>
        </span>
        <span>
          Review{" "}
          <b className="text-ink">
            {it.review_status
              ? (REVIEW_LABEL[it.review_status] ?? it.review_status)
              : "Not queued"}
          </b>
        </span>
        <span>
          Classified at{" "}
          <b className="text-ink">{fmtTime(it.classified_at).slice(5, 16)}</b>
        </span>
      </div>
      {/* Merged questions show the normalized phrasing; keep the user's original wording visible so the entry's origin stays clear */}
      {it.normalized && it.raw_question && it.raw_question !== it.text ? (
        <div className="mt-1.5 text-xs leading-6 text-ink-soft">
          <span className="block text-[10.5px] text-muted">Original wording</span>
          {it.raw_question}
        </div>
      ) : null}
    </div>
  );
}

export default function TopicQuestionsPage({
  loaderData,
}: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();
  const [params, setParams] = useSearchParams();
  const label = params.get("label") ?? "";

  const go = (nextLabel: string, page: number) => {
    const q = new URLSearchParams({ label: nextLabel, page: String(page) });
    setParams(q);
  };

  const dist = loaderData.kind === "nolabel" ? null : loaderData.dist;

  return (
    <PageShell
      title={loaderData.kind === "ok" ? loaderData.label : "Topic Questions"}
      sub={
        loaderData.kind === "ok"
          ? "Questions the classifier grouped under “" +
            loaderData.label +
            "” — " +
            String(loaderData.d.total) +
            " in total"
          : "Questions the classifier grouped under this class, paginated"
      }
      active="/topics"
      maxW="max-w-[1080px]"
      actions={
        <>
          <BtnLink to="/topics">← Back to Topic Distribution</BtnLink>
          <Btn onClick={() => { void revalidate(); }} disabled={state === "loading"}>
            <RefreshCw
              className={
                state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"
              }
              aria-hidden
            />
            Refresh
          </Btn>
        </>
      }
    >
      {dist ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[...dist.classes]
            .sort((a, b) => b.count - a.count)
            .map((c) => (
              <Link
                key={c.label}
                to={
                  "/topics/questions?label=" +
                  encodeURIComponent(c.label) +
                  "&page=1"
                }
                className={cn(
                  "border-3 border-ink bg-paper px-2.5 py-1 text-xs no-underline shadow-hard-xs hover:bg-fur-hover",
                  c.label === label && "bg-fur font-bold",
                  c.count === 0 && "opacity-45",
                )}
              >
                {c.label}
                <span
                  className={cn(
                    "ml-1.5 text-muted",
                    c.label === label && "text-ink",
                  )}
                >
                  {c.count}
                </span>
              </Link>
            ))}
        </div>
      ) : null}

      {loaderData.kind === "nolabel" ? (
        <MissingBox className="mt-4">
          No class specified. Go back to Topic Distribution and click a class
          name to get here.
        </MissingBox>
      ) : loaderData.kind === "error" ? (
        <MissingBox className="mt-4">Failed to load data: {loaderData.error}</MissingBox>
      ) : loaderData.d.total === 0 ? (
        <MissingBox className="mt-4">
          No questions have been classified into this class yet. Try another
          class, or run the bypass batch classification first.
        </MissingBox>
      ) : (
        <div className="mt-4 border-4 border-ink bg-cream p-3.5 shadow-hard sm:p-4">
          <h2 className="flex flex-wrap items-center gap-2.5 text-sm font-bold">
            {loaderData.d.label}
            <Pill tone="info">
              {loaderData.d.total} questions · page {loaderData.d.page}/
              {loaderData.d.pages}
            </Pill>
          </h2>
          <p className="mt-1 mb-1 text-[12.5px] leading-7 text-ink-soft">
            Lists the questions the classifier grouped into this class;
            multi-label questions appear under every class they hit. The
            phrasing shown is the normalized question from the merge stage —
            the original wording is on the line below.
          </p>
          {loaderData.d.items.map((it) => (
            <QuestionRow key={it.question_id} it={it} label={loaderData.label} />
          ))}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Btn
              size="sm"
              disabled={loaderData.d.page <= 1}
              onClick={() => { go(loaderData.d.label, loaderData.d.page - 1); }}
            >
              ← Previous
            </Btn>
            <Btn
              size="sm"
              disabled={loaderData.d.page >= loaderData.d.pages}
              onClick={() => { go(loaderData.d.label, loaderData.d.page + 1); }}
            >
              Next →
            </Btn>
            <span className="text-[12.5px]">
              Page <b className="tabular-nums">{loaderData.d.page}</b> /{" "}
              {loaderData.d.pages} ·{" "}
              <b className="tabular-nums">{loaderData.d.total}</b> questions in
              this class · {loaderData.d.size} per page
            </span>
          </div>
        </div>
      )}
    </PageShell>
  );
}
