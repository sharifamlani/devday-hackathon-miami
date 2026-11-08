"""PUBLIC_SHOW_ALL (docs/public-tunnel.md): public mode hides nothing (demo data is fictional) but stays read-only."""
import pytest
from fastapi.testclient import TestClient

from service import config, db, public_mode
from service.main import app

VERCEL = "https://devday-donor-desk.vercel.app"
H = {"Origin": VERCEL}


@pytest.fixture(autouse=True)
def show_all(monkeypatch):
    public_mode.set_enabled(False, [VERCEL])
    monkeypatch.setattr(config, "PUBLIC_SHOW_ALL", True)
    yield
    public_mode.set_enabled(False)


@pytest.fixture
def client(db_file):
    return TestClient(app)


def seed_private(client) -> tuple[int, str]:
    """A call note with a transcript on donor 1, and a staff (crm) task: both hidden by the redacting public mode."""
    conn = db.connect()
    try:
        db.save_call_note(conn, {"id": "probe-note", "title": "Call with donor", "created_at": "2026-11-08T10:00:00",
                                 "duration_sec": 60, "transcript": "ZEBRA-TRANSCRIPT-7731",
                                 "notes": "staff note", "destinations": [{"kind": "donor", "id": "1"}]})
        conn.commit()
    finally:
        conn.close()
    r = client.post("/crm/tasks", json={"contact_id": 1, "type": "Call", "text": "PRIVATE-TASK-9931",
                                        "due_date": "2026-11-09"})
    assert r.status_code in (200, 201), r.text
    return 1, "PRIVATE-TASK-9931"


def test_public_mode_reports_not_redacted(client):
    public_mode.set_enabled(True)
    assert client.get("/public-mode").json() == {"enabled": True, "redacted": False}
    assert public_mode.enabled() and not public_mode.redacting()


def test_responses_match_local_mode(client):
    """Every read the web makes returns exactly what local mode returns: no masking, no blanking."""
    seed_private(client)
    paths = ["/donors/1", "/people", "/donors", "/tasks", "/calendar", "/artifacts", "/home/summary", "/calls?limit=200"]
    local = {p: client.get(p).json() for p in paths}
    public_mode.set_enabled(True)
    for p in paths:
        r = client.get(p, headers=H)
        assert r.status_code == 200, p
        assert r.json() == local[p], p
    assert "ZEBRA-TRANSCRIPT-7731" in client.get("/calls?limit=200", headers=H).text
    assert "@" in client.get("/donors/1", headers=H).json()["email"] and "***" not in client.get("/donors/1", headers=H).text


def test_every_read_needs_the_vercel_origin(client):
    public_mode.set_enabled(True)
    for p in ["/calls", "/crm/contacts", "/openapi.json", "/donors/1"]:
        assert client.get(p, headers=H).status_code == 200, p
        assert client.get(p).status_code == 403, p
        assert client.get(p, headers={"Origin": "https://evil.example"}).status_code == 403, p


def test_writes_stay_refused(client):
    public_mode.set_enabled(True)
    for method, path in [("patch", "/people/1"), ("put", "/people/1"), ("post", "/tasks"), ("post", "/crm/tasks"),
                         ("post", "/duplicates/1/merge"), ("post", "/campaigns/1/send"), ("delete", "/tasks/1"),
                         ("post", "/ingest"), ("post", "/context/run"), ("post", "/phone/calls")]:
        assert getattr(client, method)(path, headers=H).status_code == 403, (method, path)


def test_agent_reads_private_data_but_cannot_write(monkeypatch):
    from service import chat_agent
    public_mode.set_enabled(True)
    monkeypatch.setattr(chat_agent, "refuse_in_preview", lambda t: ("refused", t.name))
    refused = {x[1] for x in chat_agent.tools_for_mode() if isinstance(x, tuple)}
    for name in chat_agent.READ_ONLY_TOOLS | chat_agent.PRIVATE_READ_TOOLS:
        assert name not in refused, name
    for name in ("create_task", "update_person", "send", "merge_duplicate", "update_donor_summary"):
        assert name in refused, name
    monkeypatch.setattr(config, "PUBLIC_SHOW_ALL", False)        # default: the private reads are refused again
    refused = {x[1] for x in chat_agent.tools_for_mode() if isinstance(x, tuple)}
    assert chat_agent.PRIVATE_READ_TOOLS <= refused


def test_mask_json_passes_through():
    value = {"email": "ana@example.com", "phone": "305-555-0101", "call_notes": [{"transcript": "x"}], "notes": "y"}
    assert public_mode.mask_json(value) == value


def test_default_is_unchanged(client, monkeypatch):
    """Without PUBLIC_SHOW_ALL, public mode still redacts (the env var is opt-in)."""
    monkeypatch.setattr(config, "PUBLIC_SHOW_ALL", False)
    public_mode.set_enabled(True)
    assert client.get("/public-mode").json() == {"enabled": True, "redacted": True}
    assert client.get("/calls", headers=H).status_code == 403
    assert "***" in client.get("/donors/1", headers=H).json()["email"]
