"""Calendar v3: the calendar holds organization events only. Staff and the agent add, move and remove events
(no source link needed for them); events found on the website stay read-only; every write has Undo; deleting
needs the approval card. The events table migrates in place, idempotently, keeping every row."""

import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import chat_agent as ca, db, tasks
from service.tests.test_agent_tools import invoke

OLD_EVENTS = """
CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT, place TEXT,
 audience_hint TEXT, source_url TEXT NOT NULL CHECK (source_url <> ''), source TEXT, verification TEXT, quote TEXT,
 captured_at TEXT, status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'changed', 'past')),
 event_kind TEXT, rationale TEXT, first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')));
"""


@pytest.fixture
def client(db_file):
    from service.routes_data import router as data_router
    from service.routes_events import router as events_router
    from service.routes_tasks import router as tasks_router
    app = FastAPI()
    for r in (events_router, data_router, tasks_router):
        app.include_router(r)
    return TestClient(app)


def website_event(db_file, title="Give Miami Day", day="2026-11-19"):
    conn = db.connect(db_file)
    try:
        return db.save_events(conn, [{"title": title, "starts_at": day, "source_url": "https://givemiamiday.org",
                                      "source": "website"}])["ids"][0]
    finally:
        conn.close()


# ---------- migration ----------

def test_the_events_table_migrates_in_place_keeping_rows_and_twice_is_a_no_op(tmp_path: Path):
    path = tmp_path / "old.db"
    c = sqlite3.connect(path)
    c.executescript(OLD_EVENTS)
    c.execute("INSERT INTO events (id, title, starts_at, source_url, source) VALUES "
              "(7, 'Give Miami Day', '2026-11-19', 'https://givemiamiday.org', 'website')")
    c.commit()
    c.close()
    conn = db.connect(path)
    db.create_schema(conn, force=True)
    assert [tuple(r) for r in conn.execute("SELECT id, title, source_url FROM events")] == \
        [(7, "Give Miami Day", "https://givemiamiday.org")]
    first = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'events'").fetchone()[0]
    assert db.migrate_events_v3(conn) is False                       # already v3
    db.create_schema(conn, force=True)
    assert conn.execute("SELECT sql FROM sqlite_master WHERE name = 'events'").fetchone()[0] == first
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
    conn.execute("INSERT INTO events (title, starts_at, source) VALUES ('Board meeting', '2026-11-10', 'staff')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO events (title, starts_at, source) VALUES ('No link', '2026-11-10', 'website')")
    conn.close()


# ---------- routes ----------

def test_staff_add_an_event_and_the_calendar_shows_events_only(client, db_file):
    """S1: POST /events (source staff, no link) -> GET /calendar?kind=event; tasks stay off the calendar."""
    conn = db.connect(db_file)
    tasks.create_task(conn, kind="call", title="Call Ana", due="2026-11-10")
    conn.close()
    made = client.post("/events", json={"title": "Board meeting", "date": "2026-11-10", "time": "15:00",
                                        "place": "Foundation office", "event_kind": "other"}).json()
    assert made["source"] == "staff" and made["source_url"] is None and made["starts_at"] == "2026-11-10T15:00"
    assert made["undo_token"]
    cal = client.get("/calendar", params={"from": "2026-11-01", "to": "2026-11-30", "kind": "event"}).json()
    assert [(i["kind"], i["title"], i["time"], i["source"], i["place"]) for i in cal] == \
        [("event", "Board meeting", "15:00", "staff", "Foundation office")]
    both = client.get("/calendar", params={"from": "2026-11-01", "to": "2026-11-30"}).json()
    assert {i["kind"] for i in both} == {"event", "task"}                 # the old default is unchanged
    assert any(e["title"] == "Board meeting" and e["notes"] is None for e in client.get("/events").json())


def test_a_found_event_needs_a_link_and_bad_input_is_422(client):
    """S-neg: a website/news/search event without source_url is refused."""
    assert client.post("/events", json={"title": "Gala", "date": "2026-12-05", "source": "website"}).status_code == 422
    ok = client.post("/events", json={"title": "Gala", "date": "2026-12-05", "source": "website",
                                      "source_url": "https://miamifoundation.org/gala"})
    assert ok.status_code == 200 and ok.json()["source"] == "website"
    assert client.post("/events", json={"title": "No date"}).status_code == 422
    assert client.post("/events", json={"title": "Bad", "date": "next week"}).status_code == 422
    assert client.post("/events", json={"title": "Bad", "date": "2026-12-05", "time": "3pm"}).status_code == 422
    assert client.post("/events", json={"title": "Bad", "date": "2026-12-05", "event_kind": "party"}).status_code == 422


