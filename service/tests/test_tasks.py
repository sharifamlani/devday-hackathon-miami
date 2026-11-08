"""B11/B12: tasks, undo, the generator on the sample upload, the calendar feed and artifacts (plan.md §21)."""

import json
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import db, tasks
from service.tests.test_gift_alerts import load_answer_key

AS_OF = date(2026, 11, 8)
ANSWER_KEY = Path(__file__).resolve().parents[2] / "data" / "sample_inputs" / "answer_key.json"
EXPECTED_ALERTS = {"D18", "D19", "D06", "D09", "D27"}   # test_gift_alerts: the 5 planted gift problems


def person(conn, name="Ana Ruiz") -> int:
    return db.insert_donor(conn, {"full_name": name, "donor_type": "individual"})


def event(conn, title, starts_at, **extra) -> int:
    cur = conn.execute("INSERT INTO events (title, starts_at, source_url, source, place) VALUES (?, ?, ?, ?, ?)",
                       (title, starts_at, extra.get("source_url", "https://miamifoundation.org/events"),
                        extra.get("source", "website"), extra.get("place")))
    conn.commit()
    return cur.lastrowid


def actions(conn):
    return [dict(r) for r in conn.execute("SELECT actor, action, target, undone_at FROM agent_actions ORDER BY id")]


# ---------- schema ----------

def test_schema_creates_tasks_and_agent_actions_and_leaves_donors_alone(conn):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"tasks", "agent_actions"} <= tables
    donor_cols = [r[1] for r in conn.execute("PRAGMA table_info(donors)")]
    db.create_schema(conn)   # idempotent
    assert [r[1] for r in conn.execute("PRAGMA table_info(donors)")] == donor_cols
    assert "tasks" in db.TABLES and "agent_actions" in db.TABLES


# ---------- CRUD + undo ----------

def test_create_returns_contract_shape_and_logs_an_undoable_action(conn):
    pid = person(conn)
    task, token = tasks.create_task(conn, kind="call", title="Call Ana", why="Monthly gift failed",
                                    person_id=pid, chips=["Lifetime $900"], due="2026-11-08", time="10:30",
                                    actor="agent")
    assert set(task) == {"id", "kind", "title", "why", "person_id", "chips", "due", "time", "done", "source"}
    assert task["chips"] == ["Lifetime $900"] and task["source"] == "agent" and task["done"] is False
    assert actions(conn) == [{"actor": "agent", "action": "create_task", "target": f"task:{task['id']}",
                              "undone_at": None}]
    assert tasks.undo(conn, token)["undone"] is True
    assert tasks.list_tasks(conn, as_of=AS_OF) == []


def test_update_complete_delete_each_undo_back(conn):
    task, _ = tasks.create_task(conn, kind="email", title="Thank Ana", due="2026-11-08")
    t1, u1 = tasks.update_task(conn, task["id"], title="Thank Ana for her gift", time="09:00")
    assert t1["title"] == "Thank Ana for her gift" and t1["time"] == "09:00"
    t2, u2 = tasks.complete_task(conn, task["id"])
    assert t2["done"] is True
    _, u3 = tasks.delete_task(conn, task["id"])
    assert tasks.list_tasks(conn, as_of=AS_OF) == []

    tasks.undo(conn, u3)
    assert tasks.get_task(conn, task["id"])["done"] is True
    tasks.undo(conn, u2)
    assert tasks.get_task(conn, task["id"])["done"] is False
    tasks.undo(conn, u1)
    assert tasks.get_task(conn, task["id"])["title"] == "Thank Ana" and tasks.get_task(conn, task["id"])["time"] is None
    assert [a["action"] for a in actions(conn)] == ["create_task", "update_task", "complete_task", "delete_task"]


def test_undo_refuses_out_of_order_and_twice(conn):
    task, _ = tasks.create_task(conn, kind="other", title="A")
    _, older = tasks.update_task(conn, task["id"], title="B")
    _, newer = tasks.update_task(conn, task["id"], title="C")
    with pytest.raises(tasks.UndoConflict):
        tasks.undo(conn, older)
    tasks.undo(conn, newer)
    tasks.undo(conn, older)
    assert tasks.get_task(conn, task["id"])["title"] == "A"
    with pytest.raises(tasks.UndoConflict):
        tasks.undo(conn, older)
    with pytest.raises(tasks.NotFound):
        tasks.undo(conn, "nope")


