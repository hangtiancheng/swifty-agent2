"""GitHub env config parsing (API base URL + token)."""

from __future__ import annotations

from app.shared.config import load_config


def test_defaults_to_unconfigured_when_the_environment_is_empty() -> None:
    # Without an authenticated gh CLI or a token the github_* tools degrade
    # per call; nothing in the code points at an account by default.
    config = load_config({})
    assert config.github.token == ""
    assert config.github.base_url == ""


def test_treats_empty_strings_as_unset() -> None:
    config = load_config({"GITHUB_BASE_URL": ""})
    assert config.github.base_url == ""


def test_github_token_prefers_github_token_over_gh_token() -> None:
    config = load_config({"GITHUB_TOKEN": "a", "GH_TOKEN": "b"})
    assert config.github.token == "a"


def test_github_token_falls_back_to_gh_token() -> None:
    assert load_config({"GH_TOKEN": "b"}).github.token == "b"


def test_a_blank_github_token_is_unset() -> None:
    assert load_config({"GITHUB_TOKEN": "   "}).github.token == ""


def test_strips_trailing_slashes_from_the_github_base_url() -> None:
    config = load_config({"GITHUB_BASE_URL": "https://ghe.example.com/api/v3//"})
    assert config.github.base_url == "https://ghe.example.com/api/v3"


def test_honours_an_explicit_github_base_url() -> None:
    config = load_config({"GITHUB_BASE_URL": "https://ghe.example.com/api/v3"})
    assert config.github.base_url == "https://ghe.example.com/api/v3"
