/** Same formatting conventions as the terminal artifacts (from the original acceptance.js) */
export const fmtTime = (iso?: string | null): string =>
  iso ? String(iso).replace("T", " ").slice(0, 19) : "—";

export const fmtBytes = (n?: number | null): string => {
  if (n === null || n === undefined) {
    return "—";
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return (n / 1024).toFixed(1) + " KB";
  }
  if (n < 1024 * 1024 * 1024) {
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
};

export const fmt3 = (v?: number | null): string =>
  v === null || v === undefined ? "—" : Number(v).toFixed(3);

export const pctFmt = (v?: number | null): string =>
  v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;

export const thousands = (n?: number | null): string =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US");
