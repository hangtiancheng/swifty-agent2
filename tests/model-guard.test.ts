import { describe, expect, it } from "vitest";

import { modelsIn, repairHint, unsupportedModels } from "../src/core/model-guard.ts";

describe("model guard", () => {
  it("extracts product model numbers in order", () => {
    expect(modelsIn("推荐 MH-LP100 和 MH-CAM1,还有 MH-LP100")).toEqual(["MH-LP100", "MH-CAM1"]);
  });

  it("flags models missing from the evidence", () => {
    expect(unsupportedModels("可用 MH-CAM1 与 MH-CAD1", "规格:MH-CAM1 支持 2K")).toEqual(["MH-CAD1"]);
    expect(unsupportedModels("可用 MH-CAM1", "规格:MH-CAM1 支持 2K")).toEqual([]);
  });

  it("matches case-sensitively", () => {
    expect(unsupportedModels("MH-cam1", "MH-CAM1")).toEqual(["MH-cam1"]);
  });

  it("names the bad models in the repair hint", () => {
    expect(repairHint(["MH-CAD1"])).toContain("MH-CAD1");
  });
});
