"""After-call agent (B6): from a call transcript, propose typed actions; staff click Apply to write them.

propose(conn, note_id) reads the call note (call_notes, Christian's table) and returns
{steps, actions:[{id, type, label, payload, evidence}]}. Nothing is written to the database:
the proposal is kept in memory (and a temp file, so a restart keeps it) until Apply.

The model returns a list of typed actions (create_task, rsvp_event, record_pledge,
add_context_note, tag_interest), each with a verbatim evidence quote. Code then checks every one:
  - the evidence must appear in the transcript;
  - an RSVP must point at a real upcoming event whose date matches what was said ("the 21st",
    "Thursday"); if none matches, it becomes a review task, never an invented event;
  - a pledge's amount must appear in the transcript;
  - a tag must be one of the interest tags (42's list), and is offered only once that lane exists.
Without an OpenAI key, a rule-based proposer covers the same five action types.

apply(conn, note_id, action_ids) writes through the shared service functions: tasks.create_task
(3a, actor="call", with an undo token), event_audience.rsvp, pledges, research_facts (a call-sourced
note about the person, source "call-note:<id>"), interests.add_interest (42, guarded). Applying an
action twice does nothing the second time. Pledges are promises: no total, target or score reads them.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import tempfile
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

ACTION_TYPES = ("create_task", "rsvp_event", "record_pledge", "add_context_note", "tag_interest")
TASK_KINDS = ("call", "email", "review", "prep", "other")
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
MONTHS = ("january february march april may june july august september october november december").split()
PROPOSALS_FILE = Path(os.environ.get("AFTER_CALL_PROPOSALS",
                                     Path(tempfile.gettempdir()) / "kindred_after_call_proposals.json"))
_PROPOSALS: dict = {}


class NotFound(LookupError):
    pass


# ----------------------------------------------------------------------------------------------
# What the model returns
# ----------------------------------------------------------------------------------------------

class ProposedAction(BaseModel):
    type: Literal["create_task", "rsvp_event", "record_pledge", "add_context_note", "tag_interest"]
    label: str = Field(description="What staff will see on the button, e.g. 'Text Rosa a secure link to update her card'")
    evidence: str = Field(description="A short span copied verbatim from the transcript that this action rests on")
    task_kind: Literal["call", "email", "review", "prep", "other"] | None = Field(None, description="create_task only")
    task_title: str | None = Field(None, description="create_task only: the task as it should read on the list")
    task_due: str | None = Field(None, description="create_task only: YYYY-MM-DD, or null")
    event_id: int | None = Field(None, description="rsvp_event only: an id from the events list, never another")
    rsvp: Literal["yes", "no", "maybe"] | None = Field(None, description="rsvp_event only")
    amount: float | None = Field(None, description="record_pledge only: the amount exactly as said")
    frequency: Literal["one_time", "monthly", "annual"] | None = Field(None, description="record_pledge only")
    expected_by: str | None = Field(None, description="record_pledge only: YYYY-MM-DD if a date was named, else null")
    note: str | None = Field(None, description="add_context_note only: one plain sentence about the person, from the call")
    tag: str | None = Field(None, description="tag_interest only: one slug from the interest tags list")


class CallProposal(BaseModel):
    steps: list[str] = Field(description="2-5 short next steps in plain words, in the order staff should do them")
    actions: list[ProposedAction]


INSTRUCTIONS = """You read a nonprofit staff member's call with a supporter and propose the follow-up actions.
Propose only what the call actually supports; every action quotes the transcript in `evidence`.
- create_task: something staff must do (send a link, call back, mail something). Pick task_kind and a due date
  (today unless the call says otherwise).
