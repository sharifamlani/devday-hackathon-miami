"""POST /context/run when the live read times out or the model fails: the typed URLs are kept (never the
facts wiped), and the background refresh reads those saved URLs instead of the Foundation default.
No network and no model calls: build_context is stood in everywhere."""

import sqlite3
import time

from fastapi.testclient import TestClient

from service import config, org_context
from service import refresh as refresh_module
from service.main import app, run_refresh


def good_result(name="Test Org"):
    facts = [{"source": s, "url": f"https://example.org/{s}", "posted_at": "2026-10-01", "fact": f"{s} fact",
              "quote": "fact", "priority": "Generate Prosperity", "captured_at": "2026-11-07"}
             for s in ("website", "news")]
    return {"profile": {"name": name, "priorities": ["Generate Prosperity"], "voice": {"phrases": []}},
            "facts": facts, "sources": {"website": "ok", "news": "ok"}}


def slow(urls, refresh=False):
    time.sleep(0.5)
    return good_result("Should not be saved")


def saved(c: TestClient) -> tuple:
    profile = c.get("/org-profile").json() or {}
    facts = sorted((f["source"], f["fact"]) for f in c.get("/context").json())
    urls = {k: profile.get(k) for k in ("website", "x_url", "linkedin_url", "instagram_url")}
    return profile.get("name"), urls, facts


def test_timeout_keeps_the_typed_urls_and_the_saved_facts(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result())
    assert c.post("/context/run", json={"website": "https://example.org"}).json()["state"] == "done"
    name, _, facts = saved(c)

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    body = c.post("/context/run", json={"website": "https://example.org/about",
                                        "x_url": "https://x.com/testorg"}).json()

    assert body["served_from"] == "fallback" and body["state"] == "failed"
    assert "took longer" in body["detail"]
    assert body["saved"]["urls_only"] is True and body["saved"]["replaced_sources"] == []
    after_name, urls, after_facts = saved(c)
    assert urls == {"website": "https://example.org/about", "x_url": "https://x.com/testorg",
                    "linkedin_url": None, "instagram_url": None}
    assert (after_name, after_facts) == (name, facts) == ("Test Org", [("news", "news fact"),
                                                                       ("website", "website fact")])


def test_model_error_on_a_first_run_still_saves_the_urls(db_file, monkeypatch):
    c = TestClient(app)

    def model_down(urls, refresh=False):
        raise RuntimeError("APIConnectionError: model unreachable")

    monkeypatch.setattr(org_context, "build_context", model_down)
    body = c.post("/context/run", json={"website": "https://new-org.org",
                                        "instagram_url": "https://www.instagram.com/neworg"}).json()

    assert body["served_from"] == "fallback" and body["facts"] == []
    assert body["sources"]["instagram"]["status"] == "saved, not connected"   # and it really is saved now
    _, urls, facts = saved(c)
    assert urls["website"] == "https://new-org.org"
    assert urls["instagram_url"] == "https://www.instagram.com/neworg"
    assert facts == []


def test_missing_website_still_saves_nothing(db_file, monkeypatch):
    c = TestClient(app)
    before = saved(c)
    body = c.post("/context/run", json={"x_url": "https://x.com/someorg"}).json()
    assert body["saved"] is None and saved(c) == before


def test_background_refresh_reads_the_urls_a_timed_out_run_saved(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    c.post("/context/run", json={"website": "https://slow-org.org", "linkedin_url": "https://www.linkedin.com/company/slow"})

    seen = []
    monkeypatch.setattr(refresh_module, "refresh", lambda conn, urls: seen.append(urls) or {"facts": {"added": 0}})
    result = run_refresh()

    assert result["state"] == "done"
    assert seen and seen[0]["website"] == "https://slow-org.org"
    assert seen[0]["linkedin_url"] == "https://www.linkedin.com/company/slow"


def test_refresh_without_urls_uses_the_saved_profile_not_the_foundation():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE org_profile (id INTEGER PRIMARY KEY, name, website, x_url, linkedin_url, instagram_url)")
    conn.execute("INSERT INTO org_profile VALUES (1, 'Saved Org', 'https://saved-org.org/', NULL, NULL, NULL)")
    built = []

    def build(urls, refresh):
        built.append(urls)
        return {"facts": [], "sources": {"website": "error: test", "news": "error: test"}}

    refresh_module.refresh(conn, None, "2026-11-08", [], build=build, extract=lambda facts, refresh, website: [],
                           audience=lambda *a, **k: {"person_ids": []}, invite=lambda e, p: {},
                           save=lambda *a: None)

    assert built[0]["website"] == "https://saved-org.org/" and built[0]["name"] == "Saved Org"


def test_refresh_falls_back_to_the_foundation_before_onboarding():
    conn = sqlite3.connect(":memory:")
    built = []

    def build(urls, refresh):
        built.append(urls)
        return {"facts": [], "sources": {}}

    refresh_module.refresh(conn, None, "2026-11-08", [], build=build, extract=lambda facts, refresh, website: [],
                           audience=lambda *a, **k: {"person_ids": []}, invite=lambda e, p: {},
                           save=lambda *a: None)

    assert built[0]["website"] == refresh_module.FOUNDATION_URLS["website"]


def full_profile(c: TestClient) -> dict:
    return c.get("/org-profile").json() or {}


def test_timeout_for_another_org_forgets_the_previous_orgs_context(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Old Org"))
    assert c.post("/context/run", json={"website": "https://example.org"}).json()["state"] == "done"
    assert full_profile(c)["priorities"] == ["Generate Prosperity"]

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    body = c.post("/context/run", json={"website": "https://another-org.org"}).json()

    assert body["served_from"] == "fallback" and body["facts"] == []
    assert body["saved"]["cleared_previous_org"] is True
    profile = full_profile(c)
    assert profile["website"] == "https://another-org.org"
    assert profile["name"] is None and profile["priorities"] == [] and profile["voice"] == {}
    assert profile["source_status"] == {}
    assert c.get("/context").json() == []                     # no Old Org facts under the new URL


def test_timeout_for_the_same_host_keeps_its_context(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Same Org"))
    c.post("/context/run", json={"website": "https://example.org"})

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    body = c.post("/context/run", json={"website": "https://www.example.org/donate"}).json()   # www + path: same host

    assert body["saved"]["cleared_previous_org"] is False
    profile = full_profile(c)
    assert profile["website"] == "https://www.example.org/donate"
    assert profile["name"] == "Same Org" and profile["priorities"] == ["Generate Prosperity"]
    assert len(c.get("/context").json()) == 2


def test_partial_live_run_for_another_org_keeps_none_of_the_old_facts(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Old Org"))
    c.post("/context/run", json={"website": "https://example.org"})

    fresh = good_result("New Org")                               # news fails for the new org
    fresh["facts"] = [{**fresh["facts"][0], "url": "https://new-org.org/about", "fact": "new org fact"}]
    fresh["sources"] = {"website": "ok", "news": "error: search timed out"}
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: fresh)
    body = c.post("/context/run", json={"website": "https://new-org.org"}).json()

    assert body["state"] == "partial"
    assert [(f["source"], f["fact"]) for f in c.get("/context").json()] == [("website", "new org fact")]
    assert full_profile(c)["name"] == "New Org"
