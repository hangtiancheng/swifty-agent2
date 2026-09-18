"""The tool registry seam between tool modules and the MCP SDK server.

Every tool registers with the same shape — name, description, a pydantic
arguments model (whose JSON schema becomes the tool's inputSchema) and an
async handler — so tool modules stay independent of which server instance
hosts them. The registry then drives the SDK server's `tools/list` and
`tools/call` handlers.

This replaces the TypeScript ToolHost's two registration forms: the Python
SDK has no variadic overloads to paper over, so one explicit shape is enough.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import mcp.types as types
from pydantic import BaseModel, ValidationError

#: Handler contract: validated arguments model in, MCP result out.
ToolHandler = Callable[[BaseModel], Awaitable[types.CallToolResult]]

#: The stored form: arguments arrive as the raw JSON object from the client.
StoredHandler = Callable[[dict[str, Any]], Awaitable[types.CallToolResult]]


@dataclass(slots=True)
class RegisteredTool:
    """One tool as the registry holds it."""

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: StoredHandler
    title: str | None = None
    annotations: types.ToolAnnotations | None = None


class ToolRegistry:
    """Collects tools from modules and serves the SDK's tool request handlers.

    Registering a duplicate name raises: with per-session server instances in
    HTTP mode a duplicate would surface as runtime errors, so fail fast.
    """

    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}

    def register(self, tool: RegisteredTool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"duplicate tool name: {tool.name}")
        self._tools[tool.name] = tool

    def __len__(self) -> int:
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        return name in self._tools

    def names(self) -> list[str]:
        return list(self._tools)

    async def list_tools(
        self,
        ctx: Any,
        params: types.PaginatedRequestParams | None,
    ) -> types.ListToolsResult:
        """SDK `tools/list` handler."""
        return types.ListToolsResult(
            tools=[
                types.Tool(
                    name=tool.name,
                    title=tool.title,
                    description=tool.description,
                    input_schema=tool.input_schema,
                    annotations=tool.annotations,
                )
                for tool in self._tools.values()
            ]
        )

    async def call_tool(
        self,
        ctx: Any,
        params: types.CallToolRequestParams,
    ) -> types.CallToolResult:
        """SDK `tools/call` handler: dispatch by name to the stored handler."""
        tool = self._tools.get(params.name)
        if tool is None:
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text", text=f"✘ Unknown tool: {params.name}"
                    )
                ],
                is_error=True,
            )
        arguments = params.arguments or {}
        if not isinstance(arguments, dict):
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text", text="✘ Tool arguments must be a JSON object"
                    )
                ],
                is_error=True,
            )
        return await tool.handler(arguments)


def model_input_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON schema for a tool arguments model, using wire (alias) names."""
    return model.model_json_schema(by_alias=True, mode="validation")


def register_model_tool[M: BaseModel](
    registry: ToolRegistry,
    *,
    name: str,
    description: str,
    model: type[M],
    handler: Callable[[M], Awaitable[types.CallToolResult]],
    title: str | None = None,
    annotations: types.ToolAnnotations | None = None,
) -> None:
    """Register a tool whose arguments are validated against a pydantic model.

    Validation failures become isError tool results rather than protocol
    errors, so the agent sees what was wrong with its arguments.
    """

    async def stored_handler(arguments: dict[str, Any]) -> types.CallToolResult:
        try:
            parsed = model.model_validate(arguments)
        except ValidationError as exc:
            return types.CallToolResult(
                content=[
                    types.TextContent(type="text", text=f"✘ Invalid arguments: {exc}")
                ],
                is_error=True,
            )
        return await handler(parsed)

    registry.register(
        RegisteredTool(
            name=name,
            description=description,
            input_schema=model_input_schema(model),
            handler=stored_handler,
            title=title,
            annotations=annotations,
        )
    )
