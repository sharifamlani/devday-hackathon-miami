import json
import os
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import db, gift_alerts
from service.gift_alerts import add_months, alerts, cadence_for, donor_alerts

AS_OF = date(2026, 11, 8)
ANSWER_KEY = Path(__file__).resolve().parents[2] / "data" / "sample_inputs" / "answer_key.json"


def series(start: str, months: int, step: int = 1, amount: float = 75.0, **extra) -> list[dict]:
    d = date.fromisoformat(start)
    return [{"id": i + 1, "amount": amount, "gift_date": add_months(d, i * step).isoformat(), **extra}
            for i in range(months)]


def kinds(found):
    return [(a["kind"], a["cadence"]) for a in found]


def test_add_months_clamps_to_month_end():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2025, 11, 15), 3) == date(2026, 2, 15)


def test_monthly_on_time_has_no_alert():
    gifts = series("2025-07-05", 17)                       # Jul 2025 .. Nov 5 2026
    assert gifts[-1]["gift_date"] == "2026-11-05"
    assert donor_alerts(1, gifts, AS_OF) == []


def test_monthly_ten_days_late_is_flagged():
    gifts = series("2025-09-20", 13)                       # last gift 2026-09-20, next due 2026-10-20
    found = donor_alerts(1, gifts, date(2026, 10, 30))      # due + 10 days > 7-day grace
    assert kinds(found) == [("late", "monthly")]
    assert found[0]["expected_date"] == "2026-10-20" and found[0]["days_late"] == 10
    assert found[0]["evidence"] == [11, 12, 13]
    assert donor_alerts(1, gifts, date(2026, 10, 26)) == []   # 6 days late: still inside grace


def test_quarterly_overdue_is_late():
    gifts = series("2025-01-15", 6, step=3, amount=300)     # last 2026-04-15; missed Jul and Oct
    found = donor_alerts(1, gifts, AS_OF)
    assert kinds(found) == [("late", "quarterly")]
    assert found[0]["expected_date"] == "2026-07-15" and found[0]["days_late"] == 116


def test_give_miami_day_giver_not_late_before_gmd_plus_grace():
    gifts = [{"id": i, "amount": 250, "gift_date": d} for i, d in
             enumerate(["2022-11-17", "2023-11-16", "2024-11-21", "2025-11-20"], 1)]
    assert cadence_for([date.fromisoformat(g["gift_date"]) for g in gifts]) == "yearly_gmd"
    assert donor_alerts(1, gifts, AS_OF) == []                       # Nov 8: GMD is Nov 19
    assert donor_alerts(1, gifts, date(2026, 12, 19)) == []          # GMD + 30 days: still grace
    late = donor_alerts(1, gifts, date(2026, 12, 20))
    assert kinds(late) == [("late", "yearly_gmd")] and late[0]["expected_date"] == "2026-11-19"


def test_missed_month_in_a_series_is_failed():
    gifts = [g for g in series("2026-01-05", 11) if g["gift_date"] != "2026-08-05"]   # skipped August
    found = donor_alerts(1, gifts, AS_OF)
    assert kinds(found) == [("failed", "monthly")]
    assert found[0]["expected_date"] == "2026-08-05" and found[0]["evidence"] == [7, 9]


def test_failed_or_zero_gift_is_failed_until_a_good_gift_follows():
    gifts = series("2026-03-03", 8)                                    # good through 2026-10-03
    declined = {"id": 99, "amount": 75, "gift_date": "2026-11-03", "channel": "card declined"}
    zero = {"id": 98, "amount": 0, "gift_date": "2026-11-03"}
    for bad in (declined, zero):
        found = donor_alerts(1, gifts + [bad], AS_OF)
        assert kinds(found) == [("failed", "monthly")] and found[0]["evidence"] == [bad["id"]]
    recovered = gifts + [declined, {"id": 100, "amount": 75, "gift_date": "2026-11-05"}]
    assert donor_alerts(1, recovered, AS_OF) == []


