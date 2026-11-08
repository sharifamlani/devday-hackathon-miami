"""CORS_ORIGINS env override: appended to the Vite defaults, defaults unchanged when unset."""
from service import config


def test_unset_keeps_the_defaults():
    assert config.cors_origins(None) == config.DEFAULT_CORS_ORIGINS
    assert config.cors_origins("") == config.DEFAULT_CORS_ORIGINS


def test_extra_origins_are_appended_trimmed_and_deduplicated():
    got = config.cors_origins(" http://localhost:5199/ ,http://localhost:5173, http://127.0.0.1:5199 ")
    assert got[: len(config.DEFAULT_CORS_ORIGINS)] == config.DEFAULT_CORS_ORIGINS
    assert got[len(config.DEFAULT_CORS_ORIGINS):] == ["http://localhost:5199", "http://127.0.0.1:5199"]
