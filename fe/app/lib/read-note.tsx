import type { ReactNode } from "react";

import { cn } from "./cn";

/** Chart-reading note: if the artifact carries the sentence the model wrote about
 *  this round's numbers, use it (numbers auto-bolded); otherwise fall back to the
 *  page's hardcoded copy. Notes are generated and number-checked when the script
 *  writes the artifact (app/core/read_notes.py); the frontend only displays them and
 *  no longer draws its own conclusions. */

// Bold only real numbers, not digits inside names (the 25 in BM25, the 10 in
// Recall@10, the 3 in qwen3.7-text-embedding-flash) — matching the boundary rule read_notes.py validates with.
const NUM_RE = /(?<![A-Za-z@_.\-\d])\d+(?:,\d{3})*(?:\.\d+)?%?(?![A-Za-z_])/g;

function boldNumbers(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  NUM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUM_RE.exec(s)) !== null) {
    if (m.index > last) {
      parts.push(s.slice(last, m.index));
    }
    parts.push(<b key={k++}>{m[0]}</b>);
    last = m.index + m[0].length;
  }
  if (last < s.length) {
    parts.push(s.slice(last));
  }
  return parts;
}

export function ReadNote({
  note,
  fallback,
  className,
}: {
  note?: string | null;
  fallback: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-ink bg-paper [&_b]:border-ink [&_b]:bg-fur mt-3 border-3 border-dashed px-3 py-2 text-[12.5px] leading-[1.8] [&_b]:border-2 [&_b]:px-1 [&_b]:font-bold",
        className,
      )}
    >
      <span className="bg-ink text-cream mr-2 inline-block px-1.5 py-px align-middle text-[11px] font-bold">
        Insight
      </span>
      {note ? boldNumbers(note) : fallback}
    </div>
  );
}
