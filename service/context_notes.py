"""Context notes about a person or organization (research_facts rows), written and deleted with undo.

The after-call agent's notes, the chat agent and staff all go through these two functions. Each returns
(row, undo_token) and logs to `agent_actions` with target "note:<id>"; agent_writes.undo reverts it.

    add_context_note      insert; undo deletes the row
    delete_context_note   delete; undo puts the row back with the same id

A delete stays a real delete, so every reader of research_facts (outreach, chat, ICP, snapshot) keeps
working unchanged. The tombstone is the log itself: a deleted or undone note's row, with its source marker
("call-note:<id>#line<n>"), stays in agent_actions, and `logged_note` finds it so a cold re-apply of the
same call doesn't write it again.
"""
from __future__ import annotations

import json
import sqlite3

COLUMNS = ("id", "donor_id", "fact", "source_url", "retrieved_at", "agent_run_id")


class NoteError(ValueError):
    pass


def _row(conn: sqlite3.Connection, fact_id: int) -> dict | None:
    r = conn.execute(f"SELECT {', '.join(COLUMNS)} FROM research_facts WHERE id = ?", (fact_id,)).fetchone()
    return dict(zip(COLUMNS, r)) if r else None


def _log(conn, actor, action, fact_id, before, after) -> str:
    from service.agent_writes import _log
    return _log(conn, actor, action, f"note:{fact_id}", before, after)


def add_context_note(conn: sqlite3.Connection, person_id: int, fact: str, source: str,
                     actor: str = "staff", agent_run_id: str | None = None) -> tuple[dict, str]:
    """A note about the person (or organization). `source` is where it came from: a URL, or a call marker."""
    if not (fact or "").strip():
        raise NoteError("a note needs text")
    if not (source or "").strip():
        raise NoteError("a note needs a source")
    if conn.execute("SELECT 1 FROM donors WHERE id = ?", (person_id,)).fetchone() is None:
        raise NoteError(f"person {person_id} not found")
    cur = conn.execute("INSERT INTO research_facts (donor_id, fact, source_url, agent_run_id) VALUES (?, ?, ?, ?)",
                       (person_id, fact.strip(), source.strip(), agent_run_id))
    row = _row(conn, cur.lastrowid)
    token = _log(conn, actor, "add_context_note", row["id"], None, row)
    conn.commit()
    return row, token


def delete_context_note(conn: sqlite3.Connection, fact_id: int, actor: str = "staff",
                        person_id: int | None = None) -> tuple[dict, str]:
    """Remove a note. The row stays in the log (the tombstone), so undo can restore it exactly."""
    row = _row(conn, fact_id)
    if row is None or (person_id is not None and row["donor_id"] != person_id):
        raise LookupError(f"note {fact_id} not found")
    conn.execute("DELETE FROM research_facts WHERE id = ?", (fact_id,))
    token = _log(conn, actor, "delete_context_note", fact_id, row, None)
    conn.commit()
    return row, token


def undo_note(conn: sqlite3.Connection, action: sqlite3.Row) -> None:
    """agent_writes.undo's branch for "note:<id>". Undo an add: delete the row. Undo a delete: put it back."""
    fact_id = int(action["target"].split(":", 1)[1])
    if action["before"] is None:
        conn.execute("DELETE FROM research_facts WHERE id = ?", (fact_id,))
        return
    before = json.loads(action["before"])
    if conn.execute("SELECT 1 FROM donors WHERE id = ?", (before["donor_id"],)).fetchone() is None:
        raise NoteError(f"person {before['donor_id']} no longer exists")
    conn.execute(f"INSERT OR IGNORE INTO research_facts ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
                 [before[c] for c in COLUMNS])


def logged_note(conn: sqlite3.Connection, person_id: int, source: str) -> int | None:
    """The id of a note with exactly this person and source that the log has seen (live, deleted or undone).
    after_call_agent.already_written uses it, so a removed call note is never re-added by a re-apply."""
    needle = json.dumps(source)                        # quoted: "…#line6" never matches "…#line61"
    for before, after in conn.execute(
            "SELECT before, after FROM agent_actions WHERE target LIKE 'note:%' AND action IN "
            "('add_context_note', 'delete_context_note') AND (instr(after, ?) > 0 OR instr(before, ?) > 0) ORDER BY id",
            (needle, needle)):
        for blob in (after, before):
            row = json.loads(blob) if blob else None
            if row and row.get("donor_id") == person_id and row.get("source_url") == source:
                return row["id"]
    return None
