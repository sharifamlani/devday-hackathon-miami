"""Call notes (service/routes_calls.py): the rules summary, POST /calls/summarize with the model mocked,
saving and listing notes, the donor detail's call_notes, the migration and the snapshot export.

No network: every "key" test replaces Runner.run; the rest run with no key.
"""

import asyncio
import logging

import agents
import pytest
from fastapi.testclient import TestClient

from service import config, db, routes_calls
from service.export_snapshot import build_snapshot
from service.main import app
from service.routes_calls import CallSummary, TranscriptLine, rules_summary

JAMES = 3   # seed: James Carter, monthly donor; his newest gift is $50 on 2026-10-15

TRANSCRIPT = [
    {"speaker": "you", "name": "Sam", "text": "Hi James, thanks for taking the call.", "at": 0},
    {"speaker": "them", "name": "James Carter", "text": "Happy to. The weather has been great.", "at": 6},
    {"speaker": "them", "name": "James Carter",
     "text": "I want to keep my monthly gift going and maybe bring my family to the gala.", "at": 41},
    {"speaker": "you", "name": "Sam", "text": "Wonderful. I’ll send you the gala details by email.", "at": 95},
    {"speaker": "them", "name": "James Carter", "text": "Great, talk soon.", "at": 182},
]
SECRET_LINE = "my private medical detail"


def lines(raw=TRANSCRIPT):
    return [TranscriptLine(**r) for r in raw]


@pytest.fixture
def client(db_file, monkeypatch):
    monkeypatch.setattr(config, "HAS_OPENAI_KEY", False)
    return TestClient(app)


class FakeResult:
    def __init__(self, out):
        self.out = out

    def final_output_as(self, cls, raise_if_incorrect_type=False):
        assert cls is CallSummary
        return self.out


@pytest.fixture
def fake_model(monkeypatch):
    """A 'key' plus a Runner.run that returns a canned CallSummary; records what the agent was given."""
    calls = []

    def install(out=None, error=None, delay=0.0):
        async def run(agent, prompt, **kwargs):
            calls.append({"agent": agent, "prompt": prompt, **kwargs})
            if delay:
                await asyncio.sleep(delay)
            if error:
                raise error
            return FakeResult(out)

        monkeypatch.setattr(config, "HAS_OPENAI_KEY", True)
        monkeypatch.setattr(agents.Runner, "run", run)
        return calls

    return install


# ----------------------------------------------------------------------------------------------
# Rules summary
# ----------------------------------------------------------------------------------------------

def test_rules_summary_quotes_the_call_and_finds_next_steps():
    summary, steps = rules_summary(lines(), "Prefers email.\n- [ ] Add family to gala list")
    assert summary[0] == "Call with James Carter, about 3 min."
    # key lines first (gift / family / gala), not small talk
    assert summary[1] == "James Carter said: “I want to keep my monthly gift going and maybe bring my family to the gala.”"
    assert "weather" not in " ".join(summary)
    assert summary[-1] == "Your notes: Prefers email."
    assert steps == ["You: I’ll send you the gala details by email.", "Add family to gala list"]


def test_rules_summary_without_a_transcript():
    summary, steps = rules_summary([], "", {"full_name": "Angela Brooks"})
    assert summary == ["No transcript was recorded for this call."]
    assert steps == ["Log the next contact date for Angela Brooks."]


def test_rules_summary_is_deterministic():
    assert rules_summary(lines(), "n") == rules_summary(lines(), "n")


# ----------------------------------------------------------------------------------------------
# POST /calls/summarize
# ----------------------------------------------------------------------------------------------

def test_summarize_without_a_key_uses_the_rules(client):
    body = client.post("/calls/summarize", json={"title": "Check-in", "transcript": TRANSCRIPT, "notes": "",
                                                 "donor_id": JAMES}).json()
    assert body["source"] == "rules" and "OPENAI_API_KEY" in body["detail"]
    assert body["summary"][0] == "Call with James Carter, about 3 min."
    assert body["next_steps"] and isinstance(body["next_steps"], list)


def test_summarize_uses_a_grounded_model_answer(client, fake_model):
    out = CallSummary(summary=["James will keep his monthly gift; his last was $50 on Oct 15."],
                      next_steps=["Send the gala details by email."])
    calls = fake_model(out)
    body = client.post("/calls/summarize", json={"title": "Check-in", "transcript": TRANSCRIPT,
                                                 "notes": "", "donor_id": JAMES}).json()
    assert body == {"summary": out.summary, "next_steps": out.next_steps, "source": "model", "detail": None}
    agent = calls[0]["agent"]
    assert agent.tools == [] and agent.output_type is CallSummary and agent.model == config.MODEL_FAST
    assert calls[0]["run_config"].trace_include_sensitive_data is False
    assert "bring my family to the gala" in calls[0]["prompt"]            # the transcript
    assert "2026-10-15: $50 via" in calls[0]["prompt"]                    # the donor's own record


@pytest.mark.parametrize("bad", [
    CallSummary(summary=["James pledged $5,000 for the gala."], next_steps=[]),         # invented amount
    CallSummary(summary=["Spoke with James."], next_steps=["Call back on March 3."]),  # invented date
    CallSummary(summary=[], next_steps=["Send details."]),                               # empty summary
])
def test_summarize_rejects_an_ungrounded_model_answer(client, fake_model, bad):
    fake_model(bad)
    body = client.post("/calls/summarize", json={"transcript": TRANSCRIPT, "donor_id": JAMES}).json()
    assert body["source"] == "rules" and "summarized by the rules" in body["detail"]
    assert "$5,000" not in str(body) and "March 3" not in str(body)


