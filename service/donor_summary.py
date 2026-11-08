""""About <donor>": the agent's running summary of one person (Sharif, Nov 8).

Each time someone shares something about a person (the home chat agent's update_donor_summary tool, or a saved call
note), the model REWRITES the paragraph: it merges the new facts into what was already there, 3-5 sentences, newest
relevant facts first, relationship and personal notes plus the giving pattern, nothing invented. Every write is
logged in agent_actions (target summary:<donor_id>), so Undo restores the previous paragraph.

Without a model (no key, or SUMMARY_WRITER=rules, as in tests) a plain rule keeps the user's own words, newest first.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import unicodedata
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field

log = logging.getLogger("service.donor_summary")

MAX_SENTENCES = 5
MAX_SOURCES = 12
TRANSCRIPT_CHARS = 6000

SOURCE_KINDS = ("chat", "call_note", "note", "gift")
# What GET /donors/{id} shows under PUBLIC_MODE and in the public snapshot: the paragraph is written from calls
# and chats, so it stays private like call notes.
BLANK = {"summary": None, "summary_updated_at": None, "summary_sources": []}


class WriteError(ValueError):
    """Nothing written: the person couldn't be found, the name matched several people, or there was nothing to add."""


class SummaryRewrite(BaseModel):
    summary: str = Field(description="The rewritten paragraph, 3-5 sentences, third person, plain prose.")


INSTRUCTIONS = """You keep a short 'About' paragraph on one supporter for a community foundation's development officer.
Rewrite the paragraph so it merges the NEW information into the CURRENT paragraph.

Rules:
- 3 to 5 sentences of plain prose, third person, using the supporter's first name.
- Newest relevant facts first. Keep earlier facts unless the new information replaces them; never drop a fact
  just to make room unless the paragraph would exceed 5 sentences (then drop the least useful, oldest detail).
- Cover the relationship and personal notes (family members by name, preferences, plans, how a conversation went)
  and, in one sentence at most, the giving pattern from the GIVING facts.
- Use ONLY facts stated in CURRENT, NEW or GIVING. Never invent names, dates, amounts, places or feelings.
- No headings, bullets, quotes or advice; just the paragraph."""


# ----------------------------------------------------------------------------------------------
# Storage
# ----------------------------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(conn: sqlite3.Connection, donor_id: int) -> dict:
    """{summary, summary_updated_at, summary_sources} for GET /donors/{id}; empty values when nothing is written yet."""
    row = conn.execute("SELECT summary, sources, updated_at FROM donor_summaries WHERE donor_id = ?",
                       (donor_id,)).fetchone()
    if row is None:
        return {"summary": None, "summary_updated_at": None, "summary_sources": []}
    return {"summary": row["summary"], "summary_updated_at": row["updated_at"],
            "summary_sources": json.loads(row["sources"] or "[]")}


def put(conn: sqlite3.Connection, donor_id: int, summary: str | None, sources: list, updated_at: str | None) -> None:
    if summary is None:
        conn.execute("DELETE FROM donor_summaries WHERE donor_id = ?", (donor_id,))
        return
    conn.execute("INSERT INTO donor_summaries (donor_id, summary, sources, updated_at) VALUES (?, ?, ?, ?) "
                 "ON CONFLICT(donor_id) DO UPDATE SET summary = excluded.summary, sources = excluded.sources, "
                 "updated_at = excluded.updated_at", (donor_id, summary, json.dumps(sources), updated_at))


def restore(conn: sqlite3.Connection, donor_id: int, before: dict) -> None:
    """Undo (agent_writes.undo, target summary:<id>): put back the paragraph as it was, or none."""
    put(conn, donor_id, before.get("summary"), before.get("summary_sources") or [], before.get("summary_updated_at"))


# ----------------------------------------------------------------------------------------------
# Finding the person
# ----------------------------------------------------------------------------------------------

def fold(text: str | None) -> str:
    """Accent- and case-insensitive form of a name: 'María Delgado-Ruiz' -> 'maria delgado-ruiz'."""
    return "".join(c for c in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(c)).casefold().strip()


def resolve(conn: sqlite3.Connection, person_id: int | None = None, name: str | None = None) -> sqlite3.Row:
    """The one person meant. No match or several matches is a WriteError that asks; never a guess."""
    if person_id is not None:
        row = conn.execute("SELECT id, full_name, first_name FROM donors WHERE id = ?", (person_id,)).fetchone()
        if row is None:
            raise WriteError(f"person {person_id} not found")
        return row
    name = (name or "").strip()
    if not name:
        raise WriteError("who is this about? Give me their name")
    # Compared in Python, not SQLite lower()/LIKE: "Maria Delgado" must find "María Delgado-Ruiz"
    rows = conn.execute("SELECT id, full_name, first_name FROM donors ORDER BY full_name, id").fetchall()
    want = fold(name)
    exact = sorted((r for r in rows if fold(r["full_name"]) == want), key=lambda r: r["id"])
    hits = exact or [r for r in rows if want in fold(r["full_name"])]
    if not hits:
        raise WriteError(f"I couldn't find anyone named {name}. Who did you mean?")
    if len(hits) > 1:
        options = " or ".join(f"{r['full_name']} (person {r['id']})" for r in hits[:5])
        raise WriteError(f"which one did you mean: {options}?")
    return hits[0]