def test_undo_refuses_other_agent_writes_and_never_touches_a_task(conn):
    """agent_actions is shared (90's person/duplicate/merge/RSVP writes); tasks.undo must not read 'donor:5' as task 5."""
    task, _ = tasks.create_task(conn, kind="call", title="Keep me")
    conn.execute("INSERT INTO agent_actions (token, actor, action, target, before, after) "
                 "VALUES ('other', 'agent', 'update_person', ?, NULL, '{}')", (f"donor:{task['id']}",))
    conn.commit()
    with pytest.raises(tasks.TaskError):
        tasks.undo(conn, "other")
    assert tasks.get_task(conn, task["id"])["title"] == "Keep me"
    assert conn.execute("SELECT undone_at FROM agent_actions WHERE token = 'other'").fetchone()[0] is None


def test_validation(conn):
    with pytest.raises(tasks.TaskError):
        tasks.create_task(conn, kind="lunch", title="x")
    with pytest.raises(tasks.TaskError):
        tasks.create_task(conn, kind="call", title="  ")
    with pytest.raises(tasks.TaskError):
        tasks.create_task(conn, kind="call", title="x", due="next week")
    with pytest.raises(tasks.NotFound):
        tasks.create_task(conn, kind="call", title="x", person_id=999)
    with pytest.raises(tasks.NotFound):
        tasks.update_task(conn, 999, title="x")


def test_today_list_has_overdue_and_undated_open_tasks_and_filters(conn):
    pid = person(conn)
    tasks.create_task(conn, kind="call", title="Today call", due="2026-11-08", person_id=pid)
    tasks.create_task(conn, kind="email", title="Overdue", due="2026-11-01")
    done, _ = tasks.create_task(conn, kind="email", title="Old done", due="2026-11-01")
    tasks.complete_task(conn, done["id"])
    tasks.create_task(conn, kind="prep", title="Later", due="2026-11-20")
    tasks.create_task(conn, kind="other", title="Someday")
    today = [t["title"] for t in tasks.list_tasks(conn, due="today", as_of=AS_OF)]
    assert today == ["Overdue", "Today call", "Someday"]
    assert [t["title"] for t in tasks.list_tasks(conn, from_="2026-11-10", to="2026-11-30")] == ["Later"]
    assert [t["title"] for t in tasks.list_tasks(conn, person_id=pid)] == ["Today call"]


# ---------- calendar items (dated tasks) ----------

def test_calendar_items_add_move_delete_with_undo(conn):
    item, add_tok = tasks.add_calendar_item(conn, title="3 thank-you calls", date_="2026-11-10", actor="agent")
    ref = f"task:{item['id']}"
    moved, move_tok = tasks.move_calendar_item(conn, ref, date_="2026-11-12", time="14:00", actor="agent")
    assert (moved["due"], moved["time"]) == ("2026-11-12", "14:00")
    _, del_tok = tasks.delete_calendar_item(conn, ref, actor="agent")
    assert all(i["ref"] != ref for i in tasks.calendar(conn, as_of=AS_OF))
    tasks.undo(conn, del_tok)
    tasks.undo(conn, move_tok)
    assert [i for i in tasks.calendar(conn, as_of=AS_OF) if i["ref"] == ref][0]["date"] == "2026-11-10"
    tasks.undo(conn, add_tok)
    assert tasks.calendar(conn, as_of=AS_OF) == []
    assert {a["action"] for a in actions(conn)} == {"create_task", "move_calendar_item", "delete_calendar_item"}


def test_events_on_the_calendar_are_read_only(conn):
    eid = event(conn, "Give Miami Day", "2026-11-19")
    with pytest.raises(tasks.TaskError):
        tasks.move_calendar_item(conn, f"event:{eid}", date_="2026-11-20")


def test_calendar_merges_events_and_dated_tasks(conn):
    eid = event(conn, "Give Miami Day", "2026-11-19")
    event(conn, "Open House", "2026-11-12T18:00")
    event(conn, "Far away", "2027-03-01")
    tasks.add_calendar_item(conn, title="3 thank-you calls", date_="2026-11-12", time="10:00", kind="call",
                            actor="agent")
    tasks.create_task(conn, kind="other", title="Undated")   # not on the calendar
    items = tasks.calendar(conn, as_of=AS_OF)
    assert [(i["date"], i["time"], i["title"], i["kind"], i["source"]) for i in items] == [
        ("2026-11-12", "10:00", "3 thank-you calls", "task", "agent"),
        ("2026-11-12", "18:00", "Open House", "event", "website"),
        ("2026-11-19", None, "Give Miami Day", "event", "website"),
    ]
    assert items[-1]["ref"] == f"event:{eid}"
    assert tasks.calendar(conn, from_="2027-01-01", to="2027-12-31")[0]["title"] == "Far away"


