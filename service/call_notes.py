"""Call notes (plan §21.2.7, contract §21.5): save a finished call's transcript to a person, list them, undo.

save_call_note() writes one call_notes row and returns {id, summary, created_at, undo_token}. The summary
is one OpenAI Agents SDK run (MODEL_FAST) over the transcript; with no key, a timeout or a model error the
note is still saved with summary null, so a call is never lost to the model. The undo token
("call_note:<id>") is what 3a's POST /undo/{token} hands back to undo_call_note().
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime, timezone

from service import config

log = logging.getLogger("service.call_notes")

SUMMARY_DEADLINE_S = float(os.getenv("CALL_SUMMARY_DEADLINE_S", "30"))
UNDO_PREFIX = "call_note:"
SUMMARY_INSTRUCTIONS = (
    "You summarize a phone call between a nonprofit staff member and a donor or community member. "
    "Write 2-4 short plain sentences: what the person said about their giving, anything they asked for or "
    "agreed to (events, dates, amounts, payment changes), and the follow-up the staff member owes. "
    "Use only what is in the transcript; never invent names, dates or amounts. No preamble.")


def transcript_text(transcript: str | None, segments: list[dict] | None) -> str:
    if segments:
        return "\n".join(f"{s.get('speaker') or 'Speaker'}: {s.get('text', '')}" for s in segments)
    return (transcript or "").strip()


def summarize(text: str) -> str | None:
    """One Agents SDK run; None when there is nothing to summarize or the model is unavailable."""
    if not text or not config.HAS_OPENAI_KEY:
        return None
    import asyncio
    from agents import Agent, Runner, trace

    async def run() -> str:
        agent = Agent(name="CallNoteSummary", instructions=SUMMARY_INSTRUCTIONS, model=config.MODEL_FAST)
        with trace("call_note_summary"):
            result = await asyncio.wait_for(Runner.run(agent, text), SUMMARY_DEADLINE_S)
        return str(result.final_output).strip()

    try:
        return asyncio.run(run()) or None
    except Exception as e:
        log.warning("call note summary failed: %s", e)
        return None


def person_exists(conn: sqlite3.Connection, person_id: int) -> bool:
    return conn.execute("SELECT 1 FROM donors WHERE id = ?", (person_id,)).fetchone() is not None


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["segments"] = json.loads(d["segments"] or "[]")
    return d


def save_call_note(conn: sqlite3.Connection, person_id: int, note: dict, summary: str | None = None) -> dict:
    """note: {title, folder?, transcript?, segments?, staff_name?, contact_name?, duration_s?}.
    Pass summary to skip the model (tests, or a summary made elsewhere)."""
    segments = note.get("segments") or []
    transcript = (note.get("transcript") or "").strip() or transcript_text(None, segments)
    if summary is None:
        summary = summarize(transcript_text(transcript, segments))
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cur = conn.execute(
        "INSERT INTO call_notes (person_id, title, folder, transcript, segments, staff_name, contact_name,"
        " duration_s, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (person_id, note["title"], note.get("folder") or "Call notes", transcript, json.dumps(segments),
         note.get("staff_name"), note.get("contact_name"), note.get("duration_s"), summary, created_at))
    conn.commit()
    return {"id": cur.lastrowid, "summary": summary, "created_at": created_at,
            "undo_token": f"{UNDO_PREFIX}{cur.lastrowid}"}


def list_call_notes(conn: sqlite3.Connection, person_id: int) -> list[dict]:
    rows = conn.execute("SELECT * FROM call_notes WHERE person_id = ? ORDER BY created_at DESC, id DESC",
                        (person_id,)).fetchall()
    return [_row(r) for r in rows]


def get_call_note(conn: sqlite3.Connection, note_id: int) -> dict | None:
    r = conn.execute("SELECT * FROM call_notes WHERE id = ?", (note_id,)).fetchone()
    return _row(r) if r else None


def undo_call_note(conn: sqlite3.Connection, token: str) -> bool:
    """Delete the note a save created. False for a token that isn't ours or a note already gone."""
    if not token.startswith(UNDO_PREFIX) or not token[len(UNDO_PREFIX):].isdigit():
        return False
    cur = conn.execute("DELETE FROM call_notes WHERE id = ?", (int(token[len(UNDO_PREFIX):]),))
    conn.commit()
    return cur.rowcount == 1
