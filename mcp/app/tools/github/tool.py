"""MCP tool registration for GitHub repositories.

The tools prefer the local `gh` CLI when it is installed and authenticated
and fall back to the token-based HTTP transport otherwise; the choice is
made per call (see app/tools/github/transport.py).
"""

from __future__ import annotations

import mcp.types as types
from pydantic import BaseModel, Field

from app.shared.config import load_config
from app.shared.logger import logger
from app.shared.tools.host import ToolRegistry, register_model_tool
from app.tools.github.client import (
    BranchEntry,
    CommitEntry,
    GitHubClient,
    TreeEntry,
)
from app.tools.github.transport import (
    GitHubError,
    GitHubTransport,
    resolve_transport,
)
from app.tools.types import ToolModule

_REPO_DESCRIPTION = 'Repository as `owner/name` (e.g. "hangtiancheng/swifty-agent2").'
_REF_DESCRIPTION = (
    "Branch, tag or commit ref to read from. Defaults to the repository's "
    "default branch."
)

_READ_ONLY_ANNOTATIONS = types.ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=True,
)


class ReadFileArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    file_path: str = Field(
        min_length=1,
        description='Path to the file within the repository, e.g. "src/index.ts" or "readme.md".',
    )
    ref: str | None = Field(default=None, description=_REF_DESCRIPTION)


class ListTreeArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    path: str = Field(
        default="",
        description="Directory path within the repository; empty string for the root.",
    )
    ref: str | None = Field(default=None, description=_REF_DESCRIPTION)


class ListCommitsArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    ref: str | None = Field(default=None, description=_REF_DESCRIPTION)
    per_page: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Number of commits to return (1-100, default 20).",
    )


class ListBranchesArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    per_page: int = Field(
        default=50,
        ge=1,
        le=100,
        description="Number of branches to return (1-100, default 50).",
    )


class CreateRepoArgs(BaseModel):
    name: str = Field(min_length=1, description='Repository name, e.g. "my-new-repo".')
    owner: str | None = Field(
        default=None,
        description=(
            "Account or organization to create the repository under. Defaults to "
            "the authenticated user."
        ),
    )
    description: str | None = Field(
        default=None, description="Optional repository description."
    )
    private: bool | None = Field(
        default=None,
        description=(
            "true for a private repository, false for public. Defaults to the "
            "account default."
        ),
    )


def _error_message(err: Exception) -> str:
    return str(err)


def _error_result(err: Exception) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=f"✘ {_error_message(err)}")],
        is_error=True,
    )


def _unavailable() -> types.CallToolResult:
    """Name exactly what is missing, so the agent (or the person reading the
    tool result) knows how to make the tools usable."""
    return types.CallToolResult(
        content=[
            types.TextContent(
                type="text",
                text=(
                    "✘ github tools are unavailable: no authenticated `gh` CLI was "
                    "found and no GITHUB_TOKEN is set. Authenticate the gh CLI "
                    "(`gh auth login`) or set the GITHUB_TOKEN env var (MCP client "
                    "env or .env) to a personal access token with repo access."
                ),
            )
        ],
        is_error=True,
    )


def format_tree(entries: list[TreeEntry]) -> str:
    if not entries:
        return "(empty)"
    return "\n".join(f"{'📁' if e.type == 'tree' else '📄'} {e.path}" for e in entries)


def format_commits(entries: list[CommitEntry]) -> str:
    if not entries:
        return "(no commits)"
    lines: list[str] = []
    for c in entries:
        date = (c.authored_date or "")[:19].replace("T", " ")
        lines.append(f"{c.short_id}  {date}  {c.author_name}  {c.title}")
    return "\n".join(lines)


def format_branches(entries: list[BranchEntry]) -> str:
    if not entries:
        return "(no branches)"
    return "\n".join(
        f"{'* ' if b.default else '  '}{b.name}{' (protected)' if b.protected else ''}"
        for b in entries
    )


