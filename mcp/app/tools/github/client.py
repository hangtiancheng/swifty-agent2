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


#: Characters git forbids anywhere in a ref name (whitespace and C0 control
#: characters are rejected separately in validate_branch_name).
_INVALID_REF_CHARS = frozenset("~^:?*[\\")


def validate_branch_name(branch: str) -> str:
    """Validate a new branch name against git's ref rules (the common subset).

    Raises GitHubError early so a malformed name never reaches the API.
    """
    name = branch.strip()
    invalid = (
        not name
        or name.startswith(("/", "-", "."))
        or name.endswith(("/", "."))
        or name.endswith(".lock")
        or ".." in name
        or "@{" in name
        or any(c in _INVALID_REF_CHARS or c.isspace() or ord(c) < 32 for c in name)
    )
    if invalid:
        raise GitHubError(f'"{branch}" is not a valid git branch name.')
    return name


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


class RepoInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str
    full_name: str
    description: str | None = None
    private: bool | None = None
    default_branch: str | None = None
    html_url: str | None = None
    language: str | None = None
    stargazers_count: int | None = None
    forks_count: int | None = None
    open_issues_count: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CodeSearchHit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    #: `owner/name` of the repository the match lives in.
    repository: str
    path: str
    html_url: str | None = None
    score: float | None = None


class RepoSearchHit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    full_name: str
    description: str | None = None
    private: bool | None = None
    html_url: str | None = None
    language: str | None = None
    stargazers_count: int | None = None
    updated_at: str | None = None


class TagEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    commit_sha: str | None = None


class IssueEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    number: int
    title: str
    state: str
    author: str | None = None
    labels: list[str] = []
    html_url: str | None = None
    created_at: str | None = None


class CreatedIssue(BaseModel):
    model_config = ConfigDict(extra="ignore")

    number: int
    title: str
    state: str | None = None
    html_url: str | None = None


class PullRequestEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    number: int
    title: str
    state: str
    draft: bool | None = None
    author: str | None = None
    head_ref: str | None = None
    base_ref: str | None = None
    html_url: str | None = None
    created_at: str | None = None


class CreatedPullRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    number: int
    title: str
    state: str | None = None
    html_url: str | None = None


class CreatedBranch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    #: The created git ref, e.g. `refs/heads/feature-x`.
    ref: str
    #: Commit sha the new branch points at.
    sha: str


class WrittenFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    path: str
    #: Blob sha of the written content.
    blob_sha: str | None = None
    html_url: str | None = None
    #: True when the file did not exist before, False when it was overwritten.
    created: bool


