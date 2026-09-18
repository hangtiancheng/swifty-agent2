"""HTTP transport bind configuration.

MCP_HOST/MCP_PORT are resolved here, next to the HTTP layer that uses them,
and nowhere else: a second parser for the same variables is how defaults
drift apart (see the note in app/shared/config.py). The names are
namespaced (unlike the TypeScript server's HOST/PORT) because this repo's
single root .env is shared with the Node side, which already owns the
generic HOST/PORT for its own servers.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from pydantic import BaseModel

#: The HTTP endpoints are unauthenticated, so the default binds localhost
#: only (same contract as the TypeScript server's HOST/PORT defaults).
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3300


class HttpConfig(BaseModel):
    """Listen address for the HTTP transports (--http)."""

    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT


def load_http_config(env: Mapping[str, str] | None = None) -> HttpConfig:
    """Parse MCP_HOST/MCP_PORT from the environment; `env` defaults to
    os.environ.

    Empty strings behave as "unset", and a malformed or out-of-range
    MCP_PORT degrades to the default instead of crashing at startup (the
    TypeScript config's `.catch(3300)` contract).
    """
    source = dict(os.environ if env is None else env)

    host = source.get("MCP_HOST", "").strip() or DEFAULT_HOST

    try:
        port = int(source.get("MCP_PORT", "").strip())
    except ValueError:
        port = DEFAULT_PORT
    if not 1 <= port <= 65535:
        port = DEFAULT_PORT

    return HttpConfig(host=host, port=port)
