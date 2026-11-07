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
