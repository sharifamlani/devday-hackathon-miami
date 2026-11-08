"""B2 money by quarter (plan §21.5): GET /targets/quarters and the reached_today count on GET /targets.

Expected sums are computed here from data/sample_inputs/answer_key.json gifts, never typed in, and the DB is
built from the key (plus its declined charges), not from a startup seed. Declined charges and pledges must
not count.
"""
import json
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import db, targets
from service.routes_targets import router

ANSWER_KEY = Path(__file__).resolve().parents[2] / "data" / "sample_inputs" / "answer_key.json"
KEY = json.loads(ANSWER_KEY.read_text(encoding="utf-8"))
AS_OF = date.fromisoformat(KEY["as_of"])


def load_key(conn, key=KEY) -> dict[str, int]:
    """The key's donors and gifts as ingest should store them, plus its declined charges (status 'declined')."""
    ids = {d["donor_id"]: db.insert_donor(conn, {"full_name": d["full_name"], "donor_type": d["donor_type"]})
           for d in key["canonical_donors"]}
    for g in key["gifts"]:
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, ?, ?, ?, 'ok')",
                     (ids[g["donor_id"]], g["amount"], g["gift_date"], g.get("channel")))
    for g in key.get("failed_gifts_not_counted", []):
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, ?, ?, ?, 'declined')",
                     (ids[g["donor_id"]], g["amount"], g["date"], g.get("note")))
    conn.commit()
    return ids


def key_raised(start: str, end: str) -> float:
    """Sum of the key's gifts dated start..end (ISO strings compare as dates), counted up to the as-of date."""
    end = min(end, AS_OF.isoformat())
    return float(sum(g["amount"] for g in KEY["gifts"] if start <= g["gift_date"] <= end))


@pytest.fixture
def key_conn(conn):
    load_key(conn)
    return conn


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    monkeypatch.setenv("SCORE_AS_OF", AS_OF.isoformat())
    c = db.connect(path)
    db.create_schema(c)
    load_key(c)
    c.close()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_quarters_equal_sums_computed_from_the_answer_key(key_conn):
    q = targets.quarters(key_conn, AS_OF)
    assert [x["label"] for x in q["quarters"]] == [f"{AS_OF.year}-Q{i}" for i in (1, 2, 3, 4)]
    for x in q["quarters"]:
        assert x["raised"] == key_raised(x["start"], x["end"]), x["label"]
    assert q["ytd"] == {"year": AS_OF.year, "raised": key_raised(f"{AS_OF.year}-01-01", AS_OF.isoformat())}
    assert q["ytd"]["raised"] == sum(x["raised"] for x in q["quarters"]) > 0


def test_declined_charges_do_not_count(key_conn):
    """Hye-jin Park's declined $40 (Oct 10) is in the db with status 'declined' but in no total."""
    declined = KEY["failed_gifts_not_counted"]
    assert declined and key_conn.execute("SELECT COUNT(*) FROM gifts WHERE status = 'declined'").fetchone()[0] == len(declined)
    q4 = targets.quarters(key_conn, AS_OF)["quarters"][3]
    assert q4["raised"] == key_raised(q4["start"], q4["end"])
    assert targets.compute(key_conn, "quarter", AS_OF)["raised"] == q4["raised"]
    assert targets.compute(key_conn, "month", AS_OF)["raised"] == key_raised(AS_OF.replace(day=1).isoformat(), AS_OF.isoformat())


def test_quarters_route_matches_the_key_and_honours_as_of(client):
    body = client.get("/targets/quarters").json()               # $SCORE_AS_OF = the key's as-of date
    assert set(body) == {"quarters", "ytd"} and set(body["quarters"][0]) == {"label", "start", "end", "raised"}
    for x in body["quarters"]:
        assert x["raised"] == key_raised(x["start"], x["end"])
    # an earlier as-of date: later quarters are 0 and gifts after that date are not counted
    early = client.get("/targets/quarters?as_of=2025-06-30").json()
    assert early["ytd"]["year"] == 2025
    assert [x["label"] for x in early["quarters"]][0] == "2025-Q1"
    assert early["quarters"][2]["raised"] == 0 == early["quarters"][3]["raised"]
    assert early["ytd"]["raised"] == float(sum(g["amount"] for g in KEY["gifts"] if "2025-01-01" <= g["gift_date"] <= "2025-06-30"))


