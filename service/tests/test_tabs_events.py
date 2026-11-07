"""5E: three tabs (Givers / Neighbors / Community), the event calendar and community stats."""

import json
import sqlite3
from datetime import date

import pytest

from service import db, score
from service.export_snapshot import build_snapshot
from service.routes_data import list_events
from service.tests.conftest import AS_OF
from service.tests.test_routes_data import client

EVENTS = [
    {"title": "Give Miami Day", "starts_at": "2026-11-19", "place": "Online", "audience_hint": "giving",
     "source_url": "https://www.givemiamiday.org/", "source": "website", "verification": "search-cited"},
    {"title": "Give Miami 5K", "starts_at": "2026-11-15T07:00", "place": "Maurice A. Ferré Park",
     "audience_hint": "community", "source_url": "https://miamifoundation.org/5k", "source": "website"},
    {"title": "Early giving opens", "starts_at": "2026-11-14", "audience_hint": "giving",
     "source_url": "https://www.givemiamiday.org/early", "source": "website"},
    {"title": "Summer arts night", "starts_at": "2026-07-01", "source_url": "https://miamifoundation.org/arts"},
    {"title": "No source", "starts_at": "2026-12-01", "source_url": ""},
]


def person_id(conn, name):
    return conn.execute("SELECT id FROM donors WHERE full_name = ?", (name,)).fetchone()[0]


# ---- schema -------------------------------------------------------------------------------------

