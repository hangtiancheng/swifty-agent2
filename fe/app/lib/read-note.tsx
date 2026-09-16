import type { ReactNode } from "react";

import { cn } from "./cn";

/** 读图小注:产物里带着模型看这一轮数写的那句就用它,数字自动加粗;
 *  没有才用页面写死的兜底文案。注是脚本落盘时生成并校过数的(app/core/read_notes.py),
 *  前端只负责显示,不再自己下结论。 */

// 只加粗真正的数,名字里的数字不算(BM25 的 25、Recall@10 的 10、bge-m3 的 3),
// 与 read_notes.py 里那条校验用的边界规则保持一致
const NUM_RE =
  /(?<![A-Za-z@_.\-\d])\d+(?:,\d{3})*(?:\.\d+)?%?(?![A-Za-z_])/g;

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
        "mt-3 border-3 border-dashed border-ink bg-paper px-3 py-2 text-[12.5px] leading-[1.8] [&_b]:border-2 [&_b]:border-ink [&_b]:bg-fur [&_b]:px-1 [&_b]:font-bold",
        className,
      )}
    >
      <span className="mr-2 inline-block bg-ink px-1.5 py-px align-middle text-[11px] font-bold text-cream">
        读图
      </span>
      {note ? boldNumbers(note) : fallback}
    </div>
  );
}