- rsvp_event: the supporter said they will (or won't) come to an event. Use ONLY an event id from the events
  list whose date matches what they said. If no listed event matches, do not propose rsvp_event.
- record_pledge: the supporter promised a future gift. Copy the amount exactly; set frequency.
- add_context_note: something worth remembering about the supporter (a life change, why they give, how long).
- tag_interest: an interest the call shows, only from the given tags list; skip if the list is empty.
Never invent a date, amount, event or name."""


# ----------------------------------------------------------------------------------------------
# Reading the call, the person and the calendar
# ----------------------------------------------------------------------------------------------

def load_note(conn: sqlite3.Connection, note_id: str) -> dict:
    row = conn.execute("SELECT * FROM call_notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        raise NotFound(f"no call note {note_id}")
    note = dict(row)
    for k in ("transcript", "destinations", "summary", "next_steps"):
        note[k] = json.loads(note.get(k) or "[]")
    return note


def resolve_person(conn: sqlite3.Connection, note: dict) -> dict | None:
    """The donor the call was with: the note's donor destination, else the name on the 'them' lines."""
    for d in note["destinations"]:
        if d.get("kind") == "donor" and str(d.get("id") or "").isdigit():
            row = conn.execute("SELECT id, full_name, first_name FROM donors WHERE id = ?", (int(d["id"]),)).fetchone()
            if row:
                return dict(row)
    names = {(line.get("name") or "").strip() for line in note["transcript"] if line.get("speaker") == "them"}
    for name in filter(None, names):
        row = conn.execute("SELECT id, full_name, first_name FROM donors WHERE lower(full_name) = lower(?) "
                           "OR lower(first_name) = lower(?) ORDER BY id LIMIT 1", (name, name)).fetchone()
        if row:
            return dict(row)
    return None


def upcoming_events(conn: sqlite3.Connection, today: date) -> list[dict]:
    rows = conn.execute("SELECT id, title, starts_at, place FROM events WHERE substr(starts_at, 1, 10) >= ? "
                        "ORDER BY starts_at", (today.isoformat(),)).fetchall()
    return [dict(r) for r in rows]


def interest_tags() -> list[str]:
    """42's interest tag slugs, once that lane has landed; [] until then (tag_interest is then never offered)."""
    try:
        from service import interests
    except ImportError:
        return []
    for name in ("tag_slugs", "list_tags", "TAGS", "INTEREST_TAGS"):
        got = getattr(interests, name, None)
        if callable(got):
            got = got()
        if got:
            return [t["slug"] if isinstance(t, dict) else str(t) for t in got]
    return []


def transcript_text(note: dict) -> str:
    return "\n".join(f"{line.get('name') or line.get('speaker')}: {line.get('text', '')}" for line in note["transcript"])


def plain(s: str) -> str:
    return re.sub(r"[^a-z0-9$.]+", " ", (s or "").lower()).strip()


def grounded(evidence: str, text: str) -> bool:
    return bool(plain(evidence)) and plain(evidence) in plain(text)


def date_mentions(text: str) -> dict:
    """{'day': 21, 'weekday': 3, 'month': 11} from "the 21st", "Thursday", "November 21"."""
    t = (text or "").lower()
    out = {}
    if m := re.search(rf"\b({'|'.join(MONTHS)})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", t):
        out["month"], out["day"] = MONTHS.index(m.group(1)) + 1, int(m.group(2))
    elif m := re.search(r"\b(\d{1,2})(?:st|nd|rd|th)\b", t):
        out["day"] = int(m.group(1))
    if m := re.search(rf"\b({'|'.join(WEEKDAYS)})\b", t):
        out["weekday"] = WEEKDAYS.index(m.group(1))
    return out


def event_matches(event: dict, said: dict) -> bool:
    d = date.fromisoformat(event["starts_at"][:10])
    return (("day" not in said or d.day == said["day"]) and ("month" not in said or d.month == said["month"])
            and ("weekday" not in said or d.weekday() == said["weekday"]))


def find_event(events: list[dict], evidence: str, today: date) -> dict | None:
    """The one upcoming event the words point at: its date matches what was said and, when the words
    name it, its title shares a word with them. None when it's ambiguous or nothing matches."""
    said = date_mentions(evidence)
    if not said:
        return None
    words = set(re.findall(r"[a-z]{4,}", (evidence or "").lower())) - {"down", "please", "will", "come", "with"}
    hits = [e for e in events if event_matches(e, said)]
    named = [e for e in hits if words & set(re.findall(r"[a-z]{4,}", e["title"].lower()))]
    hits = named or hits
    return hits[0] if len(hits) == 1 else None


def figures(text: str) -> set[float]:
    return {float(m.replace(",", "")) for m in re.findall(r"\$\s?(\d[\d,]*(?:\.\d+)?)", text or "")}


# ----------------------------------------------------------------------------------------------
# Propose
# ----------------------------------------------------------------------------------------------

def today_date() -> date:
    raw = os.environ.get("SCORE_AS_OF")
    return date.fromisoformat(raw) if raw else date.today()


def model_available() -> bool:
    if os.getenv("AFTER_CALL_DRAFTER", "").lower() == "rules":
        return False
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    return bool(os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_MODEL_DEFAULT"))


def model_proposal(note: dict, person: dict | None, events: list[dict], tags: list[str], today: date) -> CallProposal:
    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning
    from dotenv import load_dotenv
    from service.outreach_agent import bounded_model, long_date

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")   # the client needs the key, however we were called
    ev = "\n".join(f"- id {e['id']}: {e['title']} on {long_date(date.fromisoformat(e['starts_at'][:10]))}"
                   + (f" at {e['place']}" if e.get("place") else "") for e in events) or "- none"
    prompt = (f"Today is {long_date(today)}.\nSupporter: {(person or {}).get('full_name') or 'unknown'}\n"
              f"Events list (the only events you may RSVP to):\n{ev}\n"
              f"Interest tags: {', '.join(tags) or 'none (do not propose tag_interest)'}\n\n"
              f"Transcript:\n{transcript_text(note)}")
    agent = Agent(name="AfterCallAgent", instructions=INSTRUCTIONS, model=bounded_model(), output_type=CallProposal,
                  model_settings=ModelSettings(reasoning=Reasoning(effort="low")))
    return Runner.run_sync(agent, prompt).final_output


def rule_proposal(note: dict, person: dict | None, events: list[dict], tags: list[str], today: date) -> CallProposal:
    """The no-key path: plain rules over the supporter's lines."""
    first = ((person or {}).get("first_name") or ((person or {}).get("full_name") or "the supporter").split()[0])
    actions, steps = [], []
    for line in note["transcript"]:
        text = line.get("text") or ""
        low = text.lower()
        if re.search(r"\b(new card|update (it|my card|the card)|card (expired|stopped|declined))\b", low):
            actions.append(ProposedAction(type="create_task", label=f"Text {first} a secure link to update their card",
                                          evidence=text, task_kind="other", task_title=f"Send {first} the card-update link",
                                          task_due=today.isoformat()))
            actions.append(ProposedAction(type="add_context_note", label=f"Note: {first} has a new card", evidence=text,
                                          note=f"{first} got a new card and needs to update it."))
            steps.append(f"Send {first} the secure card-update link today.")
        if line.get("speaker") == "them" and (m := re.search(r"\$\s?(\d[\d,]*)\s*(a|per|every)\s*(month|year)", low)):
            amount, freq = float(m.group(1).replace(",", "")), "monthly" if m.group(3) == "month" else "annual"
            actions.append(ProposedAction(type="record_pledge", label=f"Record {first}'s ${amount:,.0f}/{m.group(3)} pledge",
                                          evidence=text, amount=amount, frequency=freq))
            steps.append(f"Confirm {first}'s ${amount:,.0f} {freq} gift resumes once the card is updated.")
        if line.get("speaker") == "them" and re.search(r"\b(put me down|sign me up|i'll (be there|come)|count me in)\b", low):
            ev = find_event(events, text, today)
            if ev:
                actions.append(ProposedAction(type="rsvp_event", label=f"RSVP {first}: yes to {ev['title']}",
                                              evidence=text, event_id=ev["id"], rsvp="yes"))
                steps.append(f"Add {first} to {ev['title']}.")
            else:
                actions.append(ProposedAction(type="create_task", label=f"Find the event {first} mentioned",
                                              evidence=text, task_kind="review", task_title=f"Find the event {first} meant: \"{text}\"",
                                              task_due=today.isoformat()))
        if m := re.search(r"\bsince (\d{4})\b", low):
            actions.append(ProposedAction(type="add_context_note", label=f"Note: giving since {m.group(1)}", evidence=text,
                                          note=f"{first} has given since {m.group(1)}."))
    return CallProposal(steps=steps or ["Review the call notes."], actions=actions)


def check_action(a: ProposedAction, text: str, person: dict | None, events: list[dict], tags: list[str],
                 today: date) -> tuple[ProposedAction | None, str | None]:
    """(the action, possibly turned into a review task) or (None, why it was dropped)."""
    if not grounded(a.evidence, text):
        return None, "its evidence isn't in the transcript"
    if a.type != "create_task" and not person:
        return None, "the call isn't linked to a person"
    if a.type == "create_task":
        if not (a.task_title or "").strip():
            return None, "no task title"
        if a.task_due and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.task_due):
            a.task_due = None
        a.task_kind = a.task_kind if a.task_kind in TASK_KINDS else "other"
    elif a.type == "rsvp_event":
        ev = next((e for e in events if e["id"] == a.event_id), None)
        said = date_mentions(a.evidence)
        if ev is None or (said and not event_matches(ev, said)):
            ev = find_event(events, a.evidence, today)
        if ev is None:                                  # never invent an event: staff find it instead
            first = (person or {}).get("first_name") or "the supporter"
            return ProposedAction(type="create_task", label=f"Find the event {first} mentioned", evidence=a.evidence,
                                  task_kind="review", task_title=f"Find the event {first} meant: \"{a.evidence}\"",
                                  task_due=today.isoformat()), None
        a.event_id, a.rsvp = ev["id"], a.rsvp or "yes"
    elif a.type == "record_pledge":
        if not a.amount or a.amount <= 0 or not any(abs(a.amount - f) < 0.5 for f in figures(text)):
            return None, "the amount isn't said in the call"
        a.frequency = a.frequency or "one_time"
        if a.expected_by and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.expected_by):
            a.expected_by = None
    elif a.type == "add_context_note":
        if not (a.note or "").strip():
            return None, "empty note"
    elif a.type == "tag_interest":
        if not tags or a.tag not in tags:
            return None, "not one of the interest tags (or tags aren't available yet)"
    return a, None


