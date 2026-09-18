"""GitLab client behaviour, including the quirks of older self-hosted forks
(plain-string branch lists, v3 project creation, redirect-as-auth-failure)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from app.tools.gitlab.client import (
    GitLabClient,
    GitLabError,
    encode_project_ref,
)

BASE_URL = "https://gitlab.example.com"


def test_encode_project_ref_encodes_the_group_project_slash() -> None:
    assert (
        encode_project_ref("hangtiancheng/swifty-agent2")
        == "hangtiancheng%2Fswifty-agent2"
    )


def test_encode_project_ref_leaves_a_numeric_id_unchanged() -> None:
    assert encode_project_ref("2606572") == "2606572"


def test_encode_project_ref_trims_surrounding_whitespace() -> None:
    assert (
        encode_project_ref("  hangtiancheng/swifty-agent2  ")
        == "hangtiancheng%2Fswifty-agent2"
    )


def test_throws_when_no_token_is_configured() -> None:
    with pytest.raises(GitLabError):
        GitLabClient(base_url=BASE_URL, private_token="")


def test_constructs_successfully_with_a_token() -> None:
    GitLabClient(base_url=BASE_URL, private_token="abc")


def _client() -> GitLabClient:
    return GitLabClient(base_url=BASE_URL, private_token="tok")


@respx.mock
async def test_list_branches_normalizes_plain_branch_name_strings() -> None:
    # Some self-hosted instances return branches as plain strings.
    route = respx.get(
        f"{BASE_URL}/api/v4/projects/hangtiancheng%2Fswifty-agent2/repository/branches"
    ).mock(return_value=httpx.Response(200, json=["master", "dev/0.0.1"]))

    branches = await _client().list_branches("hangtiancheng/swifty-agent2")

    assert [(b.name, b.default, b.protected) for b in branches] == [
        ("master", None, None),
        ("dev/0.0.1", None, None),
    ]
    request = route.calls.last.request
    assert request.url.params.get("private_token") == "tok"


@respx.mock
async def test_list_branches_passes_object_entries_through_unchanged() -> None:
    # Standard GitLab shape must keep working.
    respx.get(
        f"{BASE_URL}/api/v4/projects/hangtiancheng%2Fswifty-agent2/repository/branches"
    ).mock(
        return_value=httpx.Response(
            200, json=[{"name": "master", "default": True, "protected": True}]
        )
    )

    branches = await _client().list_branches("hangtiancheng/swifty-agent2")

    assert len(branches) == 1
    assert branches[0].name == "master"
    assert branches[0].default is True
    assert branches[0].protected is True


@respx.mock
async def test_list_branches_enforces_per_page_locally_when_the_instance_ignores_it() -> (
    None
):
    route = respx.get(
        f"{BASE_URL}/api/v4/projects/hangtiancheng%2Fswifty-agent2/repository/branches"
    ).mock(return_value=httpx.Response(200, json=["a", "b", "c", "d"]))

    branches = await _client().list_branches("hangtiancheng/swifty-agent2", per_page=2)

    assert [b.name for b in branches] == ["a", "b"]
    assert route.calls.last.request.url.params.get("per_page") == "2"


@respx.mock
async def test_create_project_posts_the_project_fields_as_json_to_the_v3_endpoint() -> (
    None
):
    route = respx.post(f"{BASE_URL}/api/v3/projects").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": 4445626,
                "name": "repo",
                "path": "repo",
                "path_with_namespace": "user/repo",
                "web_url": "https://gitlab.example.com/user/repo",
                "http_url_to_repo": "https://gitlab.example.com/user/repo.git",
                "ssh_url_to_repo": "git@gitlab.example.com:user/repo.git",
            },
        )
    )

    project = await _client().create_project(
        name="repo", namespace_id=3186, description="desc", visibility_level=10
    )

    assert project.path_with_namespace == "user/repo"
    request = route.calls.last.request
    assert request.url.params.get("private_token") == "tok"
    assert json.loads(request.content) == {
        "name": "repo",
        "namespace_id": 3186,
        "description": "desc",
        "visibility_level": 10,
    }


@respx.mock
async def test_create_project_omits_none_optional_fields_from_the_body() -> None:
    route = respx.post(f"{BASE_URL}/api/v3/projects").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": 1,
                "name": "repo",
                "path": "repo",
                "path_with_namespace": "user/repo",
            },
        )
    )

    await _client().create_project(name="repo")

    assert json.loads(route.calls.last.request.content) == {"name": "repo"}


@respx.mock
async def test_create_project_surfaces_the_instance_error_message_on_400() -> None:
    respx.post(f"{BASE_URL}/api/v3/projects").mock(
        return_value=httpx.Response(400, json={"message": "Namespace is not valid."})
    )

    with pytest.raises(GitLabError, match="Namespace is not valid."):
        await _client().create_project(name="repo")


@respx.mock
async def test_resolve_namespace_id_resolves_a_namespace_path_via_the_v3_api() -> None:
    route = respx.get(f"{BASE_URL}/api/v3/namespaces").mock(
        return_value=httpx.Response(
            200, json=[{"id": 777, "kind": "group", "path": "user"}]
        )
    )

    assert await _client().resolve_namespace_id(" User ") == 777
    assert route.calls.last.request.url.params.get("search") == "user"


@respx.mock
async def test_resolve_namespace_id_throws_when_the_namespace_is_not_visible() -> None:
    respx.get(f"{BASE_URL}/api/v3/namespaces").mock(
        return_value=httpx.Response(200, json=[])
    )

    with pytest.raises(GitLabError, match='Namespace "nope" not found'):
        await _client().resolve_namespace_id("nope")


@respx.mock
async def test_a_redirect_is_treated_as_an_auth_failure() -> None:
    # The instance redirects unauthenticated API calls to the login page; the
    # client must not follow it.
    respx.get(
        f"{BASE_URL}/api/v4/projects/hangtiancheng%2Fswifty-agent2/repository/tree"
    ).mock(
        return_value=httpx.Response(302, headers={"location": "https://login.example"})
    )

    with pytest.raises(GitLabError, match="redirected to login"):
        await _client().list_tree("hangtiancheng/swifty-agent2")


@respx.mock
async def test_read_file_returns_the_blob_content() -> None:
    route = respx.get(
        f"{BASE_URL}/api/v4/projects/hangtiancheng%2Fswifty-agent2/repository/blobs"
    ).mock(return_value=httpx.Response(200, json={"content": "hello", "size": 5}))

    file = await _client().read_file(
        "hangtiancheng/swifty-agent2", "readme.md", "master"
    )

    assert file.content == "hello"
    assert file.size == 5
    params = route.calls.last.request.url.params
    assert params.get("filepath") == "readme.md"
    assert params.get("ref") == "master"


@respx.mock
async def test_list_commits_passes_ref_and_per_page() -> None:
    route = respx.get(
        f"{BASE_URL}/api/v4/projects/hangtiancheng%2Fswifty-agent2/repository/commits"
    ).mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": "a" * 40,
                    "short_id": "a" * 8,
                    "title": "feat: x",
                    "author_name": "A",
                    "author_email": "a@example.com",
                    "authored_date": "2026-09-18T10:00:00+08:00",
                }
            ],
        )
    )

    commits = await _client().list_commits(
        "hangtiancheng/swifty-agent2", ref="dev/0.0.1", per_page=5
    )

    assert len(commits) == 1
    assert commits[0].title == "feat: x"
    params = route.calls.last.request.url.params
    assert params.get("ref_name") == "dev/0.0.1"
    assert params.get("per_page") == "5"
