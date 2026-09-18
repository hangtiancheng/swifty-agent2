"""MCP tool registration for GitHub repositories.

The tools prefer the local `gh` CLI when it is installed and authenticated
and fall back to the token-based HTTP transport otherwise; the choice is
made per call (see app/tools/github/transport.py).
"""

from __future__ import annotations

from typing import Literal

import mcp.types as types
from pydantic import BaseModel, Field

from app.shared.config import load_config
from app.shared.logger import logger
from app.shared.tools.host import ToolRegistry, register_model_tool
from app.tools.github.client import (
    BranchEntry,
    CodeSearchHit,
    CommitEntry,
    GitHubClient,
    IssueEntry,
    PullRequestEntry,
    RepoInfo,
    RepoSearchHit,
    TagEntry,
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
_STATE_DESCRIPTION = 'Which entries to return: "open", "closed" or "all".'

_READ_ONLY_ANNOTATIONS = types.ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=True,
)

_WRITE_ANNOTATIONS = types.ToolAnnotations(
    read_only_hint=False,
    destructive_hint=False,
    idempotent_hint=False,
    open_world_hint=True,
)

IssueState = Literal["open", "closed", "all"]


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


class GetRepoArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)


class SearchCodeArgs(BaseModel):
    query: str = Field(
        min_length=1,
        description=(
            'GitHub code-search query, e.g. "TODO repo:owner/name" or '
            '"class MilvusClient language:python". Scope qualifiers (repo:, '
            "language:, path:, filename:) are part of the query string."
        ),
    )
    per_page: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Number of matches to return (1-100, default 20).",
    )


class SearchRepositoriesArgs(BaseModel):
    query: str = Field(
        min_length=1,
        description=(
            'GitHub repository-search query, e.g. "milvus language:python stars:>1000".'
        ),
    )
    per_page: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Number of repositories to return (1-100, default 20).",
    )


class ListTagsArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    per_page: int = Field(
        default=50,
        ge=1,
        le=100,
        description="Number of tags to return (1-100, default 50).",
    )


class ListIssuesArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    state: IssueState = Field(default="open", description=_STATE_DESCRIPTION)
    per_page: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Number of issues to return (1-100, default 20).",
    )


class CreateIssueArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    title: str = Field(min_length=1, description="Issue title.")
    body: str | None = Field(
        default=None, description="Optional issue body (markdown)."
    )
    labels: list[str] | None = Field(
        default=None, description="Optional label names to attach."
    )
    assignees: list[str] | None = Field(
        default=None, description="Optional user logins to assign."
    )


class ListPullRequestsArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    state: IssueState = Field(default="open", description=_STATE_DESCRIPTION)
    per_page: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Number of pull requests to return (1-100, default 20).",
    )


class CreatePullRequestArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    title: str = Field(min_length=1, description="Pull request title.")
    head: str = Field(
        min_length=1,
        description=(
            'Branch containing the changes, e.g. "feature-x" (or "user:branch" '
            "for a cross-repository pull request)."
        ),
    )
    base: str | None = Field(
        default=None,
        description=(
            "Branch to merge into. Defaults to the repository's default branch."
        ),
    )
    body: str | None = Field(
        default=None, description="Optional pull request body (markdown)."
    )
    draft: bool = Field(
        default=False, description="true to open the pull request as a draft."
    )


class CreateBranchArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    branch: str = Field(min_length=1, description='New branch name, e.g. "feature-x".')
    from_ref: str | None = Field(
        default=None,
        description=(
            "Branch, tag or commit sha to branch from. Defaults to the "
            "repository's default branch."
        ),
    )


