from fastapi.testclient import TestClient

from service import db, outreach_agent
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
