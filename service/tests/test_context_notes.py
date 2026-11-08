"""Context notes (research_facts) get undo and a tombstone: an undone or deleted call note stays gone
through a cold re-apply. No network (the after-call agent's rules path)."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import after_call_agent as aca, agent_writes, context_notes, tasks
from service.tests.test_after_call import TODAY, counts, env  # noqa: F401  (env is a fixture)


def notes(conn, person_id):
    return [dict(r) for r in conn.execute("SELECT id, fact, source_url FROM research_facts WHERE donor_id = ? ORDER BY id",
                                          (person_id,))]


def apply_notes(conn):
    proposal = aca.propose(conn, "note-1", TODAY)
    ids = [a["id"] for a in proposal["actions"] if a["type"] == "add_context_note"]
    assert ids, "the demo call proposes at least one context note"
    return aca.apply(conn, "note-1", ids)


def cold_restart():
    aca._PROPOSALS.clear()
    aca.PROPOSALS_FILE.unlink(missing_ok=True)


def test_an_applied_call_note_is_logged_with_an_undo_token(env):
    conn, rosa, _ = env
    out = apply_notes(conn)
    ref = out["applied"][0]["ref"]
    assert set(ref) == {"research_fact_id", "undo_token"}
    note = notes(conn, rosa)[0]
    assert note["source_url"].startswith("call-note:note-1#")
    logged = conn.execute("SELECT actor, action, target FROM agent_actions WHERE token = ?", (ref["undo_token"],)).fetchone()
    assert tuple(logged) == ("call", "add_context_note", f"note:{note['id']}")


def test_apply_undo_note_wipe_proposals_reapply_writes_nothing(env):
    """The lead's case: apply -> undo the note -> lose the proposal store -> re-apply: 0 writes."""
    conn, rosa, _ = env
    out = apply_notes(conn)
    for a in out["applied"]:
        assert agent_writes.undo(conn, a["ref"]["undo_token"])["undone"] is True
    assert notes(conn, rosa) == []
    before = counts(conn)
    cold_restart()
    again = apply_notes(conn)
    assert again["applied"] == [] and counts(conn) == before
    assert all(s.get("ref", {}).get("undone_by_staff") for s in again["skipped"])


def test_a_note_staff_deleted_by_hand_stays_deleted_and_undo_restores_it(env):
    conn, rosa, _ = env
    apply_notes(conn)
    note = notes(conn, rosa)[0]
    removed, token = context_notes.delete_context_note(conn, note["id"])
    assert removed["fact"] == note["fact"]
    assert note["id"] not in [n["id"] for n in notes(conn, rosa)]
    cold_restart()
    assert apply_notes(conn)["applied"] == []                                  # the tombstone holds
    assert note["id"] not in [n["id"] for n in notes(conn, rosa)]
    agent_writes.undo(conn, token)                                             # undo the delete
    assert note in notes(conn, rosa)                                           # same id, text and marker


def test_undo_order_and_conflicts(env):
    conn, rosa, _ = env
    row, add_tok = context_notes.add_context_note(conn, rosa, "Prefers texts", "staff note")
    _, del_tok = context_notes.delete_context_note(conn, row["id"])
    with pytest.raises(tasks.UndoConflict):
        agent_writes.undo(conn, add_tok)                                       # the delete must be undone first
    agent_writes.undo(conn, del_tok)
    agent_writes.undo(conn, add_tok)
    assert notes(conn, rosa) == []
    with pytest.raises(tasks.UndoConflict):
        agent_writes.undo(conn, add_tok)


def test_logged_note_matches_the_exact_person_and_marker(env):
    conn, rosa, _ = env
    other = conn.execute("INSERT INTO donors (full_name, donor_type) VALUES ('Other Person', 'individual')").lastrowid
    conn.commit()
    row, tok = context_notes.add_context_note(conn, rosa, "Said yes", "call-note:n#line6", actor="call")
    agent_writes.undo(conn, tok)
    assert context_notes.logged_note(conn, rosa, "call-note:n#line6") == row["id"]
    assert context_notes.logged_note(conn, rosa, "call-note:n#line61") is None   # no prefix match
    assert context_notes.logged_note(conn, other, "call-note:n#line6") is None   # another person


def test_validation(env):
    conn, rosa, _ = env
    with pytest.raises(context_notes.NoteError):
        context_notes.add_context_note(conn, rosa, "  ", "staff note")
    with pytest.raises(context_notes.NoteError):
        context_notes.add_context_note(conn, 9999, "x", "staff note")
    with pytest.raises(LookupError):
        context_notes.delete_context_note(conn, 9999)


def test_routes_add_delete_and_undo(env):
    conn, rosa, _ = env
    from service.routes_tasks import router
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    r = client.post(f"/people/{rosa}/context-notes", json={"fact": "Board chair at her temple"})
    assert r.status_code == 200
    body = r.json()
    assert body["note"]["source_url"] == "staff note"
    assert client.post(f"/undo/{body['undo_token']}").json()["undone"] is True
    assert notes(conn, rosa) == []

    made = client.post(f"/people/{rosa}/context-notes", json={"fact": "Loves the beach cleanups",
                                                              "source": "https://example.org/a"}).json()["note"]
    assert client.delete(f"/people/{rosa + 1}/context-notes/{made['id']}").status_code == 404   # not this person's
    gone = client.delete(f"/people/{rosa}/context-notes/{made['id']}").json()
    assert gone["deleted"] is True and notes(conn, rosa) == []
    client.post(f"/undo/{gone['undo_token']}")
    assert [n["fact"] for n in notes(conn, rosa)] == ["Loves the beach cleanups"]
    assert client.post("/people/9999/context-notes", json={"fact": "x"}).status_code == 404
    assert client.post(f"/people/{rosa}/context-notes", json={"fact": ""}).status_code == 422
    assert json.loads(conn.execute("SELECT before FROM agent_actions WHERE action = 'delete_context_note'")
                      .fetchone()[0])["fact"] == "Loves the beach cleanups"            # the tombstone keeps the row
