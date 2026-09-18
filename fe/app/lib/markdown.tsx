import { cn } from "./cn";
import type { Citation } from "./types";

/** Lightweight markdown → lit templates (zero-dependency, ported from the
 *  original index.html renderer). Text goes through JSX so it is escaped
 *  naturally — none of the original string-concatenated-HTML injection surface;
 *  links only allow http(s). When citations are provided, [n] in the body
 *  renders as a clickable superscript and clicking calls onCite (with the
 *  superscript element for positioning the popover). */

export interface MarkdownOptions {
  citations?: Map<string, Citation>;
  onCite?: (c: Citation, el: HTMLElement) => void;
}

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(~~[^~]+~~)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\[(\d+)\])/g;

const CITE_CLS =
  "bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary cursor-pointer rounded-full px-1.5 text-[10px] leading-4 font-medium align-super transition-colors duration-150 select-none";

function renderInline(s: string, opts: MarkdownOptions): unknown[] {
  const out: unknown[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(s)) !== null) {
    if (m.index > last) {
      out.push(s.slice(last, m.index));
    }
    if (m[1] !== undefined) {
      out.push(
        <code class="bg-surface-container-high text-on-surface-variant rounded-xs px-1.5 py-0.5 font-mono text-[12.5px]">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2] !== undefined) {
      out.push(<strong class="font-semibold">{m[2].slice(2, -2)}</strong>);
    } else if (m[3] !== undefined) {
      out.push(<em>{m[3].slice(1, -1)}</em>);
    } else if (m[4] !== undefined) {
      out.push(<del>{m[4].slice(2, -2)}</del>);
    } else if (m[5] !== undefined) {
      out.push(
        <a
          href={m[7]}
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary decoration-primary/40 hover:decoration-primary underline underline-offset-2 transition-colors duration-150"
        >
          {m[6]}
        </a>,
      );
    } else if (m[8] !== undefined) {
      const n = m[9] ?? "";
      const c = opts.citations?.get(n);
      if (c) {
        const cite = c;
        out.push(
          <sup
            role="button"
            tabIndex={0}
            title={cite.section_path ?? "View source"}
            class={CITE_CLS}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              opts.onCite?.(cite, e.currentTarget as HTMLElement);
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                opts.onCite?.(cite, e.currentTarget as HTMLElement);
              }
            }}
          >
            [{n}]
          </sup>,
        );
      } else {
        out.push(m[0]); // Not a valid citation number; keep the original text
      }
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) {
    out.push(s.slice(last));
  }
  return out;
}

export function renderMarkdown(md: string, opts: MarkdownOptions = {}): unknown[] {
  const lines = md.split("\n");
  const out: unknown[] = [];

  const isTableSep = (l?: string): boolean =>
    l !== undefined && l.includes("-") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l);
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
      // Code block
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++;
      out.push(
        <pre class="scroll-slim bg-surface-container-high my-3 overflow-x-auto rounded-md p-3.5">
          <code class="text-on-surface font-mono text-[12.5px] leading-relaxed">{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      // Heading
      const cls = "text-on-surface mt-3.5 mb-1.5 text-[15px] font-semibold";
      const inline = renderInline(hm[2] ?? "", opts);
      const level = hm[1]?.length ?? 1;
      if (level === 1) {
        out.push(<h1 class={cls}>{inline}</h1>);
      } else if (level === 2) {
        out.push(<h2 class={cls}>{inline}</h2>);
      } else if (level === 3) {
        out.push(<h3 class={cls}>{inline}</h3>);
      } else if (level === 4) {
        out.push(<h4 class={cls}>{inline}</h4>);
      } else if (level === 5) {
        out.push(<h5 class={cls}>{inline}</h5>);
      } else {
        out.push(<h6 class={cls}>{inline}</h6>);
      }
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      // Horizontal rule
      out.push(<hr class="border-outline-variant my-3 border-t" />);
      i++;
      continue;
    }
    if (line.includes("|") && isTableSep(lines[i + 1])) {
      // Table
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      const thCls =
        "border-outline-variant bg-surface-container-low text-on-surface-variant border-b px-2.5 py-1.5 text-left text-label-medium";
      const tdCls = "border-outline-variant text-on-surface border-b px-2.5 py-1.5 text-left";
      out.push(
        <div class="scroll-slim border-outline-variant my-3 overflow-x-auto rounded-md border">
          <table class="w-full border-collapse text-[13px]">
            <thead>
              <tr>{headers.map((c) => <th class={thCls}>{renderInline(c, opts)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr class="hover:bg-on-surface/4 last:[&_td]:border-b-0">
                  {r.map((c) => (
                    <td class={tdCls}>{renderInline(c, opts)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      // Unordered list
      const items: unknown[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push(<li class="my-0.5">{renderInline((lines[i] ?? "").replace(/^\s*[-*+]\s+/, ""), opts)}</li>);
        i++;
      }
      out.push(<ul class="my-1.5 list-disc pl-5">{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      // Ordered list
      const items: unknown[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push(<li class="my-0.5">{renderInline((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""), opts)}</li>);
        i++;
      }
      out.push(<ol class="my-1.5 list-decimal pl-5">{items}</ol>);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      // Blockquote
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote class="border-primary/60 text-on-surface-variant my-2.5 border-l-2 py-0.5 pl-3">
          {buf.map((b, j) => (
            <span>
              {j > 0 ? <br /> : null}
              {renderInline(b, opts)}
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
    // Paragraph
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !isSpecial(lines[i] ?? "", lines[i + 1])) {
      para.push(lines[i] ?? "");
      i++;
    }
    out.push(
      <p class="mb-2">
        {para.map((p, j) => (
          <span>
            {j > 0 ? <br /> : null}
            {renderInline(p, opts)}
          </span>
        ))}
      </p>,
    );
  }
  return out;
}

export interface MarkdownProps {
  text: string;
  citations?: Map<string, Citation>;
  onCite?: (c: Citation, el: HTMLElement) => void;
  class?: string;
}

/** Bot bubble body: markdown rendering + optional citation superscripts */
export function Markdown({ text, citations, onCite, class: cls }: MarkdownProps) {
  return (
    <div class={cn("[&_p:last-child]:mb-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", cls)}>
      {renderMarkdown(text, { citations, onCite })}
    </div>
  );
}
