"""Tool-level tests for the github module: registration, backend gating
(gh CLI vs token), argument schemas and result shapes."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import httpx
import pytest
import respx
from conftest import first_text

from app.shared.tools.host import ToolRegistry
from app.tools.github.tool import github_module

API_BASE = "https://api.github.com"
TOKEN = "tok-secret"
REPO = "hangtiancheng/swifty-agent2"


def _patch_gh_availability(monkeypatch: pytest.MonkeyPatch, available: bool) -> None:
    """Force the gh CLI availability decision, so the developer's real gh
    login never leaks into these tests."""

    async def _availability() -> bool:
        return available

    monkeypatch.setattr("app.tools.github.transport.gh_cli_is_available", _availability)


@pytest.fixture(autouse=True)
def _clean_github_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # Isolate from whatever the developer/CI environment happens to set.
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_BASE_URL", raising=False)
    _patch_gh_availability(monkeypatch, False)


@pytest.fixture
def registry() -> ToolRegistry:
    reg = ToolRegistry()
    github_module.register(reg)
    return reg


def _configure_token(monkeypatch: pytest.MonkeyPatch, token: str = TOKEN) -> None:
    monkeypatch.setenv("GITHUB_TOKEN", token)


def _write_fake_gh(tmp_path: Path, script: str) -> None:
    gh = tmp_path / "gh"
    gh.write_text(f"#!/bin/sh\n{script}\n")
    gh.chmod(0o755)


async def _call(
    registry: ToolRegistry, name: str, arguments: dict[str, object]
) -> object:
    import mcp.types as types

    return await registry.call_tool(
        None, types.CallToolRequestParams(name=name, arguments=arguments)
    )


def test_registers_exactly_the_five_github_tools(registry: ToolRegistry) -> None:
    assert sorted(registry.names()) == [
        "github_create_repo",
        "github_list_branches",
        "github_list_commits",
        "github_list_tree",
        "github_read_file",
    ]


async def test_tools_are_unavailable_without_gh_or_a_token(
    registry: ToolRegistry,
) -> None:
    import mcp.types as types

    result = await _call(
        registry, "github_read_file", {"repo": REPO, "file_path": "r.md"}
    )

    assert isinstance(result, types.CallToolResult)
    assert result.is_error
    text = first_text(result)
    assert "GITHUB_TOKEN" in text
    assert "gh auth login" in text


@respx.mock
async def test_read_file_uses_the_token_transport_when_gh_is_unavailable(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_token(monkeypatch)
    respx.get(f"{API_BASE}/repos/{REPO}").mock(
        return_value=httpx.Response(200, json={"default_branch": "main"})
    )
    route = respx.get(f"{API_BASE}/repos/{REPO}/contents/readme.md").mock(
        return_value=httpx.Response(
            200,
            json={
                "type": "file",
                "encoding": "base64",
                "content": base64.b64encode(b"hello world").decode("ascii"),
                "size": 11,
            },
        )
    )

    result = await _call(
        registry, "github_read_file", {"repo": REPO, "file_path": "readme.md"}
    )

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert first_text(result) == "hello world"
    assert result.structured_content == {
        "repo": REPO,
        "file_path": "readme.md",
        "ref": None,
        "size": 11,
        "type": "file",
    }
    # The configured token is the one that reaches GitHub.
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"


@respx.mock
async def test_read_file_prefers_the_gh_cli_over_the_token(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import mcp.types as types

    _write_fake_gh(
        tmp_path,
        """
