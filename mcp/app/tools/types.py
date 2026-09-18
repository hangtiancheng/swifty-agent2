"""Tool module protocol.

A self-contained tool module. `register` is called once per MCP server
instance, while `init`/`shutdown` manage process-wide singleton state
(connections, caches).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from app.shared.tools.host import ToolRegistry


class ToolModule(ABC):
    """Base class for the server's own tool modules (gitlab, ...)."""

    #: Unique module name, used in logs.
    name: ClassVar[str]

    #: Register the module's tools on a registry (one per MCP server instance).
    @abstractmethod
    def register(self, registry: ToolRegistry) -> None: ...

    #: Optional background initialization kicked off after transport connect.
    async def init(self) -> None:  # noqa: B027 — intentional default no-op
        """No-op by default."""

    #: Optional graceful shutdown.
    async def shutdown(self) -> None:  # noqa: B027 — intentional default no-op
        """No-op by default."""