@pytest.mark.parametrize("failure", ["error", "timeout"])
def test_summarize_falls_back_when_the_model_fails(client, fake_model, monkeypatch, caplog, failure):
    if failure == "timeout":
        monkeypatch.setattr(routes_calls, "CALLS_DEADLINE_S", 0.05)
        fake_model(CallSummary(summary=["x"], next_steps=[]), delay=1.0)
    else:
        fake_model(error=RuntimeError(SECRET_LINE))
    transcript = TRANSCRIPT + [{"speaker": "them", "name": "James Carter", "text": SECRET_LINE, "at": 190}]
    with caplog.at_level(logging.DEBUG):
        body = client.post("/calls/summarize", json={"transcript": transcript}).json()
    assert body["source"] == "rules"
    assert ("longer than" if failure == "timeout" else "RuntimeError") in body["detail"]
    assert caplog.records and all(SECRET_LINE not in r.getMessage() for r in caplog.records)   # never logged


def test_summarize_unknown_donor_is_404(client):
    assert client.post("/calls/summarize", json={"transcript": [], "donor_id": 9999}).status_code == 404


def test_summarize_validates_the_transcript(client):
    bad = [{"speaker": "narrator", "name": "x", "text": "hi", "at": 0}]
    assert client.post("/calls/summarize", json={"transcript": bad}).status_code == 422


# ----------------------------------------------------------------------------------------------
# POST /calls, GET /calls, GET /donors/{id}
# ----------------------------------------------------------------------------------------------

def note(**overrides):
    base = {"id": "call-1", "title": "Check-in with James", "created_at": "2026-11-07T15:00:00.000Z",
            "duration_sec": 182, "destinations": [{"kind": "donor", "id": JAMES, "label": "James Carter"}],
            "transcript": TRANSCRIPT, "notes": "Prefers email.", "summary": ["Kept his monthly gift."],
            "next_steps": ["Send gala details."]}
    return {**base, **overrides}


def test_save_and_list_calls(client):
    saved = client.post("/calls", json=note()).json()
    assert saved["id"] == "call-1" and saved["destinations"] == [{"kind": "donor", "id": "3", "label": "James Carter"}]
    assert saved["transcript"][3]["text"].startswith("Wonderful.") and saved["next_steps"] == ["Send gala details."]
    assert saved["duration_sec"] == 182 and saved["created_at"] == "2026-11-07T15:00:00.000Z"

    project = note(id="call-2", created_at="2026-11-07T16:30:00+00:00", title="Board prep",
                   destinations=[{"kind": "project", "id": "7", "label": "Year-end push"}])
    client.post("/calls", json=project)
    fresh = client.post("/calls", json=note(id=None, created_at=None, destinations=[])).json()
    assert len(fresh["id"]) == 32 and fresh["created_at"].endswith("Z")

    everyone = client.get("/calls").json()
    assert [c["id"] for c in everyone][1:] == ["call-2", "call-1"] and everyone[0]["id"] == fresh["id"]
    assert everyone[1]["created_at"] == "2026-11-07T16:30:00.000Z"          # normalized to UTC
    assert [c["id"] for c in client.get(f"/calls?donor_id={JAMES}").json()] == ["call-1"]
    assert [c["id"] for c in client.get("/calls?project_id=7").json()] == ["call-2"]
    assert client.get("/calls?donor_id=1").json() == []
    assert len(client.get("/calls?limit=1").json()) == 1


def test_saving_again_updates_the_note(client):
    client.post("/calls", json=note())
    client.post("/calls", json=note(title="Renamed", summary=["Edited by hand."]))
    rows = client.get("/calls").json()
    assert len(rows) == 1 and rows[0]["title"] == "Renamed" and rows[0]["summary"] == ["Edited by hand."]


def test_donor_destination_must_exist(client):
    r = client.post("/calls", json=note(destinations=[{"kind": "donor", "id": "9999", "label": "Nobody"}]))
    assert r.status_code == 422 and client.get("/calls").json() == []


def test_donor_detail_lists_its_call_notes(client):
    assert client.get(f"/donors/{JAMES}").json()["call_notes"] == []
    client.post("/calls", json=note())
    client.post("/calls", json=note(id="other", destinations=[{"kind": "group", "id": "g1", "label": "Monthly"}]))
    detail = client.get(f"/donors/{JAMES}").json()
    assert [c["id"] for c in detail["call_notes"]] == ["call-1"]
    assert {"gifts", "research_facts", "outreach_drafts", "merges"} <= detail.keys()   # existing shape kept


# ----------------------------------------------------------------------------------------------
# Migration and snapshot
# ----------------------------------------------------------------------------------------------

def test_create_schema_adds_call_notes_to_an_older_db(tmp_path):
    path = tmp_path / "old.db"
    conn = db.connect(path)
    db.create_schema(conn)
    conn.execute("DROP TABLE call_notes")            # a donors.db from before this table existed
    conn.commit()
    db.create_schema(conn)
    db.create_schema(conn)                           # idempotent
    db.save_call_note(conn, {"id": "x", "title": "t", "created_at": "2026-11-07T00:00:00.000Z"})
    assert [r["id"] for r in db.list_call_notes(conn)] == ["x"]
    conn.close()


def test_snapshot_never_exports_call_notes(client, db_file):
    client.post("/calls", json=note())
    conn = db.connect(db_file)
    snap = build_snapshot(conn, rescore=False)
    conn.close()
    assert all(d["call_notes"] == [] for d in snap["donor_details"].values())
    assert SECRET_LINE not in str(snap) and "bring my family to the gala" not in str(snap)
