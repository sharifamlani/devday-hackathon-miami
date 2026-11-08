"""B13 home screen data (plan §21.5): GET /home/summary and GET /people/attention.

The DB is built from data/sample_inputs/answer_key.json (its gifts plus its declined charges), not from a startup
seed, and every expected number is read from the key. Tables owned by other lanes (tasks, call_notes) are created
by the tests that need them, to prove the endpoints switch on when they exist.
"""
import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import db
from service.routes_home import router

ANSWER_KEY = Path(__file__).resolve().parents[2] / "data" / "sample_inputs" / "answer_key.json"
KEY = json.loads(ANSWER_KEY.read_text(encoding="utf-8"))
AS_OF = date.fromisoformat(KEY["as_of"])
DAY = AS_OF.isoformat()


def load_key(conn) -> dict[str, int]:
    """The key's donors and gifts as ingest should store them, plus its declined charges (status 'declined')."""
    ids = {d["donor_id"]: db.insert_donor(conn, {"full_name": d["full_name"], "donor_type": d["donor_type"]})
           for d in KEY["canonical_donors"]}
    for g in KEY["gifts"]:
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, ?, ?, ?, 'ok')",
                     (ids[g["donor_id"]], g["amount"], g["gift_date"], g.get("channel")))
    for g in KEY.get("failed_gifts_not_counted", []):
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, ?, ?, ?, 'declined')",
                     (ids[g["donor_id"]], g["amount"], g["date"], g.get("note")))
    conn.commit()
    return ids


@pytest.fixture
def ids(tmp_path, monkeypatch):
    """donor_id (key id like 'D18') -> db id, in a temp db file the routes read via $DONORS_DB."""
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    monkeypatch.setenv("SCORE_AS_OF", DAY)
    conn = db.connect(path)
    db.create_schema(conn)
    mapping = load_key(conn)
    conn.close()
    return mapping


@pytest.fixture
def client(ids):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def conn(ids):
    c = db.connect()
    yield c
    c.close()


def add_donor(conn, name, donor_type="individual") -> int:
    return conn.execute("INSERT INTO donors (full_name, donor_type) VALUES (?, ?)", (name, donor_type)).lastrowid


def add_gift(conn, donor_id, amount, gift_date, status="ok"):
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, ?, ?, 'online', ?)",
                 (donor_id, amount, gift_date, status))
    conn.commit()


def add_suggestion(conn, a, b, status="pending"):
    conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence, status) "
                 "VALUES (?, ?, '[\"same email\"]', 0.9, ?)", (a, b, status))
    conn.commit()


def attention(client, limit=50):
    return client.get(f"/people/attention?limit={limit}").json()


# ---- /home/summary --------------------------------------------------------------------------------------------

def test_gifts_at_risk_equals_the_keys_expected_alerts(client):
    body = client.get("/home/summary").json()
    assert set(body) == {"gifts_at_risk", "duplicates", "tasks_today", "next_event", "reached_today", "suggestions"}
    assert body["gifts_at_risk"] == len(KEY["gift_alerts_expected"])


def test_duplicates_are_the_open_suggestions(client, conn, ids):
    assert client.get("/home/summary").json()["duplicates"] == 0
    d = list(ids.values())
    add_suggestion(conn, d[0], d[1])
    add_suggestion(conn, d[2], d[3])
    add_suggestion(conn, d[4], d[5], status="dismissed")
    add_suggestion(conn, d[6], d[7], status="merged")
    assert client.get("/home/summary").json()["duplicates"] == 2


def test_tasks_today_counts_open_tasks_on_todays_list(client, conn, ids):
    """Against the real tasks table (#79): the same rows GET /tasks?due=today lists, open ones only."""
    from service import tasks
    assert client.get("/home/summary").json()["tasks_today"] == 0
    person = ids["D01"]
    tomorrow = (AS_OF + timedelta(days=1)).isoformat()
    tasks.create_task(conn, kind="call", title="call A", due=DAY, person_id=person)
    tasks.create_task(conn, kind="email", title="email B", due=DAY)
    tasks.create_task(conn, kind="call", title="overdue", due=(AS_OF - timedelta(days=2)).isoformat())
    tasks.create_task(conn, kind="prep", title="tomorrow", due=tomorrow)
    done, _ = tasks.create_task(conn, kind="call", title="done today", due=DAY)
    gone, _ = tasks.create_task(conn, kind="call", title="deleted", due=DAY)
    conn.execute("UPDATE tasks SET done = 1 WHERE id = ?", (done["id"],))
    conn.execute("UPDATE tasks SET deleted_at = datetime('now') WHERE id = ?", (gone["id"],))
    conn.commit()
    expected = [t for t in tasks.list_tasks(conn, due="today", as_of=AS_OF) if not t["done"]]
    assert sorted(t["title"] for t in expected) == ["call A", "email B", "overdue"]
    assert client.get("/home/summary").json()["tasks_today"] == len(expected) == 3


