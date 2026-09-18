"""HTTP transports host.

Exposes both remote MCP transports on one port, mirroring the TypeScript
server's `http.ts`:

- Streamable HTTP:  POST /mcp        (stateless, JSON responses)
- legacy SSE:       GET /sse + POST /messages/?session_id=...

GET /mcp answers 405: stateless mode has no server-initiated notification
stream. There is no authentication in this iteration — the server binds to
localhost by default (app/http/config.py) and is intended for local or
trusted networks only.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Awaitable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from mcp.server.sse import SseServerTransport
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.routing import Mount, Route
from starlette.types import Receive, Scope, Send

from app.server import SERVER_NAME, create_server
from app.shared.logger import logger
from app.tools import MODULES
from app.version import __version__


class _StreamableHttpEndpoint:
    """Raw ASGI endpoint for /mcp.

    A callable instance (not a function) so Starlette's Route mounts it as
    an ASGI app instead of wrapping it as request/response: the session
    manager writes its replies straight to the socket.
    """

    def __init__(self, manager: StreamableHTTPSessionManager) -> None:
        self._manager = manager

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["method"] == "GET":
            # Stateless mode has no server-initiated notification stream.
            response = JSONResponse({"error": "Method Not Allowed"}, status_code=405)
            await response(scope, receive, send)
            return
        await self._manager.handle_request(scope, receive, send)


class _SseEndpoint:
    """Raw ASGI endpoint for GET /sse.

    One server + transport per connection; tool-module state stays in
    process-wide singletons, so per-connection instances are cheap.
    """

    def __init__(self, sse: SseServerTransport) -> None:
        self._sse = sse

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        connection = await create_server()
        async with self._sse.connect_sse(scope, receive, send) as (
            read_stream,
            write_stream,
        ):
            await connection.server.run(
                read_stream,
                write_stream,
                connection.server.create_initialization_options(),
                raise_exceptions=False,
            )


async def create_http_app() -> FastAPI:
    """Build the FastAPI app hosting both remote MCP transports."""
    created = await create_server()

    # Stateless Streamable HTTP: a fresh transport (and session) per request,
    # so no session bookkeeping is needed.
    manager = StreamableHTTPSessionManager(
        app=created.server,
        json_response=True,
        stateless=True,
    )
    # Legacy SSE: one long-lived transport per GET /sse connection, messages
    # posted back on /messages/ correlated by session_id.
    sse = SseServerTransport("/messages/")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        # Kick off module initialization only after the transports are up, so
        # tools are listable immediately. Failures are logged, not fatal.
        async def _init_module(module_name: str, coro: Awaitable[None]) -> None:
            try:
                await coro
            except Exception as err:  # noqa: BLE001 — init is best-effort
                logger.warning("module init failed", err=str(err), module=module_name)

        init_tasks = [
            asyncio.create_task(_init_module(module.name, module.init()))
            for module in MODULES
        ]

        try:
            async with manager.run():
                logger.info(
                    "MCP HTTP transports ready",
                    streamable_http="POST /mcp",
                    sse="GET /sse + POST /messages/?session_id=...",
                )
                yield
        finally:
            for task in init_tasks:
                task.cancel()
            for module in MODULES:
                try:
                    await module.shutdown()
                except Exception as err:  # noqa: BLE001 — shutdown is best-effort
                    logger.warning(
                        "module shutdown failed", err=str(err), module=module.name
                    )

    app = FastAPI(title=SERVER_NAME, version=__version__, lifespan=lifespan)
    # The MCP transports are raw ASGI apps (the SDK writes straight to the
    # socket), so they go on the router as plain Starlette routes — FastAPI's
    # request/response machinery and OpenAPI generation do not apply to them.
    # The `routes=` constructor parameter is deprecated in FastAPI; extending
    # the router is the supported way to mix in non-APIRoute entries.
    app.router.routes.extend(
        [
            Route("/mcp", endpoint=_StreamableHttpEndpoint(manager)),
            Route("/sse", endpoint=_SseEndpoint(sse), methods=["GET"]),
            Mount("/messages/", app=sse.handle_post_message),
        ]
    )
    return app