def test_alerts_reads_db_and_route_serves_it(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    conn = db.connect(path)
    db.create_schema(conn)
    on_time = db.insert_donor(conn, {"full_name": "Bob", "donor_type": "individual",
                                     "gifts": [(g["amount"], g["gift_date"], "online") for g in series("2025-07-05", 17)]})
    overdue = db.insert_donor(conn, {"full_name": "Teo", "donor_type": "individual",
                                     "gifts": [(300, g["gift_date"], "check") for g in series("2025-01-15", 6, step=3)]})
    conn.commit()
    found = alerts(conn, AS_OF)
    conn.close()
    assert [(a["donor_id"], a["kind"], a["donor"]) for a in found] == [(overdue, "late", "Teo")]
    assert on_time not in {a["donor_id"] for a in found}

    app = FastAPI()
    app.include_router(gift_alerts.router)
    body = TestClient(app).get("/alerts", params={"as_of": "2026-11-08"}).json()
    assert [a["donor"] for a in body] == ["Teo"]


def load_answer_key(conn, key: dict) -> dict[str, int]:
    """Gifts as ingest should produce them: good gifts plus declined charges stored with gifts.status."""
    if not any(c["name"] == "status" for c in conn.execute("PRAGMA table_info(gifts)")):
        conn.execute("ALTER TABLE gifts ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'")   # 8b's column
    ids = {d["donor_id"]: db.insert_donor(conn, {"full_name": d["full_name"], "donor_type": d["donor_type"]})
           for d in key["canonical_donors"]}
    for g in key["gifts"]:
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, ?, ?, ?, 'ok')",
                     (ids[g["donor_id"]], g["amount"], g["gift_date"], g["channel"]))
    for g in key.get("failed_gifts_not_counted", []):
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, ?, ?, ?, 'declined')",
                     (ids[g["donor_id"]], g["amount"], g["date"], g.get("note")))
    conn.commit()
    return ids


def test_planted_sample_cases_from_the_answer_key(conn, monkeypatch):
    """Ground truth from data/sample_inputs: exactly the planted regular-gift problems are flagged.

    SAMPLE_ANSWER_KEY points at another key (e.g. PR #44's) to run the same check against it.
    """
    path = Path(os.environ.get("SAMPLE_ANSWER_KEY", ANSWER_KEY))
    key = json.loads(path.read_text(encoding="utf-8"))
    if not key.get("failed_gifts_not_counted"):
        pytest.skip("answer key predates the failed-gift cases (PR #44)")
    ids = load_answer_key(conn, key)
    by_key = {v: k for k, v in ids.items()}
    found = {(by_key[a["donor_id"]], a["kind"]) for a in alerts(conn, AS_OF)}
    assert found == {("D18", "failed"),    # Hye-jin Park: declined monthly charge
                     ("D19", "failed"),    # Rafael Quintero: skipped September
                     ("D06", "late"),      # Teodoro Salinas: quarterly overdue
                     ("D09", "late"),      # Walter Brandt: yearly (March) not given in 2026
                     ("D27", "late")}      # Veloria Bay Foundation: yearly (April) not given in 2026


def test_new_monthly_pledge_after_old_gmd_gifts_has_no_phantom_gap():
    """Park's shape: GMD gifts 2023-2025, then monthly from June 2026. No 'missed 2025-12' alert."""
    gmd = [{"id": i, "amount": 100, "gift_date": d} for i, d in enumerate(["2023-11-16", "2024-11-21", "2025-11-20"], 1)]
    monthly = [{**g, "id": g["id"] + 10} for g in series("2026-06-10", 5, amount=40)]       # Jun .. Oct 10
    assert donor_alerts(1, gmd + monthly, AS_OF) == []                                      # next due Nov 10
    declined = {"id": 99, "amount": 40, "gift_date": "2026-10-10", "status": "declined"}
    found = donor_alerts(1, gmd + monthly + [declined], AS_OF)
    assert kinds(found) == [("failed", "monthly")] and found[0]["evidence"] == [99]


def test_status_column_beats_the_text_fallback():
    gifts = series("2026-03-03", 8)
    ok_but_scary_text = {"id": 50, "amount": 50, "gift_date": "2026-11-03", "channel": "card declined", "status": "ok"}
    assert donor_alerts(1, gifts + [ok_but_scary_text], AS_OF) == []
    failed = {"id": 51, "amount": 50, "gift_date": "2026-11-03", "status": "failed"}
    assert kinds(donor_alerts(1, gifts + [failed], AS_OF)) == [("failed", "monthly")]