if [ "$1" = "auth" ]; then exit 0; fi
for last in "$@"; do :; done
case "$last" in
  */contents/*) printf '{"type":"file","encoding":"base64","content":"aGVsbG8=","size":5}' ;;
  *) printf '{"default_branch":"main"}' ;;
esac
""",
    )
    monkeypatch.setenv("PATH", str(tmp_path))
    _patch_gh_availability(monkeypatch, True)
    _configure_token(monkeypatch)  # present, but the gh CLI must win

    result = await _call(
        registry, "github_read_file", {"repo": REPO, "file_path": "readme.md"}
    )

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert first_text(result) == "hello"
    # Nothing went over HTTP: the gh CLI handled the whole call.
    assert respx.mock.calls == []


@respx.mock
async def test_list_tree_formats_flattened_entries(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_token(monkeypatch)
    respx.get(f"{API_BASE}/repos/{REPO}/git/trees/main").mock(
        return_value=httpx.Response(
            200,
            json={
                "truncated": False,
                "tree": [
                    {"path": "src", "type": "tree", "sha": "s1"},
                    {"path": "src/index.ts", "type": "blob", "sha": "s2", "size": 10},
                ],
            },
        )
    )

    result = await _call(registry, "github_list_tree", {"repo": REPO, "ref": "main"})

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert first_text(result) == "📁 src\n📄 src/index.ts"
    assert result.structured_content == {
        "repo": REPO,
        "path": "",
        "ref": "main",
        "count": 2,
    }


@respx.mock
async def test_list_commits_formats_entries(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_token(monkeypatch)
    respx.get(f"{API_BASE}/repos/{REPO}/commits").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "sha": "a" * 40,
                    "commit": {
                        "message": "feat: x",
                        "author": {
                            "name": "A",
                            "date": "2026-09-18T10:00:00Z",
                        },
                    },
                }
            ],
        )
    )

    result = await _call(registry, "github_list_commits", {"repo": REPO, "ref": "main"})

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert first_text(result) == "aaaaaaaa  2026-09-18 10:00:00  A  feat: x"
    assert result.structured_content == {"repo": REPO, "ref": "main", "count": 1}


@respx.mock
async def test_list_branches_formats_default_and_protected(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_token(monkeypatch)
    respx.get(f"{API_BASE}/repos/{REPO}").mock(
        return_value=httpx.Response(200, json={"default_branch": "main"})
    )
    respx.get(f"{API_BASE}/repos/{REPO}/branches").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"name": "main", "protected": True},
                {"name": "dev/0.0.1", "protected": False},
            ],
        )
    )

    result = await _call(registry, "github_list_branches", {"repo": REPO})

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert first_text(result) == "* main (protected)\n  dev/0.0.1"
    assert result.structured_content == {"repo": REPO, "count": 2}


@respx.mock
async def test_create_repo_reports_urls(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_token(monkeypatch)
    route = respx.post(f"{API_BASE}/user/repos").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": 812345,
                "name": "repo",
                "full_name": "octocat/repo",
                "private": True,
                "html_url": "https://github.com/octocat/repo",
                "clone_url": "https://github.com/octocat/repo.git",
                "ssh_url": "git@github.com:octocat/repo.git",
            },
        )
    )

    result = await _call(
        registry, "github_create_repo", {"name": "repo", "private": True}
    )

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    text = first_text(result)
    assert "Created octocat/repo (id 812345)" in text
    assert "web:  https://github.com/octocat/repo" in text
    assert "http: https://github.com/octocat/repo.git" in text
    assert json.loads(route.calls.last.request.content) == {
        "name": "repo",
        "private": True,
    }
    assert result.structured_content is not None
    assert result.structured_content["id"] == 812345


@respx.mock
async def test_api_errors_surface_as_error_results(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_token(monkeypatch)
    respx.get(f"{API_BASE}/repos/{REPO}").mock(
        return_value=httpx.Response(404, json={"message": "Not Found"})
    )

    result = await _call(registry, "github_list_branches", {"repo": REPO})

    assert isinstance(result, types.CallToolResult)
    assert result.is_error
    assert "404" in first_text(result)


async def test_invalid_arguments_produce_an_error_result(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_token(monkeypatch)

    # per_page above the declared maximum must fail validation, not the call.
    result = await _call(
        registry, "github_list_commits", {"repo": REPO, "per_page": 999}
    )

    assert isinstance(result, types.CallToolResult)
    assert result.is_error
    assert "Invalid arguments" in first_text(result)


async def test_input_schema_uses_the_published_wire_names(
    registry: ToolRegistry,
) -> None:
    result = await registry.list_tools(None, None)
    tools = {tool.name: tool for tool in result.tools}

    read_file = tools["github_read_file"]
    assert read_file.input_schema is not None
    properties = read_file.input_schema["properties"]
    assert set(properties) == {"repo", "file_path", "ref"}
    assert read_file.input_schema["required"] == ["repo", "file_path"]
    assert read_file.annotations is not None
    assert read_file.annotations.read_only_hint is True

    create_repo = tools["github_create_repo"]
    assert create_repo.annotations is not None
    assert create_repo.annotations.read_only_hint is False
    assert set(create_repo.input_schema["properties"]) == {
        "name",
        "owner",
        "description",
        "private",
    }


@respx.mock
async def test_a_custom_base_url_is_honoured(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    # GITHUB_BASE_URL points the HTTP transport at any GitHub-compatible API
    # (e.g. GitHub Enterprise Server).
    import mcp.types as types

    _configure_token(monkeypatch)
    monkeypatch.setenv("GITHUB_BASE_URL", "https://ghe.example.com/api/v3/")

    respx.get("https://ghe.example.com/api/v3/repos/g/p").mock(
        return_value=httpx.Response(200, json={"default_branch": "main"})
    )
    route = respx.get("https://ghe.example.com/api/v3/repos/g/p/contents/f.txt").mock(
        return_value=httpx.Response(
            200,
            json={
                "type": "file",
                "encoding": "base64",
                "content": base64.b64encode(b"x").decode("ascii"),
                "size": 1,
            },
        )
    )

    result = await _call(
        registry, "github_read_file", {"repo": "g/p", "file_path": "f.txt"}
    )

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert route.call_count == 1
