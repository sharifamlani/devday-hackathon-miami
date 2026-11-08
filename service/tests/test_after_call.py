"""B6 after-call agent: propose writes nothing; Apply writes each action once; tasks undo; events are
never invented; pledges never count as money raised. No network (rules path, or a stood-in model)."""

import json
from datetime import date

import pytest

from service import after_call_agent as aca, db

TODAY = date(2026, 11, 8)
# Christian's demo script (web/.../voice/transcriptSource.ts), with Rosa Delgado as the supporter
SCRIPT = [
    ("you", "Staff", "Hi Rosa, I'm calling from the foundation. Do you have a minute?"),
    ("them", "Rosa", "Of course. Is everything okay?"),
    ("you", "Staff", "Everything's fine. Your monthly gift didn't go through in October, so I wanted to check in."),
    ("them", "Rosa", "Oh, I got a new card last month. I forgot to update it."),
    ("them", "Rosa", "I still want to keep giving $50 a month."),
    ("you", "Staff", "No problem. I can text you a secure link to update your card."),
    ("them", "Rosa", "Perfect. And put me down for the beach cleanup on the 21st."),
    ("you", "Staff", "Will do. Thank you for sticking with us since 2021."),
    ("them", "Rosa", "Thank you for calling. Talk soon!"),
]
EFFECT_TABLES = ("tasks", "pledges", "research_facts")


@pytest.fixture
def env(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    monkeypatch.setenv("SCORE_AS_OF", TODAY.isoformat())
    monkeypatch.setenv("AFTER_CALL_DRAFTER", "rules")
    monkeypatch.setattr(aca, "PROPOSALS_FILE", tmp_path / "proposals.json")
    aca._PROPOSALS.clear()
    conn = db.connect(path)
    db.create_schema(conn)
    rosa = conn.execute("INSERT INTO donors (full_name, first_name, last_name, donor_type) "
                        "VALUES ('Rosa Delgado', 'Rosa', 'Delgado', 'individual')").lastrowid
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel) VALUES (?, 50, '2026-09-01', 'online')", (rosa,))
    beach = conn.execute("INSERT INTO events (title, starts_at, place, source_url) VALUES "
                         "('Beach Cleanup (SAMPLE)', '2026-11-21', 'Crandon Park', 'https://example.org/beach')").lastrowid
    conn.execute("INSERT INTO events (title, starts_at, source_url) VALUES ('Give Miami Day', '2026-11-19', 'https://www.givemiamiday.org/')")
    conn.execute("INSERT INTO call_notes (id, title, created_at, transcript, destinations) VALUES (?, ?, ?, ?, ?)",
                 ("note-1", "Call with Rosa", "2026-11-08T10:00:00",
                  json.dumps([{"speaker": s, "name": n, "text": t, "at": i} for i, (s, n, t) in enumerate(SCRIPT)]),
                  json.dumps([{"kind": "donor", "id": rosa, "label": "Rosa Delgado"}])))
    conn.commit()
    yield conn, rosa, beach
    conn.close()


def counts(conn):
    c = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in EFFECT_TABLES}
    c["rsvp"] = conn.execute("SELECT COUNT(*) FROM event_audience WHERE rsvp IS NOT NULL").fetchone()[0]
    return c


def test_demo_call_proposes_the_expected_actions_and_writes_nothing(env):
    conn, rosa, beach = env
    before = counts(conn)
    got = aca.propose(conn, "note-1", TODAY)
    types = [a["type"] for a in got["actions"]]
    assert types.count("create_task") == 1 and "record_pledge" in types and "rsvp_event" in types
    assert types.count("add_context_note") == 2
    pledge = next(a for a in got["actions"] if a["type"] == "record_pledge")["payload"]
    assert (pledge["amount"], pledge["frequency"], pledge["person_id"]) == (50.0, "monthly", rosa)
    rsvp = next(a for a in got["actions"] if a["type"] == "rsvp_event")["payload"]
    assert rsvp == {"event_id": beach, "person_id": rosa, "rsvp": "yes"}       # "the 21st" -> the beach cleanup, not GMD
    assert counts(conn) == before == {"tasks": 0, "pledges": 0, "research_facts": 0, "rsvp": 0}


def test_apply_writes_every_action_once_and_tasks_undo(env):
    from service import tasks
    conn, rosa, beach = env
    got = aca.propose(conn, "note-1", TODAY)
    ids = [a["id"] for a in got["actions"]]
    out = aca.apply(conn, "note-1", ids)
    assert len(out["applied"]) == len(ids) and out["skipped"] == []
    assert counts(conn) == {"tasks": 1, "pledges": 1, "research_facts": 2, "rsvp": 1}
    assert conn.execute("SELECT rsvp FROM event_audience WHERE event_id = ? AND person_id = ?", (beach, rosa)).fetchone()[0] == "yes"
    task = conn.execute("SELECT source, person_id, due FROM tasks").fetchone()
    assert tuple(task) == ("call", rosa, TODAY.isoformat())
    again = aca.apply(conn, "note-1", ids)                                        # second click: nothing new
    assert again["applied"] == [] and all(s["why"] == "already applied" for s in again["skipped"])
    token = next(a["ref"]["undo_token"] for a in out["applied"] if a["type"] == "create_task")
    tasks.undo(conn, token)
    assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0


