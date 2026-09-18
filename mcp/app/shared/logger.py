"""Structured JSON logging to stderr only.

The stdio MCP transport owns stdout for JSON-RPC frames, so any stray stdout
write would corrupt the protocol stream (same rule as the pino logger in the
TypeScript original).
"""

from __future__ import annotations

import logging
import os
import sys

import structlog

_configured = False


def configure_logging() -> None:
    """Idempotent structlog setup; safe to call from every entry point."""
    global _configured
    if _configured:
        return
    _configured = True

    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )


configure_logging()

logger: structlog.stdlib.BoundLogger = structlog.get_logger("swifty-agent2-mcp")