def payload_of(a: ProposedAction, person: dict | None, note_id: str) -> dict:
    pid = (person or {}).get("id")
    return {
        "create_task": lambda: {"kind": a.task_kind, "title": a.task_title, "why": a.evidence, "person_id": pid,
                                "due": a.task_due, "chips": ["from a call"]},
        "rsvp_event": lambda: {"event_id": a.event_id, "person_id": pid, "rsvp": a.rsvp},
        "record_pledge": lambda: {"person_id": pid, "amount": a.amount, "frequency": a.frequency,
                                  "expected_by": a.expected_by, "note": a.evidence, "call_note_id": note_id},
        "add_context_note": lambda: {"person_id": pid, "fact": a.note, "source": f"call-note:{note_id}"},
        "tag_interest": lambda: {"person_id": pid, "tag": a.tag, "evidence": a.evidence},
    }[a.type]()


def propose(conn: sqlite3.Connection, note_id: str, today: date | None = None, use_model: bool | None = None) -> dict:
    """{steps, actions:[{id, type, label, payload, evidence}], dropped:[...], person, drafted_by}. No db writes."""
    conn.row_factory = sqlite3.Row
    today = today or today_date()
    note = load_note(conn, note_id)
    person = resolve_person(conn, note)
    events = upcoming_events(conn, today)
    tags = interest_tags()
    text = transcript_text(note)
    use_model = model_available() if use_model is None else use_model
    drafted_by = "model" if use_model else "rules"
    try:
        raw = (model_proposal if use_model else rule_proposal)(note, person, events, tags, today)
    except Exception as e:                              # model error: the rules still give staff something
        raw, drafted_by = rule_proposal(note, person, events, tags, today), f"rules (model failed: {type(e).__name__}: {e}"[:160] + ")"
    actions, dropped, seen = [], [], set()
    for a in raw.actions:
        checked, why = check_action(a, text, person, events, tags, today)
        if checked is None:
            dropped.append({"type": a.type, "label": a.label, "why": why})
            continue
        payload = payload_of(checked, person, note_id)
        key = (checked.type, json.dumps({k: v for k, v in payload.items() if k != "why" and k != "note"}, sort_keys=True))
        if key in seen:
            continue
        seen.add(key)
        actions.append({"id": f"a{len(actions) + 1}", "type": checked.type, "label": checked.label,
                        "payload": payload, "evidence": checked.evidence})
    out = {"note_id": note_id, "steps": raw.steps, "actions": actions, "dropped": dropped,
           "person": person, "drafted_by": drafted_by}
    _remember(note_id, {"actions": actions, "applied": {}})
    return out


