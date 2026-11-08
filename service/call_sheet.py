"""The call sheet (agent call protocol): what staff need in front of them before dialing a person.

build(conn, donor_id) -> a plain dict with "kind": "call_sheet", shown as a card in the agent panel next to a
Call button. Everything in it comes from the db; the talking points are written from those same facts only, never
by a model, so nothing on the sheet is invented. The phone number is masked (***-***-0104): the Call button
resolves the real number server-side. LookupError for an unknown person.
"""

from __future__ import annotations

import sqlite3
from collections import Counter

from service import phone as phone_module
from service.routes_campaigns import mask_address

MAX_POINTS = 3
MAX_NOTES = 2
MAX_FACTS = 4


def money(amount: float) -> str:
    return f"${amount:,.0f}" if float(amount).is_integer() else f"${amount:,.2f}"


def giving(conn: sqlite3.Connection, donor_id: int) -> tuple[dict, list[dict]]:
    """(relationship summary of gifts that went through, declined/failed charges kept apart)."""
    rows = [dict(r) for r in conn.execute(
        "SELECT amount, gift_date, channel, COALESCE(status, 'ok') AS status FROM gifts WHERE donor_id = ? "
        "ORDER BY gift_date, id", (donor_id,))]
    ok = [g for g in rows if g["status"] == "ok"]
    declined = [{"date": g["gift_date"], "amount": g["amount"], "status": g["status"]}
                for g in rows if g["status"] in ("declined", "failed")]
    channels = Counter(g["channel"] for g in ok if g["channel"])
    rel = {
        "gift_count": len(ok),
        "total": round(sum(g["amount"] for g in ok), 2),
        "first_gift": {"date": ok[0]["gift_date"], "amount": ok[0]["amount"]} if ok else None,
        "last_gift": {"date": ok[-1]["gift_date"], "amount": ok[-1]["amount"]} if ok else None,
        "usual_channel": channels.most_common(1)[0][0] if channels else None,
    }
    return rel, declined


def talking_points(sheet: dict) -> list[str]:
    """Up to three suggestions, each built from a field already on the sheet, in order of what matters most."""
    rel, name = sheet["relationship"], sheet["name"]
    points: list[str] = []
    if sheet["declined_charges"]:
        d = sheet["declined_charges"][-1]
        points.append(f"Ask gently about the {money(d['amount'])} charge on {d['date']} that didn't go through "
                      f"({d['status']}) and how they'd like to continue.")
    for n in sheet["recent_calls"]:
        if n["next_steps"]:
            points.append(f"Follow up on the last call ({n['date']}): {n['next_steps'][0]}")
            break
    if rel["last_gift"]:
        g = rel["last_gift"]
        points.append(f"Thank {name} for the {money(g['amount'])} gift on {g['date']}"
                      + (f" (by {rel['usual_channel']})" if rel["usual_channel"] else "") + ".")
        if rel["gift_count"] > 1:
            points.append(f"Acknowledge {rel['gift_count']} gifts totaling {money(rel['total'])} since "
                          f"{rel['first_gift']['date'][:4]}.")
    else:
        points.append(f"No gifts on record: introduce the Foundation and ask what brought {name} to us.")
    if sheet["interests"]:
        points.append(f"Ask what draws them to {', '.join(sheet['interests'][:2])}.")
    if sheet["open_tasks"]:
        t = sheet["open_tasks"][0]
        points.append(f"Cover the open task: {t['title']}" + (f" (due {t['due']})" if t["due"] else "") + ".")
    if sheet["facts"]:
        points.append(f"Open with something you know: {sheet['facts'][0]['fact']}")
    return points[:MAX_POINTS]


def build(conn: sqlite3.Connection, donor_id: int) -> dict:
    row = conn.execute("SELECT id, full_name, org_name, donor_type, phone, city, state FROM donors WHERE id = ?",
                       (donor_id,)).fetchone()
    if row is None:
        raise LookupError(f"person {donor_id} not found")
    number = phone_module.e164(row["phone"])
    rel, declined = giving(conn, donor_id)
    interests = [r["label"] for r in conn.execute(
        "SELECT t.label FROM donor_interests i JOIN interest_tags t ON t.slug = i.tag "
        "WHERE i.donor_id = ? AND i.status = 'active' ORDER BY i.id", (donor_id,))]
    calls = []
    for n in db_call_notes(conn, donor_id):
        calls.append({"date": (n["created_at"] or "")[:10], "title": n["title"],
                      "summary": (n["summary"] or [])[:2], "next_steps": (n["next_steps"] or [])[:2]})
    tasks = [{"id": r["id"], "title": r["title"], "due": r["due"]} for r in conn.execute(
        "SELECT id, title, due FROM tasks WHERE person_id = ? AND done = 0 AND deleted_at IS NULL "
        "ORDER BY due IS NULL, due, id", (donor_id,))]
    facts = [{"fact": r["fact"], "source_url": r["source_url"]} for r in conn.execute(
        "SELECT fact, source_url FROM research_facts WHERE donor_id = ? ORDER BY retrieved_at DESC, id DESC LIMIT ?",
        (donor_id, MAX_FACTS))]
    sheet = {
        "kind": "call_sheet",
        "person_id": donor_id,
        "name": row["full_name"] or row["org_name"] or f"person {donor_id}",
        "donor_type": row["donor_type"],
        "org_name": row["org_name"],
        "location": ", ".join(x for x in (row["city"], row["state"]) if x) or None,
        "has_phone": number is not None,
        "phone_masked": mask_address(number, "text") if number else None,
        "relationship": rel,
        "declined_charges": declined,
        "interests": interests,
        "recent_calls": calls,
        "open_tasks": tasks,
        "facts": facts,
    }
    sheet["talking_points"] = talking_points(sheet)
    return sheet


def db_call_notes(conn: sqlite3.Connection, donor_id: int) -> list[dict]:
    from service import db
    return db.list_call_notes(conn, donor_id=donor_id, limit=MAX_NOTES)


def summary_line(sheet: dict) -> str:
    rel = sheet["relationship"]
    gifts = f"{rel['gift_count']} gift{'s' if rel['gift_count'] != 1 else ''}, {money(rel['total'])}"
    return f"call sheet for {sheet['name']}: {gifts}" + ("" if sheet["has_phone"] else " (no phone number)")