def test_existing_rows_default_to_giver_on_an_old_db(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE donors (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, first_name TEXT, last_name TEXT,
            org_name TEXT, donor_type TEXT, email TEXT, emails_all TEXT, phone TEXT, city TEXT, state TEXT,
            fund_type TEXT, notes TEXT, source_row TEXT);
        INSERT INTO donors (full_name) VALUES ('Ingested Before 5E');
    """)
    old.commit()
    old.close()
    conn = db.connect(path)
    db.create_schema(conn)
    row = conn.execute("SELECT contact_type, interests, has_dog, demographics, tab_review FROM donors").fetchone()
    assert tuple(row) == ("giver", None, None, None, None)
    assert {"events", "event_drafts"} <= {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    conn.close()


def test_contact_type_and_has_dog_are_checked(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO donors (full_name, contact_type) VALUES ('X', 'volunteer')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO donors (full_name, has_dog) VALUES ('Y', 2)")


def test_only_givers_are_scored_and_listed_as_donors(db_file):
    c = client()
    donors = c.get("/donors").json()
    assert len(donors) == 12 and {d["contact_type"] for d in donors} == {"giver"}
    conn = db.connect(db_file)
    unscored = conn.execute("SELECT COUNT(*) FROM donors d LEFT JOIN donor_scores s ON s.donor_id = d.id "
                            "WHERE d.contact_type != 'giver' AND s.donor_id IS NULL").fetchone()[0]
    assert unscored == 6
    conn.close()


# ---- people -------------------------------------------------------------------------------------

def test_people_by_tab_with_counts_and_filters(db_file):
    c = client()
    body = c.get("/people", params={"type": "community"}).json()
    assert body["counts"] == {"giver": 12, "neighbor": 3, "community": 3, "needs_review": 1}
    assert [p["full_name"] for p in body["people"]] == ["Keisha Grant", "Rosa Jimenez", "Tomas Reyes"]
    keisha = body["people"][0]
    assert keisha["has_dog"] is True and keisha["interests"] == ["youth programs"]
    assert keisha["demographics"]["zip"] == {"value": "33030", "source_row": "intake_form_01.docx: ZIP"}

    givers = c.get("/people", params={"type": "giver"}).json()["people"]
    assert givers[0]["full_name"] == "Maria Delgado"                   # best score first
    dogs = c.get("/people", params={"has_dog": True}).json()["people"]
    assert {p["full_name"] for p in dogs} == {"Danielle Okafor", "Keisha Grant"}   # across tabs
    assert [p["full_name"] for p in c.get("/people", params={"interest": "ARTS"}).json()["people"]] == ["Marco Bellini"]
    assert len(c.get("/people").json()["people"]) == 18
    assert c.get("/people", params={"type": "volunteer"}).status_code == 422


def test_move_person_between_tabs(db_file):
    c = client()
    conn = db.connect(db_file)
    jordan = person_id(conn, "Jordan Lee")
    danielle = person_id(conn, "Danielle Okafor")
    conn.close()

    moved = c.patch(f"/people/{jordan}", json={"contact_type": "community"}).json()
    assert moved["contact_type"] == "community" and moved["tab_review"] is None
    assert c.get("/people").json()["counts"]["needs_review"] == 0

    giver = c.patch(f"/people/{danielle}", json={"contact_type": "giver"}).json()
    assert giver["status"] == "no_gifts" and giver["score"] == 0           # scored on arrival
    assert danielle in [d["id"] for d in c.get("/donors").json()]
    assert c.patch(f"/people/{danielle}", json={"contact_type": "donor"}).status_code == 422
    assert c.patch("/people/9999", json={"contact_type": "giver"}).status_code == 404


# ---- events -------------------------------------------------------------------------------------

def test_save_events_new_changed_and_sourceless(conn):
    db.seed(conn)
    first = db.save_events(conn, EVENTS)
    assert (first["added"], first["changed"], first["removed"]) == (4, 0, 0)        # "No source" dropped
    assert len(first["ids"]) == 5 and first["ids"][4] is None                        # ids line up with the input
    status = dict(conn.execute("SELECT title, status FROM events").fetchall())
    assert status["Summer arts night"] == "past" and status["Give Miami Day"] == "upcoming"

    moved = [{**EVENTS[1], "starts_at": "2026-11-15T08:00"}]                        # same date, new time
    second = db.save_events(conn, moved)
    assert (second["added"], second["changed"]) == (0, 1) and second["ids"] == [first["ids"][1]]
    row = conn.execute("SELECT status, starts_at FROM events WHERE id = ?", (first["ids"][1],)).fetchone()
    assert tuple(row) == ("changed", "2026-11-15T08:00")
    assert db.save_events(conn, moved)["changed"] == 0                             # no new change...
    assert conn.execute("SELECT status FROM events WHERE id = ?", (first["ids"][1],)).fetchone()[0] == "changed"


def test_only_a_complete_run_removes_missing_future_events(conn):
    db.seed(conn)
    ids = db.save_events(conn, EVENTS)["ids"]
    partial = db.save_events(conn, EVENTS[:1])                                      # failed/partial run
    assert partial["removed"] == 0 and conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 4

    maria = person_id(conn, "Maria Delgado")
    db.save_event_draft(conn, ids[1], maria, {"subject": "5K", "email_body": "Run with us", "status": "ready"})
    full = db.save_events(conn, EVENTS[:1], complete=True)                         # 5K + early giving gone
    assert full["removed"] == 2
    titles = {r[0] for r in conn.execute("SELECT title FROM events")}
    assert titles == {"Give Miami Day", "Summer arts night"}                        # past events are kept
    assert conn.execute("SELECT COUNT(*) FROM outreach_drafts WHERE body = 'Run with us'").fetchone()[0] == 0


def test_events_list_upcoming_first_then_past(conn):
    db.seed(conn)
    db.save_events(conn, EVENTS)
    titles = [e["title"] for e in list_events(conn, today=date(2026, 11, 8))]
    assert titles == ["Early giving opens", "Give Miami 5K", "Give Miami Day", "Summer arts night"]


def test_event_audience_rows_replace_and_skip_unknown_people(conn):
    db.seed(conn)
    (gmd,) = db.save_events(conn, EVENTS[:1])["ids"]
    maria = person_id(conn, "Maria Delgado")
    n = db.save_event_audience(conn, gmd, {"event_kind": "giving", "person_ids": [maria, 9999, maria],
                                           "why": {str(maria): "lapsing Give Miami Day giver"}, "rationale": "r"})
    assert n == 1
    assert conn.execute("SELECT reason FROM event_audience WHERE event_id = ?", (gmd,)).fetchone()[0] == \
        "lapsing Give Miami Day giver"
    db.save_event_audience(conn, gmd, {"event_kind": "giving", "person_ids": []})
    assert conn.execute("SELECT COUNT(*) FROM event_audience WHERE event_id = ?", (gmd,)).fetchone()[0] == 0
    with pytest.raises(LookupError):
        db.save_event_audience(conn, 9999, {})


def test_event_drafts_link_replace_and_obey_star_rules(conn):
    db.seed(conn)
    score.run(conn, AS_OF)
    (gmd,) = db.save_events(conn, EVENTS[:1])["ids"]
    maria = person_id(conn, "Maria Delgado")
    invite = {"subject": "Give Miami Day is Nov 19", "email_body": "Hi Maria", "sms": "GMD Nov 19!",
              "facts_used": [{"fact": "f", "url": "https://x", "date": "2026-11-01"}], "status": "ready"}
    first = db.save_event_draft(conn, gmd, maria, invite)
    assert conn.execute("SELECT body FROM outreach_drafts WHERE id = ?", (first,)).fetchone()[0] == "Hi Maria"
    second = db.save_event_draft(conn, gmd, maria, {**invite, "email_body": "Hi again"})
    assert conn.execute("SELECT COUNT(*) FROM event_drafts WHERE event_id = ?", (gmd,)).fetchone()[0] == 1
    assert conn.execute("SELECT sms, body FROM outreach_drafts WHERE id = ?", (second,)).fetchone()[:] == \
        ("GMD Nov 19!", "Hi again")
    star = conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 1").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):                            # a star invite is never 'ready'
        db.save_event_draft(conn, gmd, star, invite)


def test_event_routes_with_recipients_and_drafts(db_file):
    conn = db.connect(db_file)
    ids = db.save_events(conn, EVENTS)["ids"]
    danielle, keisha = person_id(conn, "Danielle Okafor"), person_id(conn, "Keisha Grant")
    db.save_event_audience(conn, ids[1], {"event_kind": "pet", "person_ids": [danielle, keisha],
                                          "why": {str(danielle): "has a dog", str(keisha): "has a dog"},
                                          "rationale": "puppy outreach"})
    db.save_event_draft(conn, ids[1], danielle, {"subject": "5K", "email_body": "Bring your dog", "status": "ready"})
    conn.close()

    c = client()
    events = c.get("/events").json()
    assert events[0]["title"] == "Early giving opens"
    fivek = next(e for e in events if e["title"] == "Give Miami 5K")
    assert (fivek["audience_count"], fivek["drafts_ready"]) == (2, 1)
    assert fivek["status"] == "upcoming" and fivek["source_url"].startswith("https://")
    detail = c.get(f"/events/{ids[1]}").json()
    assert detail["event_kind"] == "pet" and detail["rationale"] == "puppy outreach"
    assert [(r["full_name"], r["contact_type"], r["reason"]) for r in detail["recipients"]] == [
        ("Danielle Okafor", "neighbor", "has a dog"), ("Keisha Grant", "community", "has a dog")]
    assert all(r["has_dog"] is True for r in detail["recipients"])           # puppy event: only dog owners
    d = detail["drafts"][0]
    assert (d["full_name"], d["contact_type"], d["person_id"], d["status"]) == ("Danielle Okafor", "neighbor", danielle, "ready")
    assert c.get("/events/9999").status_code == 404


# ---- context refresh log ------------------------------------------------------------------------

def test_refresh_log_and_context_status(db_file):
    c = client()
    assert c.get("/context/status").json() == {"last_refreshed_at": None, "last_run": None}
    conn = db.connect(db_file)
    ctx = db.save_context(conn, {"profile": {"name": "The Miami Foundation"},
                                 "facts": [{"source": "website", "url": "https://m.org/a", "fact": "A", "posted_at": "2026-10-01"}],
                                 "sources": {"website": "ok", "x": "skipped"}})
    assert (ctx["facts_added"], ctx["facts_removed"]) == (1, 0)
    ctx2 = db.save_context(conn, {"facts": [{"source": "website", "url": "https://m.org/b", "fact": "B"}],
                                  "sources": {"website": "ok"}})
    assert (ctx2["facts_added"], ctx2["facts_removed"]) == (1, 1)
    ev = db.save_events(conn, EVENTS[:2])
    log_id = db.log_context_refresh(conn, "2026-11-08T10:00:00", {"website": "ok", "x": "skipped"}, ctx2, ev,
                                    errors=["instagram: blocked"])
    conn.close()
    status = c.get("/context/status").json()
    assert status["last_refreshed_at"] is not None
    run = status["last_run"]
    assert run["id"] == log_id and run["sources_read"] == {"website": "ok", "x": "skipped"}
    assert (run["facts_added"], run["facts_removed"], run["events_added"]) == (1, 1, 2)
    assert run["errors"] == ["instagram: blocked"] and run["finished_at"]


def test_blocked_refresh_keeps_last_refreshed_at_unchanged(conn):
    db.save_context(conn, {"profile": {}, "facts": [], "sources": {"website": "blocked"}})
    assert conn.execute("SELECT last_refreshed_at FROM org_profile").fetchone()[0] is None


# ---- community stats ----------------------------------------------------------------------------

def test_community_stats_counts_recorded_fields_with_not_recorded_bucket(db_file):
    stats = client().get("/community/stats").json()
    assert stats["total"] == 3
    zips = stats["fields"]["zip"]
    assert zips["recorded"] == 3 and zips["not_recorded"] == 0
    assert zips["buckets"] == [{"value": "33125", "count": 2}, {"value": "33030", "count": 1}]
    gender = stats["fields"]["gender"]
    assert gender["buckets"] == [{"value": "Female", "count": 1}, {"value": "not recorded", "count": 2}]
    programs = {b["value"]: b["count"] for b in stats["fields"]["programs"]["buckets"]}
    assert programs == {"After-school tutoring": 2, "Food pantry": 1, "not recorded": 1}
    assert set(stats["fields"]) == set(db.DEMOGRAPHIC_FIELDS)


# ---- snapshot -----------------------------------------------------------------------------------

def test_snapshot_people_events_and_stats_mirror_routes(db_file):
    conn = db.connect(db_file)
    ids = db.save_events(conn, EVENTS[:2])["ids"]
    snap = json.loads(json.dumps(build_snapshot(conn, rescore=False)))
    conn.close()
    c = client()
    for tab in ("giver", "neighbor", "community"):
        assert snap["people"][tab] == c.get("/people", params={"type": tab}).json()["people"]
    assert snap["people"]["counts"] == c.get("/people").json()["counts"]
    assert snap["events"] == c.get("/events").json()
    assert snap["event_details"][str(ids[0])] == c.get(f"/events/{ids[0]}").json()
    assert snap["community_stats"] == c.get("/community/stats").json()
    assert snap["context_status"] == c.get("/context/status").json()
    keisha = next(p for p in snap["people"]["community"] if p["full_name"] == "Keisha Grant")
    assert snap["donor_details"][str(keisha["id"])]["full_name"] == "Keisha Grant"


# ---- gift status ----------------------------------------------------------------------------------

def test_declined_and_failed_gifts_are_shown_but_never_scored(db_file):
    conn = db.connect(db_file)
    maria = person_id(conn, "Maria Delgado")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, status) VALUES (?, 1, '2026-11-01', 'pending')", (maria,))
    # A declined 2026 Give Miami Day charge must not make her look like she already gave this year
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, 3000, '2026-11-02', "
                 "'online', 'declined')", (maria,))
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, 99999, '2026-10-01', "
                 "'online', 'failed')", (maria,))
    conn.commit()
    score.run(conn, AS_OF)
    conn.close()
    d = client().get(f"/donors/{maria}").json()
    assert d["status"] == "lapsing" and d["why"]["gift_count"] == 4 and d["why"]["lifetime_total"] == 11000
    statuses = {g["gift_date"]: g["status"] for g in d["gifts"]}
    assert statuses["2026-11-02"] == "declined" and statuses["2026-10-01"] == "failed"
    assert statuses["2025-11-20"] == "ok"


def test_existing_gifts_default_to_ok(conn):
    db.seed(conn)
    assert {r[0] for r in conn.execute("SELECT DISTINCT status FROM gifts")} == {"ok"}


def test_event_batch_id_is_null_until_campaigns_link_events(db_file):
    conn = db.connect(db_file)
    (gmd, fivek) = db.save_events(conn, EVENTS[:2])["ids"]
    conn.close()
    c = client()
    assert all(e["batch_id"] is None for e in c.get("/events").json())     # no campaigns.event_id yet
    conn = db.connect(db_file)                                              # 90's hook adds the column
    conn.executescript("""CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY, name TEXT);
                          ALTER TABLE campaigns ADD COLUMN event_id INTEGER;""")
    conn.executemany("INSERT INTO campaigns (name, event_id) VALUES (?, ?)", [("old", gmd), ("new", gmd), ("x", None)])
    conn.commit()
    latest = conn.execute("SELECT MAX(id) FROM campaigns WHERE event_id = ?", (gmd,)).fetchone()[0]
    conn.close()
    assert c.get(f"/events/{gmd}").json()["batch_id"] == latest
    assert {e["id"]: e["batch_id"] for e in c.get("/events").json()} == {gmd: latest, fivek: None}


def test_event_quote_is_stored_and_a_new_snippet_is_not_a_change(conn):
    db.seed(conn)
    e = {**EVENTS[0], "verification": "page-verified", "quote": "Give Miami Day returns Nov. 19", "place": None}
    (gid,) = db.save_events(conn, [e])["ids"]
    again = db.save_events(conn, [{**e, "quote": "Give Miami Day is Thursday, Nov. 19"}])
    assert again["changed"] == 0
    row = conn.execute("SELECT quote, status, place FROM events WHERE id = ?", (gid,)).fetchone()
    assert tuple(row) == ("Give Miami Day is Thursday, Nov. 19", "upcoming", None)
