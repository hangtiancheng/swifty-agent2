"""GitHub client behaviour: endpoint mapping, payload normalization and the
two transports (an authenticated `gh` CLI subprocess vs bearer-token HTTP).

The gh CLI is exercised through a fake `gh` shell script on PATH, so the
tests cover the real subprocess plumbing without touching the network or
the developer's own gh login.
"""

from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from app.tools.github.client import GitHubClient, encode_repo
from app.tools.github.transport import (
    GhCliTransport,
    GitHubError,
    HttpTransport,
    gh_cli_is_available,
    resolve_transport,
)

REPO = "hangtiancheng/swifty-agent2"
API_BASE = "https://api.github.com"


@dataclass
class RecordedRequest:
    method: str
    api_path: str
    query: dict[str, str | int] | None
    json_body: dict[str, Any] | None


class FakeTransport:
    """Returns canned responses in order and records every request."""

    def __init__(self) -> None:
        self.requests: list[RecordedRequest] = []
        self.responses: list[Any] = []
        self.raise_on: set[str] = set()

    def enqueue(self, response: Any) -> None:
        self.responses.append(response)

    async def request(
        self,
        method: str,
        api_path: str,
        *,
        query: Mapping[str, str | int] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        self.requests.append(
            RecordedRequest(method, api_path, dict(query) if query else None, json_body)
        )
        if api_path in self.raise_on:
            raise GitHubError(f"boom for {api_path}", 403)
        assert self.responses, "FakeTransport ran out of canned responses"
        return self.responses.pop(0)


def _client() -> tuple[GitHubClient, FakeTransport]:
    transport = FakeTransport()
    return GitHubClient(transport), transport


def _write_fake_gh(tmp_path: Path, script: str) -> Path:
    """A fake `gh` executable whose behaviour is the given sh script body."""
    gh = tmp_path / "gh"
    gh.write_text(f"#!/bin/sh\n{script}\n")
    gh.chmod(0o755)
    return gh


def _use_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """PATH contains only tmp_path: `gh` resolves to the fake one (or none)."""
    monkeypatch.setenv("PATH", str(tmp_path))


# --- encode_repo -----------------------------------------------------------


def test_encode_repo_keeps_a_plain_owner_name_path() -> None:
    assert encode_repo(REPO) == REPO


def test_encode_repo_percent_encodes_unsafe_characters() -> None:
    assert encode_repo("my org/my repo") == "my%20org/my%20repo"


def test_encode_repo_trims_surrounding_whitespace() -> None:
    assert encode_repo(f"  {REPO}  ") == REPO


@pytest.mark.parametrize("bad", ["", "just-a-name", "a/b/c", "/repo", "owner/"])
def test_encode_repo_rejects_paths_that_are_not_owner_name(bad: str) -> None:
    with pytest.raises(GitHubError, match="owner/name"):
        encode_repo(bad)


# --- read_file -------------------------------------------------------------


async def test_read_file_resolves_the_default_branch_when_ref_is_omitted() -> None:
    client, transport = _client()
    transport.enqueue({"default_branch": "main"})
    transport.enqueue(
        {
            "type": "file",
            "encoding": "base64",
            "content": base64.b64encode(b"hello world").decode("ascii"),
            "size": 11,
        }
    )

    file = await client.read_file(REPO, "readme.md")

    assert file.content == "hello world"
    assert file.size == 11
    assert file.type == "file"
    assert transport.requests[0].api_path == f"/repos/{REPO}"
    assert transport.requests[1].api_path == f"/repos/{REPO}/contents/readme.md"
    assert transport.requests[1].query == {"ref": "main"}


async def test_read_file_with_an_explicit_ref_skips_the_repo_lookup() -> None:
    client, transport = _client()
    transport.enqueue(
        {
            "type": "file",
            "encoding": "base64",
            "content": base64.b64encode(b"hi").decode("ascii"),
            "size": 2,
        }
    )

    file = await client.read_file(REPO, "readme.md", "dev/0.0.1")

    assert file.content == "hi"
    assert len(transport.requests) == 1
    assert transport.requests[0].query == {"ref": "dev/0.0.1"}


async def test_read_file_rejects_paths_that_are_not_regular_files() -> None:
    client, transport = _client()
    transport.enqueue({"type": "dir"})

    with pytest.raises(GitHubError, match="not a regular file"):
        await client.read_file(REPO, "src", "main")


# --- list_tree -------------------------------------------------------------


def _tree_response() -> dict[str, Any]:
    return {
        "sha": "t",
        "truncated": False,
        "tree": [
            {"path": "src", "type": "tree", "sha": "s1", "mode": "040000"},
            {
                "path": "src/index.ts",
                "type": "blob",
                "sha": "s2",
                "mode": "100644",
                "size": 10,
            },
            {
                "path": "src/util/helpers.ts",
                "type": "blob",
                "sha": "s3",
                "mode": "100644",
                "size": 5,
            },
            {"path": "readme.md", "type": "blob", "sha": "s4", "mode": "100644"},
        ],
    }


async def test_list_tree_returns_the_flattened_tree_at_the_root() -> None:
    client, transport = _client()
    transport.enqueue({"default_branch": "main"})
    transport.enqueue(_tree_response())

    entries = await client.list_tree(REPO)

    assert [e.path for e in entries] == [
        "src",
        "src/index.ts",
        "src/util/helpers.ts",
        "readme.md",
    ]
    assert transport.requests[1].api_path == f"/repos/{REPO}/git/trees/main"
    assert transport.requests[1].query == {"recursive": "1"}


async def test_list_tree_filters_by_path_prefix() -> None:
    client, transport = _client()
    transport.enqueue(_tree_response())

    entries = await client.list_tree(REPO, path="src", ref="main")

    # The prefix directory itself is excluded; only its subtree is listed.
    assert [e.path for e in entries] == ["src/index.ts", "src/util/helpers.ts"]


async def test_list_tree_names_entries_after_their_last_path_segment() -> None:
    client, transport = _client()
    transport.enqueue(_tree_response())

    entries = await client.list_tree(REPO, path="src/util", ref="main")

    assert [e.name for e in entries] == ["helpers.ts"]
    assert entries[0].size == 5


# --- list_commits ----------------------------------------------------------


async def test_list_commits_maps_the_nested_commit_shape() -> None:
    client, transport = _client()
    transport.enqueue(
        [
            {
                "sha": "a" * 40,
                "commit": {
                    "message": "feat: x\n\nbody",
                    "author": {
                        "name": "A",
                        "email": "a@example.com",
                        "date": "2026-09-18T10:00:00Z",
                    },
                },
            }
        ]
    )

    commits = await client.list_commits(REPO, ref="main", per_page=5)

    assert len(commits) == 1
    commit = commits[0]
    assert commit.id == "a" * 40
    assert commit.short_id == "a" * 8
    assert commit.title == "feat: x"
    assert commit.author_name == "A"
    assert commit.author_email == "a@example.com"
    assert commit.authored_date == "2026-09-18T10:00:00Z"
    assert transport.requests[0].api_path == f"/repos/{REPO}/commits"
    assert transport.requests[0].query == {"sha": "main", "per_page": 5}


# --- list_branches ---------------------------------------------------------


async def test_list_branches_marks_the_default_and_protected_flags() -> None:
    client, transport = _client()
    transport.enqueue({"default_branch": "main"})
    transport.enqueue(
        [
            {"name": "main", "protected": True},
            {"name": "dev/0.0.1", "protected": False},
        ]
    )

    branches = await client.list_branches(REPO)

    assert [(b.name, b.default, b.protected) for b in branches] == [
        ("main", True, True),
        ("dev/0.0.1", False, False),
    ]
    assert transport.requests[1].api_path == f"/repos/{REPO}/branches"
    assert transport.requests[1].query == {"per_page": 50}


# --- create_repo -----------------------------------------------------------


def _created_repo_payload() -> dict[str, Any]:
    return {
        "id": 812345,
        "name": "repo",
        "full_name": "octocat/repo",
        "private": True,
        "default_branch": "main",
        "html_url": "https://github.com/octocat/repo",
        "clone_url": "https://github.com/octocat/repo.git",
        "ssh_url": "git@github.com:octocat/repo.git",
    }


async def test_create_repo_posts_to_user_repos_without_an_owner() -> None:
    client, transport = _client()
    transport.enqueue(_created_repo_payload())

    repo = await client.create_repo(name="repo", private=True)

    assert repo.full_name == "octocat/repo"
    assert transport.requests[0].method == "POST"
    assert transport.requests[0].api_path == "/user/repos"
    assert transport.requests[0].json_body == {"name": "repo", "private": True}


async def test_create_repo_omits_none_optional_fields_from_the_body() -> None:
    client, transport = _client()
    transport.enqueue(_created_repo_payload())

    await client.create_repo(name="repo")

    assert transport.requests[0].json_body == {"name": "repo"}


async def test_create_repo_uses_user_repos_when_owner_matches_the_login() -> None:
    client, transport = _client()
    transport.enqueue({"login": "octocat"})
    transport.enqueue(_created_repo_payload())

    await client.create_repo(name="repo", owner="Octocat")

    assert transport.requests[0].api_path == "/user"
    assert transport.requests[1].api_path == "/user/repos"


async def test_create_repo_uses_the_org_endpoint_for_a_different_owner() -> None:
    client, transport = _client()
    transport.enqueue({"login": "octocat"})
    transport.enqueue(_created_repo_payload())

    await client.create_repo(name="repo", owner="my-org")

    assert transport.requests[1].api_path == "/orgs/my-org/repos"


async def test_create_repo_falls_back_to_the_org_endpoint_when_user_fails() -> None:
    # Narrowly scoped tokens may not reach GET /user; the org endpoint is
    # then the only reasonable attempt.
    client, transport = _client()
    transport.raise_on.add("/user")
    transport.enqueue(_created_repo_payload())

    await client.create_repo(name="repo", owner="my-org")

    assert transport.requests[0].api_path == "/user"
    assert transport.requests[1].api_path == "/orgs/my-org/repos"


# --- HttpTransport ---------------------------------------------------------


@respx.mock
async def test_http_transport_sends_the_bearer_token_and_api_version() -> None:
    route = respx.get(f"{API_BASE}/repos/{REPO}").mock(
        return_value=httpx.Response(200, json={"default_branch": "main"})
    )

    transport = HttpTransport(token="tok-secret")
    data = await transport.request("GET", f"/repos/{REPO}")

    assert data == {"default_branch": "main"}
    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer tok-secret"
    assert request.headers["x-github-api-version"] == "2022-11-28"


@respx.mock
async def test_http_transport_raises_with_status_on_api_errors() -> None:
    respx.get(f"{API_BASE}/repos/{REPO}").mock(
        return_value=httpx.Response(404, json={"message": "Not Found"})
    )

    transport = HttpTransport(token="tok-secret")
    with pytest.raises(GitHubError, match="404") as excinfo:
        await transport.request("GET", f"/repos/{REPO}")
    assert excinfo.value.status == 404


@respx.mock
async def test_http_transport_returns_none_for_empty_bodies() -> None:
    respx.delete(f"{API_BASE}/repos/{REPO}").mock(return_value=httpx.Response(204))

    transport = HttpTransport(token="tok-secret")
    assert await transport.request("DELETE", f"/repos/{REPO}") is None


@respx.mock
async def test_http_transport_honours_a_custom_base_url() -> None:
    route = respx.get("https://ghe.example.com/api/v3/user").mock(
        return_value=httpx.Response(200, json={"login": "octocat"})
    )

    transport = HttpTransport(token="tok", base_url="https://ghe.example.com/api/v3")
    await transport.request("GET", "/user")

    assert route.call_count == 1


def test_http_transport_requires_a_token() -> None:
    with pytest.raises(GitHubError):
        HttpTransport(token="")


# --- GhCliTransport --------------------------------------------------------


async def test_gh_cli_transport_parses_json_stdout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_fake_gh(tmp_path, """printf '{"login": "octocat"}'""")
    _use_path(tmp_path, monkeypatch)

    data = await GhCliTransport().request("GET", "/user")

    assert data == {"login": "octocat"}


async def test_gh_cli_transport_appends_query_params_to_the_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The fake gh echoes its last argument (the endpoint) back as JSON.
    _write_fake_gh(
        tmp_path,
        'for last in "$@"; do :; done\nprintf \'"%s"\' "$last"',
    )
    _use_path(tmp_path, monkeypatch)

    url = await GhCliTransport().request(
        "GET", "/repos/o/r/commits", query={"sha": "main", "per_page": 5}
    )

    assert url == "/repos/o/r/commits?sha=main&per_page=5"


async def test_gh_cli_transport_sends_the_json_body_through_stdin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The fake gh echoes stdin back, revealing exactly what arrived.
    # /bin/cat by absolute path: PATH only contains the fake gh's directory.
    _write_fake_gh(tmp_path, "/bin/cat")
    _use_path(tmp_path, monkeypatch)

    result = await GhCliTransport().request(
        "POST", "/user/repos", json_body={"name": "repo", "private": True}
    )

    assert result == {"name": "repo", "private": True}


async def test_gh_cli_transport_returns_none_for_an_empty_body(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_fake_gh(tmp_path, "true")
    _use_path(tmp_path, monkeypatch)

    assert await GhCliTransport().request("DELETE", "/repos/o/r") is None


async def test_gh_cli_transport_surfaces_gh_errors_with_the_http_status(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_fake_gh(tmp_path, 'echo "gh: HTTP 404: Not Found" >&2\nexit 1')
    _use_path(tmp_path, monkeypatch)

    with pytest.raises(GitHubError, match="HTTP 404") as excinfo:
        await GhCliTransport().request("GET", "/repos/o/r")
    assert excinfo.value.status == 404


async def test_gh_cli_transport_reports_a_missing_executable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_path(tmp_path, monkeypatch)  # no gh anywhere on PATH

    with pytest.raises(GitHubError, match="Failed to run the gh CLI"):
        await GhCliTransport().request("GET", "/user")


# --- gh_cli_is_available / resolve_transport -------------------------------


async def test_gh_cli_is_available_requires_an_executable_on_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_path(tmp_path, monkeypatch)  # empty dir: no gh

    assert await gh_cli_is_available() is False


async def test_gh_cli_is_available_requires_authentication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_fake_gh(tmp_path, 'if [ "$1" = "auth" ]; then exit 1; fi')
    _use_path(tmp_path, monkeypatch)

    assert await gh_cli_is_available() is False


async def test_gh_cli_is_available_when_installed_and_authenticated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_fake_gh(tmp_path, 'if [ "$1" = "auth" ]; then exit 0; fi')
    _use_path(tmp_path, monkeypatch)

    assert await gh_cli_is_available() is True


async def test_resolve_transport_prefers_the_gh_cli_over_a_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_fake_gh(tmp_path, 'if [ "$1" = "auth" ]; then exit 0; fi')
    _use_path(tmp_path, monkeypatch)

    transport = await resolve_transport(token="tok")

    assert isinstance(transport, GhCliTransport)


async def test_resolve_transport_falls_back_to_http_with_a_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_path(tmp_path, monkeypatch)  # no gh

    transport = await resolve_transport(token="tok")

    assert isinstance(transport, HttpTransport)


async def test_resolve_transport_is_none_without_gh_or_a_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_path(tmp_path, monkeypatch)  # no gh

    assert await resolve_transport() is None
