"""The chat agent's writes that aren't tasks (plan.md §21.2.5, B10). Each returns (result, undo_token).

Tasks and calendar items are written by service.tasks (3a), which logs them in `agent_actions` itself.
Everything here logs into the same table with its own target prefix, and undo(token) reverts any of them:

    task:12              -> service.tasks.undo
    int_...              -> service.interests.undo (42's interest writes)
    donor:5              update_person: restores the changed fields; add_contact: deletes it if unreferenced
    duplicate:7          dismiss_duplicate: back to 'pending'
    merge:3              merge_duplicate: dedupe.undo_merge (the merge log keeps both rows)
    rsvp:<event>:<id>    rsvp_event: restores the previous answer
    note:<id>            context_notes add/delete: removes the note, or puts it back (3a)
    event:<id>           events_crud add/update/move/delete (calendar v3): removes, restores or puts it back (3a)

The same functions back the screens' buttons and the agent's tools; the agent passes actor="agent".
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from service import dedupe

# Fields a person edit may change (donors). contact_type moves a person between the three tabs.
PERSON_FIELDS = ("first_name", "last_name", "full_name", "org_name", "email", "phone", "city", "state",
                 "notes", "contact_type", "has_dog")
CONTACT_TYPES = ("giver", "neighbor", "community")
RSVPS = ("yes", "no", "maybe")


class WriteError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _cols(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def _log(conn: sqlite3.Connection, actor: str, action: str, target: str, before, after) -> str:
    token = uuid.uuid4().hex
    conn.execute("INSERT INTO agent_actions (token, actor, action, target, before, after, created_at) "
                 "VALUES (?, ?, ?, ?, ?, ?, ?)",
                 (token, actor, action, target, json.dumps(before) if before is not None else None,
                  json.dumps(after) if after is not None else None, _now()))
    return token


# ---------- writes ----------

DONOR_TYPES = ("individual", "organization")
# Rows other code derives from every donor; they don't count as "something references this contact"
DERIVED = ("donor_scores", "duplicate_suggestions")


def known_name(name: str) -> str:
    """The exact name Enrich's interest cache knows, when the given name points at exactly one of them
    ("Knight Foundation" -> "John S. and James L. Knight Foundation"); the name as given when none match.
    Several matches is ambiguous: ask, never guess."""
    from service.enrich_agent import read_interest_cache
    known = list(read_interest_cache())
    exact = [k for k in known if k.lower() == name.lower()]
    if exact:
        return exact[0]
    hits = [k for k in known if name.lower() in k.lower()]
    if len(hits) > 1:
        raise WriteError(f"which one did you mean: {' or '.join(hits)}?")
    return hits[0] if hits else name


def add_contact(conn: sqlite3.Connection, full_name: str, donor_type: str = "individual",
                contact_type: str = "giver", email: str | None = None, phone: str | None = None,
                city: str | None = None, notes: str | None = None, actor: str = "staff") -> tuple[dict, str]:
    """Create a person with no gifts through db.insert_donor (the same writer the seed and imports use).

    Organizations get donor_type 'organization' and org_name, so Enrich researches them as organizations.
    """
    from service import db

    name = (full_name or "").strip()
    if not name:
        raise WriteError("a contact needs a name")
    name = known_name(name)
    if donor_type not in DONOR_TYPES:
        raise WriteError(f"donor_type must be one of {', '.join(DONOR_TYPES)}")
    if contact_type not in CONTACT_TYPES:
        raise WriteError(f"contact_type must be one of {', '.join(CONTACT_TYPES)}")
    org = donor_type == "organization"
    first, _, last = name.partition(" ")
    person_id = db.insert_donor(conn, {
        "full_name": name, "org_name": name if org else None, "donor_type": donor_type,
        "first_name": None if org else first, "last_name": None if org else (last or None),
        "email": email, "emails_all": [email] if email else [], "phone": phone, "city": city, "notes": notes,
        "contact_type": contact_type, "source_row": "AGENT" if actor == "agent" else "STAFF"})
    row = {"id": person_id, "full_name": name, "donor_type": donor_type, "contact_type": contact_type}
    token = _log(conn, actor, "add_contact", f"donor:{person_id}", None, row)
    conn.commit()
    return {"person_id": person_id, **row}, token


def references(conn: sqlite3.Connection, person_id: int) -> list[str]:
    """Tables (other than derived ones) holding rows that point at this person."""
    found = []
    for (table,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"):
        if table in DERIVED or table == "donors":
            continue
        for fk in conn.execute(f"PRAGMA foreign_key_list({table})"):
            if fk[2] == "donors" and conn.execute(
                    f"SELECT 1 FROM {table} WHERE {fk[3]} = ? LIMIT 1", (person_id,)).fetchone():
                found.append(table)
    return sorted(set(found))

def update_person(conn: sqlite3.Connection, person_id: int, fields: dict, actor: str = "staff") -> tuple[dict, str]:
    """Change some of a person's fields. Unknown fields are refused, never silently dropped."""
    unknown = sorted(set(fields) - set(PERSON_FIELDS))
    if unknown:
        raise WriteError(f"can't change {', '.join(unknown)}; allowed: {', '.join(PERSON_FIELDS)}")
    have = _cols(conn, "donors")
    missing = sorted(set(fields) - have)
    if missing:
        raise WriteError(f"{', '.join(missing)} not available yet")
    if fields.get("contact_type") not in (None, *CONTACT_TYPES):
        raise WriteError(f"contact_type must be one of {', '.join(CONTACT_TYPES)}")
    if not fields:
        raise WriteError("nothing to change")
    row = conn.execute(f"SELECT id, {', '.join(fields)} FROM donors WHERE id = ?", (person_id,)).fetchone()
    if row is None:
        raise WriteError(f"person {person_id} not found")
    before = {k: row[k] for k in fields}
    conn.execute(f"UPDATE donors SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                 [*fields.values(), person_id])
    token = _log(conn, actor, "update_person", f"donor:{person_id}", before, dict(fields))
    conn.commit()
    return {"person_id": person_id, "before": before, "after": dict(fields)}, token


def dismiss_duplicate(conn: sqlite3.Connection, suggestion_id: int, actor: str = "staff") -> tuple[dict, str]:
    row = conn.execute("SELECT status FROM duplicate_suggestions WHERE id = ?", (suggestion_id,)).fetchone()
    if row is None:
        raise WriteError(f"duplicate suggestion {suggestion_id} not found")
    dedupe.dismiss(conn, suggestion_id)
    token = _log(conn, actor, "dismiss_duplicate", f"duplicate:{suggestion_id}", {"status": row["status"]},
                 {"status": "dismissed"})
    conn.commit()
    from service import tasks
    tasks.generate_safely(conn, "dismiss")    # its review task retires
    return {"suggestion_id": suggestion_id, "status": "dismissed"}, token


def merge_duplicate(conn: sqlite3.Connection, suggestion_id: int, keep_id: int | None = None,
                    approved_by: str | None = None, actor: str = "staff") -> tuple[dict, str]:
    """Merge a suggested pair (approval-gated in the chat). Reversible through the merge log."""
    try:
        result = dedupe.merge(conn, suggestion_id, keep_id, approved_by)
    except (LookupError, ValueError) as e:
        raise WriteError(str(e))
    merge_id = result.get("merge_id")
    token = _log(conn, actor, "merge_duplicate", f"merge:{merge_id}", {"suggestion_id": suggestion_id},
                 {"kept_donor_id": result.get("kept_donor_id"), "merge_id": merge_id})
    conn.commit()
    from service import tasks
    tasks.generate_safely(conn, "merge")
    return result, token


def rsvp_event(conn: sqlite3.Connection, event_id: int, person_id: int, rsvp: str,
               actor: str = "staff") -> tuple[dict, str]:
    if rsvp not in RSVPS:
        raise WriteError(f"rsvp must be one of {', '.join(RSVPS)}")
    if "rsvp" not in _cols(conn, "event_audience"):
        raise WriteError("RSVPs are not available yet")
    row = conn.execute("SELECT rsvp FROM event_audience WHERE event_id = ? AND person_id = ?",
                       (event_id, person_id)).fetchone()
    if row is None:
        raise WriteError(f"person {person_id} is not in event {event_id}'s audience")
    conn.execute("UPDATE event_audience SET rsvp = ? WHERE event_id = ? AND person_id = ?", (rsvp, event_id, person_id))
    token = _log(conn, actor, "rsvp_event", f"rsvp:{event_id}:{person_id}", {"rsvp": row["rsvp"]}, {"rsvp": rsvp})
    conn.commit()
    person = conn.execute("SELECT full_name FROM donors WHERE id = ?", (person_id,)).fetchone()
    event = conn.execute("SELECT title, starts_at FROM events WHERE id = ?", (event_id,)).fetchone()
    return {"event_id": event_id, "person_id": person_id, "rsvp": rsvp,
            "full_name": person["full_name"] if person else None,
            "event_title": event["title"] if event else None,
            "starts_at": event["starts_at"] if event else None}, token


# ---------- undo ----------

def event_deleted_since(conn: sqlite3.Connection, action: sqlite3.Row) -> bool:
    """A later delete_event on the same event, not undone, and the event is gone."""
    later = conn.execute("SELECT 1 FROM agent_actions WHERE target = ? AND id > ? AND action = 'delete_event' "
                         "AND undone_at IS NULL", (action["target"], action["id"])).fetchone()
    event_id = int(action["target"].split(":", 1)[1])
    return bool(later) and conn.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None


def undo(conn: sqlite3.Connection, token: str) -> dict:
    """Revert one logged write, whichever kind it was."""
    if token.startswith("int_"):                     # 42's interest writes keep their own undo record
        from service import interests
        try:
            return interests.undo(conn, token)
        except (ValueError, LookupError) as e:
            raise WriteError(str(e))
    from service import tasks                        # its NotFound / UndoConflict keep POST /undo's 404 / 409
    action = conn.execute("SELECT * FROM agent_actions WHERE token = ?", (token,)).fetchone()
    if action is None:
        raise tasks.NotFound("unknown undo token")
    kind, _, ref = action["target"].partition(":")
    if kind == "task":
        return tasks.undo(conn, token)
    if action["undone_at"]:
        raise tasks.UndoConflict("already undone")
    if kind == "event" and action["action"] != "delete_event" and event_deleted_since(conn, action):
        # The add/move Undo on a card whose event was deleted afterwards: nothing to undo, and not an error.
        return {"undone": False, "target": action["target"], "action": action["action"],
                "reason": "the event was deleted afterwards; undo the delete to bring it back"}
    newer = conn.execute("SELECT 1 FROM agent_actions WHERE target = ? AND id > ? AND undone_at IS NULL",
                         (action["target"], action["id"])).fetchone()
    if newer:
        raise tasks.UndoConflict("a later change to the same record must be undone first")
    before = json.loads(action["before"]) if action["before"] else {}
    if kind == "donor" and action["action"] == "add_contact":
        used = references(conn, int(ref))
        if used:
            raise tasks.UndoConflict(f"this contact is already used ({', '.join(used)}); remove those first")
        for table in DERIVED:
            for fk in conn.execute(f"PRAGMA foreign_key_list({table})"):
                if fk[2] == "donors":
                    conn.execute(f"DELETE FROM {table} WHERE {fk[3]} = ?", (int(ref),))
        conn.execute("DELETE FROM donors WHERE id = ?", (int(ref),))
    elif kind == "donor":
        conn.execute(f"UPDATE donors SET {', '.join(f'{k} = ?' for k in before)} WHERE id = ?",
                     [*before.values(), int(ref)])
    elif kind == "duplicate":
        conn.execute("UPDATE duplicate_suggestions SET status = ? WHERE id = ?", (before["status"], int(ref)))
    elif kind == "merge":
        try:
            dedupe.undo_merge(conn, int(ref))
        except (LookupError, ValueError) as e:
            raise WriteError(str(e))
    elif kind == "rsvp":
        event_id, person_id = (int(x) for x in ref.split(":"))
        conn.execute("UPDATE event_audience SET rsvp = ? WHERE event_id = ? AND person_id = ?",
                     (before["rsvp"], event_id, person_id))
    elif kind == "summary":                    # donor_summary.update: put back the paragraph as it was
        from service import donor_summary
        donor_summary.restore(conn, int(ref), before)
    elif kind == "note":
        from service import context_notes
        try:
            context_notes.undo_note(conn, action)
        except context_notes.NoteError as e:
            raise WriteError(str(e))
    elif kind == "event":
        from service import events_crud
        events_crud.undo_event(conn, action)
    else:
        raise WriteError(f"can't undo a {kind} change")
    conn.execute("UPDATE agent_actions SET undone_at = ? WHERE id = ?", (_now(), action["id"]))
    conn.commit()
    if kind in ("merge", "duplicate"):         # the pair is pending again: its review task comes back
        tasks.generate_safely(conn, f"{kind} undo")
    return {"undone": True, "target": action["target"], "action": action["action"]}