# ----------------------------------------------------------------------------------------------
# Giving pattern (facts the paragraph may use)
# ----------------------------------------------------------------------------------------------

def giving_facts(conn: sqlite3.Connection, donor_id: int) -> tuple[str, dict | None]:
    """One line of facts from gifts that went through, and a gift source for the newest one (None without gifts)."""
    rows = conn.execute("SELECT id, amount, gift_date FROM gifts WHERE donor_id = ? AND COALESCE(status, 'ok') = 'ok' "
                        "ORDER BY gift_date DESC, id DESC", (donor_id,)).fetchall()
    if not rows:
        return "no gifts recorded", None
    total = sum(r["amount"] or 0 for r in rows)
    first, last = rows[-1]["gift_date"], rows[0]["gift_date"]
    text = (f"{len(rows)} gift{'s' if len(rows) != 1 else ''} totaling ${total:,.0f}, "
            f"first on {first}, most recent ${rows[0]['amount']:,.0f} on {last}")
    return text, {"kind": "gift", "ref": str(rows[0]["id"]), "at": last}


# ----------------------------------------------------------------------------------------------
# The rewrite
# ----------------------------------------------------------------------------------------------

def model_available() -> bool:
    if os.getenv("SUMMARY_WRITER", "").lower() == "rules":
        return False
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    return bool(os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_MODEL_FAST"))


def summary_model():
    """The luna model (OPENAI_MODEL_FAST, gpt-6-luna: the newest luna on the account on Nov 8) on its own client with
    outreach_agent's timeout and retries. Sharif: the agent that writes donor notes uses the latest luna model."""
    from agents import OpenAIResponsesModel
    from openai import AsyncOpenAI
    from service.outreach_agent import OPENAI_RETRIES, OPENAI_TIMEOUT_S
    client = AsyncOpenAI(timeout=OPENAI_TIMEOUT_S, max_retries=OPENAI_RETRIES)
    return OpenAIResponsesModel(model=os.getenv("OPENAI_MODEL_FAST"), openai_client=client)


def model_rewrite(full_name: str, current: str, new_info: str, giving: str) -> str:
    """One Agents SDK run with a structured output. Run on its own thread: the chat agent calls this from inside
    its own event loop, where Runner.run_sync can't start another."""
    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning

    prompt = (f"Supporter: {full_name}\n\nCURRENT:\n{current or '(empty: write the first paragraph)'}\n\n"
              f"NEW:\n{new_info}\n\nGIVING:\n{giving}")
    agent = Agent(name="DonorSummaryAgent", instructions=INSTRUCTIONS, model=summary_model(),
                  output_type=SummaryRewrite, model_settings=ModelSettings(reasoning=Reasoning(effort="low")))
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: Runner.run_sync(agent, prompt).final_output.summary).result().strip()


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", (text or "").strip()) if s.strip()]


# Capitalized words a grounded paragraph may use without them appearing in its inputs.
COMMON_CAPS = {"i", "he", "she", "they", "his", "her", "their", "the", "a", "an", "and", "in", "on", "at", "of", "for",
               "with", "after", "before", "since", "last", "next", "this", "it", "as", "most", "recently", "both",
               "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
               "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
               "miami", "foundation"}


def ungrounded(summary: str, *inputs: str) -> list[str]:
    """Proper-noun-looking words in the summary that appear in none of the inputs (a sign of invention)."""
    known = " ".join(inputs).lower()
    out = []
    for sentence in sentences(summary):
        for word in re.findall(r"\b[A-Z][a-zA-Z'\-]+", sentence)[1:]:     # skip each sentence's first word
            w = re.sub(r"'s?$", "", word.lower())
            if w not in COMMON_CAPS and w not in known:
                out.append(word)
    return out


def rules_rewrite(current: str, new_info: str) -> str:
    """No model: the user's own words first, then what was there, capped at MAX_SENTENCES."""
    return " ".join((sentences(new_info) + sentences(current))[:MAX_SENTENCES])


