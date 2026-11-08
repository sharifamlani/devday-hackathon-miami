"""Calendar v3: organization events staff and the agent add, move and remove (the calendar holds events only;
tasks stay on the to-do list). Each write returns (event, undo_token) and is logged in agent_actions as
"event:<id>"; agent_writes.undo reverts it through undo_event.

    add_event      source staff | agent; no source link needed
    update_event   title, date/time, place, kind, notes
    delete_event   removes the event; undo puts it back with its audience and draft links

Events found on the Foundation's site (source website | news | search) belong to the refresh
(refresh.py / db.save_events): they can't be edited or deleted here (EventLocked).
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime

APP_SOURCES = ("staff", "agent")
EVENT_KINDS = ("fundraising", "stewardship", "community", "other")
FIELDS = ("title", "starts_at", "ends_at", "place", "event_kind", "notes")


class EventError(ValueError):
    """Bad input (422)."""


class EventNotFound(LookupError):
    """No such event (404)."""


class EventLocked(PermissionError):
    """An event found on the web: the refresh owns it (403)."""


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _row(conn: sqlite3.Connection, event_id: int) -> dict | None:
    r = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    return dict(r) if r else None


def starts_at(value: str | None = None, day: str | None = None, time: str | None = None) -> str:
    """'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM', from starts_at or from date + time."""
    if value:
        day, _, time = str(value).partition("T")
        time = time[:5] or None
    if not day:
        raise EventError("an event needs a date (starts_at or date)")
    try:
        d = date.fromisoformat(str(day)[:10]).isoformat()
    except ValueError:
        raise EventError("date must be YYYY-MM-DD") from None
    if time:
        try:
            time = datetime.strptime(str(time)[:5], "%H:%M").strftime("%H:%M")
        except ValueError:
            raise EventError("time must be HH:MM") from None
        return f"{d}T{time}"
    return d


def _clean(fields: dict) -> dict:
    out = {}
    for k, v in fields.items():
        if k not in FIELDS:
            raise EventError(f"unknown field: {k}")
        if k == "title":
            v = (v or "").strip()
            if not v:
                raise EventError("an event needs a title")
        if k == "event_kind" and v is not None and v not in EVENT_KINDS:
            raise EventError(f"event_kind must be one of {', '.join(EVENT_KINDS)}")
        if k == "ends_at" and v:
            v = starts_at(v)
        if isinstance(v, str) and k in ("place", "notes"):
            v = v.strip() or None
        out[k] = v
    return out


def public(row: dict) -> dict:
    return {k: row.get(k) for k in ("id", "title", "starts_at", "ends_at", "place", "event_kind", "notes", "source",
                                    "source_url", "status", "audience_hint")}


def _log(conn, actor, action, event_id, before, after) -> str:
    from service.agent_writes import _log
    return _log(conn, actor, action, f"event:{event_id}", before, after)


def _editable(conn: sqlite3.Connection, event_id: int) -> dict:
    row = _row(conn, event_id)
    if row is None:
        raise EventNotFound(f"event {event_id} not found")
    if row["source"] not in APP_SOURCES:
        raise EventLocked("this event comes from your website; it can't be edited here")
    return row


def add_event(conn: sqlite3.Connection, *, title: str, starts_at_: str, source: str = "staff",
              source_url: str | None = None, actor: str | None = None, **fields) -> tuple[dict, str]:
    """A new organization event. Staff/agent events need no source link; any other source needs one."""
    source = source or "staff"
    url = (source_url or "").strip() or None
    if source not in APP_SOURCES and not url:
        raise EventError(f"an event from {source} needs a source_url")
    values = {**_clean({"title": title, **fields}), "starts_at": starts_at_, "source": source, "source_url": url}
    cur = conn.execute(f"INSERT INTO events ({', '.join(values)}) VALUES ({', '.join('?' * len(values))})",
                       list(values.values()))
    row = _row(conn, cur.lastrowid)
    token = _log(conn, actor or source, "add_event", row["id"], None, row)
    conn.commit()
    return public(row), token


def update_event(conn: sqlite3.Connection, event_id: int, actor: str = "staff", _action: str = "update_event",
                 **fields) -> tuple[dict, str]:
    before = _editable(conn, event_id)
    values = _clean(fields)
    if not values:
        raise EventError("nothing to change")
    values["updated_at"] = _now()
    conn.execute(f"UPDATE events SET {', '.join(f'{k} = ?' for k in values)} WHERE id = ?", [*values.values(), event_id])
    after = _row(conn, event_id)
    token = _log(conn, actor, _action, event_id, before, after)
    conn.commit()
    return public(after), token


def move_event(conn: sqlite3.Connection, event_id: int, *, day: str, time: str | None = None,
               actor: str = "staff") -> tuple[dict, str]:
    return update_event(conn, event_id, actor=actor, _action="move_event", starts_at=starts_at(day=day, time=time))


def delete_event(conn: sqlite3.Connection, event_id: int, actor: str = "staff") -> tuple[dict, str]:
    before = _editable(conn, event_id)
    snap = {"event": before,
            "audience": [dict(r) for r in conn.execute("SELECT * FROM event_audience WHERE event_id = ?", (event_id,))],
            "drafts": [r[0] for r in conn.execute("SELECT draft_id FROM event_drafts WHERE event_id = ?", (event_id,))]}
    conn.execute("DELETE FROM events WHERE id = ?", (event_id,))        # cascades to audience + draft links
    token = _log(conn, actor, "delete_event", event_id, snap, None)
    conn.commit()
    return public(before), token


def undo_event(conn: sqlite3.Connection, action: sqlite3.Row) -> None:
    """agent_writes.undo's branch for "event:<id>": undo an add (remove it), an edit (restore it) or a delete
    (put it back, audience and draft links included)."""
    event_id = int(action["target"].split(":", 1)[1])
    if action["before"] is None:
        conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
        return
    before = json.loads(action["before"])
    if action["action"] != "delete_event":
        cols = [c for c in before if c != "id"]
        conn.execute(f"UPDATE events SET {', '.join(f'{c} = ?' for c in cols)} WHERE id = ?",
                     [before[c] for c in cols] + [event_id])
        return
    ev = before["event"]
    cols = list(ev)
    conn.execute(f"INSERT OR IGNORE INTO events ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                 [ev[c] for c in cols])
    for a in before["audience"]:
        keys = list(a)
        conn.execute(f"INSERT OR IGNORE INTO event_audience ({', '.join(keys)}) VALUES ({', '.join('?' * len(keys))})",
                     [a[k] for k in keys])
    for draft_id in before["drafts"]:
        conn.execute("INSERT OR IGNORE INTO event_drafts (event_id, draft_id) SELECT ?, id FROM outreach_drafts "
                     "WHERE id = ?", (event_id, draft_id))
