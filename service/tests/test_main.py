import pytest
from fastapi.testclient import TestClient

from service import db, org_context, outreach_agent
from service.main import app


def add_prospect(name: str, status: str) -> int:
    conn = db.connect()
    with conn:
        cur = conn.execute("INSERT INTO prospects (name, org_type, city, status) VALUES (?, 'foundation', 'Miami', ?)",
                           (name, status))
    conn.close()
    return cur.lastrowid


def no_model_call(prospect_id):
    raise AssertionError(f"draft_for_prospect ran for prospect {prospect_id}")


def test_dismissed_prospect_gets_409_and_no_draft(db_file, monkeypatch):
    monkeypatch.setattr(outreach_agent, "draft_for_prospect", no_model_call)
    pid = add_prospect("Test Dismissed Foundation", "dismissed")

    r = TestClient(app).post(f"/prospects/{pid}/outreach")

    assert r.status_code == 409
    assert r.json()["detail"] == f"prospect {pid} is dismissed"
    conn = db.connect()
    assert conn.execute("SELECT COUNT(*) FROM outreach_drafts WHERE prospect_id = ?", (pid,)).fetchone()[0] == 0
    conn.close()


def test_unknown_prospect_404_without_local_path(db_file, monkeypatch):
    monkeypatch.setattr(outreach_agent, "draft_for_prospect", no_model_call)

    r = TestClient(app).post("/prospects/9999/outreach")

    assert r.status_code == 404
    assert r.json()["detail"] == "prospect 9999 not found"


def test_new_prospect_still_drafts(db_file, monkeypatch):
    pid = add_prospect("Test New Foundation", "new")
    calls = []

    def fake_draft(prospect_id):
        calls.append(prospect_id)
        draft = outreach_agent.Draft(subject="s", body="b", call_script="c", facts_used=[], status="draft")
        return draft, "donors.db:outreach_drafts#77"

    monkeypatch.setattr(outreach_agent, "draft_for_prospect", fake_draft)

    r = TestClient(app).post(f"/prospects/{pid}/outreach")

    assert r.status_code == 200
    assert calls == [pid]
    assert r.json()["draft_id"] == 77 and r.json()["status"] == "draft"


def context_result(website: str, news: str) -> dict:
    facts = [{"source": s, "url": f"https://example.org/{s}", "posted_at": "2026-10-01", "fact": f"{s} fact",
              "quote": "fact", "priority": "Generate Prosperity", "captured_at": "2026-11-07"}
             for s, status in (("website", website), ("news", news)) if status == "ok"]
    return {"profile": {"name": "Test Org", "priorities": [], "voice": {"phrases": []}},
            "facts": facts,
            "sources": {"website": website, "news": news, "x": "skipped", "linkedin": "skipped",
                        "instagram": "skipped"}}


@pytest.mark.parametrize("website, news, state", [
    ("ok", "ok", "done"),
    ("ok", "error: search timed out", "partial"),
    ("blocked", "ok", "partial"),
    ("error: site returned 503", "error: search timed out", "failed"),
    ("blocked", "skipped", "failed"),
])
def test_context_run_state_reflects_sources(db_file, monkeypatch, website, news, state):
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: context_result(website, news))

    r = TestClient(app).post("/context/run", json={"website": "https://example.org",
                                                   "linkedin_url": "https://www.linkedin.com/company/x"})

    assert r.status_code == 200
    body = r.json()
    assert body["state"] == state
    assert body["served_from"] == "live" and body["cached"] is False      # the site is read on every run
    assert body["sources"]["linkedin"]["status"] == "saved, not connected"


def test_context_run_without_website_serves_nothing(db_file, monkeypatch):
    def no_read(urls, refresh=False):
        raise AssertionError("build_context ran without a website")

    monkeypatch.setattr(org_context, "build_context", no_read)

    r = TestClient(app).post("/context/run", json={"x_url": "https://x.com/someorg"})

    body = r.json()
    assert r.status_code == 200
    assert body["state"] == "failed" and body["detail"] == "no website provided"
    assert body["profile"] is None and body["facts"] == [] and body["saved"] is None
    assert body["sources"]["news"]["status"] == "not provided"
    assert body["sources"]["x"]["status"] == "not connected"