def rewrite(full_name: str, current: str, new_info: str, giving: str) -> tuple[str, str]:
    """(paragraph, writer): the model's rewrite when it's available and grounded, else the rule."""
    if model_available():
        try:
            text = model_rewrite(full_name, current, new_info, giving)
            extra = ungrounded(text, full_name, current, new_info, giving)
            n = len(sentences(text))
            if text and not extra and 1 <= n <= MAX_SENTENCES + 1:
                return text, "model"
            log.warning("summary: model output rejected (%d sentences, ungrounded %s); using the rule", n, extra)
        except Exception as e:   # a stalled or failed model call must not lose what the user told us
            log.warning("summary: model failed (%s: %s); using the rule", type(e).__name__, e)
    return rules_rewrite(current, new_info), "rules"


# ----------------------------------------------------------------------------------------------
# The write
# ----------------------------------------------------------------------------------------------

def update(conn: sqlite3.Connection, new_info: str, person_id: int | None = None, name: str | None = None,
           kind: str = "chat", ref: str | None = None, at: str | None = None,
           actor: str = "agent") -> tuple[dict, str]:
    """Merge new_info into the person's paragraph. Returns (result, undo_token) like every agent write."""
    from service import agent_writes
    new_info = (new_info or "").strip()
    if not new_info:
        raise WriteError("there's nothing to add to the summary")
    if kind not in SOURCE_KINDS:
        raise WriteError(f"unknown source kind {kind!r}")
    person = resolve(conn, person_id, name)
    donor_id = person["id"]
    before = get(conn, donor_id)
    giving, gift_source = giving_facts(conn, donor_id)
    text, writer = rewrite(person["full_name"], before["summary"] or "", new_info, giving)
    at = at or now_iso()
    source = {"kind": kind, "ref": ref or uuid.uuid4().hex[:12], "at": at}   # a chat has no row of its own
    if kind == "call_note":
        source["h"] = hashlib.sha256(new_info.encode()).hexdigest()[:12]
    sources = [source] + [s for s in before["summary_sources"]
                          if not (s.get("kind") == kind and s.get("ref") == source["ref"]) and s.get("kind") != "gift"]
    if gift_source:
        sources.append(gift_source)
    sources = sources[:MAX_SOURCES]
    updated_at = now_iso()
    put(conn, donor_id, text, sources, updated_at)
    after = {"summary": text, "summary_sources": sources, "summary_updated_at": updated_at}
    token = agent_writes._log(conn, actor, "update_donor_summary", f"summary:{donor_id}", before, after)
    conn.commit()
    log.info("summary: donor %s updated from %s (%s, %d sentences)", donor_id, kind, writer, len(sentences(text)))
    return {"summary_updated": True, "person_id": donor_id, "full_name": person["full_name"],
            "first_name": person["first_name"] or person["full_name"].split()[0], "summary": text,
            "writer": writer}, token


# ----------------------------------------------------------------------------------------------
# Call notes (POST /calls): a saved note refreshes each donor it was filed to
# ----------------------------------------------------------------------------------------------

def call_note_text(note: dict) -> str:
    parts = []
    if (note.get("notes") or "").strip():
        parts.append(f"Staff notes: {note['notes'].strip()}")
    bullets = note.get("summary") or []
    if bullets:
        parts.append("Call summary: " + " ".join(b.strip() for b in bullets if b.strip()))
    lines = [f"{line.get('name') or line.get('speaker') or 'Speaker'}: {line.get('text', '').strip()}"
             for line in (note.get("transcript") or []) if (line.get("text") or "").strip()]
    if lines:
        parts.append("Transcript: " + "\n".join(lines)[-TRANSCRIPT_CHARS:])
    return "\n".join(parts)


def refresh_from_call_note(conn: sqlite3.Connection, note: dict) -> list[int]:
    """Update the summary of every donor the note was filed to. A re-save of the same, unchanged note is skipped.
    Returns the donor ids updated; a failure for one donor is logged and never fails the save."""
    text = call_note_text(note)
    if not text:
        return []
    digest = hashlib.sha256(text.encode()).hexdigest()[:12]
    at = note.get("created_at") or now_iso()
    done = []
    for dest in note.get("destinations") or []:
        if dest.get("kind") != "donor" or not str(dest.get("id", "")).isdigit():
            continue
        donor_id = int(dest["id"])
        seen = get(conn, donor_id)["summary_sources"]
        if any(s.get("kind") == "call_note" and s.get("ref") == note["id"] and s.get("h") == digest for s in seen):
            continue
        try:
            update(conn, text, person_id=donor_id, kind="call_note", ref=note["id"], at=at)
            done.append(donor_id)
        except Exception as e:
            log.warning("summary: call note %s -> donor %s failed (%s: %s)", note.get("id"), donor_id,
                        type(e).__name__, e)
    return done


def refresh_in_background(note: dict) -> list[int]:
    """Background task for POST /calls: its own connection, after the response went out."""
    from service import db
    conn = db.connect()
    try:
        db.create_schema(conn)
        return refresh_from_call_note(conn, note)
    finally:
        conn.close()
