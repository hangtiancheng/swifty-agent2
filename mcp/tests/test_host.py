"""The registry seam between tool modules and the MCP SDK server.

The end-to-end cases run a real SDK low-level Server over the in-memory
transport against a real ClientSession: a stub can agree with an assumption
the SDK doesn't hold, which is exactly how a duck-typed seam passes its tests
while being broken.
"""

from __future__ import annotations

import mcp.types as types
import pytest
from conftest import first_text
from mcp.client._memory import InMemoryTransport
from mcp.client.session import ClientSession
from mcp.server.lowlevel import Server
from pydantic import BaseModel, Field

from app.server import SERVER_NAME, create_server
from app.shared.tools.host import ToolRegistry, register_model_tool


class EchoArgs(BaseModel):
    phrase: str = Field(description="what to echo")


def _echo_registry() -> ToolRegistry:
    registry = ToolRegistry()

    async def echo(args: EchoArgs) -> types.CallToolResult:
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=f"echo: {args.phrase}")]
        )

    register_model_tool(
        registry,
        name="echo-tool",
        description="echoes what it is given",
        model=EchoArgs,
        handler=echo,
    )
    return registry


def test_duplicate_tool_names_raise() -> None:
    registry = _echo_registry()

    async def echo(args: EchoArgs) -> types.CallToolResult:
        raise NotImplementedError

    with pytest.raises(ValueError, match="duplicate tool name"):
        register_model_tool(
            registry,
            name="echo-tool",
            description="again",
            model=EchoArgs,
            handler=echo,
        )


async def test_call_tool_dispatches_and_validates() -> None:
    registry = _echo_registry()

    result = await registry.call_tool(
        None, types.CallToolRequestParams(name="echo-tool", arguments={"phrase": "hi"})
    )
    assert first_text(result) == "echo: hi"
    assert not result.is_error

    unknown = await registry.call_tool(
        None, types.CallToolRequestParams(name="nope", arguments={})
    )
    assert unknown.is_error
    assert "Unknown tool" in first_text(unknown)

    invalid = await registry.call_tool(
        None, types.CallToolRequestParams(name="echo-tool", arguments={})
    )
    assert invalid.is_error
    assert "Invalid arguments" in first_text(invalid)


async def test_a_client_can_list_and_call_a_registered_tool() -> None:
    registry = _echo_registry()

    server: Server = Server(
        "test",
        version="1.0.0",
        on_list_tools=registry.list_tools,
        on_call_tool=registry.call_tool,
    )

    async with InMemoryTransport(server) as (client_read, client_write):
        async with ClientSession(client_read, client_write) as session:
            await session.initialize()

            tools_result = await session.list_tools()
            assert [tool.name for tool in tools_result.tools] == ["echo-tool"]
            tool = tools_result.tools[0]
            assert tool.description == "echoes what it is given"
            assert tool.input_schema is not None
            assert "phrase" in tool.input_schema["properties"]

            call_result = await session.call_tool(
                "echo-tool", arguments={"phrase": "hi"}
            )
            assert first_text(call_result) == "echo: hi"


async def test_create_server_registers_the_tool_modules() -> None:
    created = await create_server()

    async with InMemoryTransport(created.server) as (client_read, client_write):
        async with ClientSession(client_read, client_write) as session:
            await session.initialize()
            tools_result = await session.list_tools()
            names = [tool.name for tool in tools_result.tools]
            assert "github_read_file" in names
            assert len(names) == len(created.registry)


def test_server_name_matches_the_typescript_original() -> None:
    assert SERVER_NAME == "swifty-agent2-mcp"
