import { z } from "zod";

export interface GitHubConfig {
  /**
   * Personal access token for the GitHub API (`GITHUB_TOKEN` env, with
   * `GH_TOKEN` as a fallback). Empty means "not configured": without an
   * authenticated gh CLI or a token the github_* tools answer with a clear
   * unavailable error per call instead of failing at startup.
   *
   * The token is a secret: it is only ever sent in an Authorization header
   * and must never be logged.
   */
  token: string;
  /**
   * REST API base URL (`GITHUB_BASE_URL` env); empty means the transport
   * default (https://api.github.com, or a GitHub Enterprise API URL).
   */
  baseUrl: string;
}

export interface AppConfig {
  github: GitHubConfig;
  /** HTTP transport listen address (only used with --http). */
  host: string;
  /** HTTP transport listen port (only used with --http). */
  port: number;
}

/** The HTTP endpoints are unauthenticated, so the default binds localhost only. */
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3300;

const EnvSchema = z.object({
  GITHUB_TOKEN: z.string().optional(),
  GH_TOKEN: z.string().optional(),
  GITHUB_BASE_URL: z.string().optional(),
  // The bind address is namespaced MCP_HOST/MCP_PORT (unlike the reference
  // server's HOST/PORT) because this repo's single root .env is shared with
  // the Node side, which already owns the generic HOST/PORT for its servers.
  MCP_HOST: z.string().optional(),
  // .catch: a malformed or out-of-range MCP_PORT in the environment must
  // degrade to the default instead of crashing the server at startup.
  MCP_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(DEFAULT_PORT)
    .catch(DEFAULT_PORT),
});

/** Empty strings behave as "unset" so placeholder env entries don't mask defaults. */
function dropEmptyValues(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.trim() !== "") {
      out[key] = value;
    }
  }
  return out;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = EnvSchema.parse(dropEmptyValues(env));
  const host = (parsed.MCP_HOST ?? "").trim();
  return {
    github: {
      token: (parsed.GITHUB_TOKEN ?? parsed.GH_TOKEN ?? "").trim(),
      baseUrl: (parsed.GITHUB_BASE_URL ?? "").replace(/\/+$/, ""),
    },
    host: host === "" ? DEFAULT_HOST : host,
    port: parsed.MCP_PORT,
  };
}