def run_then_fail(monkeypatch, saved_site: str, failing_site: str) -> dict:
    """Save context for saved_site, then make the live read fail for failing_site."""
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: context_result("ok", "ok"))
    assert c.post("/context/run", json={"website": saved_site}).json()["state"] == "done"

    def boom(urls, refresh=False):
        raise RuntimeError("site unreachable")

    monkeypatch.setattr(org_context, "build_context", boom)
    return c.post("/context/run", json={"website": failing_site, "refresh": True}).json()


def test_fallback_rows_say_cached_not_done(db_file, monkeypatch):
    body = run_then_fail(monkeypatch, "https://example.org", "https://www.example.org/")

    assert body["served_from"] == "fallback" and body["state"] == "failed"
    assert body["sources"]["website"]["status"] == "cached (fallback)"
    assert body["sources"]["news"]["status"] == "cached (fallback)"
    assert len(body["facts"]) == 2
    assert all(f["cached"] is True for f in body["facts"])               # the UI labels each one "cached"


def test_context_run_reads_live_even_when_refresh_is_false(db_file, monkeypatch):
    seen = []
    monkeypatch.setattr(org_context, "build_context",
                        lambda urls, refresh=False: seen.append(refresh) or context_result("ok", "ok"))
    TestClient(app).post("/context/run", json={"website": "https://example.org", "refresh": False})
    assert seen == [True]


def test_fallback_never_serves_another_orgs_context(db_file, monkeypatch):
    body = run_then_fail(monkeypatch, "https://example.org", "https://another-org.org")

    assert body["served_from"] == "fallback" and body["state"] == "failed"
    assert body["profile"] is None and body["facts"] == []
    assert body["sources"]["website"]["status"] == "failed"


@pytest.mark.parametrize("facts_from, state", [((), "failed"), (("website",), "partial")])
def test_source_ok_with_no_facts_counts_as_failed(db_file, monkeypatch, facts_from, state):
    result = context_result("ok", "ok")  # build_context says both sources are fine...
    result["facts"] = [f for f in result["facts"] if f["source"] in facts_from]  # ...but some found nothing
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: result)

    body = TestClient(app).post("/context/run", json={"website": "https://example.org"}).json()

    assert body["state"] == state
    assert body["sources"]["news"] == {"status": "failed", "facts": 0, "detail": "error: no facts found"}


def saved_state(c: TestClient) -> tuple:
    profile = c.get("/org-profile").json()
    facts = sorted((f["source"], f["fact"]) for f in c.get("/context").json())
    return profile["name"], profile["website"], facts


def test_failed_run_after_good_run_changes_nothing(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: context_result("ok", "ok"))
    assert c.post("/context/run", json={"website": "https://example.org"}).json()["state"] == "done"
    before = saved_state(c)

    typo = {"profile": {"name": None}, "facts": [],
            "sources": {"website": "error: DNS: exmaple.org not found", "news": "error: search found no pages"}}
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: typo)
    body = c.post("/context/run", json={"website": "https://exmaple.org", "refresh": True}).json()

    assert body["state"] == "failed" and body["saved"] is None
    assert saved_state(c) == before == ("Test Org", "https://example.org", [("news", "news fact"),
                                                                           ("website", "website fact")])


def test_partial_run_replaces_only_sources_that_succeeded(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: context_result("ok", "ok"))
    c.post("/context/run", json={"website": "https://example.org"})

    fresh = context_result("ok", "ok")  # news claims ok but finds nothing this time
    fresh["facts"] = [{**fresh["facts"][0], "fact": "new website fact", "url": "https://example.org/new"}]
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: fresh)
    body = c.post("/context/run", json={"website": "https://example.org", "refresh": True}).json()

    assert body["state"] == "partial"
    assert body["saved"]["replaced_sources"] == ["website"]
    assert saved_state(c)[2] == [("news", "news fact"), ("website", "new website fact")]
