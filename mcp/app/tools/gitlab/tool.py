"""MCP tool registration for the configured self-hosted GitLab instance."""

from __future__ import annotations

from typing import Literal

import mcp.types as types
from pydantic import BaseModel, Field

from app.shared.config import load_config
from app.shared.logger import logger
from app.shared.tools.host import ToolRegistry, register_model_tool
from app.tools.gitlab.client import (
    BranchEntry,
    CommitEntry,
    GitLabClient,
    GitLabError,
    TreeEntry,
)
from app.tools.types import ToolModule

_PROJECT_DESCRIPTION = 'Project path as `group/project` (e.g. "hangtiancheng/swifty-agent2") or a numeric project id.'
_REF_DESCRIPTION = 'Branch, tag or commit ref to read from. Defaults to "master".'

_READ_ONLY_ANNOTATIONS = types.ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=True,
)


class ReadFileArgs(BaseModel):
    project: str = Field(min_length=1, description=_PROJECT_DESCRIPTION)
    file_path: str = Field(
        min_length=1,
        description='Path to the file within the repository, e.g. "src/index.ts" or "readme.md".',
    )
    ref: str = Field(default="master", description=_REF_DESCRIPTION)


class ListTreeArgs(BaseModel):
    project: str = Field(min_length=1, description=_PROJECT_DESCRIPTION)
    path: str = Field(
        default="",
        description="Directory path within the repository; empty string for the root.",
    )
    ref: str = Field(default="master", description=_REF_DESCRIPTION)


class ListCommitsArgs(BaseModel):
    project: str = Field(min_length=1, description=_PROJECT_DESCRIPTION)
    ref: str = Field(default="master", description=_REF_DESCRIPTION)
    per_page: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Number of commits to return (1-100, default 20).",
    )


class ListBranchesArgs(BaseModel):
    project: str = Field(min_length=1, description=_PROJECT_DESCRIPTION)
    per_page: int = Field(
        default=50,
        ge=1,
        le=100,
        description="Number of branches to return (1-100, default 50).",
    )


