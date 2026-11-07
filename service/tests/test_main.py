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
    assert body["served_from"] == "cache" and body["cached"] is False
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


def test_fallback_never_serves_another_orgs_context(db_file, monkeypatch):
    body = run_then_fail(monkeypatch, "https://example.org", "https://another-org.org")

    assert body["served_from"] == "fallback" and body["state"] == "failed"
    assert body["profile"] is None and body["facts"] == []
    assert body["sources"]["website"]["status"] == "failed"
