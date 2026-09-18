# swifty-agent2-mcp (TypeScript)

An MCP (Model Context Protocol) server that exposes GitHub repositories as
tools for LLM agents, over stdio (default) or HTTP (Streamable HTTP +
legacy SSE).

- the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
  (stdio + web-standard Streamable HTTP + SSE transports)
- **h3** (v2) hosts the optional HTTP transports; the SDK's web-standard
  transport consumes h3's `Request` directly, the legacy SSE transport
  writes to the raw Node response via `fromNodeHandler`
- **zod** for tool input schemas and settings, **pino** for stderr-only
  JSON logging
- part of the root pnpm package — no `package.json` of its own; run it
  with `tsx`

## Requirements

- Node.js >= 20.12 (built-in `process.loadEnvFile`, `fetch`,
  `AbortSignal.timeout`)
- For the `github_*` tools: either an installed and authenticated
  [`gh` CLI](https://cli.github.com/) (`gh auth login`) — the preferred
  backend — or a personal access token set as `GITHUB_TOKEN` (or `GH_TOKEN`)
  for the HTTP fallback. Without either, the server still starts; the github
  tools answer with a clear unavailable error per call.

## Running

From the repository root:

```bash
pnpm tsx mcp/src/main.ts            # stdio (default)
pnpm tsx mcp/src/main.ts --http     # HTTP (Streamable HTTP + SSE)
```

CLI flags:

| Flag            | Description                                              |
| --------------- | -------------------------------------------------------- |
| `-v, --version` | Show the version and exit                                |
| `--http`        | Serve over HTTP (Streamable HTTP + SSE) instead of stdio |

### HTTP transports (`--http`)

`pnpm tsx mcp/src/main.ts --http` (or `MCP_TRANSPORT=http`) serves the same
tools on one port:

| Endpoint                                    | Transport                                                            |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `POST /mcp`                                 | Streamable HTTP — stateless, one session per request, JSON responses |
| `GET /mcp`                                  | 405 — stateless mode has no server-initiated notification stream     |
| `GET /sse` + `POST /messages?sessionId=...` | Legacy SSE — one long-lived stream per connection                    |

| Variable        | Default     | Description                                               |
| --------------- | ----------- | --------------------------------------------------------- |
| `MCP_TRANSPORT` | _(empty)_   | `http` selects the HTTP transports (same as `--http`)     |
| `MCP_HOST`      | `127.0.0.1` | HTTP bind address                                         |
| `MCP_PORT`      | `3300`      | HTTP bind port; a malformed value degrades to the default |

The names are namespaced because the shared root `.env` already uses the
generic `HOST`/`PORT` for the Node-side servers.

**Security**: the HTTP endpoints are **unauthenticated** — keep `MCP_HOST`
bound to localhost (the default) and only enable HTTP on a trusted machine;
anyone who can reach the port can call the `github_*` tools with the local
credentials.

MCP client configuration (HTTP):

```json
{
  "mcpServers": {
    "swifty-agent2-mcp": {
      "url": "http://127.0.0.1:3300/mcp"
    }
  }
}
```

### Environment

| Variable          | Default   | Description                                                                                                              |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`    | _(empty)_ | Personal access token for the GitHub API HTTP fallback (`github_*` tools); secret — never logged                         |
| `GH_TOKEN`        | _(empty)_ | Fallback for `GITHUB_TOKEN` (same variable the `gh` CLI uses)                                                            |
| `GITHUB_BASE_URL` | _(empty)_ | REST API base URL for the HTTP fallback; empty means `https://api.github.com` (set a GitHub Enterprise API URL for GHES) |
| `LOG_LEVEL`       | `info`    | pino level (`fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`); unknown values degrade to `info`                    |

All of them live in the repository root's `.env`; the entry point walks up
from `mcp/` to find it (`process.loadEnvFile`, existing variables win).

### MCP client configuration (stdio)

```json
{
  "mcpServers": {
    "swifty-agent2-mcp": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/absolute/path/to/swifty-agent2",
        "tsx",
        "mcp/src/main.ts"
      ],
      "env": {
        "GITHUB_TOKEN": "<personal access token — omit when the gh CLI is authenticated>"
      }
    }
  }
}
```

## Tools: `github_*`

Access to GitHub repositories. The repo-scoped tools take a `repo` argument —
an `owner/name` path (e.g. `hangtiancheng/swifty-agent2`) — and the search
tools take a GitHub query string.

| Tool                           | Kind  | Purpose                                                        |
| ------------------------------ | ----- | -------------------------------------------------------------- |
| `github_read_file`             | read  | Read a file's text content at a ref                            |
| `github_list_tree`             | read  | List files/directories at a path (recursive, flattened)        |
| `github_list_commits`          | read  | List recent commits on a ref                                   |
| `github_list_branches`         | read  | List branches (marks default / protected)                      |
| `github_list_tags`             | read  | List tags with the commit sha each one points at               |
| `github_get_repo`              | read  | Repository metadata: visibility, language, stars/forks, URLs   |
| `github_search_code`           | read  | Search file contents (GitHub code-search query syntax)         |
| `github_search_repositories`   | read  | Search repositories (name, language, stars, ...)               |
| `github_list_issues`           | read  | List issues (pull requests excluded), with labels and authors  |
| `github_list_pull_requests`    | read  | List pull requests with head/base refs and draft flag          |
| `github_create_repo`           | write | Create a repository under the user or an organization          |
| `github_create_issue`          | write | Open an issue (optional body, labels, assignees)               |
| `github_create_pull_request`   | write | Open a pull request from a head branch (optionally as a draft) |
| `github_create_branch`         | write | Create a branch from another branch, tag or sha                |
| `github_create_or_update_file` | write | Write one file's content to a branch in a single commit        |

### Backend selection

Each call picks a transport in this order:

1. **`gh` CLI** — when the `gh` executable is on PATH and `gh auth status`
   reports an authenticated login. Calls run through `gh api`, reusing the
   machine's existing GitHub credentials (keyring / `GH_TOKEN` / GHES host);
   no token passes through this process.
2. **HTTP + token** — otherwise, when `GITHUB_TOKEN` (or `GH_TOKEN`) is set:
   direct REST calls to `GITHUB_BASE_URL` (default `https://api.github.com`)
   with the token as a bearer token.
3. **Unavailable** — with neither, each `github_*` call answers with a clear
   error naming both options.

### `github_create_repo` arguments

| Argument      | Type    | Meaning                                                                  |
| ------------- | ------- | ------------------------------------------------------------------------ |
| `name`        | string  | Repository name                                                          |
| `owner`       | string? | Account/organization to create under; defaults to the authenticated user |
| `description` | string? | Repository description                                                   |
| `private`     | bool?   | `true` private / `false` public (account default when omitted)           |

With an `owner`, the client compares it against the authenticated login
(`GET /user`) to choose between `POST /user/repos` and
`POST /orgs/{org}/repos`; if `/user` is not accessible with the current
credentials the org endpoint is attempted.

### Behaviour notes

- `ref` is optional on the read tools and defaults to the repository's
  **default branch** (resolved via the repo object — GitHub repos are split
  between `main` and `master`, so nothing is guessed).
- `github_list_tree` uses the git trees API with `recursive=1` and filters
  by path prefix locally; a truncated tree response is logged as a warning.
  A `path` pointing at a single file returns exactly that file.
- File contents arrive base64-encoded from the contents API and are decoded
  to UTF-8 (invalid bytes are replaced, so binary files cannot crash a call).
  Files larger than the contents API's 1 MB inline limit are fetched through
  the git blobs API automatically.
- `github_list_issues` filters out the pull requests the issues endpoint also
  returns; use `github_list_pull_requests` for those. Note: GitHub's issues
  list is eventually consistent for a few seconds right after
  `github_create_issue`, so an immediate re-list may not show the new issue.
- `github_create_branch` resolves its base (branch, tag or sha; default
  branch when omitted) to a commit sha before creating the ref, and rejects
  invalid git branch names before any API call.
- `github_create_or_update_file` reads the target path first: an existing
  file is overwritten (its blob sha is sent along) and a missing one is
  created. The tool is annotated `destructiveHint` — it replaces the whole
  file content in a single commit.
- The HTTP transport follows API redirects (renamed repositories answer 301);
  Node's fetch drops the Authorization header when a redirect leaves the API
  origin, so the token cannot leak to a third host.

## Authentication (GitHub)

The `github_*` tools need no configuration when the local `gh` CLI is
authenticated — that is the preferred backend. The HTTP fallback
authenticates with a **personal access token** via the `GITHUB_TOKEN` (or
`GH_TOKEN`) environment variable:

- **No startup gate**: the server starts with or without either backend;
  each call degrades to a clear unavailable error naming both options.
- **Resolved per call**: the gh login state and the token are re-checked on
  every tool call, so `gh auth login` / `gh auth logout` or rotating the
  token takes effect without a code change (a server restart is only needed
  for env-var changes made outside the MCP client `env` block).
- **Security**: the token is only ever sent in an `Authorization: Bearer`
  header to the configured API base URL and is never logged; with the gh
  backend no token passes through this process at all.

## Project layout

```
src/
├── main.ts                  # entry point (stdio default, --http for HTTP) + shutdown
├── server.ts                # createServer(): McpServer + tool modules
├── version.ts
├── http.ts                  # h3 app: POST /mcp (streamable) + GET /sse, POST /messages (SSE)
├── shared/
│   ├── config.ts            # GITHUB_TOKEN / GITHUB_BASE_URL / MCP_HOST / MCP_PORT env parsing
│   └── logger.ts            # pino JSON -> stderr (stdout belongs to stdio MCP)
└── tools/
    ├── index.ts             # the tool-module registry
    ├── types.ts             # ToolModule interface
    └── github/              # gh-CLI/HTTP transports + GitHubClient + the github_* tools
tests/                       # vitest (config, client, tools, server, http transports)
```

## Development

All commands run from the repository root:

```bash
pnpm vitest run mcp/tests   # this server's test suite
pnpm typecheck              # tsc --noEmit (covers mcp/)
pnpm lint                   # eslint (covers mcp/)
```
