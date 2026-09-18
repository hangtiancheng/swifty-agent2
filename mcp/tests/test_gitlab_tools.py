"""Tool-level tests for the gitlab module: registration, token gating,
argument schemas and result shapes."""

from __future__ import annotations

import httpx
import pytest
import respx
from conftest import first_text

from app.shared.tools.host import ToolRegistry
from app.tools.gitlab.tool import gitlab_module

BASE_URL = "https://gitlab.example.com"
TOKEN = "tok-secret"


@pytest.fixture(autouse=True)
def _clean_gitlab_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # Isolate from whatever the developer/CI environment happens to set.
    monkeypatch.delenv("GITLAB_PRIVATE_TOKEN", raising=False)
    monkeypatch.delenv("GITLAB_BASE_URL", raising=False)


@pytest.fixture
def registry() -> ToolRegistry:
    reg = ToolRegistry()
    gitlab_module.register(reg)
    return reg


def _configure_gitlab(monkeypatch: pytest.MonkeyPatch, token: str = TOKEN) -> None:
    """Both env vars are required now: nothing points at an instance by default."""
    monkeypatch.setenv("GITLAB_BASE_URL", BASE_URL)
    monkeypatch.setenv("GITLAB_PRIVATE_TOKEN", token)


async def _call(
    registry: ToolRegistry, name: str, arguments: dict[str, object]
) -> object:
    import mcp.types as types

    return await registry.call_tool(
        None, types.CallToolRequestParams(name=name, arguments=arguments)
    )


def test_registers_exactly_the_five_gitlab_tools(registry: ToolRegistry) -> None:
    assert sorted(registry.names()) == [
        "gitlab_create_project",
        "gitlab_list_branches",
        "gitlab_list_commits",
        "gitlab_list_tree",
        "gitlab_read_file",
    ]


async def test_tools_are_unavailable_without_a_token(registry: ToolRegistry) -> None:
    import mcp.types as types

    result = await _call(
        registry,
        "gitlab_read_file",
        {"project": "hangtiancheng/swifty-agent2", "file_path": "r.md"},
    )
    assert isinstance(result, types.CallToolResult)
    assert result.is_error
    assert "GITLAB_PRIVATE_TOKEN" in first_text(result)


@respx.mock
async def test_read_file_returns_content_and_structured_metadata(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_gitlab(monkeypatch)
    route = respx.get(
        f"{BASE_URL}/api/v4/projects/hangtiancheng%2Fswifty-agent2/repository/blobs"
    ).mock(
        return_value=httpx.Response(200, json={"content": "hello world", "size": 11})
    )

    result = await _call(
        registry,
        "gitlab_read_file",
        {"project": "hangtiancheng/swifty-agent2", "file_path": "readme.md"},
    )

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert first_text(result) == "hello world"
    assert result.structured_content == {
        "project": "hangtiancheng/swifty-agent2",
        "file_path": "readme.md",
        "ref": "master",
        "size": 11,
        "type": None,
    }
    # The configured token is the one that reaches the instance.
    assert route.calls.last.request.url.params.get("private_token") == TOKEN


@respx.mock
async def test_list_branches_formats_normalized_entries(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_gitlab(monkeypatch)
    respx.get(
        f"{BASE_URL}/api/v4/projects/hangtiancheng%2Fswifty-agent2/repository/branches"
    ).mock(return_value=httpx.Response(200, json=["master", "dev/0.0.1"]))

    result = await _call(
        registry, "gitlab_list_branches", {"project": "hangtiancheng/swifty-agent2"}
    )

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert first_text(result) == "  master\n  dev/0.0.1"
    assert result.structured_content == {
        "project": "hangtiancheng/swifty-agent2",
        "count": 2,
    }


@respx.mock
async def test_create_project_requires_a_namespace(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_gitlab(monkeypatch)

    result = await _call(registry, "gitlab_create_project", {"name": "repo"})

    assert isinstance(result, types.CallToolResult)
    assert result.is_error
    assert "requires a namespace" in first_text(result)


@respx.mock
async def test_create_project_resolves_namespace_and_reports_urls(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_gitlab(monkeypatch)
    respx.get(f"{BASE_URL}/api/v3/namespaces").mock(
        return_value=httpx.Response(
            200, json=[{"id": 3186, "kind": "group", "path": "user"}]
        )
    )
    respx.post(f"{BASE_URL}/api/v3/projects").mock(
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

    result = await _call(
        registry, "gitlab_create_project", {"name": "repo", "namespace": "user"}
    )

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    text = first_text(result)
    assert "Created user/repo (id 4445626)" in text
    assert "web:  https://gitlab.example.com/user/repo" in text
    assert result.structured_content is not None
    assert result.structured_content["id"] == 4445626


async def test_invalid_arguments_produce_an_error_result(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    import mcp.types as types

    _configure_gitlab(monkeypatch)

    # per_page above the declared maximum must fail validation, not the call.
    result = await _call(
        registry,
        "gitlab_list_commits",
        {"project": "hangtiancheng/swifty-agent2", "per_page": 999},
    )

    assert isinstance(result, types.CallToolResult)
    assert result.is_error
    assert "Invalid arguments" in first_text(result)


async def test_input_schema_uses_the_published_wire_names(
    registry: ToolRegistry,
) -> None:
    result = await registry.list_tools(None, None)
    tools = {tool.name: tool for tool in result.tools}

    read_file = tools["gitlab_read_file"]
    assert read_file.input_schema is not None
    properties = read_file.input_schema["properties"]
    assert set(properties) == {"project", "file_path", "ref"}
    assert read_file.input_schema["required"] == ["project", "file_path"]
    assert read_file.annotations is not None
    assert read_file.annotations.read_only_hint is True

    create_project = tools["gitlab_create_project"]
    assert create_project.annotations is not None
    assert create_project.annotations.read_only_hint is False
    assert set(create_project.input_schema["properties"]) == {
        "name",
        "namespace",
        "namespace_id",
        "description",
        "visibility_level",
    }


@respx.mock
async def test_a_custom_base_url_is_honoured(
    registry: ToolRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The instance is fully configurable: point the tools at any GitLab that
    # accepts the private_token query parameter.
    import mcp.types as types

    _configure_gitlab(monkeypatch)
    monkeypatch.setenv("GITLAB_BASE_URL", "https://gitlab.example.com/")

    route = respx.get(
        "https://gitlab.example.com/api/v4/projects/g%2Fp/repository/blobs"
    ).mock(return_value=httpx.Response(200, json={"content": "x", "size": 1}))

    result = await _call(
        registry, "gitlab_read_file", {"project": "g/p", "file_path": "f.txt"}
    )

    assert isinstance(result, types.CallToolResult)
    assert not result.is_error
    assert route.call_count == 1
