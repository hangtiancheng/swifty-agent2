// Structured document chunk builder shared by the offline build job and the ingest API.
import * as chunking from "./chunking.ts";

const KEY_TERMS = [
  "refund",
  "return",
  "timeframe",
  "time limit",
  "shipping fee",
  "postage",
  "fee",
  "warranty",
  "compensation",
  "period",
  "free shipping",
];
// Re-exported: the confidence signal and review write-back share the same term list.
export { KEY_TERMS };

export interface Chunk {
  category: string;
  questions: string;
  answer: string;
  sectionPath: string;
  contentType: string;
  isKeyClause: number;
}

export function isKey(title: string, body: string): number {
  // Case-insensitive: the English KB uses Title Case headings.
  const head = (title + body.slice(0, 40)).toLowerCase();
  return KEY_TERMS.some((t) => head.includes(t)) ? 1 : 0;
}

export function approvedReviewChunk(question: string, answer: string): Chunk {
  return {
    category: "flywheel_review",
    questions: question,
    answer,
    sectionPath: `flywheel_review / ${question}`,
    contentType: "faq",
    isKeyClause: isKey(question, answer),
  };
}

export function approvedStagingChunk(question: string, answer: string): Chunk {
  return {
    category: "conversation_history",
    questions: question,
    answer,
    sectionPath: "mined",
    contentType: "mined",
    isKeyClause: isKey(question, answer),
  };
}

export async function buildChunks(
  md: string,
  contentType: string,
  chunkSize = 400,
  overlap = 60,
  tableMaxRows = 10,
): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for (const sec of chunking.splitSections(md)) {
    const path = ["h1", "h2", "h3", "h4"]
      .map((k) => sec.metadata[k])
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    const sectionPath = path.join(" / ");
    const title = path.length > 0 ? path[path.length - 1] : contentType;
    const category =
      path.length > 1
        ? path.slice(0, -1).join(" / ")
        : path.length === 1
          ? path[0]
          : contentType;
    const body = sec.pageContent.trim();
    if (!body) {
      continue;
    }
    let pieces: string[];
    if (chunking.isTableBlock(body)) {
      pieces = chunking.splitTableRows(body, tableMaxRows);
    } else {
      const base = await chunking.recursiveSplit(body, chunkSize, 0);
      pieces = chunking.applySentenceOverlap(base, overlap);
    }
    for (const piece of pieces) {
      out.push({
        category,
        questions: title,
        answer: piece,
        sectionPath,
        contentType,
        isKeyClause: isKey(title, piece),
      });
    }
  }
  return out;
}
