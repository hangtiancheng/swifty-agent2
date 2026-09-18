// Environment config parsing: GitHub credentials (GITHUB_TOKEN/GH_TOKEN/
// GITHUB_BASE_URL) and the HTTP bind address (MCP_HOST/MCP_PORT).

import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  loadConfig,
} from "../src/shared/config.ts";

describe("github config", () => {
  it("defaults to unconfigured when the environment is empty", () => {
    // Without an authenticated gh CLI or a token the github_* tools degrade
    // per call; nothing in the code points at an account by default.
    const config = loadConfig({});
    expect(config.github.token).toBe("");
    expect(config.github.baseUrl).toBe("");
  });

  it("treats empty strings as unset", () => {
    const config = loadConfig({ GITHUB_BASE_URL: "" });
    expect(config.github.baseUrl).toBe("");
  });

  it("prefers GITHUB_TOKEN over GH_TOKEN", () => {
    const config = loadConfig({ GITHUB_TOKEN: "a", GH_TOKEN: "b" });
    expect(config.github.token).toBe("a");
  });

  it("falls back to GH_TOKEN", () => {
    expect(loadConfig({ GH_TOKEN: "b" }).github.token).toBe("b");
  });

  it("treats a blank GITHUB_TOKEN as unset", () => {
    expect(loadConfig({ GITHUB_TOKEN: "   " }).github.token).toBe("");
  });

  it("strips trailing slashes from the base URL", () => {
    const config = loadConfig({
      GITHUB_BASE_URL: "https://ghe.example.com/api/v3//",
    });
    expect(config.github.baseUrl).toBe("https://ghe.example.com/api/v3");
  });

  it("honours an explicit base URL", () => {
    const config = loadConfig({
      GITHUB_BASE_URL: "https://ghe.example.com/api/v3",
    });
    expect(config.github.baseUrl).toBe("https://ghe.example.com/api/v3");
  });
});

describe("http bind config", () => {
  it("defaults when unset", () => {
    const config = loadConfig({});
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.port).toBe(DEFAULT_PORT);
  });

  it("reads host and port from the environment", () => {
    const config = loadConfig({ MCP_HOST: "0.0.0.0", MCP_PORT: "8080" });
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
  });

  it("ignores the generic HOST/PORT", () => {
    // The shared root .env already uses HOST/PORT for the Node-side servers;
    // the MCP bind address must not pick them up.
    const config = loadConfig({ HOST: "10.0.0.1", PORT: "8000" });
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.port).toBe(DEFAULT_PORT);
  });

  it.each(["", "   "])("treats empty values as unset (%s)", (empty) => {
    const config = loadConfig({ MCP_HOST: empty, MCP_PORT: empty });
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.port).toBe(DEFAULT_PORT);
  });

  it.each(["abc", "1.5", "-1", "0", "99999"])(
    "degrades a malformed port to the default (%s)",
    (raw) => {
      // A bad MCP_PORT must never crash the server at startup.
      expect(loadConfig({ MCP_PORT: raw }).port).toBe(DEFAULT_PORT);
    },
  );
});
