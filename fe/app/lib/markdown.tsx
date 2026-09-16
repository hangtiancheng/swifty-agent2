import type { ReactNode } from "react";

import { cn } from "./cn";
import type { Citation } from "./types";

/** 轻量 markdown → React 节点(零依赖,原 index.html 渲染器的移植)。
 *  文本经 JSX 输出天然转义,不存在原字符串拼 HTML 的注入面;链接仅放行 http(s)。
 *  citations 给了时,正文里的 [n] 渲染成可点角标,点击回调 onCite(带角标元素用于定位浮层)。 */

export interface MarkdownOptions {
  citations?: Map<string, Citation>;
  onCite?: (c: Citation, el: HTMLElement) => void;
}

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(~~[^~]+~~)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\[(\d+)\])/g;

const CITE_CLS =
  "cursor-pointer select-none border-b-2 border-coral px-px align-super text-[11px] font-bold leading-none text-coral hover:bg-coral hover:text-white";

function renderInline(s: string, opts: MarkdownOptions, kp: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(s)) !== null) {
    if (m.index > last) {
      out.push(s.slice(last, m.index));
    }
    const key = kp + "i" + String(k++);
    if (m[1] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-code-bg px-1 py-px text-[13px]">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2] !== undefined) {
      out.push(
        <strong key={key} className="font-bold">
          {m[2].slice(2, -2)}
        </strong>,
      );
    } else if (m[3] !== undefined) {
      out.push(<em key={key}>{m[3].slice(1, -1)}</em>);
    } else if (m[4] !== undefined) {
      out.push(<del key={key}>{m[4].slice(2, -2)}</del>);
    } else if (m[5] !== undefined) {
      out.push(
        <a
          key={key}
          href={m[7]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-coral underline"
        >
          {m[6]}
        </a>,
      );
    } else if (m[8] !== undefined) {
      const n = m[9] ?? "";
      const c = opts.citations?.get(n);
      if (c) {
        out.push(
          <sup
            key={key}
            role="button"
            tabIndex={0}
            title={c.section_path ?? "查看来源"}
            className={CITE_CLS}
            onClick={(e) => {
              e.stopPropagation();
              opts.onCite?.(c, e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                opts.onCite?.(c, e.currentTarget);
              }
            }}
          >
            [{n}]
          </sup>,
        );
      } else {
        out.push(m[0]); // 非有效编号,保留原文
      }
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) {
    out.push(s.slice(last));
  }
  return out;
}

export function renderMarkdown(
  md: string,
  opts: MarkdownOptions = {},
): ReactNode[] {
  const lines = md.split("\n");
  const out: ReactNode[] = [];
  let bk = 0;
  const key = () => "b" + String(bk++);

  const isTableSep = (l?: string): boolean =>
    l !== undefined &&
    l.includes("-") &&
    /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l);
  const splitRow = (l: string): string[] =>
    l
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim());
  const isSpecial = (l: string, next?: string): boolean =>
    l.startsWith("```") ||
    /^(#{1,6})\s/.test(l) ||
    /^\s*[-*+]\s+/.test(l) ||
    /^\s*\d+\.\s+/.test(l) ||
    /^\s*(---|\*\*\*|___)\s*$/.test(l) ||
    /^\s*>\s?/.test(l) ||
    (l.includes("|") && isTableSep(next));

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      // 代码块
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++;
      out.push(
        <pre
          key={key()}
          className="scroll-cat my-2 overflow-x-auto rounded-md bg-code-bg px-2.5 py-2"
        >
          <code className="text-[13px]">{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      // 标题
      const cls = "mt-2.5 mb-1.5 text-[15px] font-bold";
      const inline = renderInline(hm[2] ?? "", opts, key());
      const level = hm[1]?.length ?? 1;
      if (level === 1) {
        out.push(<h1 key={key()} className={cls}>{inline}</h1>);
      } else if (level === 2) {
        out.push(<h2 key={key()} className={cls}>{inline}</h2>);
      } else if (level === 3) {
        out.push(<h3 key={key()} className={cls}>{inline}</h3>);
      } else if (level === 4) {
        out.push(<h4 key={key()} className={cls}>{inline}</h4>);
      } else if (level === 5) {
        out.push(<h5 key={key()} className={cls}>{inline}</h5>);
      } else {
        out.push(<h6 key={key()} className={cls}>{inline}</h6>);
      }
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      // 分隔线
      out.push(
        <hr key={key()} className="my-2.5 border-t-2 border-dashed border-muted" />,
      );
      i++;
      continue;
    }
    if (line.includes("|") && isTableSep(lines[i + 1])) {
      // 表格
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (
        i < lines.length &&
        (lines[i] ?? "").includes("|") &&
        (lines[i] ?? "").trim() !== ""
      ) {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      const thCls =
        "border border-muted bg-code-bg px-2 py-1 text-left font-bold";
      const tdCls = "border border-muted px-2 py-1 text-left";
      out.push(
        <table key={key()} className="my-2 border-collapse text-[13px]">
          <thead>
            <tr>
              {headers.map((c, j) => (
                <th key={j} className={thCls}>
                  {renderInline(c, opts, key())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className={tdCls}>
                    {renderInline(c, opts, key())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      // 无序列表
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push(
          <li key={items.length} className="my-0.5">
            {renderInline(
              (lines[i] ?? "").replace(/^\s*[-*+]\s+/, ""),
              opts,
              key(),
            )}
          </li>,
        );
        i++;
      }
      out.push(
        <ul key={key()} className="my-1.5 list-disc pl-5">
          {items}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      // 有序列表
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push(
          <li key={items.length} className="my-0.5">
            {renderInline(
              (lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""),
              opts,
              key(),
            )}
          </li>,
        );
        i++;
      }
      out.push(
        <ol key={key()} className="my-1.5 list-decimal pl-5">
          {items}
        </ol>,
      );
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      // 引用
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote
          key={key()}
          className="my-1.5 border-l-3 border-muted py-0.5 pl-2.5 text-muted"
        >
          {buf.map((b, j) => (
            <span key={j}>
              {j > 0 ? <br /> : null}
              {renderInline(b, opts, key())}
            </span>
          ))}
        </blockquote>,
      );
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    // 段落
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !isSpecial(lines[i] ?? "", lines[i + 1])
    ) {
      para.push(lines[i] ?? "");
      i++;
    }
    out.push(
      <p key={key()} className="mb-2">
        {para.map((p, j) => (
          <span key={j}>
            {j > 0 ? <br /> : null}
            {renderInline(p, opts, key())}
          </span>
        ))}
      </p>,
    );
  }
  return out;
}

/** bot 气泡正文:markdown 渲染 + 可选引用角标 */
export function Markdown({
  text,
  citations,
  onCite,
  className,
}: {
  text: string;
  citations?: Map<string, Citation>;
  onCite?: (c: Citation, el: HTMLElement) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p:last-child]:mb-0",
        className,
      )}
    >
      {renderMarkdown(text, { citations, onCite })}
    </div>
  );
}
