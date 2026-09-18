"""MCP server assembly: registry + tool modules."""

from __future__ import annotations

from dataclasses import dataclass

from mcp.server.lowlevel import Server

from app.shared.tools.host import ToolRegistry
from app.tools import MODULES

SERVER_NAME = "swifty-agent2-mcp"

# Surfaced to clients at initialize time; hosts inject it into the model's
# context, improving tool selection.
INSTRUCTIONS = (
    "swifty-agent2-mcp exposes GitHub repositories as MCP tools. "
    "Use the github_* tools to read files, list directory trees, commits and "
    "branches from repositories there, and github_create_repo to create new "
    "repositories; they run through the local gh CLI when it is authenticated "
    "and fall back to the GITHUB_TOKEN env var otherwise."
)


def _assert_unique_module_names() -> None:
    """Duplicate names would surface as runtime errors in the SDK server, so
    fail fast at import time."""
    seen: set[str] = set()
    for module in MODULES:
        if module.name in seen:
            raise RuntimeError(f"duplicate tool module name: {module.name}")
        seen.add(module.name)


_assert_unique_module_names()


@dataclass(slots=True)
class CreatedServer:
    server: Server
    registry: ToolRegistry


async def create_server() -> CreatedServer:
    """Build an MCP server with every tool module registered."""
    registry = ToolRegistry()

    for module in MODULES:
        module.register(registry)

    server: Server = Server(
        SERVER_NAME,
        version=_server_version(),
        instructions=INSTRUCTIONS,
        on_list_tools=registry.list_tools,
        on_call_tool=registry.call_tool,
    )

    return CreatedServer(server=server, registry=registry)


def _server_version() -> str:
    from app.version import __version__

    return __version__