class GitHubModule(ToolModule):
    """The five github_* tools, backed by the gh CLI or a GITHUB_TOKEN."""

    name = "github"

    def register(self, registry: ToolRegistry) -> None:

        async def make_client() -> GitHubClient | None:
            """Resolve the transport per call from the environment.

            Per-call (rather than captured at registration) so configuration
            set after the server instance was built is picked up, and tests
            can monkeypatch the env freely.
            """
            github_config = load_config().github
            transport: GitHubTransport | None = await resolve_transport(
                token=github_config.token, base_url=github_config.base_url
            )
            if transport is None:
                return None
            return GitHubClient(transport)

        async def read_file(args: ReadFileArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                file = await client.read_file(args.repo, args.file_path, args.ref)
                logger.info(
                    "github_read_file ok",
                    repo=args.repo,
                    file_path=args.file_path,
                    ref=args.ref,
                )
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=file.content)],
                    structured_content={
                        "repo": args.repo,
                        "file_path": args.file_path,
                        "ref": args.ref,
                        "size": file.size,
                        "type": file.type,
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_read_file failed", err=str(err))
                return _error_result(err)

        async def list_tree(args: ListTreeArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                entries = await client.list_tree(
                    args.repo, path=args.path, ref=args.ref
                )
                logger.info(
                    "github_list_tree ok",
                    repo=args.repo,
                    path=args.path,
                    ref=args.ref,
                    count=len(entries),
                )
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=format_tree(entries))],
                    structured_content={
                        "repo": args.repo,
                        "path": args.path,
                        "ref": args.ref,
                        "count": len(entries),
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_list_tree failed", err=str(err))
                return _error_result(err)

        async def list_commits(args: ListCommitsArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                commits = await client.list_commits(
                    args.repo, ref=args.ref, per_page=args.per_page
                )
                logger.info(
                    "github_list_commits ok",
                    repo=args.repo,
                    ref=args.ref,
                    count=len(commits),
                )
                return types.CallToolResult(
                    content=[
                        types.TextContent(type="text", text=format_commits(commits))
                    ],
                    structured_content={
                        "repo": args.repo,
                        "ref": args.ref,
                        "count": len(commits),
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_list_commits failed", err=str(err))
                return _error_result(err)

        async def list_branches(args: ListBranchesArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                branches = await client.list_branches(args.repo, per_page=args.per_page)
                logger.info(
                    "github_list_branches ok", repo=args.repo, count=len(branches)
                )
                return types.CallToolResult(
                    content=[
                        types.TextContent(type="text", text=format_branches(branches))
                    ],
                    structured_content={
                        "repo": args.repo,
                        "count": len(branches),
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_list_branches failed", err=str(err))
                return _error_result(err)

        async def create_repo(args: CreateRepoArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                repo = await client.create_repo(
                    name=args.name,
                    owner=args.owner,
                    description=args.description,
                    private=args.private,
                )
                logger.info("github_create_repo ok", repo=repo.full_name, id=repo.id)
                lines = [f"Created {repo.full_name} (id {repo.id})"]
                if repo.html_url:
                    lines.append(f"web:  {repo.html_url}")
                if repo.clone_url:
                    lines.append(f"http: {repo.clone_url}")
                if repo.ssh_url:
                    lines.append(f"ssh:  {repo.ssh_url}")
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text="\n".join(lines))],
                    structured_content={
                        "id": repo.id,
                        "name": repo.name,
                        "full_name": repo.full_name,
                        "html_url": repo.html_url,
                        "clone_url": repo.clone_url,
                        "ssh_url": repo.ssh_url,
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_create_repo failed", err=str(err))
                return _error_result(err)

        register_model_tool(
            registry,
            name="github_read_file",
            title="GitHub Read File",
            description=(
                "Read a single file's text content from a GitHub repository at a "
                "given ref. Returns the raw file content."
            ),
            model=ReadFileArgs,
            handler=read_file,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_list_tree",
            title="GitHub List Tree",
            description=(
                "List the files and directories at a path in a GitHub repository "
                "(recursive, flattened). Useful for exploring a repo's structure."
            ),
            model=ListTreeArgs,
            handler=list_tree,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_list_commits",
            title="GitHub List Commits",
            description=(
                "List recent commits on a ref in a GitHub repository. Returns "
                "commit id, date, author and title."
            ),
            model=ListCommitsArgs,
            handler=list_commits,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_list_branches",
            title="GitHub List Branches",
            description=(
                "List branches of a GitHub repository. Marks the default and "
                "protected branches."
            ),
            model=ListBranchesArgs,
            handler=list_branches,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_create_repo",
            title="GitHub Create Repo",
            description=(
                "Create a new repository on GitHub, under the authenticated user "
                "or an organization. Returns the new repository's id, full name "
                "and clone URLs."
            ),
            model=CreateRepoArgs,
            handler=create_repo,
            annotations=types.ToolAnnotations(
                read_only_hint=False,
                destructive_hint=False,
                idempotent_hint=False,
                open_world_hint=True,
            ),
        )


github_module = GitHubModule()
