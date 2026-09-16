import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/kb";

import { JobRow } from "~/components/job-row";
import { useToast } from "~/components/toast";
import {
  Btn,
  GateBar,
  MissingBox,
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

type LoaderData = { ok: true; d: KbOverview } | { ok: false; error: string };

export async function clientLoader(): Promise<LoaderData> {
  try {
    return { ok: true, d: await api<KbOverview>("/api/kb/overview") };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function meta() {
  return [
    { title: "MeowMeow Select · Knowledge Base Entry" },
    { name: "description", content: "Paste a document to ingest it: chunking, dual-write, search self-test" },
  ];
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
const STAGING_ORDER: StagingKey[] = [
  "kept",
  "extracted",
  "discarded",
  "approved",
  "rejected",
];

const FIELD =
  "border-3 border-ink bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:bg-cream";

const ANSWER_CELL =
  "scroll-cat max-h-32 overflow-auto text-xs leading-7 whitespace-pre-wrap break-words";

export default function KbPage({ loaderData }: Route.ComponentProps) {
  const { revalidate, state } = useRevalidator();
  const toast = useToast();

  const [text, setText] = useState("");
  const [ctype, setCtype] = useState("");
  const [vecAfter, setVecAfter] = useState(true);
  const [preview, setPreview] = useState<KbPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [stagingRows, setStagingRows] = useState<KbStagingRows | null>(null);
  const [stagingLoading, setStagingLoading] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [q, setQ] = useState("");
  const [strategy, setStrategy] = useState("vector");
  const [topk, setTopk] = useState(5);
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [hitStrategy, setHitStrategy] = useState("");
  const [searching, setSearching] = useState(false);

  if (!loaderData.ok) {
    return (
      <PageShell title="Knowledge Base Entry" active="/kb">
        <MissingBox className="mt-4">Failed to load data: {loaderData.error}</MissingBox>
      </PageShell>
    );
  }
  const d = loaderData.d;
  const jobSpecs = Object.fromEntries(d.jobs.map((j) => [j.name, j]));
  const pick = (names: string[]) =>
    names.map((n) => jobSpecs[n]).filter((x): x is JobSpec => Boolean(x));
  const ct = ctype || d.content_types[0]?.key || "";
  const ctDesc = d.content_types.find((x) => x.key === ct)?.desc ?? "";

  const doPreview = async (payload: Record<string, unknown>) => {
    setPreviewing(true);
    setPreview(null);
    try {
      setPreview(await api<KbPreview>("/api/kb/preview", jsonPost(payload)));
    } catch (e) {
      toast("Preview failed: " + errMsg(e), true);
    } finally {
      setPreviewing(false);
    }
  };

  const doIngest = async () => {
    const body = text.trim();
    if (!body) {
      toast("Paste some body text first", true);
      return;
    }
    const n = preview?.source === "manual entry" ? preview.total : null;
    if (
      !window.confirm(
        "Ingest this text into the Knowledge Base?" +
          (n
            ? "\nThe preview cut " +
              String(n) +
              " chunks" +
              (preview?.duplicates
                ? ", " + String(preview.duplicates) + " already in the KB will be skipped"
                : "")
            : "") +
          (vecAfter
            ? "\nVectorize right after ingest (calls the embedding upstream)"
            : "\nStore as pending only; vectorize later"),
      )
    ) {
      return;
    }
    setIngesting(true);
    try {
      const r = await api<{
        inserted: number;
        skipped: number;
        vectorized: number | null;
      }>(
        "/api/kb/ingest",
        jsonPost({ text: body, content_type: ct, vectorize: vecAfter }),
      );
      toast(
        "Ingested " +
          String(r.inserted) +
          " chunks" +
          (r.skipped ? ", skipped " + String(r.skipped) + " duplicates" : "") +
          (r.vectorized !== null
            ? ", vectorized " + String(r.vectorized) + " chunks"
            : "(not vectorized)"),
      );
      void revalidate();
      if (r.inserted) {
        void doPreview({ text: body, content_type: ct });
      }
    } catch (e) {
      toast("Ingest failed: " + errMsg(e), true);
    } finally {
      setIngesting(false);
    }
  };

  const loadStaging = async () => {
    setStagingLoading(true);
    try {
      setStagingRows(await api<KbStagingRows>("/api/kb/staging"));
    } catch (e) {
      toast("Failed to load staging rows: " + errMsg(e), true);
    } finally {
      setStagingLoading(false);
    }
  };

  /** Approve / reject: the only way mined knowledge enters the KB — writes knowledge_chunks on click */
  const reviewAction = async (kind: "approve" | "reject", id: number) => {
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
      await loadStaging(); // Refetch: this row moves from pending review to approved/rejected
      void revalidate();
    } catch (e) {
      toast((kind === "approve" ? "Approval" : "Rejection") + " failed: " + errMsg(e), true);
    }
  };

  const doVectorize = async () => {
    setVectorizing(true);
    try {
      const r = await api<{
        vectorized: number;
        chunk_stats: { pending: number | null };
      }>("/api/kb/vectorize", jsonPost());
      toast(
        "Vectorized " +
          String(r.vectorized) +
          " chunks this run, pending left: " +
          String(r.chunk_stats.pending ?? "—"),
      );
      void revalidate();
    } catch (e) {
      toast("Vectorization failed: " + errMsg(e), true);
    } finally {
      setVectorizing(false);
    }
  };

  const runSearch = async (query: string) => {
    setSearching(true);
    setHits(null);
    try {
      const r = await api<{ strategy: string; hits: KbHit[] }>(
        "/api/kb/search",
        jsonPost({ q: query.trim() || "How much is postage?", strategy, top_k: topk }),
      );
      setHits(r.hits);
      setHitStrategy(r.strategy);
    } catch (e) {
      toast("Search failed: " + errMsg(e), true);
    } finally {
      setSearching(false);
    }
  };

  const c = d.chunks;
  const totalSources = d.sources.reduce(
    (acc, s) => acc + (s.present ? (s.chunks ?? 0) : 0),
    0,
  );

  return (
    <PageShell
      title="Knowledge Base Entry"
      sub="Paste a document to ingest it: chunking → dual-write to MySQL and Milvus → search self-test on the spot"
      active="/kb"
      actions={
        <Btn onClick={() => { void revalidate(); }} disabled={state === "loading"}>
          <RefreshCw
            className={state === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            aria-hidden
          />
          Refresh
        </Btn>
      }
    >
      {/* Top gate bar */}
      <GateBar>
        <Stat label="Chunks (MySQL)" value={c.total ?? "—"} />
        <Stat
          label="Pending vectorization"
          value={c.pending ?? "—"}
          tone={c.pending ? "fail" : "pass"}
        />
        <Stat
          label="Milvus rows"
          value={d.milvus.online ? (d.milvus.count ?? "—") : "Offline"}
          tone={d.milvus.online ? undefined : "fail"}
        />
        <Stat label="Key clauses" value={c.key_clause ?? "—"} />
        <Stat
          label="Dual-write"
          value={
            d.consistent === null ? "Can't read" : d.consistent ? "Consistent" : "Mismatched"
          }
          tone={
            d.consistent === null
              ? undefined
              : d.consistent
                ? "pass"
                : "fail"
          }
        />
        {d.db_error ? (
          <Stat label="MySQL" value={d.db_error} tone="fail" />
        ) : null}
      </GateBar>

      <Tip>
        Two paths: <b>manual entry</b> — paste body text on this page and what you preview
        is exactly what gets ingested; <b>offline build</b> — hand the materials in data/kb/
        to the make target, and the page button runs the same command you would type in the
        terminal. Both paths share one chunking logic and dual-write order — write to MySQL
        first as "pending", then into Milvus and mark "done"; if it dies mid-way, re-run to
        pick up the pending chunks and catch up.
      </Tip>

      {/* ① Manual entry */}
      <Panel
        title="① Manual entry"
        pill={<Pill tone="info">Paste body text here</Pill>}
        lede="Split by heading hierarchy, recursively split overlong chunks, trim cross-chunk overlap to the nearest sentence end, and split large tables row-wise with the header repeated — all four are flagged per chunk in the preview below. Dedup fingerprints the question + body, so re-ingesting the same text skips everything."
      >
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="text-[12.5px] font-bold" htmlFor="ctype">
              Content type
            </label>
            <select
              id="ctype"
              className={FIELD}
              value={ct}
              onChange={(e) => { setCtype(e.target.value); }}
            >
              {d.content_types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key}
                </option>
              ))}
            </select>
            <span className="text-[11.5px] text-ink-soft">{ctDesc}</span>
            <span className="flex-1" />
            <Btn size="sm" onClick={() => { setText(SAMPLE); }}>
              Fill in a sample
            </Btn>
            <Btn
              size="sm"
              onClick={() => {
                setText("");
                setPreview(null);
              }}
            >
              Clear
            </Btn>
          </div>
          <textarea
            className={cn(FIELD, "min-h-44 w-full resize-y leading-7")}
            placeholder="Paste Markdown. It works best with # / ## heading levels — for policy manuals without natural questions, questions fall back to section titles and category to the parent path."
            value={text}
            onChange={(e) => { setText(e.target.value); }}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <Btn
              variant="go"
              disabled={previewing}
              onClick={() => {
                void doPreview({ text, content_type: ct });
              }}
            >
              {previewing ? "Chunking…" : "Chunk preview (no writes)"}
            </Btn>
            <Btn
              disabled={ingesting}
              onClick={() => {
                void doIngest();
              }}
            >
              {ingesting ? "Ingesting…" : "Ingest into KB"}
            </Btn>
            <label className="flex cursor-pointer items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-(--coral)"
                checked={vecAfter}
                onChange={(e) => { setVecAfter(e.target.checked); }}
              />
              Vectorize right after ingest
            </label>
          </div>
        </div>

        {preview ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              <Pill tone="info">Source: {preview.source}</Pill>
              <Pill tone="info">
                Total: {preview.total} chunks / {preview.features.sections} sections
              </Pill>
              <Pill tone={preview.features.table_split ? "pass" : "missing"}>
                {preview.features.table_split
                  ? "Table row-split triggered"
                  : "Table row-split not triggered"}
              </Pill>
              <Pill tone={preview.features.overlap ? "pass" : "missing"}>
                {preview.features.overlap
                  ? "Sentence-end overlap triggered"
                  : "Sentence-end overlap not triggered (no section over 400 chars)"}
              </Pill>
              <Pill tone={preview.key_clause ? "pass" : "missing"}>
                Key clauses: {preview.key_clause} chunks
              </Pill>
              {preview.dedup_known ? (
                <Pill tone={preview.duplicates ? "fail" : "pass"}>
                  {preview.duplicates
                    ? "Already in the KB: " +
                      String(preview.duplicates) +
                      " chunks — they will be skipped on ingest"
                    : "No duplicates, safe to ingest"}
                </Pill>
              ) : (
                <Pill tone="missing">Dedup unknown (MySQL can't be read)</Pill>
              )}
            </div>
            <TableScroll className="mt-3">
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
                  {preview.chunks.map((ch) => (
                    <Tr key={ch.seq} bad={ch.duplicate}>
                      <Td num>{ch.seq}</Td>
                      <Td>{ch.section_path}</Td>
                      <Td>{ch.questions}</Td>
                      <Td>
                        <div className={ANSWER_CELL}>{ch.answer}</div>
                      </Td>
                      <Td num>{ch.chars}</Td>
                      <Td className="whitespace-nowrap">
                        {ch.is_key_clause ? (
                          <Pill tone="fail" className="mr-1">
                            Key clause
                          </Pill>
                        ) : null}
                        {ch.is_table ? (
                          <Pill tone="info" className="mr-1">
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
                <Tr key={s.file} bad={!s.present}>
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
                      <Td className="whitespace-nowrap">
                        {s.features?.table_split ? (
                          <Pill tone="info" className="mr-1">
                            Table split
                          </Pill>
                        ) : null}
                        {s.features?.overlap ? (
                          <Pill tone="info" className="mr-1">
                            Overlap
                          </Pill>
                        ) : null}
                        <Pill tone="missing">
                          {s.features?.sections ?? 0} sections
                        </Pill>
                      </Td>
                      <Td>
                        <Btn
                          size="sm"
                          onClick={() => {
                            void doPreview({ file: s.file });
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
        <JobRow
          specs={pick(["kb-preview", "kb-build", "kb-repatch"])}
          onFinish={() => { void revalidate(); }}
          note="kb-build has an idempotency guard: chunks of the same type that already exist are skipped; after editing an md file use kb-repatch to patch it in place, and remember to vectorize afterwards"
        />
      </Panel>

      {/* ③ Conversation mining */}
      <Panel
        title="③ Conversation mining"
        pill={
          <Pill tone="info">
            {d.staging
              ? d.staging.total
                ? "Total " +
                  String(d.staging.total) +
                  " rows, latest batch " +
                  (d.staging.latest_batch ?? "—")
                : "Nothing mined yet"
              : "Can't read"}
          </Pill>
        }
        lede="Historical support conversations are fed to the LLM in batches to extract QA pairs, which land in the staging table first and are then deduplicated and ingested as a whole. The gap between the three counts is the dedup pass: how many were extracted, kept, and discarded."
      >
        {d.staging ? (
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Extracted, awaiting dedup", v: d.staging.counts.extracted },
              { label: "Kept after dedup (in KB)", v: d.staging.counts.kept },
              { label: "Discarded by dedup", v: d.staging.counts.discarded },
              { label: "Batches", v: d.staging.batches },
            ].map(({ label, v }) => (
              <div
                key={label}
                className="min-w-21 border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px]"
              >
                <b className="block text-[17px] leading-snug">{v}</b>
                {label}
              </div>
            ))}
          </div>
        ) : (
          <MissingBox>MySQL can't be read, so staging counts are unavailable</MissingBox>
        )}
        <JobRow
          specs={pick(["seed-conv", "kb-mine"])}
          onFinish={() => { void revalidate(); }}
          note="Mining calls the LLM and takes minutes"
        />
        <div className="mt-3">
          <Btn
            size="sm"
            disabled={stagingLoading}
            onClick={() => {
              void loadStaging();
            }}
          >
            {stagingLoading ? "Loading…" : "Browse staging rows"}
          </Btn>
        </div>
        {stagingRows ? (
          <div className="mt-2">
            {STAGING_ORDER.map((st) => {
              const rows = stagingRows.rows[st] ?? [];
              if (!rows.length) {
                return null;
              }
              return (
                <div key={st}>
                  <h3 className="mt-3.5 mb-1.5 text-[13px] font-bold">
                    {STAGING_LABEL[st]} ({rows.length} rows)
                  </h3>
                  {st === "kept" ? (
                    <p className="mb-2 text-[12.5px] leading-6 text-ink-soft">
                      These were summarized by the model from historical conversations and quality
                      varies. Review each row before approving: anything that only applies to a
                      single order, carries an order number, or answers the wrong question should
                      not enter the Knowledge Base.
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
                          <Tr key={r.id}>
                            <Td>{r.batch_no}</Td>
                            <Td>{r.source_ref ?? "—"}</Td>
                            <Td>{r.question}</Td>
                            <Td>
                              <div className={ANSWER_CELL}>{r.answer}</div>
                            </Td>
                            {st === "kept" ? (
                              <Td className="whitespace-nowrap">
                                <Btn
                                  size="sm"
                                  variant="ok"
                                  className="mr-1.5"
                                  onClick={() => {
                                    void reviewAction("approve", r.id);
                                  }}
                                >
                                  Approve
                                </Btn>
                                <Btn
                                  size="sm"
                                  variant="no"
                                  onClick={() => {
                                    void reviewAction("reject", r.id);
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
            {STAGING_ORDER.every(
              (st) => (stagingRows.rows[st] ?? []).length === 0,
            ) ? (
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
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Pending", v: c.pending },
            { label: "Done (vectorized)", v: c.done },
            {
              label: "Milvus rows",
              v: d.milvus.online ? d.milvus.count : null,
            },
            { label: "Collection", v: d.milvus.collection ?? "knowledge" },
          ].map(({ label, v }) => (
            <div
              key={label}
              className="min-w-21 border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px]"
            >
              <b className="block text-[17px] leading-snug">
                {v === null || v === undefined ? "—" : String(v)}
              </b>
              {label}
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Btn
            variant="go"
            disabled={vectorizing}
            onClick={() => {
              void doVectorize();
            }}
          >
            {vectorizing ? "Vectorizing…" : "Vectorize pending chunks"}
          </Btn>
          <span className="text-[11.5px] text-muted">
            {d.milvus.online
              ? "Runs in-process — the same function as make kb-vectorize"
              : "Milvus offline: " + (d.milvus.detail ?? "")}
          </span>
        </div>
        <JobRow
          specs={pick(["kb-vectorize", "kb-reset"])}
          onFinish={() => { void revalidate(); }}
          note="Reset clears both tables and drops the collection; the KB must be rebuilt afterwards"
        />
      </Panel>

      {/* ⑤ Search self-test */}
      <Panel
        title="⑤ Search self-test"
        pill={<Pill tone="info">Ask it another way</Pill>}
        lede="The question is vectorized, then Top-K results are fetched from Milvus by similarity. “How much is postage?” never appears verbatim in the KB — it matches because it is semantically close to the shipping-fee chunk, and literal lookup could never do that."
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            className={cn(FIELD, "min-w-55 flex-1")}
            placeholder="How much is postage?"
            value={q}
            onChange={(e) => { setQ(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void runSearch(q);
              }
            }}
          />
          <label className="text-[12.5px] font-bold" htmlFor="strategy">
            Strategy
          </label>
          <select
            id="strategy"
            className={FIELD}
            value={strategy}
            onChange={(e) => { setStrategy(e.target.value); }}
          >
            <option value="vector">Dense vector only (this chapter)</option>
            <option value="bm25">BM25 keyword</option>
            <option value="hybrid">Hybrid retrieval</option>
            <option value="hybrid_rerank">Hybrid + rerank</option>
          </select>
          <label className="text-[12.5px] font-bold" htmlFor="topk">
            Top-K
          </label>
          <input
            id="topk"
            type="number"
            min={1}
            max={20}
            className={cn(FIELD, "w-18")}
            value={topk}
            onChange={(e) => { setTopk(Number(e.target.value) || 5); }}
          />
          <Btn
            variant="go"
            disabled={searching}
            onClick={() => {
              void runSearch(q);
            }}
          >
            <Search className="h-4 w-4" aria-hidden />
            {searching ? "Searching…" : "Search"}
          </Btn>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {[
            "How much is postage?",
            "How is shipping calculated?",
            "How soon will my order ship?",
            "Can I return expired cat food?",
          ].map((preset) => (
              <Btn
                key={preset}
                size="sm"
                onClick={() => {
                  setQ(preset);
                  void runSearch(preset);
                }}
              >
                {preset}
              </Btn>
            ),
          )}
        </div>
        {hits ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              <Pill tone="info">Strategy: {hitStrategy}</Pill>
              <Pill tone={hits.length ? "pass" : "fail"}>
                Retrieved {hits.length} chunks
              </Pill>
            </div>
            {hits.length ? (
              <div className="mt-2.5 grid gap-2.5">
                {hits.map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      "border-3 border-ink bg-paper px-3 py-2 text-[12.5px]",
                      i === 0 && "bg-cream shadow-hard-sm",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={i === 0 ? "pass" : "info"}>#{i + 1}</Pill>
                      <span className="font-bold">{h.question}</span>
                      <span className="flex-1" />
                      {h.score !== null && h.score !== undefined ? (
                        <Pill tone="info">
                          score {Number(h.score).toFixed(4)}
                        </Pill>
                      ) : null}
                      {h.rerank_score !== null &&
                      h.rerank_score !== undefined ? (
                        <Pill tone="info">
                          rerank {Number(h.rerank_score).toFixed(4)}
                        </Pill>
                      ) : null}
                    </div>
                    <div className="mt-1.5 leading-7 whitespace-pre-wrap">
                      {h.answer}
                    </div>
                    <div className="mt-1.5 text-[11.5px] text-muted">
                      {[
                        h.section_path ?? "—",
                        h.content_type ?? "—",
                        "id " + String(h.id ?? "—"),
                      ].join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <MissingBox className="mt-2.5">
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
                  <Tr key={r.id} bad={r.status === "pending"}>
                    <Td num>{r.id}</Td>
                    <Td>{r.content_type ?? "—"}</Td>
                    <Td>{r.section_path ?? "—"}</Td>
                    <Td>{r.questions}</Td>
                    <Td>
                      <div className={ANSWER_CELL}>{r.answer}</div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Pill
                        tone={r.status === "done" ? "pass" : "fail"}
                        className="mr-1"
                      >
                        {r.status === "done" ? "Vectorized" : "Pending"}
                      </Pill>
                      {r.is_key_clause ? (
                        <Pill tone="fail">Key clause</Pill>
                      ) : null}
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
