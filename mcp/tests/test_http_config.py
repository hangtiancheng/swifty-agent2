"""Tests for the HTTP bind configuration (MCP_HOST/MCP_PORT)."""

from __future__ import annotations

import pytest

from app.http.config import DEFAULT_HOST, DEFAULT_PORT, load_http_config


def test_defaults_when_unset() -> None:
    config = load_http_config({})
    assert config.host == DEFAULT_HOST
    assert config.port == DEFAULT_PORT


def test_host_and_port_from_env() -> None:
    config = load_http_config({"MCP_HOST": "0.0.0.0", "MCP_PORT": "8080"})
    assert config.host == "0.0.0.0"
    assert config.port == 8080


def test_generic_host_port_are_ignored() -> None:
    """The shared root .env already uses HOST/PORT for the Node-side
    servers; the MCP bind address must not pick them up."""
    config = load_http_config({"HOST": "10.0.0.1", "PORT": "8000"})
    assert config.host == DEFAULT_HOST
    assert config.port == DEFAULT_PORT


@pytest.mark.parametrize("empty", ["", "   "])
def test_empty_values_behave_as_unset(empty: str) -> None:
    config = load_http_config({"MCP_HOST": empty, "MCP_PORT": empty})
    assert config.host == DEFAULT_HOST
    assert config.port == DEFAULT_PORT


@pytest.mark.parametrize("raw", ["abc", "1.5", "-1", "0", "99999"])
def test_malformed_port_degrades_to_default(raw: str) -> None:
    """Mirrors the TypeScript config's `.catch(3300)`: a bad MCP_PORT must
    never crash the server at startup."""
    assert load_http_config({"MCP_PORT": raw}).port == DEFAULT_PORT
