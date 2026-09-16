import { describe, expect, it } from "vitest";

import { modelsIn, repairHint, unsupportedModels } from "@/core/model-guard.ts";

describe("model guard", () => {
  it("extracts product model numbers in order", () => {
    expect(modelsIn("Try MH-LP100 and MH-CAM1, plus MH-LP100 again")).toEqual([
      "MH-LP100",
      "MH-CAM1",
    ]);
  });

  it("flags models missing from the evidence", () => {
    expect(
      unsupportedModels("Available: MH-CAM1 and MH-CAD1", "Specs: MH-CAM1 supports 2K"),
    ).toEqual(["MH-CAD1"]);
    expect(
      unsupportedModels("Available: MH-CAM1", "Specs: MH-CAM1 supports 2K"),
    ).toEqual([]);
  });

  it("matches case-sensitively", () => {
    expect(unsupportedModels("MH-cam1", "MH-CAM1")).toEqual(["MH-cam1"]);
  });

  it("names the bad models in the repair hint", () => {
    expect(repairHint(["MH-CAD1"])).toContain("MH-CAD1");
  });
});