# ---------- artifacts ----------

def test_artifacts_lists_drafts_campaigns_and_call_notes_when_present(conn):
    pid = person(conn)
    conn.execute("INSERT INTO outreach_drafts (donor_id, channel, subject, body, created_at) "
                 "VALUES (?, 'email', 'Thank you, Ana', 'Hi', '2026-11-05 10:00:00')", (pid,))
    cid = conn.execute("INSERT INTO campaigns (name, intent, channel, created_at) "
                       "VALUES ('GMD reminders', 're_engage', 'email', '2026-11-06 09:00:00')").lastrowid
    conn.execute("INSERT INTO campaign_messages (campaign_id, donor_id, channel, body) VALUES (?, ?, 'email', 'x')",
                 (cid, pid))
    conn.commit()
    items = tasks.artifacts(conn)   # no call notes saved yet
    assert [(i["kind"], i["title"]) for i in items] == [("draft", "Campaign: GMD reminders · 1 message"),
                                                        ("draft", "Thank you, Ana")]
    conn.execute("INSERT INTO call_notes (id, title, created_at, destinations) VALUES "
                 "('note-1', 'Call with Ana', '2026-11-07T15:00:00', ?)",
                 (json.dumps([{"kind": "donor", "id": pid, "label": "Ana Ruiz"}]),))
    conn.commit()
    first = tasks.artifacts(conn)[0]
    assert first == {"kind": "call_note", "title": "Call with Ana", "date": "2026-11-07T15:00:00",
                     "ref": "call_note:note-1", "destinations": ["Ana Ruiz"]}


# ---------- the generator ----------

def sample_upload(conn) -> dict[str, int]:
    """The sample upload as ingest leaves it: canonical people, gifts (declined charges flagged), and the
    answer key's duplicate groups still open as pending suggestions (one extra record per alias)."""
    key = json.loads(ANSWER_KEY.read_text(encoding="utf-8"))
    ids = load_answer_key(conn, key)
    for group in key["duplicate_groups"]:
        keep = ids[group["donor_id"]]
        for alias in group["members"][1:]:
            other = db.insert_donor(conn, {"full_name": alias.split(" (")[0], "donor_type": "individual"})
            conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence) "
                         "VALUES (?, ?, ?, 0.9)", (keep, other, json.dumps([f"similar name: {alias}"])))
    conn.commit()
    return ids


def test_generate_on_the_sample_upload_is_exact_and_idempotent(conn):
    key = json.loads(ANSWER_KEY.read_text(encoding="utf-8"))
    ids = sample_upload(conn)
    by_id = {v: k for k, v in ids.items()}

    result = tasks.generate(conn, AS_OF)
    made = result["tasks"]
    calls = [t for t in made if t["kind"] == "call"]
    reviews = [t for t in made if t["kind"] == "review"]
    assert {by_id[t["person_id"]] for t in calls} == EXPECTED_ALERTS and len(calls) == 5
    assert len(reviews) == len(key["duplicate_groups"]) == 6
    assert all(t["source"] == "generator" and t["due"] == AS_OF.isoformat() for t in calls + reviews)
    park = next(t for t in calls if by_id[t["person_id"]] == "D18")
    assert park["title"] == "Call Hye-jin Park" and "failed" in park["why"]
    assert park["chips"][0].startswith("Lifetime $") and park["chips"][1].startswith("Last gift $")
    nguyen = next(t for t in reviews if "Robert Nguyen" in t["title"])
    assert nguyen["chips"][0] == "3 records"   # two aliases, one group
    assert result["created"] == len(made)

    assert tasks.generate(conn, AS_OF) == {"created": 0, "tasks": [], "updated": 0}
    _, _ = tasks.delete_task(conn, calls[0]["id"])
    assert tasks.generate(conn, AS_OF)["created"] == 0   # a deleted generated task stays deleted
    assert sum(1 for a in actions(conn) if a["actor"] == "generator") == len(made)


