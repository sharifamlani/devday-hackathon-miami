import pytest

from service import social_context as sc

TOKENS = ("X_BEARER_TOKEN", "IG_ACCESS_TOKEN", "IG_USER_ID", "LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORG_URN")


@pytest.fixture(autouse=True)
def no_tokens(monkeypatch):
    for k in TOKENS:
        monkeypatch.delenv(k, raising=False)


def test_cache_loads():
    cache = sc._load_cache()
    assert set(cache["platforms"]) == set(sc.PLATFORMS)
    for item in cache["items"]:
        assert {"platform", "handle", "post_url", "posted_at", "text", "captured_at", "capture_method"} <= set(item)


def test_every_quote_is_verbatim_in_its_post():
    cache = sc._load_cache()
    by_url = {i["post_url"]: i["text"] for i in cache["items"]}
    facts = sc.get_social_facts(limit=50)
    assert facts
    for f in facts:
        assert f["quote"] in by_url[f["url"]]
        assert f["quote"] in f["fact"]


def test_no_token_uses_cache_even_with_refresh():
    status = sc.social_status(refresh=True)
    assert all(s["source"] != "api" for s in status.values())
    assert status["instagram"]["source"] == "cache"


def test_facts_sorted_newest_first():
    dates = [f["date"] for f in sc.get_social_facts(limit=50)]
    assert dates == sorted(dates, reverse=True)


def test_blocked_platform_reports_blocked():
    status = sc.social_status()
    for p in ("x", "linkedin"):
        assert status[p]["source"] == "blocked" and status[p]["count"] == 0 and status[p]["blocked"]


def test_token_path_falls_back_to_cache_on_api_error(monkeypatch):
    monkeypatch.setenv("X_BEARER_TOKEN", "bad")
    monkeypatch.setitem(sc._ADAPTERS, "x", (lambda h, n: 1 / 0, ("X_BEARER_TOKEN",)))
    assert sc.social_status(refresh=True)["x"]["source"] == "blocked"
