"""Propensity score + tier: pure Python, deterministic, no LLM (plan §2 row 3).

The score answers "who do we contact first, today?" It combines four parts of a donor's gift history:

    urgency    55 pts  gap since the last gift vs. that donor's usual cadence, plus a seasonal pattern
                       (a yearly Give Miami Day giver with no gift yet this year is due right now)
    value      25 pts  lifetime giving, log scale ($1M lifetime = full marks)
    frequency  12 pts  number of gifts (5+ = full marks)
    engagement  8 pts  gave within the last ~13 months, fading to 0 at 3 years

`why` is structured JSON so the UI and the outreach agent can phrase it; the LLM explains the number,
it never computes it.

    python -m service.score              # rescore every donor as of $SCORE_AS_OF or the demo date
    python -m service.score --as-of 2026-11-07
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
from collections import Counter
from datetime import date, datetime, timezone
from statistics import median

WEIGHTS = {"urgency": 55, "value": 25, "frequency": 12, "engagement": 8}

STAR_LIFETIME = 1_000_000      # Ruth and Richard Shack Society level (plan §11)
BIG_LIFETIME = 25_000
BIG_SINGLE_GIFT = 10_000
MID_LIFETIME = 1_000
DEFAULT_CADENCE_DAYS = 365     # a donor with one gift is assumed to be a yearly giver

GIVE_MIAMI_DAY = {2023: date(2023, 11, 16), 2024: date(2024, 11, 21),
                  2025: date(2025, 11, 20), 2026: date(2026, 11, 19)}
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]


DEMO_AS_OF = date(2026, 11, 8)  # demo day (Sun); Give Miami Day is then 11 days away


def default_as_of() -> date:
    """SCORE_AS_OF overrides; otherwise the pinned demo date, so the stage numbers never drift."""
    pinned = os.environ.get("SCORE_AS_OF")
    return date.fromisoformat(pinned) if pinned else DEMO_AS_OF


def _ramp(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    """Linear interpolation of y between (x0, y0) and (x1, y1), clamped to the ends."""
    if x <= x0:
        return y0
    if x >= x1:
        return y1
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def cadence_urgency(ratio: float) -> float:
    """0-1 urgency from days-since-last-gift / usual cadence.

    < 0.85  on track, not due yet (low)   0.85-1.0  coming due          1.0-1.5  overdue (peak)
    1.5-3   lapsing, fading               > 3       lapsed: still worth a note, not first call
    """
    if ratio < 0.85:
        return _ramp(ratio, 0.0, 0.85, 0.0, 0.25)
    if ratio < 1.0:
        return _ramp(ratio, 0.85, 1.0, 0.5, 0.9)
    if ratio <= 1.5:
        return 1.0
    if ratio <= 3.0:
        return _ramp(ratio, 1.5, 3.0, 1.0, 0.4)
    return 0.3


def seasonal_pattern(gift_dates: list[date]) -> int | None:
    """The month a donor habitually gives in: at least 2 gifts and at least half of all gifts in it."""
    if len(gift_dates) < 2:
        return None
    month, count = Counter(d.month for d in gift_dates).most_common(1)[0]
    years = {d.year for d in gift_dates if d.month == month}
    if count >= 2 and len(years) >= 2 and count / len(gift_dates) >= 0.5:
        return month
    return None


def tier_for(lifetime: float, largest: float) -> str:
    if lifetime >= BIG_LIFETIME or largest >= BIG_SINGLE_GIFT:
        return "big"
    if lifetime >= MID_LIFETIME:
        return "mid"
    return "small"


def score_donor(gifts: list[dict], as_of: date) -> dict:
    """Score one donor from their gifts ({amount, gift_date[, channel]}). Gifts after as_of are ignored."""
    history = sorted(
        (date.fromisoformat(g["gift_date"]), float(g["amount"]), g.get("channel"))
        for g in gifts if date.fromisoformat(g["gift_date"]) <= as_of)

    if not history:
        return {"score": 0, "tier": "small", "is_star": False, "status": "no_gifts",
                "why": {"status": "no_gifts", "gift_count": 0, "reasons": ["no_gifts"],
                        "as_of": as_of.isoformat()}}

    dates = [d for d, _, _ in history]
    amounts = [a for _, a, _ in history]
    lifetime = sum(amounts)
    largest = max(amounts)
    last_date, last_amount, last_channel = history[-1]
    days_since = (as_of - last_date).days

    intervals = [(b - a).days for a, b in zip(dates, dates[1:]) if (b - a).days > 0]
    cadence = int(median(intervals)) if intervals else DEFAULT_CADENCE_DAYS
    cadence_basis = "median_interval" if intervals else "assumed_yearly"
    ratio = days_since / cadence if cadence else 0.0

    # Seasonal habit: a donor who gives every November and hasn't yet this year is due now.
    pattern_month = seasonal_pattern(dates)
    gave_this_year = any(d.year == as_of.year for d in dates)
    gave_in_pattern_this_year = pattern_month is not None and any(
        d.year == as_of.year and d.month == pattern_month for d in dates)
    months_until_pattern = (pattern_month - as_of.month) % 12 if pattern_month else None
    seasonal_due = pattern_month is not None and not gave_in_pattern_this_year and months_until_pattern in (0, 1)
    pattern_channels = Counter(c for d, _, c in history if d.month == pattern_month and c) if pattern_month else Counter()
    pattern_channel = pattern_channels.most_common(1)[0][0] if pattern_channels else None

    urgency = cadence_urgency(ratio)
    if seasonal_due:
        urgency = max(urgency, 1.0 if months_until_pattern == 0 else 0.85)

    value = min(1.0, math.log10(max(lifetime, 1.0)) / math.log10(STAR_LIFETIME))
    frequency = min(1.0, len(history) / 5)
    engagement = _ramp(days_since, 400, 3 * 365, 1.0, 0.0)

    parts = {"urgency": urgency, "value": value, "frequency": frequency, "engagement": engagement}
    points = {k: round(WEIGHTS[k] * v, 1) for k, v in parts.items()}
    score = int(round(sum(points.values())))

    if seasonal_due or 1.0 <= ratio <= 3.0:
        status = "lapsing"
    elif ratio > 3.0:
        status = "lapsed"
    elif ratio >= 0.85:
        status = "due"
    else:
        status = "on_track"

    reasons = []
    if seasonal_due:
        reasons.append("missed_seasonal_window" if months_until_pattern == 0 else "seasonal_window_next_month")
    if ratio > 1.0:
        reasons.append("overdue_vs_cadence")
    if status == "on_track":
        reasons.append("gave_recently_vs_cadence")
    if lifetime >= STAR_LIFETIME:
        reasons.append("shack_society_level")
    if len(history) >= 4:
        reasons.append("loyal_repeat_giver")
    if len(history) == 1:
        reasons.append("single_gift")

    gmd = GIVE_MIAMI_DAY.get(as_of.year)
    why = {
        "status": status,
        "reasons": reasons,
        "points": points,
        "gift_count": len(history),
        "lifetime_total": round(lifetime, 2),
        "largest_gift": round(largest, 2),
        "last_gift": {"date": last_date.isoformat(), "amount": round(last_amount, 2), "channel": last_channel},
        "days_since_last_gift": days_since,
        "usual_cadence_days": cadence,
        "cadence_basis": cadence_basis,
        "overdue_ratio": round(ratio, 2),
        "gave_this_year": gave_this_year,
        "pattern": None if pattern_month is None else {
            "month": pattern_month,
            "month_name": MONTH_NAMES[pattern_month - 1],
            "channel": pattern_channel,
            "years": sorted({d.year for d in dates if d.month == pattern_month}),
            "gave_this_year": gave_in_pattern_this_year,
        },
        "days_left_in_year": (date(as_of.year, 12, 31) - as_of).days,
        "give_miami_day": None if gmd is None or gmd < as_of else {
            "date": gmd.isoformat(), "days_away": (gmd - as_of).days},
        "as_of": as_of.isoformat(),
    }
    return {"score": score, "tier": tier_for(lifetime, largest), "is_star": lifetime >= STAR_LIFETIME,
            "status": status, "why": why}


def run(conn: sqlite3.Connection, as_of: date | None = None) -> int:
    """Rescore every donor and replace donor_scores. Returns the number of donors scored."""
    as_of = as_of or default_as_of()
    gifts_by_donor: dict[int, list[dict]] = {}
    for row in conn.execute("SELECT donor_id, amount, gift_date, channel FROM gifts WHERE status = 'ok'"):
        gifts_by_donor.setdefault(row["donor_id"], []).append(dict(row))

    computed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # Only Givers are scored ("call today"); Neighbors and Community have no gift history to rank.
    donor_ids = [r["id"] for r in conn.execute("SELECT id FROM donors WHERE contact_type = 'giver'")]
    conn.execute("DELETE FROM donor_scores")
    for donor_id in donor_ids:
        result = score_donor(gifts_by_donor.get(donor_id, []), as_of)
        conn.execute(
            "INSERT INTO donor_scores (donor_id, score, tier, is_star, status, why, as_of, computed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (donor_id, result["score"], result["tier"], int(result["is_star"]), result["status"],
             json.dumps(result["why"]), as_of.isoformat(), computed_at))
    conn.commit()
    return len(donor_ids)


def main() -> None:
    from service.db import connect

    parser = argparse.ArgumentParser(description="Rescore every donor")
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: $SCORE_AS_OF or 2026-11-08)")
    args = parser.parse_args()
    conn = connect()
    n = run(conn, date.fromisoformat(args.as_of) if args.as_of else None)
    for row in conn.execute(
            "SELECT d.full_name, s.score, s.tier, s.is_star, s.status FROM donor_scores s "
            "JOIN donors d ON d.id = s.donor_id ORDER BY s.score DESC"):
        print(f"{row['score']:>3}  {row['tier']:<5} {'*' if row['is_star'] else ' '} {row['status']:<9} {row['full_name']}")
    print(f"scored {n} donors")


if __name__ == "__main__":
    main()