def pair(conn, a, b, status="pending"):
    conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence, status) "
                 "VALUES (?, ?, ?, 0.9, ?)", (a, b, json.dumps([f"pair {a}~{b}"]), status))
    conn.commit()


def reviews(conn):
    return [dict(r) for r in conn.execute("SELECT id, title, chips, gen_key, members, deleted_at FROM tasks "
                                          "WHERE kind = 'review' ORDER BY id")]


def live_groups(conn):
    """{frozenset(members): chips[0]} for every live review task."""
    return {frozenset(json.loads(r["members"])): json.loads(r["chips"])[0]
            for r in reviews(conn) if not r["deleted_at"]}


def dismiss(conn, a, b):
    conn.execute("UPDATE duplicate_suggestions SET status = 'dismissed' WHERE donor_a_id = ? AND donor_b_id = ?", (a, b))
    conn.commit()


def test_a_growing_duplicate_group_keeps_one_review_task(conn):
    """c9: A~B makes a review; dedupe later adds B~C (and a lower id joins): still one task, rewritten."""
    b, c = person(conn, "Bob Nguyen"), person(conn, "R. Nguyen")
    a = person(conn, "Robert Nguyen")   # higher id than b: the group's smallest id changes when it joins
    pair(conn, b, c)
    first = tasks.generate(conn, AS_OF)
    assert first["created"] == 1 and first["tasks"][0]["chips"][0] == "2 records"

    pair(conn, a, b)
    grown = tasks.generate(conn, AS_OF)
    assert (grown["created"], grown["updated"]) == (0, 1)
    rows = reviews(conn)
    assert len(rows) == 1 and json.loads(rows[0]["chips"])[0] == "3 records"
    assert json.loads(rows[0]["members"]) == sorted([a, b, c])
    assert "Robert Nguyen" in rows[0]["title"]
    assert tasks.generate(conn, AS_OF) == {"created": 0, "tasks": [], "updated": 0}
    assert "update_duplicate_review" in [x["action"] for x in actions(conn)]


def test_two_duplicate_groups_that_join_keep_the_older_task(conn):
    a, b, c, d = (person(conn, n) for n in ("A One", "A Two", "B One", "B Two"))
    pair(conn, a, b)
    pair(conn, c, d)
    assert tasks.generate(conn, AS_OF)["created"] == 2
    pair(conn, b, c)
    result = tasks.generate(conn, AS_OF)
    assert (result["created"], result["updated"]) == (0, 1)
    live = [r for r in reviews(conn) if not r["deleted_at"]]
    assert len(live) == 1 and json.loads(live[0]["chips"])[0] == "4 records"


def test_a_joined_group_that_splits_gets_one_task_per_half(conn):
    """c9's repro: (1,2),(3,4) -> join via (2,3) -> dismiss (2,3). Used to claim one task twice and hit UNIQUE gen_key."""
    a, b, c, d = (person(conn, n) for n in ("S One", "S Two", "S Three", "S Four"))
    pair(conn, a, b)
    pair(conn, c, d)
    tasks.generate(conn, AS_OF)
    pair(conn, b, c)
    tasks.generate(conn, AS_OF)
    assert live_groups(conn) == {frozenset({a, b, c, d}): "4 records"}
    dismiss(conn, b, c)
    result = tasks.generate(conn, AS_OF)
    assert live_groups(conn) == {frozenset({a, b}): "2 records", frozenset({c, d}): "2 records"}
    assert (result["created"], result["updated"]) == (1, 1)
    assert tasks.generate(conn, AS_OF) == {"created": 0, "tasks": [], "updated": 0}


def test_join_split_rejoin_stays_one_task_per_group(conn):
    a, b, c, d = (person(conn, n) for n in ("R One", "R Two", "R Three", "R Four"))
    pair(conn, a, b)
    pair(conn, c, d)
    tasks.generate(conn, AS_OF)
    for step in range(2):
        pair(conn, b, c) if step == 0 else conn.execute(
            "UPDATE duplicate_suggestions SET status = 'pending' WHERE donor_a_id = ? AND donor_b_id = ?", (b, c))
        conn.commit()
        tasks.generate(conn, AS_OF)
        assert live_groups(conn) == {frozenset({a, b, c, d}): "4 records"}
        dismiss(conn, b, c)
        tasks.generate(conn, AS_OF)
        assert live_groups(conn) == {frozenset({a, b}): "2 records", frozenset({c, d}): "2 records"}
    keys = [r["gen_key"] for r in reviews(conn) if r["gen_key"]]
    assert len(keys) == len(set(keys))