# ----------------------------------------------------------------------------------------------
# Apply: the only writes
# ----------------------------------------------------------------------------------------------

def _store() -> dict:
    if not _PROPOSALS and PROPOSALS_FILE.exists():
        try:
            _PROPOSALS.update(json.loads(PROPOSALS_FILE.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    return _PROPOSALS


def _remember(note_id: str, entry: dict) -> None:
    store = _store()
    store[note_id] = entry
    try:
        PROPOSALS_FILE.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def write_action(conn: sqlite3.Connection, action: dict, note_id: str) -> dict:
    p, kind = action["payload"], action["type"]
    if kind == "create_task":
        from service import tasks
        made = tasks.create_task(conn, kind=p["kind"], title=p["title"], actor="call", why=p.get("why"),
                                 person_id=p.get("person_id"), due=p.get("due"), chips=p.get("chips") or [])
        task, token = made
        return {"task_id": task["id"], "undo_token": token}
    if kind == "rsvp_event":
        conn.execute("INSERT OR IGNORE INTO event_audience (event_id, person_id, reason) VALUES (?, ?, ?)",
                     (p["event_id"], p["person_id"], "said so on a call"))
        conn.execute("UPDATE event_audience SET rsvp = ? WHERE event_id = ? AND person_id = ?",
                     (p["rsvp"], p["event_id"], p["person_id"]))
        return {"event_id": p["event_id"], "person_id": p["person_id"], "rsvp": p["rsvp"]}
    if kind == "record_pledge":
        cur = conn.execute("INSERT INTO pledges (person_id, amount, frequency, expected_by, note, call_note_id) "
                           "VALUES (?, ?, ?, ?, ?, ?)", (p["person_id"], p["amount"], p["frequency"], p.get("expected_by"),
                                                         p.get("note"), note_id))
        return {"pledge_id": cur.lastrowid}
    if kind == "add_context_note":
        cur = conn.execute("INSERT INTO research_facts (donor_id, fact, source_url, agent_run_id) VALUES (?, ?, ?, ?)",
                           (p["person_id"], p["fact"], p["source"], "after_call"))
        return {"research_fact_id": cur.lastrowid}
    if kind == "tag_interest":
        from service import interests                    # 42's lane; only proposed once it exists
        got = interests.add_interest(conn, p["person_id"], p["tag"], set_by="call", evidence=p.get("evidence"),
                                     source_url=f"call-note:{note_id}")
        return {"interest": got if isinstance(got, (dict, str, int)) else p["tag"]}
    raise ValueError(f"unknown action type {kind}")


def apply(conn: sqlite3.Connection, note_id: str, action_ids: list[str]) -> dict:
    """{applied:[{id, type, ref}], skipped:[{id, why}]}. Each action is written at most once."""
    conn.row_factory = sqlite3.Row
    load_note(conn, note_id)                            # 404 for an unknown note
    entry = _store().get(note_id)
    if entry is None:
        raise NotFound(f"no proposal for call note {note_id}; propose actions first")
    by_id = {a["id"]: a for a in entry["actions"]}
    applied, skipped = [], []
    for aid in action_ids:
        if aid not in by_id:
            skipped.append({"id": aid, "why": "not in this call's proposal"})
            continue
        if aid in entry["applied"]:
            skipped.append({"id": aid, "why": "already applied", "ref": entry["applied"][aid]})
            continue
        try:
            ref = write_action(conn, by_id[aid], note_id)
            conn.commit()
        except Exception as e:
            conn.rollback()
            skipped.append({"id": aid, "why": f"{type(e).__name__}: {e}"[:200]})
            continue
        entry["applied"][aid] = ref
        applied.append({"id": aid, "type": by_id[aid]["type"], "ref": ref})
    _remember(note_id, entry)
    return {"applied": applied, "skipped": skipped}


def list_pledges(conn: sqlite3.Connection, person_id: int) -> list[dict]:
    rows = conn.execute("SELECT id, amount, frequency, expected_by, status, note, call_note_id, created_at FROM pledges "
                        "WHERE person_id = ? ORDER BY created_at DESC, id DESC", (person_id,)).fetchall()
    return [dict(r) for r in rows]
