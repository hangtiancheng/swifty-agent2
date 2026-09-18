"""Environment-derived application config.

The HTTP bind address (HOST/PORT) is NOT here: the HTTP layer resolves it in
app/http/config.py next to the public-URL variable, and a second parser for the
same variables is how defaults drift apart.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from pydantic import BaseModel


class GitHubConfig(BaseModel):
    """GitHub connection settings for the github_* tools' HTTP fallback.

    The preferred backend is the local `gh` CLI when it is installed and
    authenticated; these settings cover machines without one. Both fields
    default to empty, which means "not configured": without an authenticated
    gh CLI or a token the github_* tools answer with a clear unavailable
    error per call instead of failing at startup.

    `token` is a secret: it is only ever sent in an Authorization header and
    must never be logged.
    """

    #: Personal access token for the GitHub API (`GITHUB_TOKEN` env, with
    #: `GH_TOKEN` as a fallback). Empty means "not configured".
    token: str = ""
    #: REST API base URL (`GITHUB_BASE_URL` env); empty means the transport
    #: default (https://api.github.com, or a GitHub Enterprise API URL).
    base_url: str = ""


class AppConfig(BaseModel):
    """Connection settings for the hosted tool suites."""

    github: GitHubConfig


def _drop_empty_values(env: Mapping[str, str]) -> dict[str, str]:
    """Empty strings behave as "unset" so placeholder env entries don't mask defaults."""
    return {key: value for key, value in env.items() if value.strip() != ""}


def load_config(env: Mapping[str, str] | None = None) -> AppConfig:
    """Parse the environment into an AppConfig; `env` defaults to os.environ."""
    source = _drop_empty_values(dict(os.environ if env is None else env))
    return AppConfig(
        github=GitHubConfig(
            token=(source.get("GITHUB_TOKEN") or source.get("GH_TOKEN") or "").strip(),
            base_url=source.get("GITHUB_BASE_URL", "").rstrip("/"),
        ),
    )
