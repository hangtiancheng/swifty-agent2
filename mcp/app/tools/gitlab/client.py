"""HTTP client for a self-hosted GitLab instance.

Authentication: a personal access token via the `private_token` query
parameter. This client targets the token-accessible surface of older
self-hosted forks (the behavior below was measured against such an
instance, and standard GitLab accepts the same query parameter on these
endpoints):

- v4 repository endpoints (tree / blobs / commits / branches);
- v3 `namespaces` / `projects` — project creation goes through v3 because
  some instances answer POST /api/v4/projects with 405 and require an
  explicit namespace_id ("Namespace is not valid." without one);
- a 301/302 redirect is treated as an auth failure (instances fronted by
  SSO redirect unauthenticated API calls to a login page);
- endpoints that require an SSO cookie (project detail, merge requests) are
  NOT reachable with a token alone and are deliberately not wrapped.

The token comes from the GITLAB_PRIVATE_TOKEN env var and the base URL from
GITLAB_BASE_URL (see app/shared/config.py). The token is secret: only ever
appended to request URLs and never logged.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict

#: Requests are low-frequency and the instance is on an internal network;
#: generous bounds that still cannot hang a tool call forever.
REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class GitLabError(RuntimeError):
    """Raised for non-2xx responses or auth redirects."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def encode_project_ref(project: str) -> str:
    """URL-encode a `group/project` path for use as a project id in the URL."""
    return quote(project.strip(), safe="")


class TreeEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    type: str
    path: str
    mode: str
    size: int | None = None


class CommitEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    short_id: str | None = None
    title: str | None = None
    message: str | None = None
    author_name: str
    author_email: str
    authored_date: str


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


class NamespaceEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    kind: str | None = None
    path: str


class CreatedProject(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str
    path: str
    path_with_namespace: str
    description: str | None = None
    visibility_level: int | None = None
    default_branch: str | None = None
    web_url: str | None = None
    http_url_to_repo: str | None = None
    ssh_url_to_repo: str | None = None


class GitLabClient:
    """Minimal GitLab client.

    Every request appends `private_token` and treats a 301/302 redirect as an
    auth failure (the instance redirects unauthenticated API calls to the
    login page).
    """

    def __init__(self, base_url: str, private_token: str) -> None:
        if not private_token:
            raise GitLabError(
                "No GitLab private token: set the GITLAB_PRIVATE_TOKEN env var "
                "(MCP client env or .env) to a personal access token with API access."
            )
        self._base_url = base_url
        self._private_token = private_token

    async def _request(
        self,
        method: str,
        api_path: str,
        *,
        query: dict[str, str | int] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        """Shared request plumbing: the token goes in the query string and a
        redirect is treated as an auth failure."""
        params: dict[str, str] = {"private_token": self._private_token}
        for key, value in (query or {}).items():
            params[key] = str(value)

        headers: dict[str, str] = {"accept": "application/json"}
        if json_body is not None:
            headers["content-type"] = "application/json"

        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT, follow_redirects=False
        ) as client:
            # A 302 to the login page means the token was rejected; do not follow
            # it (following would return HTML and mask the auth failure).
            response = await client.request(
                method,
                f"{self._base_url}{api_path}",
                params=params,
                headers=headers,
                json=json_body,
            )

        if response.status_code in (301, 302):
            raise GitLabError(
                f"Authentication failed for {api_path} (redirected to login). "
                "The token may be invalid or lack access.",
                response.status_code,
            )
        if response.status_code < 200 or response.status_code >= 300:
            body = response.text[:200]
            raise GitLabError(
                f"GitLab API error {response.status_code} for {api_path}: {body}",
                response.status_code,
            )

        return response.json()

    async def list_tree(
        self,
        project: str,
        *,
        path: str = "",
        ref: str = "master",
    ) -> list[TreeEntry]:
        """List the repository tree at a path/ref."""
        data = await self._request(
            "GET",
            f"/api/v4/projects/{encode_project_ref(project)}/repository/tree",
            query={"path": path, "ref_name": ref, "type": "FLATTEN"},
        )
        return [TreeEntry.model_validate(entry) for entry in data]

    async def read_file(
        self,
        project: str,
        file_path: str,
        ref: str = "master",
    ) -> FileContent:
        """Read a file's text content at a ref."""
        data = await self._request(
            "GET",
            f"/api/v4/projects/{encode_project_ref(project)}/repository/blobs",
            query={"filepath": file_path, "ref": ref},
        )
        return FileContent.model_validate(data)

    async def list_commits(
        self,
        project: str,
        *,
        ref: str = "master",
        per_page: int = 20,
    ) -> list[CommitEntry]:
        """List commits on a ref."""
        data = await self._request(
            "GET",
            f"/api/v4/projects/{encode_project_ref(project)}/repository/commits",
            query={"ref_name": ref, "per_page": per_page},
        )
        return [CommitEntry.model_validate(entry) for entry in data]

    async def list_branches(
        self,
        project: str,
        *,
        per_page: int = 50,
    ) -> list[BranchEntry]:
        """List branches.

        Some self-hosted instances return every branch as a plain name string
        (not an object with `name`/`default`/`protected`) and ignore
        `per_page`, so the entries are normalized and the page size is
        enforced locally here. Standard GitLab object entries pass through.
        """
        data = await self._request(
            "GET",
            f"/api/v4/projects/{encode_project_ref(project)}/repository/branches",
            query={"per_page": per_page},
        )
        entries: list[BranchEntry] = []
        for raw in data[:per_page]:
            if isinstance(raw, str):
                entries.append(BranchEntry(name=raw))
            else:
                entries.append(BranchEntry.model_validate(raw))
        return entries

    async def list_namespaces(self, search: str | None = None) -> list[NamespaceEntry]:
        """List namespaces visible to the token, optionally filtered by a search
        string. On instances that gate personal namespaces behind SSO this
        returns the groups the user can access only."""
        query: dict[str, str | int] | None = {"search": search} if search else None
        data = await self._request("GET", "/api/v3/namespaces", query=query)
        return [NamespaceEntry.model_validate(entry) for entry in data]

    async def resolve_namespace_id(self, namespace_path: str) -> int:
        """Resolve a namespace path (e.g. "hangtiancheng") to its numeric id."""
        wanted = namespace_path.strip().lower()
        entries = await self.list_namespaces(wanted)
        for entry in entries:
            if entry.path.lower() == wanted:
                return entry.id
        raise GitLabError(
            f'Namespace "{wanted}" not found among the namespaces visible to this token.'
        )

    async def create_project(
        self,
        *,
        name: str,
        namespace_id: int | None = None,
        description: str | None = None,
        visibility_level: int | None = None,
    ) -> CreatedProject:
        """Create a project (repository).

        Uses the v3 API because some instances reject POST /api/v4/projects
        with 405, and require an explicit namespace_id ("Namespace is not
        valid." without one), so callers should resolve it first (see
        resolve_namespace_id).
        """
        body: dict[str, Any] = {"name": name}
        if namespace_id is not None:
            body["namespace_id"] = namespace_id
        if description is not None:
            body["description"] = description
        if visibility_level is not None:
            body["visibility_level"] = visibility_level
        data = await self._request("POST", "/api/v3/projects", json_body=body)
        return CreatedProject.model_validate(data)
