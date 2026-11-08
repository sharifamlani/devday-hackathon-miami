"""Home screen data (plan §21 B13): the "Today at a glance" counts and the CRM attention list.

GET /home/summary           {gifts_at_risk, duplicates, tasks_today, next_event {title, date, days},
                            reached_today, suggestions[3]}
GET /people/attention?limit=6   [{id, name, initials, line, badge}], one of each badge in turn (failed, skipped, late,
                                 new, not_yet, thanked), so a short list shows a mix rather than only alerts

Both take ?as_of=YYYY-MM-DD (default $SCORE_AS_OF or the demo date, like scoring and targets). Pure Python over
SQLite, no LLM. tasks_today reads service/tasks.py (the list GET /tasks?due=today serves); reached_today adds
call_notes people to outbox sends. If either table is missing the count is 0 / outbox-only.
Declined and failed charges are never gifts, so they never make a donor "new" or hide a lapse.

main.py mounts this router:

    from service.routes_home import router as home_router
    app.include_router(home_router)
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query

from service import gift_alerts, score, targets, tasks
from service.routes_data import get_conn

router = APIRouter(tags=["home"])

NEW_DONOR_DAYS = 30
BADGE_ORDER = ("failed", "skipped", "late", "new", "not_yet", "thanked")   # also the priority when a donor fits several


def _short_date(iso: str, today: date | None = None) -> str:
    """'Nov 21', or 'Nov 21, 2024' when the year isn't today's: without it, a due date two years back read
    as a future date ("due Nov 21 (717 days late)")."""
    d = date.fromisoformat(iso[:10])
    return f"{d.strftime('%b')} {d.day}" + ("" if today is None or d.year == today.year else f", {d.year}")


def _initials(name: str, donor_type: str | None) -> str:
    words = [w for w in name.replace("-", " ").split() if w[:1].isalpha()]
    if not words:
        return "?"
    if len(words) == 1:
        return words[0][0].upper()
    last = words[1] if donor_type == "organization" else words[-1]
    return (words[0][0] + last[0]).upper()


# ---- /home/summary --------------------------------------------------------------------------------------------

def tasks_today(conn: sqlite3.Connection, today: date) -> int:
    """Open tasks on today's list: the same rows GET /tasks?due=today shows (due today, overdue, or undated;
    soft-deleted and done ones excluded). 0 when the tasks table is missing."""
    if not targets.has_table(conn, "tasks"):
        return 0
    return sum(1 for t in tasks.list_tasks(conn, due="today", as_of=today) if not t["done"])


def next_event(conn: sqlite3.Connection, today: date) -> dict | None:
    """The soonest upcoming event on the calendar or Give Miami Day, whichever comes first (an event wins a tie)."""
    candidates: list[tuple[str, int, str]] = []
    if targets.has_table(conn, "events"):
        for r in conn.execute(
                "SELECT title, substr(starts_at, 1, 10) AS day FROM events "
                "WHERE substr(starts_at, 1, 10) >= ? AND status != 'past' ORDER BY starts_at, id LIMIT 1",
                (today.isoformat(),)):
            candidates.append((r["day"], 0, r["title"]))
    gmd = score.GIVE_MIAMI_DAY.get(today.year)
    if gmd is not None and gmd >= today:
        candidates.append((gmd.isoformat(), 1, "Give Miami Day"))
    if not candidates:
        return None
    day, _, title = min(candidates)
    return {"title": title, "date": day, "days": (date.fromisoformat(day) - today).days}


def suggestions(conn: sqlite3.Connection, at_risk: int, duplicates: int) -> list[str]:
    """Three short chips for the chat box, derived from today's data."""
    newest = conn.execute("SELECT full_name FROM donors ORDER BY id DESC LIMIT 1").fetchone()
    first = f"Enrich {newest['full_name']}" if newest else "Add your first donors"
    if at_risk:
        second = "Who's late on a usual gift?"
    elif duplicates:
        second = "Review possible duplicates"
    else:
        second = "Who should I thank this week?"
    return [first, second, "Plan next week"]


