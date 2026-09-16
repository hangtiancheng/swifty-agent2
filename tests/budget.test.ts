import { describe, expect, it } from "vitest";

import {
  compute,
  describe as describeBudget,
  lookupWindow,
} from "@/core/budget.ts";

describe("budget", () => {
  it("treats a large window as healthy", () => {
    const b = compute(1_000_000);
    expect(b.healthy).toBe(true);
    expect(b.sliding).toBeGreaterThan(0);
    expect(b.turns).toBeGreaterThanOrEqual(1);
  });

  it("flags a window that cannot fit one turn", () => {
    const b = compute(1_000);
    expect(b.healthy).toBe(false);
    expect(b.sliding).toBe(0);
    expect(describeBudget(b)).toContain("healthy=no");
  });

  it("looks up known model windows by prefix", () => {
    expect(lookupWindow("deepseek-ai/DeepSeek-V4-Flash")[0]).toBe(1_048_576);
    expect(lookupWindow("unknown-model")[1]).toBe(false);
  });
});
