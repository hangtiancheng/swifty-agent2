"""Environment-derived application config.

The HTTP bind address (HOST/PORT) is NOT here: the HTTP layer resolves it in
app/http/config.py next to the public-URL variable, and a second parser for the
same variables is how defaults drift apart.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from pydantic import BaseModel


class GitLabConfig(BaseModel):
    """Self-hosted GitLab connection settings.

    Both fields default to empty, which means "not configured": the gitlab_*
    tools then answer with a clear unavailable error per call instead of
    failing at startup. Nothing in the code points at a particular instance.

    `private_token` is a secret: it is only ever appended to request URLs by
    the client and must never be logged.
    """

    #: Base URL of the GitLab instance (`GITLAB_BASE_URL` env).
    base_url: str = ""
    #: Personal access token for the GitLab API (`GITLAB_PRIVATE_TOKEN` env).
    #: Empty means "not configured": the gitlab_* tools then answer with a
    #: clear unavailable error per call instead of failing at startup.
    private_token: str = ""


class AppConfig(BaseModel):
    """Self-hosted GitLab connection settings."""

    gitlab: GitLabConfig


def _drop_empty_values(env: Mapping[str, str]) -> dict[str, str]:
    """Empty strings behave as "unset" so placeholder env entries don't mask defaults."""
    return {key: value for key, value in env.items() if value.strip() != ""}


def load_config(env: Mapping[str, str] | None = None) -> AppConfig:
    """Parse the environment into an AppConfig; `env` defaults to os.environ."""
    source = _drop_empty_values(dict(os.environ if env is None else env))
    return AppConfig(
        gitlab=GitLabConfig(
            base_url=source.get("GITLAB_BASE_URL", "").rstrip("/"),
            private_token=source.get("GITLAB_PRIVATE_TOKEN", "").strip(),
        )
    )