def test_pledges_never_count_as_money_raised(env):
    conn, rosa, _ = env
    raised = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM gifts").fetchone()[0]
    got = aca.propose(conn, "note-1", TODAY)
    aca.apply(conn, "note-1", [a["id"] for a in got["actions"] if a["type"] == "record_pledge"])
    assert conn.execute("SELECT COALESCE(SUM(amount), 0) FROM gifts").fetchone()[0] == raised
    assert [(p["amount"], p["frequency"], p["status"]) for p in aca.list_pledges(conn, rosa)] == [(50.0, "monthly", "pledged")]


def test_an_event_that_isnt_on_the_calendar_becomes_a_review_task(env):
    conn, _, _ = env
    conn.execute("DELETE FROM events WHERE title LIKE 'Beach%'")
    conn.commit()
    got = aca.propose(conn, "note-1", TODAY)
    assert "rsvp_event" not in [a["type"] for a in got["actions"]]
    review = [a for a in got["actions"] if a["type"] == "create_task" and a["payload"]["kind"] == "review"]
    assert review and "beach cleanup on the 21st" in review[0]["payload"]["title"]


def test_model_actions_are_checked_against_the_transcript_and_calendar(env, monkeypatch):
    conn, rosa, beach = env
    P = aca.ProposedAction
    fake = aca.CallProposal(steps=["Do things."], actions=[
        P(type="record_pledge", label="Pledge $500", evidence="I still want to keep giving $50 a month.", amount=500, frequency="monthly"),
        P(type="create_task", label="Invented", evidence="Rosa asked for a tote bag.", task_kind="other", task_title="Mail a tote"),
        P(type="rsvp_event", label="RSVP GMD", evidence="put me down for the beach cleanup on the 21st", event_id=999, rsvp="yes"),
        P(type="tag_interest", label="Tag", evidence="beach cleanup", tag="environment"),
    ])
    monkeypatch.setattr(aca, "model_proposal", lambda *a, **k: fake)
    got = aca.propose(conn, "note-1", TODAY, use_model=True)
    rsvps = [a for a in got["actions"] if a["type"] == "rsvp_event"]
    assert len(rsvps) == 1 and rsvps[0]["payload"]["event_id"] == beach          # the made-up id re-resolved by its date
    assert not any(a["type"] == "record_pledge" for a in got["actions"])         # $500 was never said
    assert not any("tote" in a["label"].lower() for a in got["actions"])
    why = {d["label"]: d["why"] for d in got["dropped"]}
    assert "amount isn't said" in why["Pledge $500"] and "isn't in the transcript" in why["Invented"]
    assert "interest tags" in why["Tag"]


def test_routes(env):
    from fastapi.testclient import TestClient
    from service.main import app
    conn, rosa, _ = env
    c = TestClient(app)
    assert c.post("/call-notes/nope/actions").status_code == 404
    prop = c.post("/call-notes/note-1/actions").json()
    assert {"steps", "actions"} <= set(prop) and prop["actions"]
    assert c.post("/call-notes/note-1/apply", json={"action_ids": [prop["actions"][0]["id"]]}).json()["applied"]
    pledge_id = next(a["id"] for a in prop["actions"] if a["type"] == "record_pledge")
    c.post("/call-notes/note-1/apply", json={"action_ids": [pledge_id]})
    assert c.get(f"/people/{rosa}/pledges").json()[0]["amount"] == 50.0


def test_propose_apply_propose_apply_writes_nothing_the_second_time(env, monkeypatch):
    conn, _, _ = env
    first = aca.propose(conn, "note-1", TODAY)
    aca.apply(conn, "note-1", [a["id"] for a in first["actions"]])
    after_first = counts(conn)
    # the model rewords everything on the second pass: same actions, different labels and note text
    P = aca.ProposedAction
    reworded = aca.CallProposal(steps=["Again."], actions=[
        P(type="create_task", label="Send card link", evidence="I got a new card last month", task_kind="email",
          task_title="Email Rosa the card form", task_due=TODAY.isoformat()),
        P(type="record_pledge", label="Monthly pledge", evidence="keep giving $50 a month", amount=50, frequency="monthly"),
        P(type="add_context_note", label="Card", evidence="I got a new card last month", note="Rosa's card was replaced."),
    ])
    monkeypatch.setattr(aca, "model_proposal", lambda *a, **k: reworded)
    second = aca.propose(conn, "note-1", TODAY, use_model=True)
    assert all(a["applied"] for a in second["actions"])                         # every one recognized as done
    out = aca.apply(conn, "note-1", [a["id"] for a in second["actions"]])
    assert out["applied"] == [] and counts(conn) == after_first