class CreateProjectArgs(BaseModel):
    name: str = Field(min_length=1, description='Repository name, e.g. "my-new-repo".')
    namespace: str | None = Field(
        default=None,
        description=(
            'Namespace path (e.g. "hangtiancheng"), resolved to a namespace id via the '
            "namespaces API. Ignored when namespace_id is given."
        ),
    )
    namespace_id: int | None = Field(
        default=None,
        description="Numeric namespace id; takes precedence over namespace.",
    )
    description: str | None = Field(
        default=None, description="Optional repository description."
    )
    visibility_level: Literal[0, 10, 20] | None = Field(
        default=None,
        description=(
            "0 = private, 10 = internal, 20 = public. Defaults to the instance default (internal)."
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
    tool result) knows which env var to set."""
    gitlab_config = load_config().gitlab
    missing: list[str] = []
    if not gitlab_config.base_url:
        missing.append("GITLAB_BASE_URL (the GitLab instance URL)")
    if not gitlab_config.private_token:
        missing.append("GITLAB_PRIVATE_TOKEN (a personal access token with API access)")
    return types.CallToolResult(
        content=[
            types.TextContent(
                type="text",
                text=(
                    "✘ gitlab tools are unavailable: missing "
                    + " and ".join(missing)
                    + ". Set them in the environment (MCP client env or .env)."
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
        commit_id = c.short_id or c.id[:8]
        date = (c.authored_date or "")[:19].replace("T", " ")
        title = c.title or (c.message or "").split("\n")[0]
        lines.append(f"{commit_id}  {date}  {c.author_name}  {title}")
    return "\n".join(lines)


def format_branches(entries: list[BranchEntry]) -> str:
    if not entries:
        return "(no branches)"
    return "\n".join(
        f"{'* ' if b.default else '  '}{b.name}{' (protected)' if b.protected else ''}"
        for b in entries
    )


class GitLabModule(ToolModule):
    """The five gitlab_* tools, authenticated with the GITLAB_PRIVATE_TOKEN env var."""

    name = "gitlab"

    def register(self, registry: ToolRegistry) -> None:

        def make_client() -> GitLabClient | None:
            """Resolve the connection settings per call from the environment.

            Per-call (rather than captured at registration) so configuration
            set after the server instance was built is picked up, and tests
            can monkeypatch the env freely.
            """
            gitlab_config = load_config().gitlab
            if not gitlab_config.base_url or not gitlab_config.private_token:
                return None
            return GitLabClient(
                base_url=gitlab_config.base_url,
                private_token=gitlab_config.private_token,
            )

        async def read_file(args: ReadFileArgs) -> types.CallToolResult:
            client = make_client()
            if client is None:
                return _unavailable()
            try:
                file = await client.read_file(args.project, args.file_path, args.ref)
                logger.info(
                    "gitlab_read_file ok",
                    project=args.project,
                    file_path=args.file_path,
                    ref=args.ref,
                )
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=file.content)],
                    structured_content={
                        "project": args.project,
                        "file_path": args.file_path,
                        "ref": args.ref,
                        "size": file.size,
                        "type": file.type,
                    },
                )
            except (GitLabError, RuntimeError) as err:
                logger.warning("gitlab_read_file failed", err=str(err))
                return _error_result(err)

        async def list_tree(args: ListTreeArgs) -> types.CallToolResult:
            client = make_client()
            if client is None:
                return _unavailable()
            try:
                entries = await client.list_tree(
                    args.project, path=args.path, ref=args.ref
                )
                logger.info(
                    "gitlab_list_tree ok",
                    project=args.project,
                    path=args.path,
                    ref=args.ref,
                    count=len(entries),
                )
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=format_tree(entries))],
                    structured_content={
                        "project": args.project,
                        "path": args.path,
                        "ref": args.ref,
                        "count": len(entries),
                    },
                )
            except (GitLabError, RuntimeError) as err:
                logger.warning("gitlab_list_tree failed", err=str(err))
                return _error_result(err)

        async def list_commits(args: ListCommitsArgs) -> types.CallToolResult:
            client = make_client()
            if client is None:
                return _unavailable()
            try:
                commits = await client.list_commits(
                    args.project, ref=args.ref, per_page=args.per_page
                )
                logger.info(
                    "gitlab_list_commits ok",
                    project=args.project,
                    ref=args.ref,
                    count=len(commits),
                )
                return types.CallToolResult(
                    content=[
                        types.TextContent(type="text", text=format_commits(commits))
                    ],
                    structured_content={
                        "project": args.project,
                        "ref": args.ref,
                        "count": len(commits),
                    },
                )
            except (GitLabError, RuntimeError) as err:
                logger.warning("gitlab_list_commits failed", err=str(err))
                return _error_result(err)

        async def list_branches(args: ListBranchesArgs) -> types.CallToolResult:
            client = make_client()
            if client is None:
                return _unavailable()
            try:
                branches = await client.list_branches(
                    args.project, per_page=args.per_page
                )
                logger.info(
                    "gitlab_list_branches ok", project=args.project, count=len(branches)
                )
                return types.CallToolResult(
                    content=[
                        types.TextContent(type="text", text=format_branches(branches))
                    ],
                    structured_content={
                        "project": args.project,
                        "count": len(branches),
                    },
                )
            except (GitLabError, RuntimeError) as err:
                logger.warning("gitlab_list_branches failed", err=str(err))
                return _error_result(err)

        async def create_project(args: CreateProjectArgs) -> types.CallToolResult:
            client = make_client()
            if client is None:
                return _unavailable()
            if args.namespace_id is None and not args.namespace:
                return types.CallToolResult(
                    content=[
                        types.TextContent(
                            type="text",
                            text=(
                                "✘ This GitLab instance requires a namespace to create a "
                                'project: pass namespace_id, or namespace (e.g. "hangtiancheng").'
                            ),
                        )
                    ],
                    is_error=True,
                )
            try:
                namespace_id = args.namespace_id
                if namespace_id is None:
                    namespace_id = await client.resolve_namespace_id(
                        args.namespace or ""
                    )
                project = await client.create_project(
                    name=args.name,
                    namespace_id=namespace_id,
                    description=args.description,
                    visibility_level=args.visibility_level,
                )
                logger.info(
                    "gitlab_create_project ok",
                    project=project.path_with_namespace,
                    id=project.id,
                )
                lines = [f"Created {project.path_with_namespace} (id {project.id})"]
                if project.web_url:
                    lines.append(f"web:  {project.web_url}")
                if project.http_url_to_repo:
                    lines.append(f"http: {project.http_url_to_repo}")
                if project.ssh_url_to_repo:
                    lines.append(f"ssh:  {project.ssh_url_to_repo}")
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text="\n".join(lines))],
                    structured_content={
                        "id": project.id,
                        "name": project.name,
                        "path_with_namespace": project.path_with_namespace,
                        "web_url": project.web_url,
                        "http_url_to_repo": project.http_url_to_repo,
                        "ssh_url_to_repo": project.ssh_url_to_repo,
                    },
                )
            except (GitLabError, RuntimeError) as err:
                logger.warning("gitlab_create_project failed", err=str(err))
                return _error_result(err)

        register_model_tool(
            registry,
            name="gitlab_read_file",
            title="GitLab Read File",
            description=(
                "Read a single file's text content from a repository on the configured "
                "self-hosted GitLab instance at a given ref. Returns the raw file content."
            ),
            model=ReadFileArgs,
            handler=read_file,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="gitlab_list_tree",
            title="GitLab List Tree",
            description=(
                "List the files and directories at a path in a repository on the configured "
                "self-hosted GitLab instance. Useful for exploring a repo's structure."
            ),
            model=ListTreeArgs,
            handler=list_tree,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="gitlab_list_commits",
            title="GitLab List Commits",
            description=(
                "List recent commits on a ref in a repository on the configured self-hosted "
                "GitLab instance. Returns commit id, date, author and title."
            ),
            model=ListCommitsArgs,
            handler=list_commits,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="gitlab_list_branches",
            title="GitLab List Branches",
            description=(
                "List branches of a repository on the configured self-hosted GitLab instance. "
                "Marks the default and protected branches when the instance provides that "
                "information (some instances return plain branch names only)."
            ),
            model=ListBranchesArgs,
            handler=list_branches,
            annotations=_READ_ONLY_ANNOTATIONS,
        )
        register_model_tool(
            registry,
            name="gitlab_create_project",
            title="GitLab Create Project",
            description=(
                "Create a new project (repository) on the configured self-hosted GitLab "
                "instance. Some instances require an explicit namespace: pass namespace_id, "
                'or namespace (a group path such as "hangtiancheng") which is resolved to its id. '
                "Returns the new project's id, path and clone URLs."
            ),
            model=CreateProjectArgs,
            handler=create_project,
            annotations=types.ToolAnnotations(
                read_only_hint=False,
                destructive_hint=False,
                idempotent_hint=False,
                open_world_hint=True,
            ),
        )


gitlab_module = GitLabModule()