def test_next_event_is_give_miami_day_until_an_earlier_event_exists(client, conn):
    gmd = client.get("/home/summary").json()["next_event"]
    assert gmd["title"] == "Give Miami Day" and gmd["date"] == "2026-11-19" and gmd["days"] == 11
    conn.executemany(
        "INSERT INTO events (title, starts_at, source_url, status) VALUES (?, ?, 'https://example.org/e', ?)", [
            ("Donor thank-you night", "2026-11-12T18:00", "upcoming"),
            ("Early open house", "2026-11-01", "past"),
            ("Later gala", "2026-12-05", "upcoming")])
    conn.commit()
    assert client.get("/home/summary").json()["next_event"] == {
        "title": "Donor thank-you night", "date": "2026-11-12", "days": 4}
    assert client.get("/home/summary?as_of=2026-12-01").json()["next_event"] == {
        "title": "Later gala", "date": "2026-12-05", "days": 4}
    assert client.get("/home/summary?as_of=2026-12-31").json()["next_event"] is None


def test_reached_today_counts_outbox_sends_and_call_notes(client, conn, ids):
    a, b = ids["D01"], ids["D02"]
    conn.execute("INSERT INTO outbox (donor_id, channel, to_address, body, sent_at) "
                 "VALUES (?, 'email', 'x@example.com', 'hi', ?)", (a, f"{DAY} 09:00:00"))
    conn.commit()
    assert client.get("/home/summary").json()["reached_today"] == 1       # no call notes yet
    for note_id, dests in (("c1", [{"kind": "donor", "id": str(a), "label": "A"}]),     # a again: still once
                           ("c2", [{"kind": "donor", "id": b, "label": "B"}, {"kind": "group", "id": "3", "label": "G"}])):
        db.save_call_note(conn, {"id": note_id, "title": "Call", "created_at": f"{DAY}T10:00:00+00:00",
                                 "duration_sec": 30, "destinations": dests})
    conn.commit()
    assert client.get("/home/summary").json()["reached_today"] == 2


def test_suggestions_are_three_chips_from_todays_data(client, conn):
    chips = client.get("/home/summary").json()["suggestions"]
    newest = conn.execute("SELECT full_name FROM donors ORDER BY id DESC LIMIT 1").fetchone()[0]
    assert chips == [f"Enrich {newest}", "Who's late on a usual gift?", "Plan next week"]
    conn.execute("DELETE FROM gifts")                                      # no gifts: nobody is at risk
    conn.commit()
    quiet = client.get("/home/summary").json()["suggestions"]
    assert len(quiet) == 3 and quiet[1] != "Who's late on a usual gift?"


def test_empty_database_gives_zeros_and_generic_chips(tmp_path, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "empty.db"))
    monkeypatch.setenv("SCORE_AS_OF", DAY)
    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    body = c.get("/home/summary").json()
    assert (body["gifts_at_risk"], body["duplicates"], body["tasks_today"], body["reached_today"]) == (0, 0, 0, 0)
    assert len(body["suggestions"]) == 3 and body["next_event"]["title"] == "Give Miami Day"
    assert c.get("/people/attention").json() == []


# ---- /people/attention ----------------------------------------------------------------------------------------

def test_failed_and_late_badges_match_the_keys_alerts_and_come_first(client, ids):
    rows = attention(client)
    by_key_id = {v: k for k, v in ids.items()}
    alerted = {(by_key_id[r["id"]], r["badge"]) for r in rows if r["badge"] in ("failed", "late")}
    assert alerted == {(a["donor_id"], a["kind"]) for a in KEY["gift_alerts_expected"]}
    order = ["failed", "late", "new", "not_yet", "thanked"]
    positions = [order.index(r["badge"]) for r in rows]
    assert positions == sorted(positions)
    assert rows[0]["badge"] == "failed"


def test_row_shape_initials_and_one_badge_per_person(client):
    rows = attention(client)
    assert set(rows[0]) == {"id", "name", "initials", "line", "badge"}
    assert len({r["id"] for r in rows}) == len(rows)
    for r in rows:
        assert r["line"] and r["badge"] in ("failed", "late", "new", "thanked", "not_yet")
        assert r["initials"] == r["initials"].upper() and 1 <= len(r["initials"]) <= 2
    hye = next(r for r in rows if r["name"] == "Hye-jin Park")
    assert hye["initials"] == "HP" and hye["badge"] == "failed" and "didn't go through" in hye["line"]
    rafael = next(r for r in rows if r["name"] == "Rafael Quintero")
    assert rafael["badge"] == "failed" and rafael["line"].startswith("Skipped a monthly gift")
    assert any(r["badge"] == "late" and "days late" in r["line"] for r in rows)


def test_limit_trims_from_the_end_of_the_order(client):
    full = attention(client)
    assert len(full) > 6
    assert client.get("/people/attention").json() == full[:6]              # default limit is 6
    assert attention(client, 3) == full[:3]
    assert client.get("/people/attention?limit=0").status_code == 422


def test_declined_charge_is_not_a_gift(client, conn):
    """A donor whose only row is a declined charge has never given: never 'new' (gift alerts may still flag the charge)."""
    nid = add_donor(conn, "Declined Newcomer")
    add_gift(conn, nid, 50, (AS_OF - timedelta(days=3)).isoformat(), status="declined")
    assert {r["id"]: r["badge"] for r in attention(client)}.get(nid) != "new"