def test_a_lost_proposal_store_still_never_doubles_a_pledge_or_note(env):
    conn, _, _ = env
    first = aca.propose(conn, "note-1", TODAY)
    aca.apply(conn, "note-1", [a["id"] for a in first["actions"] if a["type"] in ("record_pledge", "add_context_note")])
    before = counts(conn)
    aca._PROPOSALS.clear(); aca.PROPOSALS_FILE.unlink()                          # a restart that lost the store
    second = aca.propose(conn, "note-1", TODAY)
    aca.apply(conn, "note-1", [a["id"] for a in second["actions"] if a["type"] in ("record_pledge", "add_context_note")])
    assert counts(conn) == before


def test_spoken_facts_the_model_skips_are_added_from_the_rules(env, monkeypatch):
    conn, _, _ = env
    P = aca.ProposedAction
    skimpy = aca.CallProposal(steps=["Text the link."], actions=[
        P(type="create_task", label="Text link", evidence="I can text you a secure link to update your card.",
          task_kind="other", task_title="Text Rosa the card link", task_due=TODAY.isoformat()),
        P(type="add_context_note", label="New card", evidence="I got a new card last month.", note="Rosa has a new card."),
    ])
    monkeypatch.setattr(aca, "model_proposal", lambda *a, **k: skimpy)
    got = aca.propose(conn, "note-1", TODAY, use_model=True)
    types = [a["type"] for a in got["actions"]]
    assert types.count("add_context_note") == 2                                  # "since 2021" restored, "new card" not doubled
    assert "record_pledge" in types and "rsvp_event" in types
    assert types.count("create_task") == 1                                       # tasks stay the model's call


def test_a_cold_store_after_a_restart_writes_nothing_even_when_the_model_rewords(env, monkeypatch):
    conn, _, _ = env
    P = aca.ProposedAction

    def model(wording):
        return aca.CallProposal(steps=["x"], actions=[
            P(type="create_task", label="Link", evidence="I can text you a secure link to update your card.",
              task_kind="other", task_title=f"{wording} Rosa the card link", task_due=TODAY.isoformat()),
            P(type="add_context_note", label="Card", evidence="I got a new card last month.", note=f"{wording}: Rosa has a new card."),
            P(type="add_context_note", label="Since", evidence="Thank you for sticking with us since 2021.", note=f"{wording}: giving since 2021."),
        ])
    monkeypatch.setattr(aca, "model_proposal", lambda *a, **k: model("Text"))
    first = aca.propose(conn, "note-1", TODAY, use_model=True)
    aca.apply(conn, "note-1", [a["id"] for a in first["actions"]])
    before = counts(conn)
    aca._PROPOSALS.clear(); aca.PROPOSALS_FILE.unlink()                          # server stopped, temp file deleted
    monkeypatch.setattr(aca, "model_proposal", lambda *a, **k: model("Send"))      # restarted model words it all differently
    second = aca.propose(conn, "note-1", TODAY, use_model=True)
    out = aca.apply(conn, "note-1", [a["id"] for a in second["actions"]])
    assert out["applied"] == [] and counts(conn) == before
    assert all(s["why"] == "already applied" for s in out["skipped"])


def test_staff_undo_sticks_through_a_cold_store_reapply(env):
    from service import agent_writes
    conn, rosa, beach = env
    first = aca.propose(conn, "note-1", TODAY)
    out = aca.apply(conn, "note-1", [a["id"] for a in first["actions"]])
    for a in out["applied"]:                                                     # staff undo the task and the RSVP
        if a["type"] in ("create_task", "rsvp_event"):
            agent_writes.undo(conn, a["ref"]["undo_token"])
    assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0
    assert conn.execute("SELECT rsvp FROM event_audience WHERE event_id = ? AND person_id = ?", (beach, rosa)).fetchone()[0] is None
    before = counts(conn)
    aca._PROPOSALS.clear(); aca.PROPOSALS_FILE.unlink()                          # restart, store lost
    second = aca.propose(conn, "note-1", TODAY)
    again = aca.apply(conn, "note-1", [a["id"] for a in second["actions"]])
    assert again["applied"] == [] and counts(conn) == before                     # the undone task and RSVP stay undone
    assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0


def test_rsvp_writes_through_agent_writes_with_an_undo_token(env):
    conn, rosa, beach = env
    got = aca.propose(conn, "note-1", TODAY)
    out = aca.apply(conn, "note-1", [a["id"] for a in got["actions"] if a["type"] == "rsvp_event"])
    ref = out["applied"][0]["ref"]
    assert ref["rsvp"] == "yes" and ref["undo_token"]
    assert conn.execute("SELECT actor, target FROM agent_actions WHERE token = ?", (ref["undo_token"],)).fetchone()[:] == ("call", f"rsvp:{beach}:{rosa}")
