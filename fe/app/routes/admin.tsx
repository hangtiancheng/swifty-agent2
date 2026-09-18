import { customElement } from "@swifty.js/lit-jsx";

import { BtnLink, MissingBox, PageLoading, PageShell, Pill, Tip, type PillTone } from "~/components/ui";
import { api } from "~/lib/api";
import { enterOnce } from "~/lib/motion";
import { DataLoaderElement } from "~/lib/page-element";

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

interface Overview {
  modules: AdminModule[];
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
    <div
      ref={(el: Element | undefined) => {
        enterOnce(el, { y: 14, duration: 0.35, delay: Math.min(i * 0.05, 0.3) });
      }}
      class="bg-card shadow-e1 hover:shadow-e2 hover:-translate-y-0.5 flex flex-col rounded-lg p-4 transition-[box-shadow,transform] duration-200"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-title-small text-on-surface">{m.title}</h3>
        <span class="flex-1" />
        <Pill tone={STATUS_TONE[m.status] ?? "plain"}>{STATUS_LABEL[m.status] ?? m.status}</Pill>
      </div>
      <p class="text-on-surface-variant text-body-small mt-1.5 leading-6">{m.lede}</p>
      <div class="bg-surface-container-low text-on-surface mt-2.5 rounded-md px-3 py-2 text-[13px] leading-6">
        {m.headline}
      </div>
      {m.metrics.length ? (
        <div class="mt-2.5 flex flex-wrap gap-2">
          {m.metrics.map((k) => (
            <div class="bg-surface-container-high text-on-surface-variant text-label-small min-w-19 rounded-md px-2.5 py-1.5">
              <b class="text-title-medium text-on-surface block font-medium tabular-nums">
                {k.value === null || k.value === undefined ? "—" : k.value}
              </b>
              {k.label}
            </div>
          ))}
        </div>
      ) : null}
      {m.note ? <div class="text-on-surface-variant text-label-small mt-2 leading-5">{m.note}</div> : null}
      <div class="mt-auto pt-3">
        <BtnLink to={m.page} variant="go" size="sm">
          Open {m.title} →
        </BtnLink>
      </div>
    </div>
  );
}

@customElement("admin-page")
export class AdminPage extends DataLoaderElement<Overview> {
  protected override pageTitle = "MeowMeow Select · Admin Console";

  protected override load(): Promise<Overview> {
    return api<Overview>("/api/admin/overview");
  }

  protected override render() {
    return (
      <PageShell
        title="Admin Console"
        sub="Knowledge Base, retrieval evals, flywheel, classifier — every backend module in one place, no terminal needed"
        active="/admin"
        actions={this.refreshBtn()}
      >
        <Tip>
          How to read statuses: <b>Healthy</b> — the module is live with nothing pending; <b>Needs work</b> —
          something is pending or the two sides disagree; <b>No data</b> — never run yet; open it and press once;{" "}
          <b>Read failed</b> — a dependency of that module is down (mysql / Milvus / embedding upstream / classifier
          :8110); only its own card is affected.
        </Tip>
        {this.loadError ? (
          <MissingBox class="mt-4">Failed to load data: {this.loadError}</MissingBox>
        ) : this.data ? (
          <div class="mt-4 grid [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-3.5">
            {this.data.modules.map((m, i) => (
              <ModuleCard m={m} i={i} />
            ))}
          </div>
        ) : (
          <PageLoading />
        )}
      </PageShell>
    );
  }
}
