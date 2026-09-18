"""All tool modules hosted by this server. Add future modules here."""

from __future__ import annotations

from app.tools.gitlab.tool import gitlab_module
from app.tools.types import ToolModule

MODULES: tuple[ToolModule, ...] = (gitlab_module,)
