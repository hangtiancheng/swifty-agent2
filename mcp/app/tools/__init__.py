"""All tool modules hosted by this server. Add future modules here."""

from __future__ import annotations

from app.tools.github.tool import github_module
from app.tools.types import ToolModule

MODULES: tuple[ToolModule, ...] = (github_module,)