def test_a_handled_duplicate_review_reopens_fresh_only_for_a_new_member(conn):
    """c9: done/deleted = handled. A new member gets a fresh review task; the handled one stays closed."""
    a, b, c = (person(conn, n) for n in ("X One", "X Two", "X Three"))
    pair(conn, a, b)
    made = tasks.generate(conn, AS_OF)["tasks"][0]
    tasks.delete_task(conn, made["id"])
    assert tasks.generate(conn, AS_OF)["created"] == 0          # same group: still handled
    pair(conn, b, c)
    fresh = tasks.generate(conn, AS_OF)
    assert fresh["created"] == 1 and fresh["tasks"][0]["id"] != made["id"]
    assert live_groups(conn) == {frozenset({a, b, c}): "3 records"}
    assert tasks.generate(conn, AS_OF) == {"created": 0, "tasks": [], "updated": 0}
    tasks.complete_task(conn, fresh["tasks"][0]["id"])
    assert tasks.generate(conn, AS_OF)["created"] == 0          # done counts as handled too

def test_generate_skips_resolved_duplicates(conn):
    a, b = person(conn, "Liz Fontaine"), person(conn, "Elizabeth Fontaine")
    conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence, status) "
                 "VALUES (?, ?, '[]', 0.9, 'dismissed')", (a, b))
    conn.commit()
    assert tasks.generate(conn, AS_OF)["created"] == 0


def test_generate_welcome_and_event_prep(conn):
    new = person(conn, "Nadia New")
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date) VALUES (?, 250, '2026-10-20')", (new,))
    old = person(conn, "Olga Old")
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date) VALUES (?, 250, '2026-08-01')", (old,))
    conn.commit()
    gmd = event(conn, "Give Miami Day", "2026-11-19", place="Online")
    event(conn, "Spring Gala", "2026-12-15")
    made = tasks.generate(conn, AS_OF)["tasks"]
    assert [(t["kind"], t["title"]) for t in made] == [("email", "Welcome Nadia New"),
                                                        ("prep", "Prep list: Give Miami Day")]
    prep = made[1]
    assert prep["due"] == "2026-11-12" and prep["chips"] == ["In 11 days", "Online"]
    cal = [(i["date"], i["title"]) for i in tasks.calendar(conn, as_of=AS_OF)]
    assert cal == [("2026-11-08", "Welcome Nadia New"), ("2026-11-12", "Prep list: Give Miami Day"),
                   ("2026-11-19", "Give Miami Day"), ("2026-12-15", "Spring Gala")]
    assert any(i["ref"] == f"event:{gmd}" for i in tasks.calendar(conn, as_of=AS_OF))


# ---------- HTTP ----------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "donors.db"))
    monkeypatch.setenv("SCORE_AS_OF", AS_OF.isoformat())
    from service.routes_tasks import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_routes_crud_undo_generate_calendar_artifacts(client):
    r = client.post("/tasks", json={"kind": "call", "title": "Call Ana", "due": "2026-11-08", "chips": ["VIP"]})
    assert r.status_code == 200
    body = r.json()
    task_id, token = body["id"], body["undo_token"]
    assert client.get("/tasks", params={"due": "today"}).json()[0]["title"] == "Call Ana"

    r = client.patch(f"/tasks/{task_id}", json={"done": True})
    assert r.json()["done"] is True
    assert client.post(f"/undo/{token}").status_code == 409            # a later write must be undone first
    assert client.post(f"/undo/{r.json()['undo_token']}").json()["undone"] is True

    r = client.delete(f"/tasks/{task_id}")
    assert r.json()["deleted"] is True
    assert client.get("/tasks").json() == []
    client.post(f"/undo/{r.json()['undo_token']}")
    assert client.get("/tasks").json()[0]["id"] == task_id

    assert client.post("/tasks", json={"kind": "lunch", "title": "x"}).status_code == 422
    assert client.post("/tasks", json={"kind": "call", "title": "x", "source": "generator"}).status_code == 422
    assert client.post("/tasks", json={"kind": "call", "title": "x", "source": "agent"}).json()["source"] == "agent"
    assert client.patch("/tasks/999", json={"title": "x"}).status_code == 404
    assert client.post("/undo/unknown").status_code == 404

    assert client.post("/tasks/generate").json() == {"created": 0, "tasks": [], "updated": 0}
    assert client.get("/calendar", params={"from": "2026-11-01", "to": "2026-11-30"}).json()[0]["ref"] == f"task:{task_id}"
    assert client.get("/artifacts").json() == []


