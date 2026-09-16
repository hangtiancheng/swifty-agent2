import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/admin";

import {
  Btn,
  BtnLink,
  MissingBox,
  PageShell,
  Pill,
  Tip,
  type PillTone,
} from "~/components/ui";
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
  { ok: true; modules: AdminModule[] } | { ok: false; error: string };

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
    { title: "MeowMeow Select · Admin Console" },
    {
      name: "description",
      content:
        "Knowledge Base, retrieval evals, flywheel, classifier — every backend module in one place",
    },
  ];
}

const STATUS_LABEL: Record<string, string> = {
  ok: "Healthy",
  attention: "Needs work",
  missing: "No data",
  error: "Read failed",
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
      className="border-ink bg-cream shadow-hard flex flex-col border-4 p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold">{m.title}</h3>
        <span className="flex-1" />
        <Pill tone={STATUS_TONE[m.status] ?? "plain"}>
          {STATUS_LABEL[m.status] ?? m.status}
        </Pill>
      </div>
      <p className="text-ink-soft mt-1.5 text-xs leading-6">{m.lede}</p>
      <div className="border-ink bg-paper mt-2.5 border-2 px-2.5 py-1.5 text-[13px] leading-6">
        {m.headline}
      </div>
      {m.metrics.length ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {m.metrics.map((k) => (
            <div
              key={k.label}
              className="border-ink bg-paper min-w-19 border-2 px-2.5 py-1 text-[11.5px]"
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
        <div className="text-ink-soft mt-2 text-[11.5px] leading-6">
          {m.note}
        </div>
      ) : null}
      <div className="mt-auto pt-3">
        <BtnLink to={m.page} variant="go" size="sm">
          Open {m.title} →
        </BtnLink>
      </div>
    </motion.div>
  );
}

export default function AdminPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();
  return (
    <PageShell
      title="Admin Console"
      sub="Knowledge Base, retrieval evals, flywheel, classifier — every backend module in one place, no terminal needed"
      active="/admin"
      actions={
        <Btn
          onClick={() => {
            void revalidate();
          }}
          disabled={state === "loading"}
        >
          <RefreshCw
            className={state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            aria-hidden
          />
          Refresh
        </Btn>
      }
    >
      <Tip>
        How to read statuses: <b>Healthy</b> — the module is live with nothing
        pending; <b>Needs work</b> — something is pending or the two sides
        disagree; <b>No data</b> — never run yet; open it and press once;{" "}
        <b>Read failed</b> — a dependency of that module is down (mysql / Milvus
        / embedding upstream / classifier :8110); only its own card is affected.
      </Tip>
      {loaderData.ok ? (
        <div className="mt-4 grid [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-3.5">
          {loaderData.modules.map((m, i) => (
            <ModuleCard key={m.key} m={m} i={i} />
          ))}
        </div>
      ) : (
        <MissingBox className="mt-4">
          Failed to load data: {loaderData.error}
        </MissingBox>
      )}
    </PageShell>
  );
}
