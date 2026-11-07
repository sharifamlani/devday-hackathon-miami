"""Late and failed regular gifts: pure Python, deterministic, no LLM (challenge #2 minimum, issue #39).

For each donor, the giving cadence is read from gift dates:

    monthly     median gap 20-45 days       next gift = same day next month     grace  7 days
    quarterly   median gap 70-120 days      next gift = same day +3 months      grace 21 days
    yearly      median gap 300-430 days     next gift = same day next year      grace 30 days
    yearly_gmd  every gift on Give Miami Day (±3 days)  next gift = next GMD    grace 30 days

Alerts:
    late    the expected date + grace has passed with no gift
    failed  a charge recorded as failed with no good gift after it, or a monthly series that skipped a
            month in the last 6 months. gifts.status ('declined' | 'failed') is the primary signal; when
            the column is absent, amount 0 or "failed"/"declined"/... in the row text is the fallback.
            A donor with a failed charge isn't also flagged late: the failed charge is why the gift is missing.

Monthly cadence and missed months are read from the donor's latest unbroken run of gifts (a gap over
SERIES_BREAK_DAYS starts a new run), so years of Give Miami Day gifts before a new monthly pledge don't
look like missed months.

    python -m service.gift_alerts                    # alerts as of $SCORE_AS_OF or the demo date
    python -m service.gift_alerts --as-of 2026-11-30

The service mounts `router` for GET /alerts.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from calendar import monthrange
from datetime import date, timedelta
from statistics import median

from fastapi import APIRouter, Depends, Query

from service import db
from service.score import GIVE_MIAMI_DAY as SCORE_GMD, default_as_of

CADENCES = {  # name: (min median gap, max median gap, months between gifts, grace days)
    "monthly": (20, 45, 1, 7),
    "quarterly": (70, 120, 3, 21),
    "yearly": (300, 430, 12, 30),
}
GIVE_MIAMI_DAY = {2022: date(2022, 11, 17), **SCORE_GMD}   # score.py starts at 2023
GMD_WINDOW_DAYS = 3
MISSED_MONTH_GAP = 45          # a monthly gap longer than this skipped a month
SERIES_BREAK_DAYS = 100        # ... but a gap longer than this starts a new series, not a missed month
RECENT_GAP_DAYS = 183          # only gaps in the last ~6 months count as failed
FAILED_WORDS = re.compile(r"\b(failed|declined|returned|bounced|expired|nsf|chargeback)\b", re.I)

router = APIRouter(tags=["alerts"])


def add_months(d: date, months: int) -> date:
    """Same day-of-month `months` later, clamped to the month's last day (Jan 31 + 1 → Feb 28)."""
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, monthrange(year, month)[1]))


def is_failed(gift: dict) -> bool:
    """gifts.status when present; otherwise amount 0 or failure words in the row text."""
    status = (gift.get("status") or "").strip().lower()
    if status:
        return status in ("declined", "failed")
    text = " ".join(str(gift.get(k) or "") for k in ("channel", "source_row"))
    return gift["amount"] <= 0 or bool(FAILED_WORDS.search(text))


def latest_run(dates: list[date]) -> int:
    """Index where the latest unbroken run of gifts starts (no gap over SERIES_BREAK_DAYS inside it)."""
    start = 0
    for i, (a, b) in enumerate(zip(dates, dates[1:]), 1):
        if (b - a).days > SERIES_BREAK_DAYS:
            start = i
    return start


def is_gmd(d: date) -> bool:
    gmd = GIVE_MIAMI_DAY.get(d.year)
    return gmd is not None and abs((d - gmd).days) <= GMD_WINDOW_DAYS


def cadence_for(dates: list[date]) -> str | None:
    """monthly | quarterly | yearly | yearly_gmd, or None when there are too few or irregular gifts."""
    if len(dates) < 2:
        return None
    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    gap = median(gaps)
    for name, (lo, hi, _, _) in CADENCES.items():
        if lo <= gap <= hi:
            if name == "monthly" and len(dates) < 3:
                return None          # two gifts a month apart aren't a series yet
            if name == "yearly" and all(is_gmd(d) for d in dates):
                return "yearly_gmd"
            return name
    return None


def expected_after(last: date, cadence: str) -> date | None:
    if cadence == "yearly_gmd":
        return GIVE_MIAMI_DAY.get(last.year + 1)
    return add_months(last, CADENCES[cadence][2])