# ---------- hooks ----------

def test_upload_hook_generates_tasks_once(tmp_path, monkeypatch):
    """ingest_events runs the generator after dedupe: alerts and new donors become tasks; dry runs add nothing."""
    from service import ingest_adapter as ia
    from service.tests.test_ingest_adapter import _events, _judgments

    monkeypatch.setenv("SCORE_AS_OF", AS_OF.isoformat())
    dry = db.connect(tmp_path / "dry.db")
    db.create_schema(dry)
    ia.ingest_events(_events(), "auto", dry, judgments=_judgments(), dry_run=True)
    assert dry.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0

    conn = db.connect(tmp_path / "t.db")
    db.create_schema(conn)
    ia.ingest_events(_events(), "auto", conn, judgments=_judgments())
    made = tasks.list_tasks(conn, as_of=AS_OF)
    assert {(t["kind"], t["title"]) for t in made} == {("call", "Call Ann Lee"), ("email", "Welcome Hye Park")}
    assert all(t["source"] == "generator" for t in made)
    assert tasks.generate(conn, AS_OF)["created"] == 0


def test_a_generator_failure_never_fails_an_upload(tmp_path, monkeypatch):
    from service import ingest_adapter as ia
    from service.tests.test_ingest_adapter import _events, _judgments

    def boom(*_, **__):
        raise RuntimeError("generator bug")

    monkeypatch.setattr(tasks, "generate", boom)
    conn = db.connect(tmp_path / "t.db")
    db.create_schema(conn)
    res = ia.ingest_events(_events(), "auto", conn, judgments=_judgments())
    assert res["people_added"] == 5
    assert conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0] == 5


# ---------- refresh hook + undo routing ----------

@pytest.fixture
def refresh_db(tmp_path, monkeypatch):
    """A db with a saved org and an event in 11 days; service.refresh.refresh stubbed (no network)."""
    import service.refresh

    monkeypatch.setenv("DONORS_DB", str(tmp_path / "donors.db"))
    monkeypatch.setenv("SCORE_AS_OF", AS_OF.isoformat())
    monkeypatch.setattr(service.refresh, "refresh", lambda conn, urls, **_: {"events_added": 1})
    conn = db.connect()
    db.create_schema(conn)
    conn.execute("INSERT INTO org_profile (name, website) VALUES ('The Miami Foundation', 'https://miamifoundation.org')")
    conn.commit()
    event(conn, "Give Miami Day", "2026-11-19")
    conn.close()


def test_refresh_hook_generates_prep_tasks(refresh_db):
    from service.main import run_refresh

    assert run_refresh() == {"state": "done", "detail": None, "changes": {"events_added": 1}}
    conn = db.connect()
    assert tasks.list_tasks(conn, due="today", as_of=AS_OF) == []    # due Nov 12, not today
    assert [t["title"] for t in tasks.list_tasks(conn, from_="2026-11-01", to="2026-11-30")] == ["Prep list: Give Miami Day"]
    conn.close()


def test_a_generator_failure_never_fails_a_refresh(refresh_db, monkeypatch):
    from service.main import run_refresh

    def boom(*_, **__):
        raise RuntimeError("generator bug")

    monkeypatch.setattr(tasks, "generate", boom)
    assert run_refresh()["state"] == "done"


def test_undo_routes_interest_tokens(client, monkeypatch):
    import sys
    import types

    fake = types.ModuleType("service.interests")
    fake.undo = lambda conn, token: {"undone": True, "op": "add_interest", "donor_id": 1}
    monkeypatch.setitem(sys.modules, "service.interests", fake)
    assert client.post("/undo/int_abc").json() == {"undone": True, "op": "add_interest", "donor_id": 1}

    def bad(conn, token):
        raise ValueError("Incorrect padding")

    fake.undo = bad
    assert client.post("/undo/int_abc").status_code == 422


def test_undo_interest_token_before_interests_lands(client, monkeypatch):
    import sys

    monkeypatch.setitem(sys.modules, "service.interests", None)   # import raises ImportError
    r = client.post("/undo/int_abc")
    assert r.status_code == 404 and "isn't available yet" in r.json()["detail"]


# ---------- one task store: the Donors tab (/crm/tasks) is a view of the tasks table ----------

