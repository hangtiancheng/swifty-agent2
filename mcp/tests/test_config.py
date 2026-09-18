"""GitLab env config parsing (base URL + private token)."""

from __future__ import annotations

from app.shared.config import load_config


def test_defaults_to_unconfigured_when_the_environment_is_empty() -> None:
    # Nothing in the code points at a particular instance: an unset
    # GITLAB_BASE_URL means the gitlab_* tools degrade per call.
    config = load_config({})
    assert config.gitlab.base_url == ""


def test_treats_empty_strings_as_unset() -> None:
    config = load_config({"GITLAB_BASE_URL": ""})
    assert config.gitlab.base_url == ""


def test_strips_trailing_slashes_from_the_gitlab_base_url() -> None:
    config = load_config({"GITLAB_BASE_URL": "https://gitlab.example.com//"})
    assert config.gitlab.base_url == "https://gitlab.example.com"


def test_honours_an_explicit_gitlab_base_url() -> None:
    config = load_config({"GITLAB_BASE_URL": "https://gitlab.example.com"})
    assert config.gitlab.base_url == "https://gitlab.example.com"


def test_the_private_token_defaults_to_empty() -> None:
    # Empty means "not configured": the gitlab_* tools answer with a clear
    # unavailable error per call instead of failing at startup.
    assert load_config({}).gitlab.private_token == ""


def test_honours_an_explicit_private_token() -> None:
    config = load_config({"GITLAB_PRIVATE_TOKEN": "tok-secret"})
    assert config.gitlab.private_token == "tok-secret"


def test_a_blank_private_token_is_unset() -> None:
    config = load_config({"GITLAB_PRIVATE_TOKEN": "   "})
    assert config.gitlab.private_token == ""
