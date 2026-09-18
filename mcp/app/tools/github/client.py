"""Minimal GitHub client over a pluggable transport.

The client knows the REST endpoints and response shapes; how a request
physically reaches GitHub (an authenticated `gh` CLI subprocess or a bearer
token HTTP call) is decided by the transport it is constructed with — see
app/tools/github/transport.py. Responses are normalized into the pydantic
models below so the tool layer never sees raw API payloads.
"""

from __future__ import annotations

import base64
from typing import Any
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict

from app.shared.logger import logger
from app.tools.github.transport import GitHubError, GitHubTransport


def encode_repo(repo: str) -> str:
    """Validate an `owner/name` repository path and URL-encode it for API paths.

    Raises GitHubError for anything that is not exactly `owner/name`, so a
    malformed argument fails before it is interpolated into a URL.
    """
    parts = repo.strip().split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise GitHubError(
            'Repository must be an `owner/name` path (e.g. "hangtiancheng/swifty-agent2"), '
            f'got "{repo}".'
        )
    return f"{quote(parts[0], safe='')}/{quote(parts[1], safe='')}"


class TreeEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    #: "blob" for files, "tree" for directories (git tree terminology).
    type: str
    path: str
    mode: str | None = None
    size: int | None = None


class CommitEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    short_id: str
    title: str
    author_name: str
    author_email: str | None = None
    authored_date: str | None = None


class BranchEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    default: bool | None = None
    protected: bool | None = None


class FileContent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content: str
    size: int | None = None
    type: str | None = None


class CreatedRepo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str
    full_name: str
    description: str | None = None
    private: bool | None = None
    default_branch: str | None = None
    html_url: str | None = None
    clone_url: str | None = None
    ssh_url: str | None = None