def test_an_empty_database_returns_zeros(conn):
    q = targets.quarters(conn, AS_OF)
    assert [x["raised"] for x in q["quarters"]] == [0, 0, 0, 0] and q["ytd"]["raised"] == 0
    assert targets.reached_today(conn, AS_OF) == 0


def add_send(conn, donor_id, sent_at, channel="email"):
    conn.execute("INSERT INTO outbox (donor_id, channel, to_address, body, sent_at) VALUES (?, ?, 'x@example.com', 'hi', ?)",
                 (donor_id, channel, sent_at))


def test_reached_today_counts_distinct_people_from_the_outbox(key_conn):
    a, b, c = (r[0] for r in key_conn.execute("SELECT id FROM donors ORDER BY id LIMIT 3"))
    day = AS_OF.isoformat()
    add_send(key_conn, a, f"{day} 09:00:00")
    add_send(key_conn, a, f"{day} 15:30:00", "text")          # same person twice: once
    add_send(key_conn, b, f"{day} 10:00:00")
    add_send(key_conn, c, "2026-11-07 23:59:59")              # yesterday: not today
    key_conn.commit()
    assert targets.reached_today(key_conn, AS_OF) == 2
    assert targets.reached_today(key_conn, date(2026, 11, 7)) == 1


def add_call(conn, note_id, created_at, destinations):
    """A call note shaped like #78's POST /calls: people live in destinations JSON, not a person_id column."""
    db.save_call_note(conn, {"id": note_id, "title": "Call", "created_at": created_at, "duration_sec": 60,
                             "destinations": destinations})
    conn.commit()


def test_reached_today_counts_donors_in_call_note_destinations(key_conn):
    a, b, c = (r[0] for r in key_conn.execute("SELECT id FROM donors ORDER BY id LIMIT 3"))
    day = AS_OF.isoformat()
    assert targets.has_table(key_conn, "call_notes") and targets.reached_today(key_conn, AS_OF) == 0
    add_send(key_conn, a, f"{day} 09:00:00")
    key_conn.commit()
    add_call(key_conn, "n1", f"{day}T11:00:00+00:00", [{"kind": "donor", "id": str(a), "label": "A"},   # already emailed: once
                                                      {"kind": "donor", "id": b, "label": "B"},
                                                      {"kind": "group", "id": "7", "label": "Gala list"},   # not a person
                                                      {"kind": "project", "id": "9", "label": "Spring"}])
    add_call(key_conn, "n2", f"{day}T15:00:00Z", [{"kind": "donor", "id": b, "label": "B"}])        # same person, 2nd call
    add_call(key_conn, "n3", "2026-11-01T12:00:00+00:00", [{"kind": "donor", "id": c, "label": "C"}])  # another day
    add_call(key_conn, "n4", f"{day}T16:00:00+00:00", [])                                           # no destinations
    assert targets.reached_today(key_conn, AS_OF) == 2


def test_targets_route_adds_reached_today_to_every_period(client):
    conn = db.connect()
    donor = conn.execute("SELECT id FROM donors ORDER BY id LIMIT 1").fetchone()[0]
    add_send(conn, donor, f"{AS_OF.isoformat()} 08:00:00")
    conn.commit()
    conn.close()
    both = client.get("/targets").json()
    assert set(both) == {"month", "quarter"}
    assert both["month"]["reached_today"] == both["quarter"]["reached_today"] == 1
    assert client.get("/targets?period=quarter").json()["reached_today"] == 1
    assert client.get("/targets?as_of=2026-11-07").json()["quarter"]["reached_today"] == 0
