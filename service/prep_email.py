"""Email prep (Sharif, Nov 8): before an email blast, show what we sent these people before, what the Foundation
did since (X, Y, Z: sourced facts from the context store) and what's coming, so the draft can say "since we last
wrote, we did X, Y and Z". Built only from the database: nothing is invented and no model is called here; the
drafts themselves come from draft_email after the person clicks Draft.
"""
from __future__ import annotations

import sqlite3
from datetime import date

MAX_FACTS = 3
MAX_EVENTS = 2


def last_campaign(conn: sqlite3.Connection, person_ids: list[int]) -> dict | None:
    """The newest campaign that actually sent something to any of these people (drafts never sent don't count)."""
    if not person_ids:
        return None
    marks = ", ".join("?" * len(person_ids))
    row = conn.execute(
        f"SELECT c.id, c.name, c.intent, c.channel, c.created_at, "
        f"SUM(m.status = 'sent') AS sent, COUNT(m.id) AS messages FROM campaigns c "
        f"JOIN campaign_messages m ON m.campaign_id = c.id WHERE m.donor_id IN ({marks}) "
        f"GROUP BY c.id HAVING SUM(m.status = 'sent') > 0 ORDER BY c.created_at DESC, c.id DESC LIMIT 1",
        person_ids).fetchone()
    if row is None:
        return None
    return {"name": row["name"], "intent": row["intent"], "channel": row["channel"],
            "date": (row["created_at"] or "")[:10], "sent": row["sent"] or 0, "messages": row["messages"]}


def news_since(conn: sqlite3.Connection, since: str | None) -> list[dict]:
    """The newest sourced facts (newer than the last email when there is one), at most MAX_FACTS."""
    rows = conn.execute(
        "SELECT fact, url, posted_at, source FROM org_context WHERE fact IS NOT NULL AND url IS NOT NULL "
        "AND (? IS NULL OR posted_at > ?) ORDER BY posted_at IS NULL, posted_at DESC, id DESC LIMIT ?",
        (since, since, MAX_FACTS)).fetchall()
    return [{"fact": r["fact"], "url": r["url"], "date": r["posted_at"]} for r in rows]


def coming_up(conn: sqlite3.Connection, today: date) -> list[dict]:
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'events'").fetchone():
        return []
    rows = conn.execute("SELECT title, starts_at FROM events WHERE substr(starts_at, 1, 10) >= ? "
                        "ORDER BY starts_at LIMIT ?", (today.isoformat(), MAX_EVENTS)).fetchall()
    return [{"title": r["title"], "date": r["starts_at"][:10]} for r in rows]


def build(conn: sqlite3.Connection, person_ids: list[int], topic: str, today: date) -> dict:
    """The email-prep card: audience, last time, what we did since (X, Y, Z), what's next, and the angle."""
    ids = list(dict.fromkeys(int(i) for i in person_ids))
    names = []
    if ids:
        marks = ", ".join("?" * len(ids))
        names = [r["full_name"] for r in conn.execute(
            f"SELECT full_name FROM donors WHERE id IN ({marks}) ORDER BY full_name", ids)]
    last = last_campaign(conn, ids)
    facts = news_since(conn, last["date"] if last else None)
    if last and not facts:              # nothing new since the last email: fall back to the newest facts
        facts = news_since(conn, None)
    events = coming_up(conn, today)
    lead = "Since we last wrote" if last else "Here's what we've been doing"
    angle = (f"{lead}: lead with {', '.join(f'({chr(88 + i)})' for i in range(len(facts)))} below"
             if facts else f"{lead}: no new sourced updates on file, so keep it to a thank-you")
    if events:
        angle += f", then invite them to {events[0]['title']} ({events[0]['date']})."
    else:
        angle += "."
    return {"kind": "email_prep", "topic": topic.strip() or "Email", "person_ids": ids,
            "audience": {"count": len(ids), "names": names[:5]},
            "last_time": last, "since": facts, "coming_up": events, "angle": angle}
