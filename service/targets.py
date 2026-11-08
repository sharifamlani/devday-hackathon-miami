"""Monthly and quarterly donation targets: raised vs. goal for the calendar month or quarter of the as-of date.

Pure Python over the `gifts` table, no LLM. Totals are sums of gift rows, and a merge only moves a duplicate's
gifts onto the kept donor_id (dedupe.merge), so merging or undoing a merge never changes `raised`; it only
changes how many distinct donors gave.

Goals are SAMPLE values from service/org_config.json ("targets"): a "default" per period kind, optionally
overridden for one period by a "2026-11" (month) or "2026-Q4" (quarter) key.

    compute(conn, "quarter", date(2026, 11, 8)) ->
    {"period": "quarter", "label": "Q4 2026", "start": "2026-10-01", "end": "2026-12-31", "as_of": "2026-11-08",
     "goal": 150000, "goal_is_sample": true, "raised": 50050.0, "percent": 33.4, "days_left": 53,
     "donors_count": 2, "gifts_count": 2, "by_channel": [{"channel": "check", "amount": 50000.0}, ...],
     "new_vs_returning": {"new": 0, "returning": 2, "new_amount": 0.0, "returning_amount": 50050.0},
     "give_miami_day": {"date": "2026-11-19", "days_until": 11, "in_period": true},
     "top_donor_ids": [...], "donor_ids": [...], "reached_today": 0}

    python -m service.targets            # print both periods as of $SCORE_AS_OF or the demo date

    quarters(conn, date(2026, 11, 8)) ->
    {"quarters": [{"label": "2026-Q1", "start": "2026-01-01", "end": "2026-03-31", "raised": 9400.0}, ...],
     "ytd": {"year": 2026, "raised": 61450.0}}

    reached_today(conn, date(2026, 11, 8))   # distinct people contacted that day: outbox sends + call_notes
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from service import score

ORG_CONFIG = Path(__file__).resolve().parent / "org_config.json"
PERIODS = ("month", "quarter")
TOP_N = 5


def load_goals(path: Path = ORG_CONFIG) -> dict:
    """The "targets" block of org_config.json; {} when the file or key is missing (goals are then null)."""
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    targets = config.get("targets") or {}
    return {k: v for k, v in targets.items() if not k.startswith("_")}


def period_bounds(period: str, as_of: date) -> tuple[date, date, str, str]:
    """(start, end, label, key) of the calendar month or quarter containing as_of.

    key is the org_config override key: "2026-11" for a month, "2026-Q4" for a quarter.
    """
    if period == "month":
        start = as_of.replace(day=1)
        nxt = date(as_of.year + (as_of.month == 12), as_of.month % 12 + 1, 1)
        return (start, nxt - timedelta(days=1), f"{score.MONTH_NAMES[as_of.month - 1]} {as_of.year}",
                f"{as_of.year}-{as_of.month:02d}")
    if period == "quarter":
        q = (as_of.month - 1) // 3 + 1
        start = date(as_of.year, 3 * q - 2, 1)
        end = date(as_of.year, 12, 31) if q == 4 else date(as_of.year, 3 * q + 1, 1) - timedelta(days=1)
        return start, end, f"Q{q} {as_of.year}", f"{as_of.year}-Q{q}"
    raise ValueError(f"period must be one of {PERIODS}, not {period!r}")


def goal_for(period: str, key: str, goals: dict) -> float | None:
    by_period = goals.get(period) or {}
    goal = by_period.get(key, by_period.get("default"))
    return float(goal) if goal is not None else None


def _money(x: float) -> float:
    return round(float(x), 2)


def has_table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _counted(conn: sqlite3.Connection) -> str:
    """SQL fragment that keeps declined and failed charges out of every total (they are not gifts).

    Empty when the gifts table predates the status column. Pledges live outside the gifts table and never count."""
    has_status = any(c[1] == "status" for c in conn.execute("PRAGMA table_info(gifts)"))
    return " AND status = 'ok'" if has_status else ""


def compute(conn: sqlite3.Connection, period: str, as_of: date | None = None, goals: dict | None = None) -> dict:
    """Raised vs. goal for the period containing as_of. Gifts after as_of are not counted (as in score.py)."""
    as_of = as_of or score.default_as_of()
    goals = load_goals() if goals is None else goals
    start, end, label, key = period_bounds(period, as_of)
    counted_to = min(end, as_of)

    ok = _counted(conn)
    rows = conn.execute(
        "SELECT donor_id, amount, channel FROM gifts WHERE gift_date >= ? AND gift_date <= ?" + ok,
        (start.isoformat(), counted_to.isoformat())).fetchall()
    # First gift ever per donor who gave in the period: before the period start means "returning"
    first_gift = {r[0]: r[1] for r in conn.execute(
        "SELECT donor_id, MIN(gift_date) FROM gifts WHERE donor_id IN "
        "(SELECT donor_id FROM gifts WHERE gift_date >= ? AND gift_date <= ?" + ok + ")" + ok + " GROUP BY donor_id",
        (start.isoformat(), counted_to.isoformat()))}

    by_donor: dict[int, float] = {}
    by_channel: dict[str, float] = {}
    for r in rows:
        by_donor[r["donor_id"]] = by_donor.get(r["donor_id"], 0.0) + r["amount"]
        channel = (r["channel"] or "").strip() or "unspecified"
        by_channel[channel] = by_channel.get(channel, 0.0) + r["amount"]

    raised = sum(by_donor.values())
    new = [d for d in by_donor if first_gift[d] >= start.isoformat()]
    returning = [d for d in by_donor if first_gift[d] < start.isoformat()]
    donor_ids = sorted(by_donor, key=lambda d: (-by_donor[d], d))
    goal = goal_for(period, key, goals)

    gmd = score.GIVE_MIAMI_DAY.get(as_of.year)
    return {
        "period": period,
        "label": label,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "as_of": as_of.isoformat(),
        "goal": goal,
        "goal_is_sample": bool(goals.get("is_sample", True)),
        "raised": _money(raised),
        "percent": round(raised / goal * 100, 1) if goal else None,
        "days_left": max((end - as_of).days, 0),
        "donors_count": len(by_donor),
        "gifts_count": len(rows),
        "by_channel": [{"channel": c, "amount": _money(a)}
                       for c, a in sorted(by_channel.items(), key=lambda kv: (-kv[1], kv[0]))],
        "new_vs_returning": {"new": len(new), "returning": len(returning),
                             "new_amount": _money(sum(by_donor[d] for d in new)),
                             "returning_amount": _money(sum(by_donor[d] for d in returning))},
        "give_miami_day": None if gmd is None or gmd < as_of else {
            "date": gmd.isoformat(), "days_until": (gmd - as_of).days, "in_period": start <= gmd <= end},
        "top_donor_ids": donor_ids[:TOP_N],
        "donor_ids": donor_ids,
        "reached_today": reached_today(conn, as_of),
    }


def compute_all(conn: sqlite3.Connection, as_of: date | None = None, goals: dict | None = None) -> dict:
    """{"month": compute(...), "quarter": compute(...)}"""
    goals = load_goals() if goals is None else goals
    return {p: compute(conn, p, as_of, goals) for p in PERIODS}


def quarters(conn: sqlite3.Connection, as_of: date | None = None) -> dict:
    """Money raised in each quarter of the as-of year, plus year to date (sums of gift rows; no goals).

    Declined and failed charges are excluded, gifts after as_of are not counted, and a quarter that hasn't
    started yet is 0. Quarter labels read "2026-Q3"."""
    as_of = as_of or score.default_as_of()
    ok = _counted(conn)
    out = []
    for q in range(1, 5):
        start, end, _, key = period_bounds("quarter", date(as_of.year, 3 * q - 2, 1))
        raised = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM gifts WHERE gift_date >= ? AND gift_date <= ?" + ok,
            (start.isoformat(), min(end, as_of).isoformat())).fetchone()[0] if start <= as_of else 0
        out.append({"label": key, "start": start.isoformat(), "end": end.isoformat(), "raised": _money(raised)})
    return {"quarters": out, "ytd": {"year": as_of.year, "raised": _money(sum(q["raised"] for q in out))}}


def reached_today(conn: sqlite3.Connection, today: date | None = None) -> int:
    """Distinct people contacted on `today`: outbox sends plus saved call notes (once that table exists)."""
    day = (today or score.default_as_of()).isoformat()
    people: set[int] = set()
    if has_table(conn, "outbox"):
        people |= {r[0] for r in conn.execute(
            "SELECT DISTINCT donor_id FROM outbox WHERE donor_id IS NOT NULL AND date(sent_at) = ?", (day,))}
    if has_table(conn, "call_notes"):
        # a note is addressed to people through destinations JSON [{kind: donor|group|project, id, label}];
        # only kind "donor" is a person (the id is a donors.id, sometimes stored as text)
        for (destinations,) in conn.execute("SELECT destinations FROM call_notes WHERE date(created_at) = ?", (day,)):
            try:
                items = json.loads(destinations or "[]")
            except ValueError:
                continue
            for item in items if isinstance(items, list) else []:
                if isinstance(item, dict) and item.get("kind") == "donor":
                    try:
                        people.add(int(item["id"]))
                    except (KeyError, TypeError, ValueError):
                        pass
    return len(people)


def main() -> None:
    from service.db import connect

    conn = connect()
    for p, t in compute_all(conn).items():
        pct = f"{t['percent']}%" if t["percent"] is not None else "no goal"
        print(f"{t['label']}: ${t['raised']:,.0f} of ${t['goal'] or 0:,.0f} ({pct}), {t['days_left']} days left, "
              f"{t['donors_count']} donors / {t['gifts_count']} gifts")
    conn.close()


if __name__ == "__main__":
    main()
