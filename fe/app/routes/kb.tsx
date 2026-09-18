import { customElement, state } from "@swifty.js/lit-jsx";

import "~/components/job-row";
import { toast } from "~/components/toast";
import {
  Btn,
  GateBar,
  MissingBox,
  PageLoading,
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
import { Icon } from "~/lib/icons";
import { DataLoaderElement } from "~/lib/page-element";
import type { JobSpec } from "~/lib/types";

/* Knowledge Base entry: paste a document and it goes straight into the KB —
   chunking → dual-write to MySQL and Milvus → search self-test on the spot.
   The page reads the output of /api/kb/overview; re-runs go through the /api/jobs runner. */

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

const SAMPLE =
  "# Membership Benefits\n\n## Shipping & Free Shipping\n\nOrders of 99 yuan or more ship free; below that, a 10-yuan shipping fee is charged. Remote areas (Xinjiang, Tibet, Inner Mongolia) pay a 20-yuan fee and are excluded from free shipping.\n\n## Membership Tiers\n\n| Tier | Annual spend | Discount | Birthday gift |\n|---|---|---|---|\n| Regular | 0+ yuan | None | None |\n| Silver | 1,000+ yuan | 5% off | Coupon |\n| Gold | 5,000+ yuan | 10% off | Canned cat food gift box |\n";

const STAGING_LABEL: Record<StagingKey, string> = {
  kept: "Pending review (enters the KB only if approved)",
  extracted: "Extracted, awaiting dedup",
  discarded: "Discarded by dedup",
  approved: "Approved into the KB",
  rejected: "Rejected",
};
const STAGING_ORDER: StagingKey[] = ["kept", "extracted", "discarded", "approved", "rejected"];

const FIELD =
  "rounded-sm border border-outline bg-transparent px-3.5 py-2.5 text-body-medium text-on-surface outline-none transition-[border-color,box-shadow] duration-200 focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-on-surface-variant";

const ANSWER_CELL = "scroll-slim max-h-32 overflow-auto text-xs leading-7 whitespace-pre-wrap break-words";

@customElement("kb-page")
export class KbPage extends DataLoaderElement<KbOverview> {
  @state() private text = "";
  @state() private ctype = "";
  @state() private vecAfter = true;
  @state() private preview: KbPreview | null = null;
  @state() private previewing = false;
  @state() private ingesting = false;
  @state() private stagingRows: KbStagingRows | null = null;
  @state() private stagingLoading = false;
  @state() private vectorizing = false;
  @state() private q = "";
  @state() private strategy = "vector";
  @state() private topk = 5;
  @state() private hits: KbHit[] | null = null;
  @state() private hitStrategy = "";
  @state() private searching = false;

  protected override pageTitle = "MeowMeow Select · Knowledge Base Entry";

  protected override load(): Promise<KbOverview> {
    return api<KbOverview>("/api/kb/overview");
  }

  private async doPreview(payload: Record<string, unknown>): Promise<void> {
    this.previewing = true;
    this.preview = null;
    try {
      this.preview = await api<KbPreview>("/api/kb/preview", jsonPost(payload));
    } catch (e) {
      toast("Preview failed: " + errMsg(e), true);
    } finally {
      this.previewing = false;
    }
  }

  private async doIngest(): Promise<void> {
    const body = this.text.trim();
    if (!body) {
      toast("Paste some body text first", true);
      return;
    }
    const n = this.preview?.source === "manual entry" ? this.preview.total : null;
    if (
      !window.confirm(
        "Ingest this text into the Knowledge Base?" +
          (n
            ? "\nThe preview cut " +
              String(n) +
              " chunks" +
              (this.preview?.duplicates
                ? ", " + String(this.preview.duplicates) + " already in the KB will be skipped"
                : "")
            : "") +
          (this.vecAfter
            ? "\nVectorize right after ingest (calls the embedding upstream)"
            : "\nStore as pending only; vectorize later"),
      )
    ) {
      return;
    }
    this.ingesting = true;
    try {
      const ct = this.ctype || this.data?.content_types[0]?.key || "";
      const r = await api<{ inserted: number; skipped: number; vectorized: number | null }>(
        "/api/kb/ingest",
        jsonPost({ text: body, content_type: ct, vectorize: this.vecAfter }),
      );
      toast(
        "Ingested " +
          String(r.inserted) +
          " chunks" +
          (r.skipped ? ", skipped " + String(r.skipped) + " duplicates" : "") +
          (r.vectorized !== null ? ", vectorized " + String(r.vectorized) + " chunks" : "(not vectorized)"),
      );
      void this.reload();
      if (r.inserted) {
        void this.doPreview({ text: body, content_type: ct });
      }
    } catch (e) {
      toast("Ingest failed: " + errMsg(e), true);
    } finally {
      this.ingesting = false;
    }
  }

  private async loadStaging(): Promise<void> {
    this.stagingLoading = true;
    try {
      this.stagingRows = await api<KbStagingRows>("/api/kb/staging");
    } catch (e) {
      toast("Failed to load staging rows: " + errMsg(e), true);
    } finally {
      this.stagingLoading = false;
    }
  }

  /** Approve / reject: the only way mined knowledge enters the KB — writes knowledge_chunks on click */
  private async reviewAction(kind: "approve" | "reject", id: number): Promise<void> {
    try {
      const r = await api<{ approved?: number; rejected?: number }>(
        "/api/kb/staging/" + kind,
        jsonPost({ ids: [id] }),
      );
      toast(
        kind === "approve"
          ? "Approved " + String(r.approved ?? 0) + " rows into the KB"
          : "Rejected " + String(r.rejected ?? 0) + " rows",
      );
      await this.loadStaging(); // Refetch: this row moves from pending review to approved/rejected
      void this.reload();
    } catch (e) {
      toast((kind === "approve" ? "Approval" : "Rejection") + " failed: " + errMsg(e), true);
    }
  }

  private async doVectorize(): Promise<void> {
    this.vectorizing = true;
    try {
      const r = await api<{ vectorized: number; chunk_stats: { pending: number | null } }>(
        "/api/kb/vectorize",
        jsonPost(),
      );
      toast(
        "Vectorized " +
          String(r.vectorized) +
          " chunks this run, pending left: " +
          String(r.chunk_stats.pending ?? "—"),
      );
      void this.reload();
    } catch (e) {
      toast("Vectorization failed: " + errMsg(e), true);
    } finally {
      this.vectorizing = false;
    }
  }

  private async runSearch(query: string): Promise<void> {
    this.searching = true;
    this.hits = null;
    try {
      const r = await api<{ strategy: string; hits: KbHit[] }>(
        "/api/kb/search",
        jsonPost({
          q: query.trim() || "How much is postage?",
          strategy: this.strategy,
          top_k: this.topk,
        }),
      );
      this.hits = r.hits;
      this.hitStrategy = r.strategy;
    } catch (e) {
      toast("Search failed: " + errMsg(e), true);
    } finally {
      this.searching = false;
    }
  }

  protected override render() {
    if (this.loadError) {
      return (
        <PageShell title="Knowledge Base Entry" active="/kb">
          <MissingBox class="mt-4">Failed to load data: {this.loadError}</MissingBox>
        </PageShell>
      );
    }
    if (!this.data) {
      return (
        <PageShell title="Knowledge Base Entry" active="/kb">
          <PageLoading />
        </PageShell>
      );
    }
    const d = this.data;
    const jobSpecs = Object.fromEntries(d.jobs.map((j) => [j.name, j]));
    const pick = (names: string[]) => names.map((n) => jobSpecs[n]).filter((x): x is JobSpec => Boolean(x));
    const ct = this.ctype || d.content_types[0]?.key || "";
    const ctDesc = d.content_types.find((x) => x.key === ct)?.desc ?? "";
    const c = d.chunks;
    const totalSources = d.sources.reduce((acc, s) => acc + (s.present ? (s.chunks ?? 0) : 0), 0);

    return (
      <PageShell
        title="Knowledge Base Entry"
        sub="Paste a document to ingest it: chunking → dual-write to MySQL and Milvus → search self-test on the spot"
        active="/kb"
        actions={this.refreshBtn()}
      >
        {/* Top gate bar */}
        <GateBar>
          <Stat label="Chunks (MySQL)" value={c.total ?? "—"} />
          <Stat label="Pending vectorization" value={c.pending ?? "—"} tone={c.pending ? "fail" : "pass"} />
          <Stat
            label="Milvus rows"
            value={d.milvus.online ? (d.milvus.count ?? "—") : "Offline"}
            tone={d.milvus.online ? undefined : "fail"}
          />
          <Stat label="Key clauses" value={c.key_clause ?? "—"} />
          <Stat
            label="Dual-write"
            value={d.consistent === null ? "Can't read" : d.consistent ? "Consistent" : "Mismatched"}
            tone={d.consistent === null ? undefined : d.consistent ? "pass" : "fail"}
          />
          {d.db_error ? <Stat label="MySQL" value={d.db_error} tone="fail" /> : null}
        </GateBar>

        <Tip>
          Two paths: <b>manual entry</b> — paste body text on this page and what you preview is exactly what gets
          ingested; <b>offline build</b> — hand the materials in data/kb/ to the make target, and the page button
          runs the same command you would type in the terminal. Both paths share one chunking logic and dual-write
          order — write to MySQL first as "pending", then into Milvus and mark "done"; if it dies mid-way, re-run
          to pick up the pending chunks and catch up.
        </Tip>

        {/* ① Manual entry */}
        <Panel
          title="① Manual entry"
          pill={<Pill tone="info">Paste body text here</Pill>}
          lede="Split by heading hierarchy, recursively split overlong chunks, trim cross-chunk overlap to the nearest sentence end, and split large tables row-wise with the header repeated — all four are flagged per chunk in the preview below. Dedup fingerprints the question + body, so re-ingesting the same text skips everything."
        >
          <div class="grid gap-2.5">
            <div class="flex flex-wrap items-center gap-2.5">
              <label class="text-[12.5px] font-medium" htmlFor="ctype">
                Content type
              </label>
              <select
                id="ctype"
                class={FIELD}
                value={ct}
                onChange={(e: Event) => {
                  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                  this.ctype = (e.target as HTMLSelectElement).value;
                }}
              >
                {d.content_types.map((t) => (
                  <option value={t.key}>{t.key}</option>
                ))}
              </select>
              <span class="text-on-surface-variant text-[11.5px]">{ctDesc}</span>
              <span class="flex-1" />
              <Btn
                size="sm"
                onClick={() => {
                  this.text = SAMPLE;
                }}
              >
                Fill in a sample
              </Btn>
              <Btn
                size="sm"
                onClick={() => {
                  this.text = "";
                  this.preview = null;
                }}
              >
                Clear
              </Btn>
            </div>
            <textarea
              class={cn(FIELD, "min-h-44 w-full resize-y leading-7")}
              placeholder="Paste Markdown. It works best with # / ## heading levels — for policy manuals without natural questions, questions fall back to section titles and category to the parent path."
              value={this.text}
              onInput={(e: Event) => {
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                this.text = (e.target as HTMLTextAreaElement).value;
              }}
            />
            <div class="flex flex-wrap items-center gap-2.5">
              <Btn
                variant="go"
                disabled={this.previewing}
                onClick={() => {
                  void this.doPreview({ text: this.text, content_type: ct });
                }}
              >
                {this.previewing ? "Chunking…" : "Chunk preview (no writes)"}
              </Btn>
              <Btn
                disabled={this.ingesting}
                onClick={() => {
                  void this.doIngest();
                }}
              >
                {this.ingesting ? "Ingesting…" : "Ingest into KB"}
              </Btn>
              <label class="flex cursor-pointer items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  class="accent-primary h-4 w-4"
                  checked={this.vecAfter}
                  onChange={(e: Event) => {
                    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                    this.vecAfter = (e.target as HTMLInputElement).checked;
                  }}
                />
                Vectorize right after ingest
              </label>
            </div>
          </div>

          {this.preview ? (
            <div class="mt-3">
              <div class="flex flex-wrap gap-2">
                <Pill tone="info">Source: {this.preview.source}</Pill>
                <Pill tone="info">
                  Total: {this.preview.total} chunks / {this.preview.features.sections} sections
                </Pill>
                <Pill tone={this.preview.features.table_split ? "pass" : "missing"}>
                  {this.preview.features.table_split
                    ? "Table row-split triggered"
                    : "Table row-split not triggered"}
                </Pill>
                <Pill tone={this.preview.features.overlap ? "pass" : "missing"}>
                  {this.preview.features.overlap
                    ? "Sentence-end overlap triggered"
                    : "Sentence-end overlap not triggered (no section over 400 chars)"}
                </Pill>
                <Pill tone={this.preview.key_clause ? "pass" : "missing"}>
                  Key clauses: {this.preview.key_clause} chunks
                </Pill>
                {this.preview.dedup_known ? (
                  <Pill tone={this.preview.duplicates ? "fail" : "pass"}>
                    {this.preview.duplicates
                      ? "Already in the KB: " + String(this.preview.duplicates) + " chunks — they will be skipped on ingest"
                      : "No duplicates, safe to ingest"}
                  </Pill>
                ) : (
                  <Pill tone="missing">Dedup unknown (MySQL can't be read)</Pill>
                )}
              </div>
              <TableScroll class="mt-3">
                <Tbl>
                  <thead>
                    <tr>
                      <Th>#</Th>
                      <Th>Section (section_path)</Th>
                      <Th>Questions</Th>
                      <Th>Body (answer)</Th>
                      <Th>Chars</Th>
                      <Th>Flags</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {this.preview.chunks.map((ch) => (
                      <Tr bad={ch.duplicate}>
                        <Td num>{ch.seq}</Td>
                        <Td>{ch.section_path}</Td>
                        <Td>{ch.questions}</Td>
                        <Td>
                          <div class={ANSWER_CELL}>{ch.answer}</div>
                        </Td>
                        <Td num>{ch.chars}</Td>
                        <Td class="whitespace-nowrap">
                          {ch.is_key_clause ? (
                            <Pill tone="fail" class="mr-1">
                              Key clause
                            </Pill>
                          ) : null}
                          {ch.is_table ? (
                            <Pill tone="info" class="mr-1">
                              Table chunk
                            </Pill>
                          ) : null}
                          {ch.duplicate ? <Pill tone="missing">Duplicate</Pill> : null}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Tbl>
              </TableScroll>
            </div>
          ) : null}
        </Panel>

        {/* ② Build materials */}
        <Panel
          title="② Build materials"
          pill={
            <Pill tone="info">
              {d.sources.length} files / {totalSources} chunks in total
            </Pill>
          }
          lede="Documents under data/kb/ are the inputs of the offline build. The chunk counts here are cut on the spot (dry run — no DB writes, no Milvus, no upstream calls); click “View chunks” to send the result to the preview area above and inspect it chunk by chunk."
        >
          <TableScroll>
            <Tbl>
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Type</Th>
                  <Th>Chars</Th>
                  <Th>Lines</Th>
                  <Th>Chunks</Th>
                  <Th>Key clauses</Th>
                  <Th>Features</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {d.sources.map((s) => (
                  <Tr bad={!s.present}>
                    <Td>{s.path}</Td>
                    <Td>{s.content_type}</Td>
                    {!s.present ? (
                      <Td colSpan={6}>File missing</Td>
                    ) : (
                      <>
                        <Td num>{s.chars}</Td>
                        <Td num>{s.lines}</Td>
                        <Td num>{s.chunks}</Td>
                        <Td num>{s.key_clause}</Td>
                        <Td class="whitespace-nowrap">
                          {s.features?.table_split ? (
                            <Pill tone="info" class="mr-1">
                              Table split
                            </Pill>
                          ) : null}
                          {s.features?.overlap ? (
                            <Pill tone="info" class="mr-1">
                              Overlap
                            </Pill>
                          ) : null}
                          <Pill tone="missing">{s.features?.sections ?? 0} sections</Pill>
                        </Td>
                        <Td>
                          <Btn
                            size="sm"
                            onClick={() => {
                              void this.doPreview({ file: s.file });
                            }}
                          >
                            View chunks
                          </Btn>
                        </Td>
                      </>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Tbl>
          </TableScroll>
          <job-row
            specs={pick(["kb-preview", "kb-build", "kb-repatch"])}
            onFinish={() => {
              void this.reload();
            }}
            note="kb-build has an idempotency guard: chunks of the same type that already exist are skipped; after editing an md file use kb-repatch to patch it in place, and remember to vectorize afterwards"
          ></job-row>
        </Panel>

        {/* ③ Conversation mining */}
        <Panel
          title="③ Conversation mining"
          pill={
            <Pill tone="info">
              {d.staging
                ? d.staging.total
                  ? "Total " + String(d.staging.total) + " rows, latest batch " + (d.staging.latest_batch ?? "—")
                  : "Nothing mined yet"
                : "Can't read"}
            </Pill>
          }
          lede="Historical support conversations are fed to the LLM in batches to extract QA pairs, which land in the staging table first and are then deduplicated and ingested as a whole. The gap between the three counts is the dedup pass: how many were extracted, kept, and discarded."
        >
          {d.staging ? (
            <div class="flex flex-wrap gap-2">
              {[
                { label: "Extracted, awaiting dedup", v: d.staging.counts.extracted },
                { label: "Kept after dedup (in KB)", v: d.staging.counts.kept },
                { label: "Discarded by dedup", v: d.staging.counts.discarded },
                { label: "Batches", v: d.staging.batches },
              ].map(({ label, v }) => (
                <div class="bg-surface-container-high text-on-surface-variant min-w-21 rounded-md px-2.5 py-1 text-[11.5px]">
                  <b class="text-on-surface block text-[17px] leading-snug font-medium tabular-nums">{v}</b>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <MissingBox>MySQL can't be read, so staging counts are unavailable</MissingBox>
          )}
          <job-row
            specs={pick(["seed-conv", "kb-mine"])}
            onFinish={() => {
              void this.reload();
            }}
            note="Mining calls the LLM and takes minutes"
          ></job-row>
          <div class="mt-3">
            <Btn
              size="sm"
              disabled={this.stagingLoading}
              onClick={() => {
                void this.loadStaging();
              }}
            >
              {this.stagingLoading ? "Loading…" : "Browse staging rows"}
            </Btn>
          </div>
          {this.stagingRows ? (
            <div class="mt-2">
              {STAGING_ORDER.map((st) => {
                const rows = this.stagingRows?.rows[st] ?? [];
                if (!rows.length) {
                  return null;
                }
                return (
                  <div>
                    <h3 class="mt-3.5 mb-1.5 text-[13px] font-medium">
                      {STAGING_LABEL[st]} ({rows.length} rows)
                    </h3>
                    {st === "kept" ? (
                      <p class="text-on-surface-variant mb-2 text-[12.5px] leading-6">
                        These were summarized by the model from historical conversations and quality varies. Review
                        each row before approving: anything that only applies to a single order, carries an order
                        number, or answers the wrong question should not enter the Knowledge Base.
                      </p>
                    ) : null}
                    <TableScroll>
                      <Tbl>
                        <thead>
                          <tr>
                            <Th>Batch</Th>
                            <Th>Source</Th>
                            <Th>Question</Th>
                            <Th>Answer</Th>
                            {st === "kept" ? <Th>Action</Th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <Tr>
                              <Td>{r.batch_no}</Td>
                              <Td>{r.source_ref ?? "—"}</Td>
                              <Td>{r.question}</Td>
                              <Td>
                                <div class={ANSWER_CELL}>{r.answer}</div>
                              </Td>
                              {st === "kept" ? (
                                <Td class="whitespace-nowrap">
                                  <Btn
                                    size="sm"
                                    variant="ok"
                                    class="mr-1.5"
                                    onClick={() => {
                                      void this.reviewAction("approve", r.id);
                                    }}
                                  >
                                    Approve
                                  </Btn>
                                  <Btn
                                    size="sm"
                                    variant="no"
                                    onClick={() => {
                                      void this.reviewAction("reject", r.id);
                                    }}
                                  >
                                    Reject
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
              {STAGING_ORDER.every((st) => (this.stagingRows?.rows[st] ?? []).length === 0) ? (
                <MissingBox>The staging table is empty — run conversation mining once first</MissingBox>
              ) : null}
            </div>
          ) : null}
        </Panel>

        {/* ④ Vectorization & dual-write */}
        <Panel
          title="④ Vectorization & dual-write"
          pill={
            d.consistent === null ? (
              <Pill tone="missing">Can't read, no conclusion</Pill>
            ) : d.consistent ? (
              <Pill tone="pass">Both sides match</Pill>
            ) : (
              <Pill tone="fail">Mismatched — fix it below</Pill>
            )
          }
          lede="MySQL is the authoritative source for the original text; Milvus stores vectors only. Idempotency relies on vectorize_status: rows are written to MySQL as pending, then after embedding they are upserted into Milvus by primary key and marked done. Interrupt a build on purpose, then press “Vectorize pending chunks” and the missed chunks get picked up — no need to replay this in the terminal."
        >
          <div class="flex flex-wrap gap-2">
            {[
              { label: "Pending", v: c.pending },
              { label: "Done (vectorized)", v: c.done },
              { label: "Milvus rows", v: d.milvus.online ? d.milvus.count : null },
              { label: "Collection", v: d.milvus.collection ?? "knowledge" },
            ].map(({ label, v }) => (
              <div class="bg-surface-container-high text-on-surface-variant min-w-21 rounded-md px-2.5 py-1 text-[11.5px]">
                <b class="text-on-surface block text-[17px] leading-snug font-medium tabular-nums">
                  {v === null || v === undefined ? "—" : String(v)}
                </b>
                {label}
              </div>
            ))}
          </div>
          <div class="mt-2.5 flex flex-wrap items-center gap-2">
            <Btn
              variant="go"
              disabled={this.vectorizing}
              onClick={() => {
                void this.doVectorize();
              }}
            >
              {this.vectorizing ? "Vectorizing…" : "Vectorize pending chunks"}
            </Btn>
            <span class="text-on-surface-variant text-[11.5px]">
              {d.milvus.online
                ? "Runs in-process — the same function as make kb-vectorize"
                : "Milvus offline: " + (d.milvus.detail ?? "")}
            </span>
          </div>
          <job-row
            specs={pick(["kb-vectorize", "kb-reset"])}
            onFinish={() => {
              void this.reload();
            }}
            note="Reset clears both tables and drops the collection; the KB must be rebuilt afterwards"
          ></job-row>
        </Panel>

        {/* ⑤ Search self-test */}
        <Panel
          title="⑤ Search self-test"
          pill={<Pill tone="info">Ask it another way</Pill>}
          lede="The question is vectorized, then Top-K results are fetched from Milvus by similarity. “How much is postage?” never appears verbatim in the KB — it matches because it is semantically close to the shipping-fee chunk, and literal lookup could never do that."
        >
          <div class="flex flex-wrap items-center gap-2.5">
            <input
              type="text"
              class={cn(FIELD, "min-w-55 flex-1")}
              placeholder="How much is postage?"
              value={this.q}
              onInput={(e: Event) => {
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                this.q = (e.target as HTMLInputElement).value;
              }}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  void this.runSearch(this.q);
                }
              }}
            />
            <label class="text-[12.5px] font-medium" htmlFor="strategy">
              Strategy
            </label>
            <select
              id="strategy"
              class={FIELD}
              value={this.strategy}
              onChange={(e: Event) => {
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                this.strategy = (e.target as HTMLSelectElement).value;
              }}
            >
              <option value="vector">Dense vector only (this chapter)</option>
              <option value="bm25">BM25 keyword</option>
              <option value="hybrid">Hybrid retrieval</option>
              <option value="hybrid_rerank">Hybrid + rerank</option>
            </select>
            <label class="text-[12.5px] font-medium" htmlFor="topk">
              Top-K
            </label>
            <input
              id="topk"
              type="number"
              min="1"
              max="20"
              class={cn(FIELD, "w-18")}
              value={String(this.topk)}
              onInput={(e: Event) => {
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                this.topk = Number((e.target as HTMLInputElement).value) || 5;
              }}
            />
            <Btn
              variant="go"
              disabled={this.searching}
              onClick={() => {
                void this.runSearch(this.q);
              }}
            >
              <Icon name="search" class="h-4 w-4" />
              {this.searching ? "Searching…" : "Search"}
            </Btn>
          </div>
          <div class="mt-2.5 flex flex-wrap gap-1.5">
            {[
              "How much is postage?",
              "How is shipping calculated?",
              "How soon will my order ship?",
              "Can I return expired cat food?",
            ].map((preset) => (
              <Btn
                size="sm"
                onClick={() => {
                  this.q = preset;
                  void this.runSearch(preset);
                }}
              >
                {preset}
              </Btn>
            ))}
          </div>
          {this.hits ? (
            <div class="mt-3">
              <div class="flex flex-wrap gap-2">
                <Pill tone="info">Strategy: {this.hitStrategy}</Pill>
                <Pill tone={this.hits.length ? "pass" : "fail"}>Retrieved {this.hits.length} chunks</Pill>
              </div>
              {this.hits.length ? (
                <div class="mt-2.5 grid gap-2.5">
                  {this.hits.map((h, i) => (
                    <div
                      class={cn(
                        "bg-card rounded-lg border px-3 py-2 text-[12.5px]",
                        i === 0 ? "border-primary shadow-e2" : "border-outline-variant",
                      )}
                    >
                      <div class="flex flex-wrap items-center gap-2">
                        <Pill tone={i === 0 ? "pass" : "info"}>#{i + 1}</Pill>
                        <span class="font-semibold">{h.question}</span>
                        <span class="flex-1" />
                        {h.score !== null && h.score !== undefined ? (
                          <Pill tone="info">score {Number(h.score).toFixed(4)}</Pill>
                        ) : null}
                        {h.rerank_score !== null && h.rerank_score !== undefined ? (
                          <Pill tone="info">rerank {Number(h.rerank_score).toFixed(4)}</Pill>
                        ) : null}
                      </div>
                      <div class="mt-1.5 leading-7 whitespace-pre-wrap">{h.answer}</div>
                      <div class="text-on-surface-variant mt-1.5 text-[11.5px]">
                        {[h.section_path ?? "—", h.content_type ?? "—", "id " + String(h.id ?? "—")].join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <MissingBox class="mt-2.5">
                  No hits at all: the KB may still be empty, or pending chunks have not been vectorized yet
                </MissingBox>
              )}
            </div>
          ) : null}
        </Panel>

        {/* ⑥ Recently ingested */}
        <Panel
          title="⑥ Recently ingested"
          lede="The latest 12 chunks in descending id order — see what ingested content looks like and how far each status has progressed."
        >
          <TableScroll>
            <Tbl>
              <thead>
                <tr>
                  <Th>id</Th>
                  <Th>Type</Th>
                  <Th>Section</Th>
                  <Th>Questions</Th>
                  <Th>Body (truncated)</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {d.recent.length ? (
                  d.recent.map((r) => (
                    <Tr bad={r.status === "pending"}>
                      <Td num>{r.id}</Td>
                      <Td>{r.content_type ?? "—"}</Td>
                      <Td>{r.section_path ?? "—"}</Td>
                      <Td>{r.questions}</Td>
                      <Td>
                        <div class={ANSWER_CELL}>{r.answer}</div>
                      </Td>
                      <Td class="whitespace-nowrap">
                        <Pill tone={r.status === "done" ? "pass" : "fail"} class="mr-1">
                          {r.status === "done" ? "Vectorized" : "Pending"}
                        </Pill>
                        {r.is_key_clause ? <Pill tone="fail">Key clause</Pill> : null}
                      </Td>
                    </Tr>
                  ))
                ) : (
                  <Tr>
                    <Td colSpan={6}>
                      No chunks in the KB yet. Paste some text above to ingest it, or run the offline build once.
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
}
