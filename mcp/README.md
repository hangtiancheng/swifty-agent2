# swifty-agent2-mcp (Python)

An MCP (Model Context Protocol) server that exposes a self-hosted GitLab
instance as tools for LLM agents, over the stdio transport.

This is a Python port of the TypeScript `swifty-agent2-mcp` server, built on:

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
- For the `gitlab_*` tools: a personal access token for the GitLab instance,
  set as `GITLAB_PRIVATE_TOKEN` (MCP client `env` block or `.env`) — see
  [Authentication](#authentication-gitlab-token). Without it the server still
  starts; the gitlab tools answer with a clear unavailable error per call.

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

| Variable               | Default   | Description                                                                        |
| ---------------------- | --------- | ---------------------------------------------------------------------------------- |
| `GITLAB_BASE_URL`      | _(empty)_ | Self-hosted GitLab instance URL; when unset the `gitlab_*` tools are unavailable   |
| `GITLAB_PRIVATE_TOKEN` | _(empty)_ | Personal access token for the GitLab API (`gitlab_*` tools); secret — never logged |

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
        "GITLAB_PRIVATE_TOKEN": "<personal access token>"
      }
    }
  }
}
```

## Tools: `gitlab_*`

Access to the GitLab instance configured via `GITLAB_BASE_URL`. The four
read tools take a `project` argument — either a `group/project` path (e.g.
`hangtiancheng/swifty-agent2`) or a numeric project id — and `gitlab_create_project` creates new
repositories. All tools authenticate with the `GITLAB_PRIVATE_TOKEN` env var
(a personal access token for the instance).

| Tool                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `gitlab_read_file`      | Read a file's text content at a ref                  |
| `gitlab_list_tree`      | List files/directories at a path                     |
| `gitlab_list_commits`   | List recent commits on a ref                         |
| `gitlab_list_branches`  | List branches (marks default / protected when known) |
| `gitlab_create_project` | Create a project (repository) in a namespace         |

### `gitlab_create_project` arguments

| Argument           | Type    | Meaning                                                                         |
| ------------------ | ------- | ------------------------------------------------------------------------------- |
| `name`             | string  | Repository name                                                                 |
| `namespace`        | string? | Namespace path (e.g. `hangtiancheng`), resolved to an id via the namespaces API |
| `namespace_id`     | int?    | Numeric namespace id; takes precedence over `namespace`                         |
| `description`      | string? | Repository description                                                          |
| `visibility_level` | int?    | `0` private / `10` internal / `20` public (instance default: internal)          |

One of `namespace` / `namespace_id` is required on instances that reject
creation without a valid namespace ("Namespace is not valid.").

### Authentication notes

The client authenticates with a personal access token via the
`private_token` query parameter on the v4 **repository** endpoints and the
v3 `namespaces` / `projects` endpoints (the same parameter standard GitLab
accepts). Endpoints that require an SSO cookie (project detail, merge
requests) are **not** reachable with a token alone, so those operations are
not exposed. If a request is redirected to a login page the client reports
an authentication error rather than following the redirect.

### Behaviour notes

- Some self-hosted instances (older forks) return every branch as a plain
  name string (no `default` / `protected` flags) and ignore `per_page`. The
  client normalizes the entries to `{ name }` objects and enforces the page
  size locally; standard GitLab object entries pass through unchanged.
- Project creation goes through the **v3** API: some instances answer
  `POST /api/v4/projects` with 405 and require an explicit `namespace_id`.
  The namespaces API only exposes namespaces visible to the token.

## Authentication (GitLab token)

The `gitlab_*` tools authenticate with a **personal access token** supplied
via the `GITLAB_PRIVATE_TOKEN` environment variable (MCP client `env` block
or `.env`). There is no startup login and no credential gate:

- **No startup gate**: the server starts with or without the token. When it
  is unset, each `gitlab_*` call answers with a clear unavailable error
  naming the variable to set.
- **Resolved per call**: the token is read from the environment on every
  tool call, so rotating it only requires restarting the server process.
- **Security**: the token is only ever appended to request URLs sent to the
  GitLab instance and is never logged or returned to callers.

All tests live in `tests/` (flat) and run under one `uv run pytest`.

## Project layout

```
app/
├── main.py                  # typer CLI entry (stdio)
├── server.py                # create_server(): registry + tool modules
├── version.py
├── shared/
│   ├── config.py            # GITLAB_BASE_URL / GITLAB_PRIVATE_TOKEN env parsing
│   ├── logger.py            # structlog JSON -> stderr (stdout belongs to stdio MCP)
│   └── tools/
│       └── host.py          # ToolRegistry driving the SDK's tools/list + tools/call
└── tools/
    ├── types.py             # ToolModule protocol
    └── gitlab/              # GitLabClient + the five gitlab_* tools
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

Working agreements live in [AGENTS.md](AGENTS.md): English for all in-repo
artifacts (comments, logs, docs, commit messages), the gates above must pass
before every commit, one commit per verified batch.
