"""Transport-level tests for the HTTP app (Streamable HTTP + legacy SSE).

These run the real ASGI app behind a real uvicorn server on an ephemeral
port, so the session manager, the SSE transport and the routing are covered
end to end — no GitHub call is made (initialize/tools-list only).

TestClient is deliberately NOT used: it runs each request to completion
before returning, which deadlocks on the never-ending SSE stream.
"""

from __future__ import annotations

import asyncio
import json
import socket
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import uvicorn

from app.http.app import create_http_app
from app.server import SERVER_NAME

pytestmark = pytest.mark.timeout(30)

INITIALIZE_REQUEST: dict[str, Any] = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "pytest", "version": "0.0.0"},
    },
}

# The stateless JSON mode requires the client to accept application/json.
STREAMABLE_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}


class _UvicornServer(uvicorn.Server):
    """uvicorn Server that announces startup completion through an Event."""

    def __init__(self, config: uvicorn.Config) -> None:
        super().__init__(config)
        self.startup_complete = asyncio.Event()

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets=sockets)
        self.startup_complete.set()


@pytest.fixture
async def base_url() -> AsyncIterator[str]:
    """Serve the HTTP app on an ephemeral localhost port for one test."""
    app = await create_http_app()
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_config=None)
    server = _UvicornServer(config)
    task = asyncio.create_task(server.serve())
    try:
        await asyncio.wait_for(server.startup_complete.wait(), timeout=10)
        sockets = server.servers[0].sockets
        assert sockets is not None
        host, port = sockets[0].getsockname()[0], sockets[0].getsockname()[1]
        yield f"http://{host}:{port}"
    finally:
        server.should_exit = True
        await task


async def test_get_mcp_is_method_not_allowed(base_url: str) -> None:
    """Stateless mode has no server-initiated notification stream (parity
    with the TypeScript server's GET /mcp -> 405)."""
    async with httpx.AsyncClient(base_url=base_url) as client:
        response = await client.get("/mcp")
    assert response.status_code == 405
    assert response.json() == {"error": "Method Not Allowed"}


async def test_streamable_http_initialize(base_url: str) -> None:
    async with httpx.AsyncClient(base_url=base_url) as client:
        response = await client.post(
            "/mcp", json=INITIALIZE_REQUEST, headers=STREAMABLE_HEADERS
        )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["id"] == 1
    result = body["result"]
    assert result["serverInfo"]["name"] == SERVER_NAME
    assert result["protocolVersion"] == "2025-06-18"


async def test_streamable_http_tools_list(base_url: str) -> None:
    """Stateless requests are born-ready: tools/list needs no prior
    initialize round trip."""
    async with httpx.AsyncClient(base_url=base_url) as client:
        response = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            headers=STREAMABLE_HEADERS,
        )
    assert response.status_code == 200
    tools = response.json()["result"]["tools"]
    names = {tool["name"] for tool in tools}
    assert "github_get_repo" in names
    assert "github_search_code" in names


async def test_post_messages_requires_session_id(base_url: str) -> None:
    async with httpx.AsyncClient(base_url=base_url) as client:
        response = await client.post("/messages/", json=INITIALIZE_REQUEST)
    assert response.status_code == 400


async def test_sse_initialize_roundtrip(base_url: str) -> None:
    async with httpx.AsyncClient(base_url=base_url) as client:
        async with client.stream("GET", "/sse") as sse_response:
            assert sse_response.status_code == 200
            assert sse_response.headers["content-type"].startswith("text/event-stream")

            lines = sse_response.aiter_lines()

            # First event announces the message endpoint for this session.
            endpoint_event = await _next_sse_event(lines)
            assert endpoint_event["event"] == "endpoint"
            endpoint = endpoint_event["data"]
            assert endpoint.startswith("/messages/?session_id=")

            # Client messages are POSTed back; the reply arrives on the
            # SSE stream, not on the POST (which only answers 202).
            post = await client.post(endpoint, json=INITIALIZE_REQUEST)
            assert post.status_code == 202

            message_event = await _next_sse_event(lines)
            assert message_event["event"] == "message"
            message = json.loads(message_event["data"])
            assert message["id"] == 1
            assert message["result"]["serverInfo"]["name"] == SERVER_NAME


async def _next_sse_event(lines: AsyncIterator[str]) -> dict[str, str]:
    """Parse one SSE event (skipping blank lines and comment pings)."""
    event: dict[str, str] = {}
    async for line in lines:
        if line.startswith(":"):
            continue
        if line == "":
            if event:
                return event
            continue
        field, _, value = line.partition(":")
        event[field] = value.strip()
    raise AssertionError("SSE stream ended before a complete event")