class CreateOrUpdateFileArgs(BaseModel):
    repo: str = Field(min_length=1, description=_REPO_DESCRIPTION)
    file_path: str = Field(
        min_length=1,
        description='Path of the file within the repository, e.g. "docs/notes.md".',
    )
    content: str = Field(description="Full new text content of the file (UTF-8).")
    message: str = Field(min_length=1, description="Commit message for the change.")
    branch: str | None = Field(
        default=None,
        description=(
            "Branch to write to. Defaults to the repository's default branch."
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


def format_repo(info: RepoInfo) -> str:
    lines = [f"{info.full_name} (id {info.id})"]
    if info.description:
        lines.append(f"description: {info.description}")
    visibility = "private" if info.private else "public"
    language = f"language: {info.language}  " if info.language else ""
    stars = (
        f"stars: {info.stargazers_count}  " if info.stargazers_count is not None else ""
    )
    forks = f"forks: {info.forks_count}  " if info.forks_count is not None else ""
    issues = (
        f"open issues: {info.open_issues_count}"
        if info.open_issues_count is not None
        else ""
    )
    lines.append(f"{visibility}  {language}{stars}{forks}{issues}".rstrip())
    if info.default_branch:
        lines.append(f"default branch: {info.default_branch}")
    if info.created_at:
        lines.append(f"created: {info.created_at[:10]}")
    if info.updated_at:
        lines.append(f"updated: {info.updated_at[:10]}")
    if info.html_url:
        lines.append(f"web: {info.html_url}")
    return "\n".join(lines)


def format_code_hits(entries: list[CodeSearchHit]) -> str:
    if not entries:
        return "(no matches)"
    return "\n".join(f"{h.repository}  {h.path}" for h in entries)


def format_repo_hits(entries: list[RepoSearchHit]) -> str:
    if not entries:
        return "(no matches)"
    lines: list[str] = []
    for h in entries:
        stars = f"★{h.stargazers_count} " if h.stargazers_count is not None else ""
        language = f"[{h.language}] " if h.language else ""
        description = f"— {h.description}" if h.description else ""
        lines.append(f"{h.full_name} {stars}{language}{description}".rstrip())
    return "\n".join(lines)


def format_tags(entries: list[TagEntry]) -> str:
    if not entries:
        return "(no tags)"
    return "\n".join(
        f"{t.name}  {t.commit_sha[:8] if t.commit_sha else ''}".rstrip()
        for t in entries
    )


def format_issues(entries: list[IssueEntry]) -> str:
    if not entries:
        return "(no issues)"
    lines: list[str] = []
    for issue in entries:
        labels = f" [{', '.join(issue.labels)}]" if issue.labels else ""
        author = f" by {issue.author}" if issue.author else ""
        date = f" on {(issue.created_at or '')[:10]}" if issue.created_at else ""
        lines.append(
            f"#{issue.number} [{issue.state}] {issue.title}{labels}{author}{date}"
        )
    return "\n".join(lines)


def format_pull_requests(entries: list[PullRequestEntry]) -> str:
    if not entries:
        return "(no pull requests)"
    lines: list[str] = []
    for pr in entries:
        state = f"{pr.state}{', draft' if pr.draft else ''}"
        refs = ""
        if pr.head_ref and pr.base_ref:
            refs = f" ({pr.head_ref} → {pr.base_ref})"
        author = f" by {pr.author}" if pr.author else ""
        lines.append(f"#{pr.number} [{state}] {pr.title}{refs}{author}")
    return "\n".join(lines)


class GitHubModule(ToolModule):
    """The github_* tools, backed by the gh CLI or a GITHUB_TOKEN."""

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

        async def get_repo(args: GetRepoArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                info = await client.get_repo(args.repo)
                logger.info("github_get_repo ok", repo=info.full_name)
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=format_repo(info))],
                    structured_content={
                        "id": info.id,
                        "full_name": info.full_name,
                        "private": info.private,
                        "default_branch": info.default_branch,
                        "language": info.language,
                        "stargazers_count": info.stargazers_count,
                        "forks_count": info.forks_count,
                        "open_issues_count": info.open_issues_count,
                        "html_url": info.html_url,
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_get_repo failed", err=str(err))
                return _error_result(err)

        async def search_code(args: SearchCodeArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                hits = await client.search_code(args.query, per_page=args.per_page)
                logger.info("github_search_code ok", query=args.query, count=len(hits))
                return types.CallToolResult(
                    content=[
                        types.TextContent(type="text", text=format_code_hits(hits))
                    ],
                    structured_content={"query": args.query, "count": len(hits)},
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_search_code failed", err=str(err))
                return _error_result(err)

        async def search_repositories(
            args: SearchRepositoriesArgs,
        ) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                hits = await client.search_repositories(
                    args.query, per_page=args.per_page
                )
                logger.info(
                    "github_search_repositories ok", query=args.query, count=len(hits)
                )
                return types.CallToolResult(
                    content=[
                        types.TextContent(type="text", text=format_repo_hits(hits))
                    ],
                    structured_content={"query": args.query, "count": len(hits)},
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_search_repositories failed", err=str(err))
                return _error_result(err)

        async def list_tags(args: ListTagsArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                tags = await client.list_tags(args.repo, per_page=args.per_page)
                logger.info("github_list_tags ok", repo=args.repo, count=len(tags))
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=format_tags(tags))],
                    structured_content={"repo": args.repo, "count": len(tags)},
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_list_tags failed", err=str(err))
                return _error_result(err)

        async def list_issues(args: ListIssuesArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                issues = await client.list_issues(
                    args.repo, state=args.state, per_page=args.per_page
                )
                logger.info(
                    "github_list_issues ok",
                    repo=args.repo,
                    state=args.state,
                    count=len(issues),
                )
                return types.CallToolResult(
                    content=[
                        types.TextContent(type="text", text=format_issues(issues))
                    ],
                    structured_content={
                        "repo": args.repo,
                        "state": args.state,
                        "count": len(issues),
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_list_issues failed", err=str(err))
                return _error_result(err)

        async def create_issue(args: CreateIssueArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                issue = await client.create_issue(
                    args.repo,
                    title=args.title,
                    body=args.body,
                    labels=args.labels,
                    assignees=args.assignees,
                )
                logger.info(
                    "github_create_issue ok", repo=args.repo, number=issue.number
                )
                lines = [f"Created issue #{issue.number}: {issue.title}"]
                if issue.html_url:
                    lines.append(f"web: {issue.html_url}")
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text="\n".join(lines))],
                    structured_content={
                        "repo": args.repo,
                        "number": issue.number,
                        "title": issue.title,
                        "state": issue.state,
                        "html_url": issue.html_url,
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_create_issue failed", err=str(err))
                return _error_result(err)

        async def list_pull_requests(
            args: ListPullRequestsArgs,
        ) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                pulls = await client.list_pull_requests(
                    args.repo, state=args.state, per_page=args.per_page
                )
                logger.info(
                    "github_list_pull_requests ok",
                    repo=args.repo,
                    state=args.state,
                    count=len(pulls),
                )
                return types.CallToolResult(
                    content=[
                        types.TextContent(type="text", text=format_pull_requests(pulls))
                    ],
                    structured_content={
                        "repo": args.repo,
                        "state": args.state,
                        "count": len(pulls),
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_list_pull_requests failed", err=str(err))
                return _error_result(err)

        async def create_pull_request(
            args: CreatePullRequestArgs,
        ) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                pr = await client.create_pull_request(
                    args.repo,
                    title=args.title,
                    head=args.head,
                    base=args.base,
                    body=args.body,
                    draft=args.draft,
                )
                logger.info(
                    "github_create_pull_request ok", repo=args.repo, number=pr.number
                )
                lines = [f"Created pull request #{pr.number}: {pr.title}"]
                if pr.html_url:
                    lines.append(f"web: {pr.html_url}")
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text="\n".join(lines))],
                    structured_content={
                        "repo": args.repo,
                        "number": pr.number,
                        "title": pr.title,
                        "state": pr.state,
                        "html_url": pr.html_url,
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_create_pull_request failed", err=str(err))
                return _error_result(err)

        async def create_branch(args: CreateBranchArgs) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                created = await client.create_branch(
                    args.repo, branch=args.branch, from_ref=args.from_ref
                )
                logger.info("github_create_branch ok", repo=args.repo, ref=created.ref)
                return types.CallToolResult(
                    content=[
                        types.TextContent(
                            type="text",
                            text=f"Created {created.ref} at {created.sha[:8]}",
                        )
                    ],
                    structured_content={
                        "repo": args.repo,
                        "ref": created.ref,
                        "sha": created.sha,
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_create_branch failed", err=str(err))
                return _error_result(err)

        async def create_or_update_file(
            args: CreateOrUpdateFileArgs,
        ) -> types.CallToolResult:
            client = await make_client()
            if client is None:
                return _unavailable()
            try:
                written = await client.create_or_update_file(
                    args.repo,
                    file_path=args.file_path,
                    content=args.content,
                    message=args.message,
                    branch=args.branch,
                )
                logger.info(
                    "github_create_or_update_file ok",
                    repo=args.repo,
                    file_path=written.path,
                    created=written.created,
                )
                verb = "Created" if written.created else "Updated"
                lines = [f"{verb} {written.path} in {args.repo}"]
                if written.html_url:
                    lines.append(f"web: {written.html_url}")
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text="\n".join(lines))],
                    structured_content={
                        "repo": args.repo,
                        "path": written.path,
                        "blob_sha": written.blob_sha,
                        "html_url": written.html_url,
                        "created": written.created,
                    },
                )
            except (GitHubError, RuntimeError) as err:
                logger.warning("github_create_or_update_file failed", err=str(err))
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
        register_model_tool(
            registry,
            name="github_get_repo",
            title="GitHub Get Repo",
            description=(
                "Get a GitHub repository's metadata: description, visibility, "
                "language, star/fork/open-issue counts, default branch and URLs."
            ),
            model=GetRepoArgs,
            handler=get_repo,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_search_code",
            title="GitHub Search Code",
            description=(
                "Search file contents across GitHub with the code-search query "
                'syntax (e.g. "TODO repo:owner/name", "class Foo language:python"). '
                "Returns the matching repository and file path for each hit."
            ),
            model=SearchCodeArgs,
            handler=search_code,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_search_repositories",
            title="GitHub Search Repositories",
            description=(
                "Search GitHub repositories by name, description, language, stars "
                'and other qualifiers (e.g. "milvus language:python stars:>1000").'
            ),
            model=SearchRepositoriesArgs,
            handler=search_repositories,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_list_tags",
            title="GitHub List Tags",
            description=(
                "List tags of a GitHub repository with the commit sha each tag "
                "points at."
            ),
            model=ListTagsArgs,
            handler=list_tags,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_list_issues",
            title="GitHub List Issues",
            description=(
                "List issues of a GitHub repository (pull requests are excluded). "
                "Returns number, state, title, labels, author and date."
            ),
            model=ListIssuesArgs,
            handler=list_issues,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_create_issue",
            title="GitHub Create Issue",
            description=(
                "Create a new issue in a GitHub repository, optionally with a "
                "markdown body, labels and assignees. Returns the issue number "
                "and URL."
            ),
            model=CreateIssueArgs,
            handler=create_issue,
            annotations=_WRITE_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_list_pull_requests",
            title="GitHub List Pull Requests",
            description=(
                "List pull requests of a GitHub repository. Returns number, "
                "state (with draft flag), title, head/base refs and author."
            ),
            model=ListPullRequestsArgs,
            handler=list_pull_requests,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_create_pull_request",
            title="GitHub Create Pull Request",
            description=(
                "Open a pull request in a GitHub repository from a head branch "
                "into a base branch (the default branch when base is omitted). "
                "Returns the pull request number and URL."
            ),
            model=CreatePullRequestArgs,
            handler=create_pull_request,
            annotations=_WRITE_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_create_branch",
            title="GitHub Create Branch",
            description=(
                "Create a new branch in a GitHub repository, pointing at another "
                "branch, tag or commit sha (the default branch when omitted). "
                "Returns the created ref and commit sha."
            ),
            model=CreateBranchArgs,
            handler=create_branch,
            annotations=_WRITE_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="github_create_or_update_file",
            title="GitHub Create or Update File",
            description=(
                "Write one file's full text content to a branch of a GitHub "
                "repository in a single commit: creates the file when it does "
                "not exist and overwrites it when it does. Returns the blob sha "
                "and whether the file was created or updated."
            ),
            model=CreateOrUpdateFileArgs,
            handler=create_or_update_file,
            annotations=types.ToolAnnotations(
                read_only_hint=False,
                destructive_hint=True,
                idempotent_hint=False,
                open_world_hint=True,
            ),
        )


github_module = GitHubModule()
