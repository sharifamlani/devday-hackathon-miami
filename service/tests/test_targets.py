"""Targets (issue #37): totals match a hand-computed sum, and merging (or undoing a merge) never changes them."""
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import db, dedupe, targets
from service.routes_targets import router

AS_OF = date(2026, 11, 8)    # demo day; Give Miami Day (Nov 19) is 11 days away
GOALS = {"is_sample": True, "month": {"default": 1000}, "quarter": {"default": 5000, "2026-Q4": 4000}}

# Fictional donors. Hand-computed for November 2026 (counted Nov 1 to the as-of date, Nov 8):
#   Ann Testa 100 (online, first gave 2025: returning) + Ann's duplicate 300 (GMD, first gift in period: new)
#   + Dev Ortiz 25 on the as-of date (online, returning) + Eli Park 500 (event, new)          = 925 from 4 gifts
# Q4 2026 adds Coral Reef Trust 1,000 (Oct 10); its Dec 1 gift is after the as-of date      = 1,925 from 5 gifts
FIXTURE = [
    {"full_name": "Ann Testa", "donor_type": "individual", "email": "ann.testa@example.com",
     "emails_all": ["ann.testa@example.com"], "city": "Miami", "state": "FL",
     "gifts": [(100, "2026-11-02", "online"), (200, "2025-03-01", "check")]},
    {"full_name": "Ann Testa", "donor_type": "individual", "email": "ANN.TESTA@example.com",
     "emails_all": ["ann.testa@example.com"], "city": "Miami", "state": "FL",
     "gifts": [(300, "2026-11-05", "Give Miami Day")]},
    {"full_name": "Coral Reef Trust", "org_name": "Coral Reef Trust", "donor_type": "organization",
     "email": "grants@coralreef.example.org", "city": "Key Biscayne", "state": "FL",
     "gifts": [(1000, "2026-10-10", "check"), (50, "2026-12-01", "check")]},
    {"full_name": "Dev Ortiz", "donor_type": "individual", "email": "dev.ortiz@example.com", "city": "Doral",
     "state": "FL", "gifts": [(75, "2026-09-30", "online"), (25, "2026-11-08", "online")]},
    {"full_name": "Eli Park", "donor_type": "individual", "email": "eli.park@example.com", "city": "Hialeah",
     "state": "FL", "gifts": [(500, "2026-11-01", "event")]},
]


@pytest.fixture
def seeded(conn):
    ids = [db.insert_donor(conn, d) for d in FIXTURE]
    conn.commit()
    return conn, ids


def totals(t: dict) -> tuple:
    return t["raised"], t["gifts_count"], t["by_channel"], t["percent"]


def test_period_bounds_and_labels():
    assert targets.period_bounds("month", AS_OF) == (date(2026, 11, 1), date(2026, 11, 30), "November 2026", "2026-11")
    assert targets.period_bounds("quarter", AS_OF) == (date(2026, 10, 1), date(2026, 12, 31), "Q4 2026", "2026-Q4")
    assert targets.period_bounds("month", date(2026, 12, 15))[1] == date(2026, 12, 31)
    assert targets.period_bounds("quarter", date(2026, 2, 28))[:3] == (date(2026, 1, 1), date(2026, 3, 31), "Q1 2026")
    with pytest.raises(ValueError):
        targets.period_bounds("year", AS_OF)


def test_month_matches_hand_computed_sum(seeded):
    conn, (ann, ann_dup, coral, dev, eli) = seeded
    t = targets.compute(conn, "month", AS_OF, GOALS)
    assert t["label"] == "November 2026" and (t["start"], t["end"]) == ("2026-11-01", "2026-11-30")
    assert t["raised"] == 925.0 and t["gifts_count"] == 4 and t["donors_count"] == 4
    assert t["goal"] == 1000.0 and t["percent"] == 92.5 and t["goal_is_sample"] is True
    assert t["days_left"] == 22
    assert t["by_channel"] == [{"channel": "event", "amount": 500.0}, {"channel": "Give Miami Day", "amount": 300.0},
                               {"channel": "online", "amount": 125.0}]
    assert t["new_vs_returning"] == {"new": 2, "returning": 2, "new_amount": 800.0, "returning_amount": 125.0}
    assert t["give_miami_day"] == {"date": "2026-11-19", "days_until": 11, "in_period": True}
    assert t["donor_ids"] == [eli, ann_dup, ann, dev] and t["top_donor_ids"] == t["donor_ids"]