CRM_KEYS = {"id", "contact_id", "type", "text", "due_date", "done_date", "sales_id", "created_at", "updated_at"}


@pytest.fixture
def crm_env(tmp_path, monkeypatch):
    """A db file with two donors; an app with both /crm and /tasks routers."""
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "donors.db"))
    monkeypatch.setenv("SCORE_AS_OF", AS_OF.isoformat())
    from service.routes_crm import router as crm_router
    from service.routes_tasks import router as tasks_router
    conn = db.connect()
    db.create_schema(conn)
    ana, ben = person(conn, "Ana Ruiz"), person(conn, "Ben Cole")
    conn.commit()   # the app's own connections write too
    app = FastAPI()
    app.include_router(crm_router)
    app.include_router(tasks_router)
    yield TestClient(app), conn, ana, ben
    conn.close()


def last_token(conn):
    return conn.execute("SELECT token FROM agent_actions ORDER BY id DESC LIMIT 1").fetchone()[0]


def test_a_donor_tab_task_is_in_the_shared_store_and_round_trips_exactly(crm_env):
    client, conn, ana, _ = crm_env
    sent = {"contact_id": ana, "type": "thank-you", "text": "Thank Ana for the gala table",
            "due_date": "2026-11-12T15:00:00.000Z", "sales_id": 0}
    made = client.post("/crm/tasks", json=sent).json()
    assert set(made) == CRM_KEYS
    assert {k: made[k] for k in sent} == sent and made["done_date"] is None
    assert client.get(f"/crm/tasks/{made['id']}").json() == made
    assert client.get("/crm/tasks", params={"contact_id": ana}).json() == {"data": [made], "total": 1}

    shared = client.get("/tasks", params={"person_id": ana}).json()
    assert [(t["id"], t["kind"], t["title"], t["due"], t["source"]) for t in shared] == [
        (made["id"], "other", "Thank Ana for the gala table", "2026-11-12", "staff")]
    cal = client.get("/calendar", params={"from": "2026-11-01", "to": "2026-11-30"}).json()
    assert [(i["date"], i["title"], i["ref"]) for i in cal] == [("2026-11-12", "Thank Ana for the gala table",
                                                                  f"task:{made['id']}")]
    assert conn.execute("SELECT COUNT(*) FROM crm_tasks").fetchone()[0] == 0     # the old store gets no writes


def test_tasks_made_elsewhere_show_in_the_donor_tab(crm_env):
    client, conn, ana, ben = crm_env
    client.post("/tasks", json={"kind": "call", "title": "Call Ana", "person_id": ana, "due": "2026-11-10"})
    tasks.create_task(conn, kind="prep", title="Bring the pledge card", person_id=ana, due="2026-11-11",
                      actor="agent")
    tasks.create_task(conn, kind="email", title="Email Ben", person_id=ben, due="2026-11-09")
    tasks.create_task(conn, kind="other", title="No donor")                # never in the donor tab
    rows = client.get("/crm/tasks", params={"contact_id": ana}).json()
    assert rows["total"] == 2
    assert [(r["type"], r["text"], r["due_date"], r["contact_id"]) for r in rows["data"]] == [
        ("call", "Call Ana", "2026-11-10", ana), ("none", "Bring the pledge card", "2026-11-11", ana)]
    everyone = client.get("/crm/tasks", params={"sort": "due_date", "order": "DESC", "per_page": 2}).json()
    assert everyone["total"] == 3 and [r["text"] for r in everyone["data"]] == ["Bring the pledge card", "Call Ana"]


