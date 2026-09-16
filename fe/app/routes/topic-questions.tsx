import { RefreshCw } from "lucide-react";
import { useRevalidator, useSearchParams, Link } from "react-router";

import type { Route } from "./+types/topic-questions";
import type { TopicDistribution } from "./topics";

import { Btn, BtnLink, MissingBox, PageShell, Pill } from "~/components/ui";
import { api, errMsg } from "~/lib/api";
import { cn } from "~/lib/cn";
import { fmtTime } from "~/lib/format";



/* 类目与页码都在地址栏里(?label=…&page=…):这一页是可以贴给别人的链接,
   翻页也走地址栏,刷新回到同一页。数据全来自 /api/topics/questions,不在前端筛。 */

const SIZE = 10;
const SOURCE_LABEL: Record<string, string> = {
  retrieval_low_conf: "检索置信度低",
  self_check: "生成自评不够答",
  user_feedback: "用户反馈没解决",
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
  // 类目选择条独立容错:分布拉不到只是没有选择条,不影响本页列表
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
  return [{ title: "喵喵优选 · 类目问题列表" }];
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
          来源{" "}
          <b className="text-ink">
            {SOURCE_LABEL[it.source] ?? it.source}
          </b>
        </span>
        <span>
          同义合并{" "}
          <b className="text-ink">
            {it.occurrence_count
              ? String(it.occurrence_count) + " 条原话"
              : "未归并"}
          </b>
        </span>
        <span>
          审核 <b className="text-ink">{it.review_status ?? "未入队列"}</b>
        </span>
        <span>
          归类于{" "}
          <b className="text-ink">{fmtTime(it.classified_at).slice(5, 16)}</b>
        </span>
      </div>
      {/* 归并过的问题,页面上显示的是标准化问法;把用户原话也带一句,免得看不出这条从哪来 */}
      {it.normalized && it.raw_question && it.raw_question !== it.text ? (
        <div className="mt-1.5 text-xs leading-6 text-ink-soft">
          <span className="block text-[10.5px] text-muted">用户原话</span>
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
      title={loaderData.kind === "ok" ? loaderData.label : "类目问题列表"}
      sub={
        loaderData.kind === "ok"
          ? "分类器归到「" +
            loaderData.label +
            "」的问题,共 " +
            String(loaderData.d.total) +
            " 条"
          : "分类器归到这一类的问题,分页看全"
      }
      active="/topics"
      maxW="max-w-[1080px]"
      actions={
        <>
          <BtnLink to="/topics">← 回主题分布</BtnLink>
          <Btn onClick={() => { void revalidate(); }} disabled={state === "loading"}>
            <RefreshCw
              className={
                state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"
              }
              aria-hidden
            />
            刷新
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
          没指定类目。回主题分布页,点某一类的名字进来。
        </MissingBox>
      ) : loaderData.kind === "error" ? (
        <MissingBox className="mt-4">取数失败:{loaderData.error}</MissingBox>
      ) : loaderData.d.total === 0 ? (
        <MissingBox className="mt-4">
          这一类还没有归类到的问题。换个类目,或先跑一次旁路批量归类。
        </MissingBox>
      ) : (
        <div className="mt-4 border-4 border-ink bg-cream p-3.5 shadow-hard sm:p-4">
          <h2 className="flex flex-wrap items-center gap-2.5 text-sm font-bold">
            {loaderData.d.label}
            <Pill tone="info">
              {loaderData.d.total} 条 · 第 {loaderData.d.page}/
              {loaderData.d.pages} 页
            </Pill>
          </h2>
          <p className="mt-1 mb-1 text-[12.5px] leading-7 text-ink-soft">
            列的是分类器归到这一类的问题,多标签的问题会同时出现在它命中的每个类目下。
            问法取归并阶段产出的标准化问句,原话在下面一行。
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
              ← 上一页
            </Btn>
            <Btn
              size="sm"
              disabled={loaderData.d.page >= loaderData.d.pages}
              onClick={() => { go(loaderData.d.label, loaderData.d.page + 1); }}
            >
              下一页 →
            </Btn>
            <span className="text-[12.5px]">
              第 <b className="tabular-nums">{loaderData.d.page}</b> /{" "}
              {loaderData.d.pages} 页 · 本类共{" "}
              <b className="tabular-nums">{loaderData.d.total}</b> 条 · 每页{" "}
              {loaderData.d.size} 条
            </span>
          </div>
        </div>
      )}
    </PageShell>
  );
}
