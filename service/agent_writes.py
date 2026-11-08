"""The chat agent's writes that aren't tasks (plan.md §21.2.5, B10). Each returns (result, undo_token).

Tasks and calendar items are written by service.tasks (3a), which logs them in `agent_actions` itself.
Everything here logs into the same table with its own target prefix, and undo(token) reverts any of them:

    task:12              -> service.tasks.undo
    int_...              -> service.interests.undo (42's interest writes)
    donor:5              update_person: restores the changed fields
    duplicate:7          dismiss_duplicate: back to 'pending'
    merge:3              merge_duplicate: dedupe.undo_merge (the merge log keeps both rows)
    rsvp:<event>:<id>    rsvp_event: restores the previous answer
    note:<id>            context_notes add/delete: removes the note, or puts it back (3a)

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
    return {"event_id": event_id, "person_id": person_id, "rsvp": rsvp}, token


# ---------- undo ----------

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
    newer = conn.execute("SELECT 1 FROM agent_actions WHERE target = ? AND id > ? AND undone_at IS NULL",
                         (action["target"], action["id"])).fetchone()
    if newer:
        raise tasks.UndoConflict("a later change to the same record must be undone first")
    before = json.loads(action["before"]) if action["before"] else {}
    if kind == "donor":
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
    elif kind == "note":
        from service import context_notes
        try:
            context_notes.undo_note(conn, action)
        except context_notes.NoteError as e:
            raise WriteError(str(e))
    else:
        raise WriteError(f"can't undo a {kind} change")
    conn.execute("UPDATE agent_actions SET undone_at = ? WHERE id = ?", (_now(), action["id"]))
    conn.commit()
    return {"undone": True, "target": action["target"], "action": action["action"]}
