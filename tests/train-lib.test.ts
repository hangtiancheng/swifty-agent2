import { describe, expect, it } from "vitest";

import { dedupe, desensitize, splitDataset, type CorpusSample } from "#/train/corpus-lib.ts";
import { applyThreshold } from "#/train/inference-lib.ts";

describe("inference-lib applyThreshold", () => {
  it("marks every class at or above the line", () => {
    expect(applyThreshold([[0.9, 0.2, 0.8]], 0.5)).toEqual([[1, 0, 1]]);
  });

  it("falls back to the top class when nothing passes", () => {
    expect(applyThreshold([[0.1, 0.4, 0.2]], 0.5)).toEqual([[0, 1, 0]]);
  });

  it("handles a batch row by row", () => {
    expect(
      applyThreshold(
        [
          [0.9, 0.1],
          [0.2, 0.3],
        ],
        0.5,
      ),
    ).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });
});

describe("corpus-lib desensitize", () => {
  it("masks emails, long digit runs and handles", () => {
    expect(desensitize("mail me at a.b+x@ex.com, order 1234567890123, ping @john_doe")).toBe(
      "mail me at [email], order [number], ping [handle]",
    );
  });

  it("leaves product model numbers untouched", () => {
    expect(desensitize("Is MH-LP100 in stock?")).toBe("Is MH-LP100 in stock?");
  });
});

describe("corpus-lib dedupe", () => {
  it("keeps the first occurrence and trims whitespace", () => {
    const out = dedupe([
      { text: "  hello ", labels: ["other"] },
      { text: "hello", labels: ["reviews"] },
      { text: "world", labels: ["other"] },
    ]);
    expect(out.map((s) => s.text)).toEqual(["hello", "world"]);
    expect(out[0].labels).toEqual(["other"]);
  });

  it("drops empty texts", () => {
    expect(dedupe([{ text: "   ", labels: ["other"] }])).toEqual([]);
  });
});

describe("corpus-lib splitDataset", () => {
  const sample = (text: string, labels: string[]): CorpusSample => ({ text, labels });

  it("is deterministic for a fixed seed", () => {
    const data = Array.from({ length: 40 }, (_, i) => sample(`q${i}`, ["logistics"]));
    const a = splitDataset(data, 7);
    const b = splitDataset(data, 7);
    expect(a.map((s) => s.map((x) => x.text))).toEqual(b.map((s) => s.map((x) => x.text)));
  });

  it("partitions every sample exactly once", () => {
    const data = Array.from({ length: 50 }, (_, i) => sample(`q${i}`, ["sizing", "returns_refunds"]));
    const [train, val, test] = splitDataset(data, 42);
    const all = [...train, ...val, ...test].map((s) => s.text).sort();
    expect(all).toEqual(data.map((s) => s.text).sort());
    expect(val.length).toBeGreaterThan(0);
    expect(test.length).toBeGreaterThan(0);
  });

  it("sends a tiny stratum wholly to train", () => {
    const data = [sample("a", ["invoicing"]), sample("b", ["invoicing"])];
    const [train, val, test] = splitDataset(data, 1);
    expect(train).toHaveLength(2);
    expect(val).toHaveLength(0);
    expect(test).toHaveLength(0);
  });
});
