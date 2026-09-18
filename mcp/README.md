# swifty-agent2-mcp (Python)

An MCP (Model Context Protocol) server that exposes GitHub repositories as
tools for LLM agents, over the stdio transport.

- the official [`mcp` Python SDK](https://github.com/modelcontextprotocol/python-sdk)
  (stdio transport)
- **httpx** for all outbound HTTP, **pydantic** for schemas and settings,
  **typer** for the CLI, **structlog** for stderr-only JSON logging
- **uv** for dependency management — this directory is part of the single uv
  project at the repository root (`../pyproject.toml` + `../uv.lock`); it has
  no `pyproject.toml`, lockfile or `.python-version` of its own

## Requirements

- Python >= 3.13 (pinned by the repository root's `.python-version`),
  [uv](https://docs.astral.sh/uv/)
- For the `github_*` tools: either an installed and authenticated
  [`gh` CLI](https://cli.github.com/) (`gh auth login`) — the preferred
  backend — or a personal access token set as `GITHUB_TOKEN` (or `GH_TOKEN`)
  for the HTTP fallback. Without either, the server still starts; the github
  tools answer with a clear unavailable error per call.

## Setup

From the repository root (the single uv project):

```bash
uv sync                 # install runtime + dev dependencies
uv run pytest           # tests (testpaths = mcp/tests)
uv run --with mypy mypy # strict type checking (files scoped in pyproject.toml)
uv run ruff check .     # lint
```

## Running

The root project is not installed as a package (`package = false`), so there
is no console script. Run the server as a module with `mcp/` as the working
directory, so the `app` package resolves:

```bash
cd mcp && uv run python -m app.main
```

CLI flags:

| Flag            | Description               |
| --------------- | ------------------------- |
| `-v, --version` | Show the version and exit |

### Environment

| Variable          | Default   | Description                                                                                                              |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`    | _(empty)_ | Personal access token for the GitHub API HTTP fallback (`github_*` tools); secret — never logged                         |
| `GH_TOKEN`        | _(empty)_ | Fallback for `GITHUB_TOKEN` (same variable the `gh` CLI uses)                                                            |
| `GITHUB_BASE_URL` | _(empty)_ | REST API base URL for the HTTP fallback; empty means `https://api.github.com` (set a GitHub Enterprise API URL for GHES) |

All three live in the repository root's `.env` (see `../.env.example`);
`load_dotenv()` walks up from `mcp/` to find it.

### MCP client configuration (stdio)

```json
{
  "mcpServers": {
    "swifty-agent2-mcp": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/absolute/path/to/swifty-agent2/mcp",
        "python",
        "-m",
        "app.main"
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
  httpx drops the Authorization header when a redirect leaves the API origin,
  so the token cannot leak to a third host.

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

All tests live in `tests/` (flat) and run under one `uv run pytest`.

## Project layout

```
app/
├── main.py                  # typer CLI entry (stdio)
├── server.py                # create_server(): registry + tool modules
├── version.py
├── shared/
│   ├── config.py            # GITHUB_TOKEN / GITHUB_BASE_URL env parsing
│   ├── logger.py            # structlog JSON -> stderr (stdout belongs to stdio MCP)
│   └── tools/
│       └── host.py          # ToolRegistry driving the SDK's tools/list + tools/call
└── tools/
    ├── types.py             # ToolModule protocol
    └── github/              # gh-CLI/HTTP transports + GitHubClient + the github_* tools
tests/                       # pytest + respx + pytest-asyncio
```

## Development

All commands run from the repository root (the single uv project):

```bash
uv run pytest                                # full suite (testpaths = mcp/tests)
uv run ruff check mcp --fix                  # lint + autofix
uv run ruff format mcp                       # format
uv run --with mypy mypy                      # strict type check (mcp + train subtrees)
```