def test_new_donor_first_gift_under_30_days(client, conn):
    new_id, old_id = add_donor(conn, "Nia Newgiver"), add_donor(conn, "Old Timer")
    add_gift(conn, new_id, 120, (AS_OF - timedelta(days=10)).isoformat())
    add_gift(conn, old_id, 80, (AS_OF - timedelta(days=45)).isoformat())   # first gift 45 days ago: not new
    rows = {r["id"]: r for r in attention(client)}
    assert rows[new_id]["badge"] == "new" and rows[new_id]["initials"] == "NN"
    assert "$120" in rows[new_id]["line"]
    assert old_id not in rows or rows[old_id]["badge"] != "new"


def test_not_yet_is_a_past_donor_with_no_gift_this_year(client, conn):
    lapsed, current = add_donor(conn, "Lapsed Larry"), add_donor(conn, "Gave This Year")
    add_gift(conn, lapsed, 500, f"{AS_OF.year - 3}-02-10")                 # irregular: no cadence, so no late alert
    add_gift(conn, lapsed, 500, f"{AS_OF.year - 1}-09-20")
    add_gift(conn, current, 25, f"{AS_OF.year - 1}-05-01")
    add_gift(conn, current, 25, f"{AS_OF.year}-02-01")
    rows = {r["id"]: r for r in attention(client)}
    assert rows[lapsed]["badge"] == "not_yet" and "$1,000" in rows[lapsed]["line"]
    assert current not in rows or rows[current]["badge"] != "not_yet"


def add_thank_you(conn, donor_id, sent_at, intent="thank_you"):
    campaign = conn.execute("INSERT INTO campaigns (name, intent, channel) VALUES ('t', ?, 'email')", (intent,)).lastrowid
    msg = conn.execute("INSERT INTO campaign_messages (campaign_id, donor_id, channel, body, status, sent_at) "
                       "VALUES (?, ?, 'email', 'thanks', 'sent', ?)", (campaign, donor_id, sent_at)).lastrowid
    conn.execute("INSERT INTO outbox (campaign_message_id, donor_id, channel, to_address, body, sent_at) "
                 "VALUES (?, ?, 'email', 'x@example.com', 'thanks', ?)", (msg, donor_id, sent_at))
    conn.commit()


def test_thanked_needs_a_thank_you_sent_this_quarter(client, conn):
    flagged = {r["id"] for r in attention(client)}
    # two donors with no other badge: given this year, long enough ago to not be new
    quiet = add_donor(conn, "Quiet Thanked"), add_donor(conn, "Quiet Other"), add_donor(conn, "Quiet Check In")
    for donor_id in quiet:
        add_gift(conn, donor_id, 60, f"{AS_OF.year}-02-01")
    thanked, last_quarter, wrong_intent = quiet
    add_thank_you(conn, thanked, f"{DAY} 08:00:00")
    add_thank_you(conn, last_quarter, "2026-06-15 08:00:00")               # last quarter: not thanked
    add_thank_you(conn, wrong_intent, f"{DAY} 08:00:00", intent="check_in")  # only thank_you campaigns count
    rows = attention(client)
    got = {r["id"]: r for r in rows}
    assert got[thanked]["badge"] == "thanked" and got[thanked]["line"] == f"Thank-you sent {AS_OF:%b} {AS_OF.day}"
    assert last_quarter not in got and wrong_intent not in got
    assert rows[-1]["id"] == thanked and thanked not in flagged           # thanked sorts last


# ---- due dates carry their year when it isn't this year (QA: "due Nov 21 (717 days late)" read as the future)

def test_a_late_line_from_an_earlier_year_shows_that_year(client, conn):
    lucia = add_donor(conn, "Lucia Ferrante")                     # GMD giver, gave 2022 and 2023, nothing since
    add_gift(conn, lucia, 50, "2022-11-17")
    add_gift(conn, lucia, 60, "2023-11-16")
    conn.commit()
    row = next(r for r in attention(client) if r["id"] == lucia)
    assert row["badge"] == "late"
    assert "due Nov 21, 2024 (717 days late)" in row["line"]      # the year makes the 717 days make sense
    assert row["line"].startswith("Yearly Give Miami Day giver")   # capitalize() used to lowercase the event name


def test_a_late_line_from_this_year_has_no_year(client):
    walter = next(r for r in attention(client) if r["name"] == "Walter Brandt")
    assert walter["badge"] == "late" and "due Mar 18 (" in walter["line"] and "2026" not in walter["line"]


def test_a_due_date_still_ahead_is_never_late(client, conn):
    ahead = add_donor(conn, "Future Faye")                         # yearly; next gift due Sep 2027
    add_gift(conn, ahead, 100, "2025-09-21")
    add_gift(conn, ahead, 100, "2026-09-21")
    conn.commit()
    row = next((r for r in attention(client) if r["id"] == ahead), None)
    assert row is None or row["badge"] not in ("late", "failed")
    from service import gift_alerts
    assert not [a for a in gift_alerts.alerts(conn, AS_OF) if a["donor_id"] == ahead]
