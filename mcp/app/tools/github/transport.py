"""Transports for the GitHub REST API.

Two interchangeable transports back the github_* tools:

- `GhCliTransport` shells out to the local `gh` CLI (`gh api ...`) when it is
  installed and authenticated. It reuses the machine's existing GitHub login
  (keyring / GH_TOKEN / GH Enterprise host), so no extra configuration is
  needed and no token ever passes through this process.
- `HttpTransport` talks to the REST API directly with httpx and a bearer
  token, for machines without a usable `gh` CLI. The token comes from the
  GITHUB_TOKEN (or GH_TOKEN) env var and is secret: it is only ever sent in
  an Authorization header and never logged.

`resolve_transport` picks between them per call — authenticated gh CLI first,
then the token transport, then None ("unavailable") — so configuration set
after the server instance was built is picked up.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
from collections.abc import Mapping
from subprocess import DEVNULL, PIPE
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx

#: REST API base used when GITHUB_BASE_URL is unset.
DEFAULT_API_BASE_URL = "https://api.github.com"

#: Requests are low-frequency; generous bounds that still cannot hang a tool
#: call forever.
REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

#: Bound for a single `gh api` subprocess (network + gh startup).
GH_CLI_TIMEOUT = 30.0

#: Bound for the local `gh auth status` availability check.
GH_AUTH_CHECK_TIMEOUT = 10.0


class GitHubError(RuntimeError):
    """Raised for non-2xx responses, gh CLI failures or malformed payloads."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class GitHubTransport(Protocol):
    """One GitHub REST call: an API path (e.g. `/repos/o/r`) in, decoded JSON
    out (None for empty bodies)."""

    async def request(
        self,
        method: str,
        api_path: str,
        *,
        query: Mapping[str, str | int] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any: ...


def _url_with_query(api_path: str, query: Mapping[str, str | int] | None) -> str:
    if not query:
        return api_path
    params = {key: str(value) for key, value in query.items()}
    return f"{api_path}?{urlencode(params)}"


def _status_from_gh_stderr(stderr: str) -> int | None:
    """gh api reports failures like `gh: HTTP 404: Not Found`; keep the status
    so callers can distinguish auth (401/403) from missing (404)."""
    match = re.search(r"HTTP (\d{3})", stderr)
    return int(match.group(1)) if match else None


class GhCliTransport:
    """Runs `gh api` as a subprocess; authentication is the gh CLI's own
    (keyring, GH_TOKEN, ...), so this transport holds no credentials."""

    def __init__(self, gh_executable: str = "gh") -> None:
        self._gh = gh_executable

    async def request(
        self,
        method: str,
        api_path: str,
        *,
        query: Mapping[str, str | int] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        args = [self._gh, "api", "--method", method, _url_with_query(api_path, query)]
        stdin_bytes: bytes | None = None
        if json_body is not None:
            # The body goes through stdin (`--input -`) rather than argv: no
            # shell involved, no size limit, no escaping concerns.
            args += ["--input", "-"]
            stdin_bytes = json.dumps(json_body).encode("utf-8")

        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdin=PIPE if stdin_bytes is not None else DEVNULL,
                stdout=PIPE,
                stderr=PIPE,
            )
        except OSError as err:
            raise GitHubError(f"Failed to run the gh CLI: {err}") from err

        try:
            async with asyncio.timeout(GH_CLI_TIMEOUT):
                stdout, stderr = await proc.communicate(input=stdin_bytes)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise GitHubError(
                f"gh api timed out after {GH_CLI_TIMEOUT:.0f}s for {api_path}"
            ) from None

        if proc.returncode != 0:
            message = stderr.decode("utf-8", "replace").strip()[:300]
            raise GitHubError(
                f"gh api failed for {api_path}: {message or 'unknown error'}",
                status=_status_from_gh_stderr(message),
            )

        text = stdout.decode("utf-8", "replace").strip()
        if not text:
            return None
        try:
            return json.loads(text)
        except ValueError as err:
            raise GitHubError(
                f"gh api returned a non-JSON response for {api_path}"
            ) from err


class HttpTransport:
    """Direct REST calls with a personal access token as a bearer token."""

    def __init__(self, token: str, base_url: str = DEFAULT_API_BASE_URL) -> None:
        if not token:
            raise GitHubError(
                "No GitHub token: set the GITHUB_TOKEN env var (MCP client env "
                "or .env) to a personal access token with repo access, or "
                "authenticate the gh CLI (gh auth login)."
            )
        self._token = token
        self._base_url = base_url

    async def request(
        self,
        method: str,
        api_path: str,
        *,
        query: Mapping[str, str | int] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        headers = {
            "accept": "application/vnd.github+json",
            "authorization": f"Bearer {self._token}",
            "x-github-api-version": "2022-11-28",
        }
        params = {key: str(value) for key, value in (query or {}).items()}

        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT, follow_redirects=False
        ) as client:
            response = await client.request(
                method,
                f"{self._base_url}{api_path}",
                params=params or None,
                headers=headers,
                json=json_body,
            )

        if response.status_code < 200 or response.status_code >= 300:
            body = response.text[:200]
            raise GitHubError(
                f"GitHub API error {response.status_code} for {api_path}: {body}",
                response.status_code,
            )
        if not response.content:
            return None
        return response.json()


async def gh_cli_is_available(gh_executable: str = "gh") -> bool:
    """True when the gh CLI is installed AND authenticated.

    `gh auth status` reads gh's local credential store (no network round
    trip), so the check is cheap enough to run per tool call and the
    decision stays fresh — logging in or out takes effect immediately.
    """
    if shutil.which(gh_executable) is None:
        return False
    try:
        proc = await asyncio.create_subprocess_exec(
            gh_executable, "auth", "status", stdout=DEVNULL, stderr=DEVNULL
        )
    except OSError:
        return False
    try:
        async with asyncio.timeout(GH_AUTH_CHECK_TIMEOUT):
            await proc.wait()
    except TimeoutError:
        proc.kill()
        await proc.wait()
        return False
    return proc.returncode == 0


async def resolve_transport(
    *, token: str = "", base_url: str = ""
) -> GitHubTransport | None:
    """Pick the transport for one tool call: the authenticated gh CLI when
    usable, else the token HTTP transport, else None ("unavailable").

    `base_url` (GITHUB_BASE_URL) only applies to the HTTP transport; the gh
    CLI resolves its host on its own (GH_HOST / gh auth status).
    """
    if await gh_cli_is_available():
        return GhCliTransport()
    if token:
        return HttpTransport(token=token, base_url=base_url or DEFAULT_API_BASE_URL)
    return None