class GitHubClient:
    """The github_* operations, transport-agnostic."""

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
        size = data.get("size")
        size = size if isinstance(size, int) else None
        if raw_content == "" and size:
            # The contents API inlines at most 1 MB; larger files come back with
            # an empty body and must be fetched through the git blobs API.
            blob_sha = data.get("sha")
            if not isinstance(blob_sha, str) or not blob_sha:
                raise GitHubError(
                    f"GitHub returned no content for {file_path} and no blob to fetch."
                )
            blob = await self._transport.request(
                "GET", f"/repos/{encode_repo(repo)}/git/blobs/{blob_sha}"
            )
            if not isinstance(blob, dict) or not isinstance(blob.get("content"), str):
                raise GitHubError(f"GitHub returned no blob content for {file_path}.")
            blob_size = blob.get("size")
            text = base64.b64decode(blob["content"]).decode("utf-8", errors="replace")
            return FileContent(
                content=text,
                size=blob_size if isinstance(blob_size, int) else size,
                type=entry_type,
            )
        if data.get("encoding") == "base64":
            text = base64.b64decode(raw_content).decode("utf-8", errors="replace")
        else:
            text = raw_content
        return FileContent(
            content=text,
            size=size,
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
            if prefix:
                # Subtree entries pass the prefix filter; a prefix pointing at a
                # single file matches that blob exactly (the directory entry
                # itself stays excluded, so `path="src"` lists src's children).
                if not entry_path.startswith(f"{prefix}/") and not (
                    entry_path == prefix and entry_type == "blob"
                ):
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

    async def get_repo(self, repo: str) -> RepoInfo:
        """Repository metadata: visibility, language, counters, URLs."""
        data = await self._transport.request("GET", f"/repos/{encode_repo(repo)}")
        if not isinstance(data, dict):
            raise GitHubError(f"GitHub returned no repository metadata for {repo}.")
        return RepoInfo.model_validate(data)

    async def search_code(
        self, query: str, *, per_page: int = 20
    ) -> list[CodeSearchHit]:
        """Search file contents across GitHub.

        `query` is GitHub's code-search syntax (e.g. `TODO repo:owner/name`);
        scoping to one repository is part of the query string.
        """
        data = await self._transport.request(
            "GET", "/search/code", query={"q": query, "per_page": per_page}
        )
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            raise GitHubError(f"GitHub returned no code search results for {query!r}.")

        entries: list[CodeSearchHit] = []
        for raw in data["items"]:
            if not isinstance(raw, dict):
                continue
            path = raw.get("path")
            if not isinstance(path, str):
                continue
            repository = raw.get("repository")
            full_name = (
                repository.get("full_name") if isinstance(repository, dict) else None
            )
            html_url = raw.get("html_url")
            score = raw.get("score")
            entries.append(
                CodeSearchHit(
                    repository=full_name if isinstance(full_name, str) else "",
                    path=path,
                    html_url=html_url if isinstance(html_url, str) else None,
                    score=score if isinstance(score, int | float) else None,
                )
            )
        return entries

    async def search_repositories(
        self, query: str, *, per_page: int = 20
    ) -> list[RepoSearchHit]:
        """Search repositories across GitHub (e.g. `milvus language:python`)."""
        data = await self._transport.request(
            "GET", "/search/repositories", query={"q": query, "per_page": per_page}
        )
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            raise GitHubError(
                f"GitHub returned no repository search results for {query!r}."
            )

        entries: list[RepoSearchHit] = []
        for raw in data["items"]:
            if not isinstance(raw, dict):
                continue
            full_name = raw.get("full_name")
            repo_id = raw.get("id")
            if not isinstance(full_name, str) or not isinstance(repo_id, int):
                continue
            entries.append(RepoSearchHit.model_validate(raw))
        return entries

    async def list_tags(self, repo: str, *, per_page: int = 50) -> list[TagEntry]:
        """List tags (name + the commit sha each one points at)."""
        data = await self._transport.request(
            "GET", f"/repos/{encode_repo(repo)}/tags", query={"per_page": per_page}
        )
        if not isinstance(data, list):
            raise GitHubError(f"GitHub returned no tag list for {repo}.")

        entries: list[TagEntry] = []
        for raw in data:
            if not isinstance(raw, dict):
                continue
            name = raw.get("name")
            if not isinstance(name, str) or not name:
                continue
            commit = raw.get("commit")
            sha = commit.get("sha") if isinstance(commit, dict) else None
            entries.append(
                TagEntry(
                    name=name,
                    commit_sha=sha if isinstance(sha, str) else None,
                )
            )
        return entries

    async def list_issues(
        self, repo: str, *, state: str = "open", per_page: int = 20
    ) -> list[IssueEntry]:
        """List issues. The issues endpoint also returns pull requests, so
        entries carrying a `pull_request` key are skipped."""
        data = await self._transport.request(
            "GET",
            f"/repos/{encode_repo(repo)}/issues",
            query={"state": state, "per_page": per_page},
        )
        if not isinstance(data, list):
            raise GitHubError(f"GitHub returned no issue list for {repo}.")

        entries: list[IssueEntry] = []
        for raw in data:
            if not isinstance(raw, dict) or "pull_request" in raw:
                continue
            number = raw.get("number")
            if not isinstance(number, int):
                continue
            title = raw.get("title")
            issue_state = raw.get("state")
            user = raw.get("user")
            login = user.get("login") if isinstance(user, dict) else None
            labels: list[str] = []
            raw_labels = raw.get("labels")
            if isinstance(raw_labels, list):
                for label in raw_labels:
                    if isinstance(label, str):
                        labels.append(label)
                    elif isinstance(label, dict) and isinstance(label.get("name"), str):
                        labels.append(label["name"])
            html_url = raw.get("html_url")
            created_at = raw.get("created_at")
            entries.append(
                IssueEntry(
                    number=number,
                    title=title if isinstance(title, str) else "",
                    state=issue_state if isinstance(issue_state, str) else "open",
                    author=login if isinstance(login, str) else None,
                    labels=labels,
                    html_url=html_url if isinstance(html_url, str) else None,
                    created_at=created_at if isinstance(created_at, str) else None,
                )
            )
        return entries

    async def create_issue(
        self,
        repo: str,
        *,
        title: str,
        body: str | None = None,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> CreatedIssue:
        """Open a new issue."""
        payload: dict[str, Any] = {"title": title}
        if body is not None:
            payload["body"] = body
        if labels:
            payload["labels"] = labels
        if assignees:
            payload["assignees"] = assignees
        data = await self._transport.request(
            "POST", f"/repos/{encode_repo(repo)}/issues", json_body=payload
        )
        if not isinstance(data, dict):
            raise GitHubError(f"GitHub returned no created issue for {repo}.")
        return CreatedIssue.model_validate(data)

    async def list_pull_requests(
        self, repo: str, *, state: str = "open", per_page: int = 20
    ) -> list[PullRequestEntry]:
        """List pull requests."""
        data = await self._transport.request(
            "GET",
            f"/repos/{encode_repo(repo)}/pulls",
            query={"state": state, "per_page": per_page},
        )
        if not isinstance(data, list):
            raise GitHubError(f"GitHub returned no pull request list for {repo}.")

        entries: list[PullRequestEntry] = []
        for raw in data:
            if not isinstance(raw, dict):
                continue
            number = raw.get("number")
            if not isinstance(number, int):
                continue
            title = raw.get("title")
            pr_state = raw.get("state")
            draft = raw.get("draft")
            user = raw.get("user")
            login = user.get("login") if isinstance(user, dict) else None
            head = raw.get("head")
            base = raw.get("base")
            head_ref = head.get("ref") if isinstance(head, dict) else None
            base_ref = base.get("ref") if isinstance(base, dict) else None
            html_url = raw.get("html_url")
            created_at = raw.get("created_at")
            entries.append(
                PullRequestEntry(
                    number=number,
                    title=title if isinstance(title, str) else "",
                    state=pr_state if isinstance(pr_state, str) else "open",
                    draft=draft if isinstance(draft, bool) else None,
                    author=login if isinstance(login, str) else None,
                    head_ref=head_ref if isinstance(head_ref, str) else None,
                    base_ref=base_ref if isinstance(base_ref, str) else None,
                    html_url=html_url if isinstance(html_url, str) else None,
                    created_at=created_at if isinstance(created_at, str) else None,
                )
            )
        return entries

    async def create_pull_request(
        self,
        repo: str,
        *,
        title: str,
        head: str,
        base: str | None = None,
        body: str | None = None,
        draft: bool = False,
    ) -> CreatedPullRequest:
        """Open a pull request from `head` into `base` (default branch when
        `base` is omitted)."""
        payload: dict[str, Any] = {"title": title, "head": head}
        if base:
            payload["base"] = base
        if body is not None:
            payload["body"] = body
        if draft:
            payload["draft"] = True
        data = await self._transport.request(
            "POST", f"/repos/{encode_repo(repo)}/pulls", json_body=payload
        )
        if not isinstance(data, dict):
            raise GitHubError(f"GitHub returned no created pull request for {repo}.")
        return CreatedPullRequest.model_validate(data)

    async def create_branch(
        self, repo: str, *, branch: str, from_ref: str | None = None
    ) -> CreatedBranch:
        """Create a branch from another ref (branch, tag or sha; the
        repository's default branch when omitted)."""
        name = validate_branch_name(branch)
        base = from_ref.strip() if from_ref and from_ref.strip() else None
        resolved_base = base or await self.get_default_branch(repo)
        # Resolve the base ref to a commit sha; one endpoint covers branches,
        # tags and shas alike.
        commit = await self._transport.request(
            "GET", f"/repos/{encode_repo(repo)}/commits/{quote(resolved_base, safe='')}"
        )
        sha = commit.get("sha") if isinstance(commit, dict) else None
        if not isinstance(sha, str) or not sha:
            raise GitHubError(
                f"GitHub could not resolve ref {resolved_base!r} in {repo}."
            )
        ref = f"refs/heads/{name}"
        data = await self._transport.request(
            "POST",
            f"/repos/{encode_repo(repo)}/git/refs",
            json_body={"ref": ref, "sha": sha},
        )
        if not isinstance(data, dict):
            raise GitHubError(f"GitHub returned no created ref for {ref}.")
        obj = data.get("object")
        obj_sha = obj.get("sha") if isinstance(obj, dict) else None
        created_ref = data.get("ref")
        return CreatedBranch(
            ref=created_ref if isinstance(created_ref, str) else ref,
            sha=obj_sha if isinstance(obj_sha, str) else sha,
        )

    async def create_or_update_file(
        self,
        repo: str,
        *,
        file_path: str,
        content: str,
        message: str,
        branch: str | None = None,
    ) -> WrittenFile:
        """Write one file on a branch via the contents API (create or overwrite).

        Updates require the current blob sha, so an existing file is read
        first; a 404 there means the file is created.
        """
        path = file_path.strip("/")
        if not path:
            raise GitHubError("file_path must not be empty.")
        resolved_branch = branch.strip() if branch and branch.strip() else None
        resolved_branch = resolved_branch or await self.get_default_branch(repo)
        contents_path = f"/repos/{encode_repo(repo)}/contents/{quote(path, safe='/')}"

        existing_sha: str | None = None
        try:
            existing = await self._transport.request(
                "GET", contents_path, query={"ref": resolved_branch}
            )
        except GitHubError as err:
            if err.status != 404:
                raise
        else:
            if isinstance(existing, list) or (
                isinstance(existing, dict) and existing.get("type") == "dir"
            ):
                raise GitHubError(
                    f'"{file_path}" exists as a directory in {repo}; '
                    "cannot write a file there."
                )
            if isinstance(existing, dict):
                sha = existing.get("sha")
                if isinstance(sha, str) and sha:
                    existing_sha = sha

        payload: dict[str, Any] = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": resolved_branch,
        }
        if existing_sha:
            payload["sha"] = existing_sha
        data = await self._transport.request("PUT", contents_path, json_body=payload)
        if not isinstance(data, dict):
            raise GitHubError(f"GitHub returned no write result for {file_path}.")
        written = data.get("content")
        blob_sha = written.get("sha") if isinstance(written, dict) else None
        html_url = written.get("html_url") if isinstance(written, dict) else None
        return WrittenFile(
            path=path,
            blob_sha=blob_sha if isinstance(blob_sha, str) else None,
            html_url=html_url if isinstance(html_url, str) else None,
            created=existing_sha is None,
        )

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