@router.get("/home/summary")
def home_summary(as_of: date | None = Query(None), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    today = as_of or score.default_as_of()
    at_risk = len(gift_alerts.alerts(conn, today))
    duplicates = conn.execute("SELECT COUNT(*) FROM duplicate_suggestions WHERE status = 'pending'").fetchone()[0]
    return {
        "gifts_at_risk": at_risk,
        "duplicates": duplicates,
        "tasks_today": tasks_today(conn, today),
        "next_event": next_event(conn, today),
        "reached_today": targets.reached_today(conn, today),
        "suggestions": suggestions(conn, at_risk, duplicates),
    }


# ---- /people/attention ----------------------------------------------------------------------------------------

def _thanked(conn: sqlite3.Connection, today: date) -> dict[int, str]:
    """{donor_id: latest sent_at} for thank-you campaign messages sent in the calendar quarter of `today`."""
    start, end, _, _ = targets.period_bounds("quarter", today)
    if not (targets.has_table(conn, "campaign_messages") and targets.has_table(conn, "campaigns")):
        return {}
    rows = conn.execute(
        "SELECT cm.donor_id, MAX(COALESCE(o.sent_at, cm.sent_at)) AS sent "
        "FROM campaign_messages cm JOIN campaigns c ON c.id = cm.campaign_id "
        "LEFT JOIN outbox o ON o.campaign_message_id = cm.id "
        "WHERE c.intent = 'thank_you' AND (cm.status = 'sent' OR o.id IS NOT NULL) "
        "AND date(COALESCE(o.sent_at, cm.sent_at)) BETWEEN ? AND ? GROUP BY cm.donor_id",
        (start.isoformat(), end.isoformat()))
    return {r["donor_id"]: r["sent"] for r in rows if r["sent"]}


def attention(conn: sqlite3.Connection, today: date, limit: int = 6) -> list[dict]:
    """People who need a look, one badge each: failed, late (gift alerts), new (first gift under 30 days ago),
    not_yet (past donor, no gift this year), thanked (a thank-you went out this quarter)."""
    donors = {r["id"]: r for r in conn.execute("SELECT id, full_name, donor_type FROM donors")}
    ok = targets._counted(conn)
    today_s = today.isoformat()
    stats: dict[int, dict] = {}      # per donor: first gift date + amount, last gift date, lifetime total
    for r in conn.execute("SELECT donor_id, amount, gift_date FROM gifts WHERE gift_date <= ?" + ok +
                          " ORDER BY gift_date, id", (today_s,)):
        st = stats.setdefault(r["donor_id"], {"first_date": r["gift_date"], "first_amount": r["amount"], "lifetime": 0.0})
        st["last_date"] = r["gift_date"]
        st["lifetime"] += r["amount"]

    # badge -> [(donor_id, line)] in display order; a donor keeps only the first badge taken (BADGE_ORDER priority)
    picked: dict[str, list[tuple]] = {b: [] for b in BADGE_ORDER}
    taken: set[int] = set()

    def take(badge: str, donor_id: int, line: str) -> None:
        if donor_id in donors and donor_id not in taken:
            taken.add(donor_id)
            picked[badge].append((donor_id, line))

    alerts = gift_alerts.alerts(conn, today)         # failed first, then most days late
    for a in alerts:
        who = (a["cadence"] or "").replace("_gmd", " Give Miami Day")
        if a["kind"] == "failed" and a["last_gift"] and a["last_gift"] > a["expected_date"]:
            line = f"Skipped a {who or 'regular'} gift around {_short_date(a['expected_date'], today)}"
            # A missed month that giving resumed after: "skipped", not a failed card.
            take("skipped", a["donor_id"], line)
            continue
        elif a["kind"] == "failed":
            line = f"{(who[:1].upper() + who[1:]) + ' gift' if who else 'Gift'} due {_short_date(a['expected_date'], today)} didn't go through"
            if a["last_gift"]:
                line += f"; last good gift {_short_date(a['last_gift'], today)}"
        else:
            line = f"{(who[:1].upper() + who[1:])} giver, due {_short_date(a['expected_date'], today)} ({a['days_late']} days late)"
        take(a["kind"], a["donor_id"], line)

    cutoff = (today - timedelta(days=NEW_DONOR_DAYS)).isoformat()
    for donor_id, s in sorted(stats.items(), key=lambda kv: (kv[1]["first_date"], kv[0]), reverse=True):
        if s["first_date"] > cutoff:
            take("new", donor_id, f"First gift ${s['first_amount']:,.0f} on {_short_date(s['first_date'], today)}")

    year_start = date(today.year, 1, 1).isoformat()
    lapsed = sorted(((d, s) for d, s in stats.items() if s["last_date"] < year_start),
                    key=lambda ds: (-ds[1]["lifetime"], ds[0]))
    for donor_id, s in lapsed:
        take("not_yet", donor_id,
             f"Gave ${s['lifetime']:,.0f} before; nothing yet in {today.year}. Last gift {_short_date(s['last_date'], today)}")

    for donor_id, sent in sorted(_thanked(conn, today).items(), key=lambda kv: (kv[1], kv[0]), reverse=True):
        take("thanked", donor_id, f"Thank-you sent {_short_date(sent, today)}")

    # One of each badge in turn (BADGE_ORDER), then the next of each: the tile's 6 rows show a mix.
    out = []
    turn = 0   # index into every badge's list; stops as soon as `limit` rows are in
    while len(out) < limit and any(turn < len(picked[b]) for b in BADGE_ORDER):
        for badge in BADGE_ORDER:
            if turn >= len(picked[badge]) or len(out) >= limit:
                continue
            donor_id, line = picked[badge][turn]
            d = donors[donor_id]
            out.append({"id": donor_id, "name": d["full_name"], "initials": _initials(d["full_name"], d["donor_type"]),
                        "line": line, "badge": badge})
        turn += 1
    return out


@router.get("/people/attention")
def people_attention(limit: int = Query(6, ge=1, le=50), as_of: date | None = Query(None),
                     conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return attention(conn, as_of or score.default_as_of(), limit)
