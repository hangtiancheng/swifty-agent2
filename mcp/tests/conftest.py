"""Shared test helpers."""

from __future__ import annotations

import mcp.types as types


def first_text(result: types.CallToolResult) -> str:
    """The text of the first content block, asserting it is a TextContent."""
    assert result.content, "expected at least one content block"
    block = result.content[0]
    assert isinstance(block, types.TextContent), (
        f"expected TextContent, got {type(block)}"
    )
    return block.text