def test_staff_events_edit_delete_and_undo_while_website_events_are_read_only(client, db_file):
    found = website_event(db_file)
    assert client.patch(f"/events/{found}", json={"title": "Renamed"}).status_code == 403
    assert client.delete(f"/events/{found}").status_code == 403
    made = client.post("/events", json={"title": "Board meeting", "date": "2026-11-10"}).json()
    moved = client.patch(f"/events/{made['id']}", json={"date": "2026-11-12", "time": "16:30"}).json()
    assert moved["starts_at"] == "2026-11-12T16:30"
    assert client.post(f"/undo/{moved['undo_token']}").json()["undone"] is True
    gone = client.delete(f"/events/{made['id']}").json()
    assert gone["deleted"] is True and all(e["id"] != made["id"] for e in client.get("/events").json())
    client.post(f"/undo/{gone['undo_token']}")
    back = next(e for e in client.get("/events").json() if e["id"] == made["id"])
    assert back["starts_at"] == "2026-11-10"                              # the move was undone before
    assert client.patch("/events/99999", json={"title": "x"}).status_code == 404


def test_undoing_a_delete_brings_back_the_audience(client, db_file):
    made = client.post("/events", json={"title": "Donor thank-you breakfast", "date": "2026-11-14"}).json()
    conn = db.connect(db_file)
    pid = conn.execute("SELECT id FROM donors ORDER BY id LIMIT 1").fetchone()[0]
    conn.execute("INSERT INTO event_audience (event_id, person_id, reason) VALUES (?, ?, 'gave last year')",
                 (made["id"], pid))
    conn.commit()
    conn.close()
    token = client.delete(f"/events/{made['id']}").json()["undo_token"]
    client.post(f"/undo/{token}")
    conn = db.connect(db_file)
    assert conn.execute("SELECT reason FROM event_audience WHERE event_id = ?", (made["id"],)).fetchone()[0] == \
        "gave last year"
    conn.close()


# ---------- agent tools ----------

def one(db_file, sql, *args):
    conn = db.connect(db_file)
    try:
        return conn.execute(sql, args).fetchone()
    finally:
        conn.close()


def test_the_agent_adds_an_event_with_undo(db_file):
    """S2: "add a board meeting Tue Nov 10 at 3 PM" -> an event row with source agent; Undo removes it."""
    out = invoke("add_event", title="Board meeting", date="2026-11-10", time="15:00")
    row = one(db_file, "SELECT title, starts_at, source, source_url FROM events WHERE id = ?", out["id"])
    assert tuple(row) == ("Board meeting", "2026-11-10T15:00", "agent", None)
    assert invoke("undo", undo_token=out["undo_token"])["undone"] is True
    assert one(db_file, "SELECT id FROM events WHERE id = ?", out["id"]) is None


def test_add_calendar_item_now_makes_an_event_not_a_task(db_file):
    before_tasks = one(db_file, "SELECT COUNT(*) FROM tasks")[0]
    out = invoke("add_calendar_item", title="Open house", date="2026-11-21", time="18:00")
    assert one(db_file, "SELECT source FROM events WHERE id = ?", out["id"])[0] == "agent"
    assert one(db_file, "SELECT COUNT(*) FROM tasks")[0] == before_tasks


def test_the_agent_moves_its_event_but_never_a_website_event(db_file):
    out = invoke("add_event", title="Board meeting", date="2026-11-10")
    moved = invoke("move_event", event_id=out["id"], date="2026-11-12", time="10:00")
    assert moved["starts_at"] == "2026-11-12T10:00" and moved["undo_token"]
    found = website_event(db_file)
    assert "website" in invoke("move_event", event_id=found, date="2026-11-20")["error"]


def test_deleting_an_event_waits_for_approval_and_the_card_names_it(db_file):
    """S3: delete_event is approval-gated (nothing is deleted before the click); the card says what."""
    assert "delete_event" in ca.APPROVAL_TOOLS
    out = invoke("add_event", title="Board meeting", date="2026-11-10")
    assert ca.approval_summary("delete_event", {"event_id": out["id"]}) == "Delete event: Board meeting (2026-11-10)"
    assert one(db_file, "SELECT id FROM events WHERE id = ?", out["id"]) is not None   # nothing deleted yet
    done = invoke("delete_event", event_id=out["id"])                                   # what Approve runs
    assert one(db_file, "SELECT id FROM events WHERE id = ?", out["id"]) is None
    invoke("undo", undo_token=done["undo_token"])
    assert one(db_file, "SELECT title FROM events WHERE id = ?", out["id"])[0] == "Board meeting"


def test_found_events_still_save_through_the_refresh(db_file):
    """Onboarding/refresh events are unchanged: save_events keeps its link rule and its matching."""
    first = website_event(db_file, "Coastal cleanup", "2026-11-21")
    assert website_event(db_file, "Coastal cleanup", "2026-11-21") == first           # same event, same row
    conn = db.connect(db_file)
    dropped = db.save_events(conn, [{"title": "No link", "starts_at": "2026-11-22", "source": "website"}])
    conn.close()
    assert dropped["ids"] == [None]
