// Markdown-aware chunking: header split, recursive split with sentence overlap, table row split.
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const HEADERS: Array<[string, string]> = [
  ["#", "h1"],
  ["##", "h2"],
  ["###", "h3"],
  ["####", "h4"],
];
// Chinese has no word boundaries: prefer paragraphs/newlines, then sentence punctuation, then chars.
const CJK_SEPARATORS = ["\n\n", "\n", "。", "！", "？", "；", "!", "?", ";", "，", " ", ""];

export interface MarkdownSection {
  pageContent: string;
  metadata: Record<string, string>;
}

const HEADER_RE = /^(#{1,4})\s+(.*)$/;

export function splitSections(md: string): MarkdownSection[] {
  // Header-aware split with the headers stripped from the body: each section carries
  // its h1..h4 path in metadata. Content before the first header becomes its own section.
  const sections: MarkdownSection[] = [];
  const stack: Record<string, string> = {};
  let buffer: string[] = [];
  let started = false;
  const flush = (): void => {
    sections.push({ pageContent: buffer.join("\n").trim(), metadata: { ...stack } });
    buffer = [];
  };
  for (const line of md.split("\n")) {
    const m = HEADER_RE.exec(line);
    if (m) {
      if (started || buffer.join("").trim()) {
        flush();
      }
      const level = m[1].length;
      for (let l = level; l <= HEADERS.length; l += 1) {
        delete stack[`h${l}`];
      }
      stack[`h${level}`] = m[2].trim();
      started = true;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

export async function recursiveSplit(text: string, chunkSize: number, chunkOverlap = 0): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: CJK_SEPARATORS,
    keepSeparator: true,
  });
  return splitter.splitText(text);
}

const SENT_RE = /[^。！？!?…\n]*[。！？!?…\n]|[^。！？!?…\n]+$/g;

function splitSentences(text: string): string[] {
  return text.match(SENT_RE) ?? [];
}

function trailingSentences(text: string, maxChars: number): string {
  // Keep whole trailing sentences up to maxChars; a single over-long sentence is kept intact.
  const out: string[] = [];
  let total = 0;
  for (const s of splitSentences(text).reverse()) {
    if (out.length > 0 && total + s.length > maxChars) {
      break;
    }
    out.unshift(s);
    total += s.length;
  }
  return out.join("");
}

export function applySentenceOverlap(chunks: string[], overlap: number): string[] {
  if (chunks.length === 0) {
    return [];
  }
  const out = [chunks[0]];
  for (let i = 1; i < chunks.length; i += 1) {
    const ov = trailingSentences(chunks[i - 1], overlap);
    out.push(ov ? ov + chunks[i] : chunks[i]);
  }
  return out;
}

const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

function findTableHeader(lines: string[]): number {
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line.trimStart().startsWith("|") && TABLE_SEP_RE.test(next) && next.includes("-")) {
      return i;
    }
  }
  return -1;
}

export function isTableBlock(text: string): boolean {
  const lines = text
    .trim()
    .split("\n")
    .filter((ln) => ln.trim() !== "");
  return findTableHeader(lines) !== -1;
}

export function splitTableRows(tableMd: string, maxRows: number): string[] {
  // Split a large table by row groups; repeat the header on every group and keep the
  // preamble on the first group only.
  const lines = tableMd
    .trim()
    .split("\n")
    .filter((ln) => ln.trim() !== "");
  const idx = findTableHeader(lines);
  if (idx === -1) {
    return [tableMd.trim()];
  }
  const preamble = lines.slice(0, idx);
  const header = lines[idx];
  const sep = lines[idx + 1];
  const rows = lines.slice(idx + 2);
  if (rows.length <= maxRows) {
    return [tableMd.trim()];
  }
  const out: string[] = [];
  for (let j = 0; j * maxRows < rows.length; j += 1) {
    const group = rows.slice(j * maxRows, (j + 1) * maxRows);
    const block = j === 0 ? [...preamble, header, sep, ...group] : [header, sep, ...group];
    out.push(block.join("\n"));
  }
  return out;
}