def test_donor_tab_edits_done_and_delete_are_shared_and_undoable(crm_env):
    client, conn, ana, ben = crm_env
    made = client.post("/crm/tasks", json={"contact_id": ana, "type": "call", "text": "Call Ana",
                                           "due_date": "2026-11-10"}).json()
    tid = made["id"]
    done = client.patch(f"/crm/tasks/{tid}", json={"done_date": "2026-11-08T17:30:00.000Z"}).json()
    assert done["done_date"] == "2026-11-08T17:30:00.000Z" and done["text"] == "Call Ana"
    assert client.get("/tasks", params={"person_id": ana}).json()[0]["done"] is True
    assert client.post(f"/undo/{last_token(conn)}").json()["undone"] is True
    assert client.get(f"/crm/tasks/{tid}").json()["done_date"] is None

    moved = client.patch(f"/crm/tasks/{tid}", json={"contact_id": ben, "text": "Call Ben instead"}).json()
    assert (moved["contact_id"], moved["text"], moved["type"]) == (ben, "Call Ben instead", "call")
    assert client.get("/tasks", params={"person_id": ben}).json()[0]["title"] == "Call Ben instead"

    gone = client.delete(f"/crm/tasks/{tid}").json()
    assert gone["id"] == tid and client.get(f"/crm/tasks/{tid}").status_code == 404
    client.post(f"/undo/{last_token(conn)}")
    assert client.get(f"/crm/tasks/{tid}").json()["text"] == "Call Ben instead"
    assert client.patch("/crm/tasks/9999", json={"text": "x"}).status_code == 404
    assert client.patch(f"/crm/tasks/{tid}", json={"text": None}).status_code == 422   # the REQUIRED rule still holds


def test_an_edit_from_the_agent_rebuilds_the_donor_tab_view(crm_env):
    client, conn, ana, _ = crm_env
    made = client.post("/crm/tasks", json={"contact_id": ana, "type": "thank-you", "text": "Thank Ana",
                                           "due_date": "2026-11-12T15:00:00.000Z"}).json()
    tasks.update_task(conn, made["id"], actor="agent", title="Thank Ana in person", due="2026-11-14")
    view = client.get(f"/crm/tasks/{made['id']}").json()
    assert (view["text"], view["due_date"], view["type"]) == ("Thank Ana in person", "2026-11-14", "thank-you")
    tasks.update_task(conn, made["id"], actor="agent", kind="call")
    assert client.get(f"/crm/tasks/{made['id']}").json()["type"] == "call"


def insert_crm_task(conn, contact_id, text, done_date=None):
    conn.execute("INSERT INTO crm_tasks (contact_id, type, text, due_date, done_date, sales_id, created_at, updated_at) "
                 "VALUES (?, 'email', ?, '2026-11-09T10:00:00.000Z', ?, 7, '2026-11-01T09:00:00.000Z', "
                 "'2026-11-02T09:00:00.000Z')", (contact_id, text, done_date))
    conn.commit()


def test_old_crm_tasks_move_into_the_shared_store_once(crm_env):
    client, conn, ana, _ = crm_env
    insert_crm_task(conn, ana, "Email Ana the report")
    insert_crm_task(conn, ana, "Sent", done_date="2026-11-03T12:00:00.000Z")
    rows = client.get("/crm/tasks", params={"contact_id": ana, "sort": "id"}).json()["data"]
    assert [(r["type"], r["text"], r["due_date"], r["done_date"], r["sales_id"], r["created_at"]) for r in rows] == [
        ("email", "Email Ana the report", "2026-11-09T10:00:00.000Z", None, 7, "2026-11-01T09:00:00.000Z"),
        ("email", "Sent", "2026-11-09T10:00:00.000Z", "2026-11-03T12:00:00.000Z", 7, "2026-11-01T09:00:00.000Z")]
    assert tasks.migrate_crm_tasks(conn) == 0
    assert client.get("/crm/tasks").json()["total"] == 2
    assert [t["title"] for t in client.get("/tasks", params={"person_id": ana}).json()] == ["Email Ana the report", "Sent"]


def test_the_app_moves_old_crm_tasks_at_startup(crm_env):
    _, conn, ana, _ = crm_env
    insert_crm_task(conn, ana, "From before")
    from service.main import app
    with TestClient(app):
        pass
    assert [t["title"] for t in tasks.list_tasks(conn, person_id=ana)] == ["From before"]


def test_a_donor_merge_moves_shared_tasks_and_undo_moves_them_back(conn):
    from service import dedupe

    keep, drop = person(conn, "Elizabeth Fontaine"), person(conn, "Liz Fontaine")
    mine, _ = tasks.create_task(conn, kind="call", title="Call Liz", person_id=drop, due="2026-11-10")
    conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence) "
                 "VALUES (?, ?, '[]', 0.9)", (keep, drop))
    conn.commit()
    sid = conn.execute("SELECT id FROM duplicate_suggestions").fetchone()[0]
    res = dedupe.merge(conn, sid, keep_id=keep, approved_by="staff")
    assert tasks.get_task(conn, mine["id"])["person_id"] == keep
    dedupe.undo_merge(conn, res["merge_id"])
    assert tasks.get_task(conn, mine["id"])["person_id"] == drop