def grace_days(cadence: str) -> int:
    return CADENCES["yearly" if cadence == "yearly_gmd" else cadence][3]


def donor_alerts(donor_id: int, gifts: list[dict], as_of: date) -> list[dict]:
    """Alerts for one donor's gifts ({id, amount, gift_date, channel, source_row}); [] when on track."""
    gifts = sorted((g for g in gifts if date.fromisoformat(g["gift_date"]) <= as_of), key=lambda g: g["gift_date"])
    good = [g for g in gifts if not is_failed(g)]
    dates = [date.fromisoformat(g["gift_date"]) for g in good]
    # A recent monthly run is read on its own; anything else uses the whole history
    start = latest_run(dates)
    if cadence_for(dates[start:]) == "monthly":
        good, dates = good[start:], dates[start:]
    cadence = cadence_for(dates)
    out = []

    def alert(kind, expected, evidence, reason):
        out.append({"donor_id": donor_id, "kind": kind, "cadence": cadence,
                    "expected_date": expected.isoformat() if expected else None,
                    "days_late": (as_of - expected).days if expected else None,
                    "last_gift": good[-1]["gift_date"] if good else None,
                    "evidence": evidence, "reason": reason})

    # failed: a failed gift with no good gift after it
    # a good gift on the same day doesn't clear a declined charge: only a later good gift does
    failed = [g for g in gifts if is_failed(g) and (not good or g["gift_date"] >= good[-1]["gift_date"])]
    if failed:
        g = failed[-1]
        alert("failed", date.fromisoformat(g["gift_date"]), [g["id"] for g in failed],
              f"gift on {g['gift_date']} recorded as failed")

    if cadence is None:
        return out

    # failed: a monthly series that skipped a month recently
    if cadence == "monthly" and not failed:
        for a, b, ga, gb in zip(dates, dates[1:], good, good[1:]):
            if (b - a).days > MISSED_MONTH_GAP and (as_of - b).days <= RECENT_GAP_DAYS:
                missed = add_months(a, 1)
                alert("failed", missed, [ga["id"], gb["id"]], f"monthly gift missed around {missed.isoformat()}")

    # late: the next expected gift + grace has passed (unless a failed charge already explains it)
    expected = expected_after(dates[-1], cadence)
    if not failed and expected and as_of > expected + timedelta(days=grace_days(cadence)):
        alert("late", expected, [g["id"] for g in good[-3:]],
              f"{cadence.replace('_gmd', ' (Give Miami Day)')} giver; next gift was due {expected.isoformat()}")
    return out


def alerts(conn: sqlite3.Connection, as_of: date | None = None) -> list[dict]:
    """Every late or failed regular gift as of `as_of` (default $SCORE_AS_OF / the demo date).

    Failed first, then most days late.
    """
    as_of = as_of or default_as_of()
    names = {r["id"]: r["full_name"] for r in conn.execute("SELECT id, full_name FROM donors")}
    has_status = any(c["name"] == "status" for c in conn.execute("PRAGMA table_info(gifts)"))
    columns = "id, donor_id, amount, gift_date, channel, source_row" + (", status" if has_status else "")
    by_donor: dict[int, list[dict]] = {}
    for r in conn.execute(f"SELECT {columns} FROM gifts"):
        by_donor.setdefault(r["donor_id"], []).append(dict(r))
    found = [{**a, "donor": names.get(donor_id)}
             for donor_id, gifts in by_donor.items() for a in donor_alerts(donor_id, gifts, as_of)]
    found.sort(key=lambda a: (a["kind"] != "failed", -(a["days_late"] or 0), a["donor_id"]))
    return found


def get_conn():
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


@router.get("/alerts")
def list_alerts(as_of: date | None = Query(None), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    """GET /alerts?as_of=YYYY-MM-DD → late and failed regular gifts."""
    return alerts(conn, as_of)


def main() -> None:
    parser = argparse.ArgumentParser(description="List late and failed regular gifts")
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: $SCORE_AS_OF or the demo date)")
    args = parser.parse_args()
    conn = db.connect()
    found = alerts(conn, date.fromisoformat(args.as_of) if args.as_of else None)
    conn.close()
    print(json.dumps(found, indent=2, ensure_ascii=False))
    print(f"{len(found)} alert(s)")


if __name__ == "__main__":
    main()
