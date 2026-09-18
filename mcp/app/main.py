"""Entry point: the MCP server over stdio, or over HTTP with --http.

There is no startup credential gate: the github_* tools resolve their
backend (an authenticated `gh` CLI or the GITHUB_TOKEN env var) per call and
answer with a clear unavailable error when neither is present, so the server
always starts.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable

import typer
from dotenv import load_dotenv

from app.shared.logger import logger
from app.version import __version__

cli = typer.Typer(
    add_completion=False,
    pretty_exceptions_show_locals=False,
    context_settings={"help_option_names": ["-h", "--help"]},
)


async def _run_stdio() -> None:
    from mcp.server.stdio import stdio_server

    from app.server import create_server
    from app.tools import MODULES

    created = await create_server()

    async with stdio_server() as (read_stream, write_stream):
        logger.info("MCP stdio server connected")

        # Kick off module initialization only after the transport is up, so
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
            await created.server.run(
                read_stream,
                write_stream,
                created.server.create_initialization_options(),
                raise_exceptions=False,
            )
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


async def _run_http() -> None:
    import uvicorn

    from app.http.app import create_http_app
    from app.http.config import load_http_config

    config = load_http_config()
    logger.info(
        "starting MCP HTTP server",
        host=config.host,
        port=config.port,
        streamable_http="POST /mcp",
        sse="GET /sse + POST /messages/?session_id=...",
    )
    uvicorn_config = uvicorn.Config(
        await create_http_app(),
        host=config.host,
        port=config.port,
        # structlog owns stderr; leave the stdlib logging config untouched.
        log_config=None,
    )
    await uvicorn.Server(uvicorn_config).serve()


def _http_requested(flag: bool) -> bool:
    return flag or os.environ.get("MCP_TRANSPORT", "").strip().lower() == "http"


@cli.command()
def main(
    version: bool = typer.Option(
        False, "-v", "--version", help="Show the version and exit."
    ),
    http: bool = typer.Option(
        False,
        "--http",
        help="Serve over HTTP (Streamable HTTP + SSE) instead of stdio.",
    ),
) -> None:
    """MCP server exposing GitHub repositories as tools (stdio, or --http)."""
    if version:
        typer.echo(__version__)
        raise typer.Exit()

    load_dotenv()

    try:
        if _http_requested(http):
            asyncio.run(_run_http())
        else:
            asyncio.run(_run_stdio())
    except Exception as err:  # noqa: BLE001 — fatal startup errors exit non-zero
        logger.error("fatal error during startup", err=str(err))
        raise typer.Exit(code=1) from err


if __name__ == "__main__":
    cli()
