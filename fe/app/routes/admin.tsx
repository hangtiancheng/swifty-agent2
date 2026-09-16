import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/admin";

import { Btn, BtnLink, MissingBox, PageShell, Pill, Tip, type PillTone } from "~/components/ui";
import { api, errMsg } from "~/lib/api";


interface AdminMetric {
  label: string;
  value: string | number | null;
}

interface AdminModule {
  key: string;
  title: string;
  page: string;
  lede: string;
  status: string; // ok | attention | missing | error
  headline: string;
  metrics: AdminMetric[];
  note: string | null;
}

type LoaderData =
  | { ok: true; modules: AdminModule[] }
  | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    const d = await api<{ modules: AdminModule[] }>("/api/admin/overview");
    return { ok: true, modules: d.modules };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "喵喵优选 · 后台管理" },
    {
      name: "description",
      content: "知识库、检索评估、飞轮、分类器,几块后台都在这里",
    },
  ];
}

const STATUS_LABEL: Record<string, string> = {
  ok: "正常",
  attention: "要干活",
  missing: "没数据",
  error: "读数失败",
};
const STATUS_TONE: Record<string, PillTone> = {
  ok: "pass",
  attention: "running",
  missing: "missing",
  error: "fail",
};

function ModuleCard({ m, i }: { m: AdminModule; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.22 }}
      className="flex flex-col border-4 border-ink bg-cream p-3.5 shadow-hard"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold">{m.title}</h3>
        <span className="flex-1" />
        <Pill tone={STATUS_TONE[m.status] ?? "plain"}>
          {STATUS_LABEL[m.status] ?? m.status}
        </Pill>
      </div>
      <p className="mt-1.5 text-xs leading-6 text-ink-soft">{m.lede}</p>
      <div className="mt-2.5 border-2 border-ink bg-paper px-2.5 py-1.5 text-[13px] leading-6">
        {m.headline}
      </div>
      {m.metrics.length ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {m.metrics.map((k) => (
            <div
              key={k.label}
              className="min-w-19 border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px]"
            >
              <b className="block text-[17px] leading-snug">
                {k.value === null || k.value === undefined ? "—" : k.value}
              </b>
              {k.label}
            </div>
          ))}
        </div>
      ) : null}
      {m.note ? (
        <div className="mt-2 text-[11.5px] leading-6 text-ink-soft">
          {m.note}
        </div>
      ) : null}
      <div className="mt-auto pt-3">
        <BtnLink to={m.page} variant="go" size="sm">
          进入 {m.title} →
        </BtnLink>
      </div>
    </motion.div>
  );
}

export default function AdminPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();
  return (
    <PageShell
      title="后台管理"
      sub="知识库、检索评估、飞轮、分类器,几块后台都在这里,不用回终端"
      active="/admin"
      actions={
        <Btn
          onClick={() => { void revalidate(); }}
          disabled={state === "loading"}
        >
          <RefreshCw
            className={state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            aria-hidden
          />
          刷新
        </Btn>
      }
    >
      <Tip>
        口径:<b>正常</b>这块是活的且没有待办;<b>要干活</b>
        有待办或两边数对不上;<b>没数据</b>还没跑过,进去按一下就有;
        <b>读数失败</b>这块的依赖没起(mysql / Milvus / 嵌入上游 / 分类器
        :8110),只影响它自己那张卡。
      </Tip>
      {loaderData.ok ? (
        <div className="mt-4 grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
          {loaderData.modules.map((m, i) => (
            <ModuleCard key={m.key} m={m} i={i} />
          ))}
        </div>
      ) : (
        <MissingBox className="mt-4">
          取数失败:{loaderData.error}
        </MissingBox>
      )}
    </PageShell>
  );
}