def test_quarter_uses_the_period_override_and_skips_future_gifts(seeded):
    conn, (ann, ann_dup, coral, dev, eli) = seeded
    t = targets.compute(conn, "quarter", AS_OF, GOALS)
    assert t["label"] == "Q4 2026" and t["days_left"] == 53
    assert t["raised"] == 1925.0 and t["gifts_count"] == 5 and t["donors_count"] == 5
    assert t["goal"] == 4000.0 and t["percent"] == 48.1      # 2026-Q4 overrides the default 5000
    assert t["donor_ids"][0] == coral
    # New in Q4: Ann's duplicate, Coral (first gift Oct 10), Eli. Returning: Ann (2025), Dev (Sep 30, before Q4)
    assert t["new_vs_returning"] == {"new": 3, "returning": 2, "new_amount": 1800.0, "returning_amount": 125.0}


def test_merge_and_undo_do_not_change_totals(seeded):
    conn, (ann, ann_dup, coral, dev, eli) = seeded
    before = {p: targets.compute(conn, p, AS_OF, GOALS) for p in targets.PERIODS}

    assert dedupe.run(conn) == 1
    suggestion = conn.execute("SELECT id FROM duplicate_suggestions WHERE status = 'pending'").fetchone()["id"]
    merged = dedupe.merge(conn, suggestion)
    assert (merged["kept_donor_id"], merged["removed_donor_id"]) == (ann, ann_dup)

    after = {p: targets.compute(conn, p, AS_OF, GOALS) for p in targets.PERIODS}
    for p in targets.PERIODS:
        assert totals(after[p]) == totals(before[p])
        assert after[p]["donors_count"] == before[p]["donors_count"] - 1   # one person, counted once
        assert ann_dup not in after[p]["donor_ids"]
    # Ann's Give Miami Day gift now sits on a donor who first gave in 2025: returning, not new
    assert after["month"]["new_vs_returning"] == {"new": 1, "returning": 2, "new_amount": 500.0,
                                                  "returning_amount": 425.0}

    # Undo by hand (there is no unmerge route yet): restore the row and move its gift back
    conn.execute("INSERT INTO donors (id, full_name, donor_type, email) VALUES (?, 'Ann Testa', 'individual', ?)",
                 (ann_dup, "ANN.TESTA@example.com"))
    conn.execute("UPDATE gifts SET donor_id = ? WHERE donor_id = ? AND gift_date = '2026-11-05'", (ann_dup, ann))
    conn.commit()
    undone = {p: targets.compute(conn, p, AS_OF, GOALS) for p in targets.PERIODS}
    assert undone == before


def test_missing_goal_gives_null_percent(seeded):
    conn, _ = seeded
    t = targets.compute(conn, "month", AS_OF, {})
    assert t["goal"] is None and t["percent"] is None and t["raised"] == 925.0


def test_give_miami_day_passed_is_null(conn):
    t = targets.compute(conn, "month", date(2026, 11, 20), GOALS)
    assert t["give_miami_day"] is None and t["raised"] == 0 and t["donor_ids"] == []


def test_org_config_goals_are_labelled_sample():
    goals = targets.load_goals()
    assert goals["is_sample"] is True
    assert goals["month"]["default"] > 0 and goals["quarter"]["default"] > 0


def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_routes_on_the_seed(db_file):
    """conftest seeds the 12 SAMPLE donors as of Nov 7: no gifts yet in November; Q4 has Palmetto Lantern + James Carter."""
    c = client()
    both = c.get("/targets").json()
    assert set(both) == {"month", "quarter"}
    assert both["month"]["raised"] == 0 and both["month"]["as_of"] == "2026-11-07"
    q = c.get("/targets?period=quarter").json()
    assert q == both["quarter"]
    assert q["raised"] == 50050.0 and q["gifts_count"] == 2 and q["donors_count"] == 2   # 50,000 + 50
    assert q["give_miami_day"]["days_until"] == 12
    assert c.get("/targets?period=year").status_code == 422

    rows = c.get("/targets/donors?period=quarter").json()
    assert [r["full_name"] for r in rows] == ["Palmetto Lantern Foundation", "James Carter"]
    assert {"score", "status", "why", "is_sample"} <= rows[0].keys()
    assert c.get("/targets/donors").json() == []          # month default: nobody yet
    assert c.get("/targets/donors?period=month&as_of=2026-10-31").json()[0]["full_name"] == "Palmetto Lantern Foundation"


def test_merge_route_keeps_seed_totals(db_file):
    from service.routes_data import router as data_router

    app = FastAPI()
    app.include_router(data_router)
    app.include_router(router)
    c = TestClient(app)
    before = c.get("/targets?as_of=2025-11-30").json()      # Maria Delgado's GMD 2025 gift is in this window
    pair = c.get("/duplicates").json()[0]
    assert c.post(f"/duplicates/{pair['id']}/merge", json={}).status_code == 200
    after = c.get("/targets?as_of=2025-11-30").json()
    for p in ("month", "quarter"):
        assert totals(after[p]) == totals(before[p])