class GitHubClient:
    """The five github_* operations, transport-agnostic."""

    def __init__(self, transport: GitHubTransport) -> None:
        self._transport = transport

    async def get_default_branch(self, repo: str) -> str:
        """The repository's default branch (GitHub always reports one)."""
        data = await self._transport.request("GET", f"/repos/{encode_repo(repo)}")
        default = data.get("default_branch") if isinstance(data, dict) else None
        if not isinstance(default, str) or not default:
            raise GitHubError(f"GitHub did not report a default branch for {repo}.")
        return default

    async def _resolve_ref(self, repo: str, ref: str | None) -> str:
        """An explicit ref passes through; None resolves to the default branch
        (GitHub repos are split between `main` and `master`, so guessing is
        not an option)."""
        return ref if ref else await self.get_default_branch(repo)

    async def read_file(
        self,
        repo: str,
        file_path: str,
        ref: str | None = None,
    ) -> FileContent:
        """Read a file's text content at a ref via the contents API."""
        resolved_ref = await self._resolve_ref(repo, ref)
        encoded_path = quote(file_path.strip("/"), safe="/")
        data = await self._transport.request(
            "GET",
            f"/repos/{encode_repo(repo)}/contents/{encoded_path}",
            query={"ref": resolved_ref},
        )
        if not isinstance(data, dict):
            raise GitHubError(f"GitHub returned no file metadata for {file_path}.")

        entry_type = data.get("type")
        if entry_type != "file":
            raise GitHubError(
                f'"{file_path}" is not a regular file (type: {entry_type}).'
            )
        raw_content = data.get("content")
        if not isinstance(raw_content, str):
            raise GitHubError(f"GitHub returned no readable content for {file_path}.")
        if data.get("encoding") == "base64":
            text = base64.b64decode(raw_content).decode("utf-8", errors="replace")
        else:
            text = raw_content
        size = data.get("size")
        return FileContent(
            content=text,
            size=size if isinstance(size, int) else None,
            type=entry_type,
        )

    async def list_tree(
        self,
        repo: str,
        *,
        path: str = "",
        ref: str | None = None,
    ) -> list[TreeEntry]:
        """List the repository tree at a path/ref (recursive, flattened).

        Uses the git trees API with `recursive=1` and filters by path prefix
        locally, so one call gives the agent the whole subtree.
        """
        resolved_ref = await self._resolve_ref(repo, ref)
        data = await self._transport.request(
            "GET",
            f"/repos/{encode_repo(repo)}/git/trees/{quote(resolved_ref, safe='')}",
            query={"recursive": "1"},
        )
        if not isinstance(data, dict) or not isinstance(data.get("tree"), list):
            raise GitHubError(f"GitHub returned no tree for {repo} at {resolved_ref}.")
        if data.get("truncated"):
            logger.warning(
                "github tree truncated", repo=repo, path=path, ref=resolved_ref
            )

        prefix = path.strip("/")
        entries: list[TreeEntry] = []
        for raw in data["tree"]:
            if not isinstance(raw, dict):
                continue
            entry_path = raw.get("path")
            sha = raw.get("sha")
            entry_type = raw.get("type")
            if (
                not isinstance(entry_path, str)
                or not isinstance(sha, str)
                or not isinstance(entry_type, str)
            ):
                continue
            if prefix and not entry_path.startswith(f"{prefix}/"):
                continue
            size = raw.get("size")
            mode = raw.get("mode")
            entries.append(
                TreeEntry(
                    id=sha,
                    name=entry_path.rsplit("/", 1)[-1],
                    type=entry_type,
                    path=entry_path,
                    mode=mode if isinstance(mode, str) else None,
                    size=size if isinstance(size, int) else None,
                )
            )
        return entries

    async def list_commits(
        self,
        repo: str,
        *,
        ref: str | None = None,
        per_page: int = 20,
    ) -> list[CommitEntry]:
        """List commits on a ref."""
        resolved_ref = await self._resolve_ref(repo, ref)
        data = await self._transport.request(
            "GET",
            f"/repos/{encode_repo(repo)}/commits",
            query={"sha": resolved_ref, "per_page": per_page},
        )
        if not isinstance(data, list):
            raise GitHubError(f"GitHub returned no commit list for {repo}.")

        entries: list[CommitEntry] = []
        for raw in data:
            if not isinstance(raw, dict):
                continue
            sha = raw.get("sha")
            if not isinstance(sha, str):
                continue
            commit = raw.get("commit")
            commit = commit if isinstance(commit, dict) else {}
            author = commit.get("author")
            author = author if isinstance(author, dict) else {}
            message = commit.get("message")
            message = message if isinstance(message, str) else ""
            email = author.get("email")
            date = author.get("date")
            entries.append(
                CommitEntry(
                    id=sha,
                    short_id=sha[:8],
                    title=message.split("\n", 1)[0],
                    author_name=author.get("name") or "",
                    author_email=email if isinstance(email, str) else None,
                    authored_date=date if isinstance(date, str) else None,
                )
            )
        return entries

    async def list_branches(
        self,
        repo: str,
        *,
        per_page: int = 50,
    ) -> list[BranchEntry]:
        """List branches; the default one is marked via the repository object
        (the branches endpoint itself does not say which one is default)."""
        default_branch = await self.get_default_branch(repo)
        data = await self._transport.request(
            "GET",
            f"/repos/{encode_repo(repo)}/branches",
            query={"per_page": per_page},
        )
        if not isinstance(data, list):
            raise GitHubError(f"GitHub returned no branch list for {repo}.")

        entries: list[BranchEntry] = []
        for raw in data:
            if not isinstance(raw, dict):
                continue
            name = raw.get("name")
            if not isinstance(name, str) or not name:
                continue
            protected = raw.get("protected")
            entries.append(
                BranchEntry(
                    name=name,
                    default=name == default_branch,
                    protected=protected if isinstance(protected, bool) else None,
                )
            )
        return entries

    async def create_repo(
        self,
        *,
        name: str,
        owner: str | None = None,
        description: str | None = None,
        private: bool | None = None,
    ) -> CreatedRepo:
        """Create a repository under the authenticated user or an organization.

        GitHub has two creation endpoints: POST /user/repos (the
        authenticated user) and POST /orgs/{org}/repos (an organization).
        When `owner` is given it is compared against the authenticated login
        to pick the right one; if the login cannot be determined the org
        endpoint is attempted.
        """
        endpoint = "/user/repos"
        if owner and owner.strip():
            wanted = owner.strip()
            login = await self._authenticated_login()
            if login is None or login.lower() != wanted.lower():
                endpoint = f"/orgs/{quote(wanted, safe='')}/repos"

        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        if private is not None:
            body["private"] = private
        data = await self._transport.request("POST", endpoint, json_body=body)
        return CreatedRepo.model_validate(data)

    async def _authenticated_login(self) -> str | None:
        """The authenticated user's login, or None when /user is not
        accessible with the current credentials (e.g. a narrowly scoped
        token)."""
        try:
            data = await self._transport.request("GET", "/user")
        except GitHubError:
            return None
        login = data.get("login") if isinstance(data, dict) else None
        return login if isinstance(login, str) and login else None
