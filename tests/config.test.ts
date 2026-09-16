import { afterEach, describe, expect, it } from "vitest";

import { bool, num } from "#/config.ts";

afterEach(() => {
  delete process.env.TEST_NUMBER_SETTING;
  delete process.env.TEST_BOOLEAN_SETTING;
});

describe("configuration parsing", () => {
  it("rejects malformed numeric values", () => {
    process.env.TEST_NUMBER_SETTING = "not-a-number";
    expect(() => num("TEST_NUMBER_SETTING", 5)).toThrow(
      "TEST_NUMBER_SETTING must be a finite number",
    );
  });

  it("accepts explicit true and false boolean forms", () => {
    process.env.TEST_BOOLEAN_SETTING = "yes";
    expect(bool("TEST_BOOLEAN_SETTING", false)).toBe(true);
    process.env.TEST_BOOLEAN_SETTING = "off";
    expect(bool("TEST_BOOLEAN_SETTING", true)).toBe(false);
  });

  it("rejects unknown boolean values", () => {
    process.env.TEST_BOOLEAN_SETTING = "maybe";
    expect(() => bool("TEST_BOOLEAN_SETTING", true)).toThrow(
      "TEST_BOOLEAN_SETTING must be a boolean",
    );
  });
});
