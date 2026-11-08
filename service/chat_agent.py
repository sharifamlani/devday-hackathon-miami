"""Chat agent (plan.md §17): one Agents SDK agent behind POST /chat, aware of the tab the user is on.

Tools wrap existing code and each step is returned to the UI (name, args, result summary). The model can
look people up, segment, read the org's context and events, and DRAFT email or text batches. It has no tool
that sends: a draft batch is a campaign (routes_campaigns) that a human approves with POST /send/{batch_id};
orgs, star and big donors need per-item approval there. Community outreach never asks for a donation.
"""
import asyncio
import json
import os
import uuid
from datetime import date
from dataclasses import dataclass, field
from typing import Literal

from agents import Agent, ModelSettings, RunContextWrapper, Runner, RunState, function_tool
from agents.items import ToolCallItem, ToolCallOutputItem
from openai.types.shared import Reasoning

from service import db

Tab = Literal["givers", "neighbors", "community", "calendar", "home"]
# The UI's screen names (context.screen) -> tabs
SCREEN_TAB = {"giver": "givers", "neighbor": "neighbors", "community": "community", "calendar": "calendar",
              "home": "home"}
Intent = Literal["thank_you", "re_engage", "check_in"]

TAB_ROLE = {
    "givers": "campaign builder for people and organizations who gave",
    "neighbors": "follow-ups with people the Foundation met who have not given yet",
    "community": "analyst and outreach for the people the Foundation serves (never a donation ask)",
    "calendar": "event outreach: who to invite to each upcoming event",
    "home": "the overview: today's priorities across all tabs",
}

INSTRUCTIONS = """You are the assistant inside The Miami Foundation's CRM. The user is on the {tab} tab: {role}.
Use the tools to look things up; never invent people, numbers, facts or events. Keep replies short.

Rules:
- Draft email or text batches first; to send, call send (it waits for the user's approval card). After
  drafting, tell the user how many drafts are ready and which ones need individual approval (organizations,
  star or big donors).
- On the community tab, outreach is about programs and help only: never ask for a donation (intent check_in).
- If a tool says data is not loaded yet, say so plainly.
- Today is {today}. Turn relative dates ("Tuesday", "next week") into YYYY-MM-DD from today before calling a tool.
- You can change records directly (people, tasks, calendar, interests, RSVPs, duplicates). Each change applies at
  once and the user sees an Undo button; say what you changed. Sends, merges and deletes wait for the user's
  approval: call the tool, and the user approves or declines on a card.
- To phone someone, call call_person (it waits for the approval card). The user's own phone rings first,
  then the person's; the call is recorded with a spoken notice and saved as a call note afterwards.
- For event outreach use plan_event_outreach: it makes one batch per event; report each event's drafts and
  who needs individual approval.
- "Work on this task: ... (task #N)" means do the work, not describe it: call get_task(N), then get_person for its
  person, then take the next step yourself. Call/email task about a late or failed gift: draft_email (or
  draft_sms if they give by text) with intent re_engage; a welcome: intent thank_you. Never send; say the
  draft is ready to review. Review task: say which records look like the same person and why, and offer the
  merge (it waits for approval). Prep task: list who is invited and what to prepare. End with "Mark done?";
  call complete_task only when the user says so.
{first_turn}{selection}"""

FIRST_TURN = """- This is the start of the conversation: before answering, call get_context and get_events. If any event
  starts within 14 days of {today}, end your reply with the offer "Plan outreach for N upcoming events?"
  (N = how many), naming them with their dates.
"""


@dataclass
class ChatContext:
    tab: str
    selection: list[int] = field(default_factory=list)
    batches: list[int] = field(default_factory=list)
    approved_by: str | None = None              # set when a person approves a paused run


def query(sql: str, args: tuple = ()) -> list[dict]:
    conn = db.connect()
    try:
        db.create_schema(conn)
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


TAB_CONTACT = {"givers": "giver", "neighbors": "neighbor", "community": "community"}


def gave_via_ids(channel: str | None) -> set[int] | None:
    """Donor ids with a gift through a matching channel (case-insensitive substring); None = no filter."""
    if not channel:
        return None
    return {r["donor_id"] for r in query("SELECT DISTINCT donor_id FROM gifts WHERE lower(channel) LIKE ? "
                                         "AND COALESCE(status, 'ok') = 'ok'",       # a declined charge isn't a gift
                                         (f"%{channel.strip().lower()}%",))}


def tab_people(tab: str) -> list[dict] | None:
    """Everyone on this tab via data's list_people once three-tab people land; None before that."""
    from service import routes_data
    if not hasattr(routes_data, "list_people"):
        return None
    conn = db.connect()
    try:
        db.create_schema(conn)
        return routes_data.list_people(conn, TAB_CONTACT.get(tab))
    finally:
        conn.close()


def not_loaded(ctx: ChatContext) -> dict:
    return {"people": [], "note": f"the {ctx.tab} list is not loaded yet (uploads for this tab are coming)"}


def last_gift_dates() -> dict[int, str]:
    """{donor id: newest gift date}; a declined charge isn't a gift."""
    return {r["donor_id"]: r["last"] for r in query(
        "SELECT donor_id, MAX(gift_date) AS last FROM gifts WHERE COALESCE(status, 'ok') = 'ok' GROUP BY donor_id")}


def interests_by_person() -> dict[int, list[str]]:
    """{donor id: interests}: what the uploaded record says plus the active tags from Enrich or staff."""
    out: dict[int, list[str]] = {}
    for r in query("SELECT id, interests FROM donors WHERE interests IS NOT NULL"):
        try:
            out[r["id"]] = [str(i) for i in json.loads(r["interests"] or "[]")]
        except ValueError:
            continue
    for r in query("SELECT donor_id, tag FROM donor_interests WHERE status = 'active'"):
        out.setdefault(r["donor_id"], []).append(r["tag"])
    return {k: list(dict.fromkeys(v)) for k, v in out.items()}


def with_gifts_and_interests(people: list[dict], no_gift_in_days: int | None, interest: str | None) -> list[dict]:
    """Add last_gift_date and interests to each person; keep only people whose last gift is at least
    no_gift_in_days old (people who never gave are left out) and whose interests mention interest."""
    lasts, tags = last_gift_dates(), interests_by_person()
    today = date.fromisoformat(os.getenv("SCORE_AS_OF") or date.today().isoformat())
    want = (interest or "").strip().lower()
    out = []
    for p in people:
        last, mine = lasts.get(p["id"]), tags.get(p["id"], [])
        if no_gift_in_days is not None and (last is None or (today - date.fromisoformat(last[:10])).days < no_gift_in_days):
            continue
        if want and not any(want in i.lower() for i in mine):
            continue
        out.append(p | {"last_gift_date": last, "interests": mine})
    return out


@function_tool
def find_people(ctx: RunContextWrapper[ChatContext], status: str | None = None, tier: str | None = None,
                star_only: bool = False, gave_via: str | None = None, no_gift_in_days: int | None = None,
                interest: str | None = None, name: str | None = None, limit: int = 25) -> dict:
    """Find people on the current tab, each with last_gift_date and interests. status: lapsing | lapsed | due |
    on_track. tier: small | mid | major. gave_via: people with a gift whose channel matches (e.g. "Give Miami Day",
    "event", "check", "online"). no_gift_in_days: people whose last gift is at least that many days old ("hasn't
    given in 7 days" = 7). interest: people whose interests mention it (e.g. "environment", "kids").
    name: people whose name contains it (use it to look someone up by name)."""
    via = gave_via_ids(gave_via)
    people = tab_people(ctx.context.tab)
    if people is not None:
        people = [p for p in people if (not status or p.get("status") == status) and (not tier or p.get("tier") == tier)
                  and (not star_only or p.get("is_star")) and (via is None or p["id"] in via)
                  and (not name or name.strip().lower() in (p.get("full_name") or "").lower())]
        people = with_gifts_and_interests(people, no_gift_in_days, interest)[:min(limit, 50)]
        keep = ("id", "full_name", "donor_type", "contact_type", "score", "tier", "is_star", "status",
                "last_gift_date", "interests", "next_step")
        return {"people": [{k: p.get(k) for k in keep} for p in people], "count": len(people)}
    if ctx.context.tab not in ("givers", "home", "calendar"):
        return not_loaded(ctx.context)
    where, args = [], []
    if status:
        where.append("s.status = ?")
        args.append(status)
    if tier:
        where.append("s.tier = ?")
        args.append(tier)
    if star_only:
        where.append("s.is_star = 1")
    if via is not None:
        where.append(f"d.id IN ({', '.join(str(i) for i in via) or 'NULL'})")
    rows = query("SELECT d.id, d.full_name, d.donor_type, s.score, s.tier, s.is_star, s.status FROM donors d "
                 "JOIN donor_scores s ON s.donor_id = d.id" + (" WHERE " + " AND ".join(where) if where else "")
                 + " ORDER BY s.score DESC", tuple(args))
    rows = with_gifts_and_interests(rows, no_gift_in_days, interest)[:min(limit, 50)]
    t = tasks_module()                  # the same next_step GET /people shows: the giver's next open task
    if t is not None:
        with_conn(t.with_next_steps, rows)
    return {"people": rows, "count": len(rows)}


@function_tool
def segment(ctx: RunContextWrapper[ChatContext], by: Literal["status", "tier", "donor_type"] = "status") -> dict:
    """Count people on the current tab, grouped by status, tier or donor_type."""
    people = tab_people(ctx.context.tab)
    if people is not None:
        groups: dict = {}
        for p in people:
            groups[p.get(by)] = groups.get(p.get(by), 0) + 1
        return {"by": by, "groups": dict(sorted(groups.items(), key=lambda kv: -kv[1]))}
    if ctx.context.tab not in ("givers", "home", "calendar"):
        return not_loaded(ctx.context)
    column = {"status": "s.status", "tier": "s.tier", "donor_type": "d.donor_type"}[by]
    rows = query(f"SELECT {column} AS grp, COUNT(*) AS n FROM donors d JOIN donor_scores s ON s.donor_id = d.id "
                 f"GROUP BY grp ORDER BY n DESC")
    return {"by": by, "groups": {r["grp"]: r["n"] for r in rows}}


@function_tool
def get_context(ctx: RunContextWrapper[ChatContext], limit: int = 5) -> dict:
    """The Foundation's saved profile and its newest sourced facts (from onboarding)."""
    profile = query("SELECT name, website, priorities FROM org_profile ORDER BY id DESC LIMIT 1")
    facts = query("SELECT source, posted_at, fact, url, priority FROM org_context "
                  "ORDER BY posted_at IS NULL, posted_at DESC, id DESC LIMIT ?", (min(limit, 20),))
    return {"profile": profile[0] if profile else None, "facts": facts}


@function_tool
def get_events(ctx: RunContextWrapper[ChatContext]) -> dict:
    """Upcoming events with dates and source links."""
    try:
        from service import routes_data
        conn = db.connect()
        try:
            return {"events": routes_data.list_events(conn)}
        finally:
            conn.close()
    except (ImportError, AttributeError):
        return {"events": [], "note": "the events list is not available yet"}


def draft_batch(ctx: ChatContext, person_ids: list[int], intent: str, channel: str) -> dict:
    from service import routes_campaigns as rc

    if ctx.tab == "community" and intent != "check_in":
        return {"error": "community outreach never asks for a donation: use intent check_in"}
    if ctx.tab not in ("givers", "calendar", "home"):
        return not_loaded(ctx)
    ids = list(dict.fromkeys(person_ids))[:rc.MAX_DONORS]
    if not ids:
        return {"error": "no people given"}
    conn = db.connect()
    try:
        db.create_schema(conn)
        try:
            rows = rc.draft_rows(conn, ids, intent, channel)
        except LookupError as e:
            return {"error": str(e)}
        name = rc.default_name(intent, channel, len(ids)) + " · chat"
        batch_id = rc.insert_campaign(conn, name, intent, channel, "chat agent", rows)
        detail = rc.campaign_detail(conn, batch_id)
    finally:
        conn.close()
    ctx.batches.append(batch_id)
    return batch_summary(detail)


def batch_summary(detail: dict) -> dict:
    """What the model sees: counts and names, not bodies."""
    msgs = detail["messages"]
    return {"batch_id": detail["id"], "name": detail["name"], "channel": detail["channel"],
            "drafts": len(msgs), "status": "pending approval (nothing sent)",
            "needs_individual_approval": [m["donor_name"] for m in msgs if m["needs_individual_approval"]],
            "flagged": [m["donor_name"] for m in msgs if m["flags"]]}


def send_item(m: dict, contact_type: str = "giver") -> dict:
    """A campaign message in the UI's SendItem shape (addresses already masked)."""
    return {"id": m["id"], "person_id": m["donor_id"], "full_name": m["donor_name"], "contact_type": contact_type,
            "channel": m["channel"], "to": m["to"], "subject": m["subject"], "body": m["body"],
            "facts_used": m["facts_used"], "needs_individual_approval": m["needs_individual_approval"],
            "approval_reason": m["approval_reason"], "flags": m["flags"], "status": m["status"]}


def contact_types(ids: list[int]) -> dict[int, str]:
    """{donor id: giver | neighbor | community} once data's contact_type exists; empty before (all givers)."""
    if not ids or "contact_type" not in {r["name"] for r in query("PRAGMA table_info(donors)")}:
        return {}
    marks = ", ".join("?" * len(ids))
    return {r["id"]: r["contact_type"] or "giver"
            for r in query(f"SELECT id, contact_type FROM donors WHERE id IN ({marks})", tuple(ids))}


def pending_batch(detail: dict) -> dict:
    types = contact_types([m["donor_id"] for m in detail["messages"]])
    return {"id": detail["id"], "title": detail["name"], "channel": detail["channel"], "counts": detail["counts"],
            "items": [send_item(m, types.get(m["donor_id"], "giver")) for m in detail["messages"]]}


@function_tool
def draft_email(ctx: RunContextWrapper[ChatContext], person_ids: list[int], intent: Intent) -> dict:
    """Draft one email per person as a batch awaiting human approval. Nothing is sent."""
    return draft_batch(ctx.context, person_ids, intent, "email")


@function_tool
def draft_sms(ctx: RunContextWrapper[ChatContext], person_ids: list[int], intent: Intent) -> dict:
    """Draft one text per person as a batch awaiting human approval. Nothing is sent."""
    return draft_batch(ctx.context, person_ids, intent, "text")


@function_tool
def build_brief(ctx: RunContextWrapper[ChatContext], person_id: int) -> dict:
    """A short donor brief: giving history, score reasons and sourced facts (first version)."""
    donor = query("SELECT d.full_name, d.donor_type, d.org_name, s.score, s.tier, s.is_star, s.status, s.why "
                  "FROM donors d LEFT JOIN donor_scores s ON s.donor_id = d.id WHERE d.id = ?", (person_id,))
    if not donor:
        return {"error": f"person {person_id} not found"}
    gifts = query("SELECT amount, gift_date, channel FROM gifts WHERE donor_id = ? AND COALESCE(status, 'ok') = 'ok' "
                  "ORDER BY gift_date DESC LIMIT 6", (person_id,))   # declined/failed charges are not gifts
    facts = query("SELECT fact, source_url FROM research_facts WHERE donor_id = ? LIMIT 5", (person_id,))
    d = donor[0]
    d["why"] = json.loads(d["why"] or "{}").get("reasons", [])
    return {"person": d, "recent_gifts": gifts, "facts": facts}


@function_tool
def get_alerts(ctx: RunContextWrapper[ChatContext]) -> dict:
    """Who is late or had a failed gift (recurring givers past their usual date, failed payments)."""
    try:
        from service.gift_alerts import alerts
    except ImportError:
        return {"alerts": [], "note": "gift alerts are not available yet"}
    conn = db.connect()
    try:
        db.create_schema(conn)
        return {"alerts": alerts(conn)}
    finally:
        conn.close()


@function_tool
def plan_event_outreach(ctx: RunContextWrapper[ChatContext], event_id: int | None = None) -> dict:
    """Draft invites for upcoming events: one batch per event (audience picked by rule, invites per person).
    event_id omitted = every upcoming event. Drafts only; nothing is sent until the user approves."""
    try:
        from service.event_outreach import plan_event_outreach as plan
        result = plan("all_upcoming" if event_id is None else event_id)
    except ImportError:
        return {"events": [], "note": "the events agent is not available yet"}
    except LookupError as e:
        return {"error": str(e)}
    ctx.context.batches += [e["batch_id"] for e in result["events"] if e.get("batch_id") is not None]
    return result


@function_tool
def community_stats(ctx: RunContextWrapper[ChatContext], by: str = "program") -> dict:
    """Counts and breakdowns of the people the Foundation serves, from what it recorded."""
    return {"groups": {}, "note": "community data is not loaded yet (uploads for this tab are coming)"}


# ----------------------------------------------------------------------------------------------
# B10 (plan.md §21.2.5, §21.6.3): the agent can do anything a screen can. Reads below; every write
# returns an undo_token (shown as Undo) and is logged in agent_actions. Sends, merges and deletes carry
# needs_approval: the run pauses on an approval card and resumes only after a person clicks.
# ----------------------------------------------------------------------------------------------

def with_conn(fn, *args, **kwargs):
    conn = db.connect()
    try:
        db.create_schema(conn)
        return fn(conn, *args, **kwargs)
    finally:
        conn.close()


def write(fn, *args, **kwargs) -> dict:
    """Run one (result, undo_token) write; errors come back as {"error"} so the model can say what failed."""
    from service import agent_writes, tasks
    try:
        result, token = with_conn(fn, *args, **kwargs)
    except (agent_writes.WriteError, tasks.TaskError) as e:
        return {"error": str(e)}
    out = result if isinstance(result, dict) else {"result": result}
    return {**out, "undo_token": token}


def tasks_module():
    try:
        from service import tasks
    except ImportError:
        return None
    return tasks


@function_tool
def get_person(ctx: RunContextWrapper[ChatContext], person_id: int) -> dict:
    """One person: contact details, score and why, gifts, research facts, drafts, merges, recent call notes."""
    from fastapi import HTTPException
    from service import routes_data
    try:
        return with_conn(lambda conn: person_record(routes_data.get_donor(person_id, conn)))
    except HTTPException as e:
        return {"error": str(e.detail)}


def person_record(donor: dict) -> dict:
    """What the agent sees about a person: gifts are only charges that went through; a declined or failed
    charge moves to declined_charges, so a draft can never thank anyone for it. The UI route is unchanged."""
    gifts = donor.get("gifts") or []
    ok = [g for g in gifts if (g.get("status") or "ok") == "ok"]
    return donor | {"gifts": ok, "declined_charges": [g for g in gifts if g not in ok]}


@function_tool
def get_calendar(ctx: RunContextWrapper[ChatContext], from_date: str | None = None, to_date: str | None = None) -> dict:
    """Calendar items (events and dated tasks) between two YYYY-MM-DD dates; default the next 60 days."""
    t = tasks_module()
    if t is None:
        return {"items": [], "note": "the calendar is not available yet"}
    return {"items": with_conn(t.calendar, from_date, to_date)}


@function_tool
def get_task(ctx: RunContextWrapper[ChatContext], task_id: int) -> dict:
    """One task by id: kind, title, why, person_id, chips, due, done, source."""
    t = tasks_module()
    if t is None:
        return {"error": "tasks are not available yet"}
    try:
        return {"task": with_conn(t.get_task, task_id)}
    except t.NotFound as e:
        return {"error": str(e)}


@function_tool
def get_tasks(ctx: RunContextWrapper[ChatContext], due: str | None = None, from_date: str | None = None,
              to_date: str | None = None, person_id: int | None = None) -> dict:
    """Tasks. due='today' for today's list, or a from/to date range, optionally for one person."""
    t = tasks_module()
    if t is None:
        return {"tasks": [], "note": "tasks are not available yet"}
    return {"tasks": with_conn(lambda conn: t.list_tasks(conn, due=due, from_=from_date, to=to_date,
                                                          person_id=person_id))}


@function_tool
def get_call_notes(ctx: RunContextWrapper[ChatContext], person_id: int | None = None, limit: int = 10) -> dict:
    """Saved call notes (newest first), optionally for one person."""
    return {"call_notes": with_conn(lambda conn: db.list_call_notes(conn, donor_id=person_id, limit=min(limit, 50)))}


@function_tool
def search_context(ctx: RunContextWrapper[ChatContext], query: str, k: int = 6) -> dict:
    """Search the organization's own context (website, news, call notes), newest and most relevant first."""
    try:
        from service.org_context import search_context as search
    except ImportError:
        search = None
    if search is not None:
        return {"results": search(query, k=min(k, 20))}
    words = [w for w in query.lower().split() if len(w) > 2][:6]
    rows = with_conn(lambda conn: [dict(r) for r in conn.execute(
        "SELECT id, source AS kind, fact AS text, url AS source_url, posted_at FROM org_context "
        "ORDER BY posted_at IS NULL, posted_at DESC, id DESC")])
    hits = [r for r in rows if any(w in (r["text"] or "").lower() for w in words)] or rows
    return {"results": hits[:min(k, 20)], "note": "keyword search (the context index is not available yet)"}


@function_tool
def update_person(ctx: RunContextWrapper[ChatContext], person_id: int, email: str | None = None,
                  phone: str | None = None, city: str | None = None, state: str | None = None,
                  notes: str | None = None, contact_type: Literal["giver", "neighbor", "community"] | None = None,
                  has_dog: bool | None = None) -> dict:
    """Change a person's details (only the fields given). contact_type moves them to another tab."""
    from service import agent_writes
    fields = {k: v for k, v in {"email": email, "phone": phone, "city": city, "state": state, "notes": notes,
                                "contact_type": contact_type,
                                "has_dog": None if has_dog is None else int(has_dog)}.items() if v is not None}
    return write(agent_writes.update_person, person_id, fields, actor="agent")


@function_tool
def add_contact(ctx: RunContextWrapper[ChatContext], full_name: str,
                donor_type: Literal["individual", "organization"] = "individual",
                contact_type: Literal["giver", "neighbor", "community"] | None = None,
                email: str | None = None, phone: str | None = None, city: str | None = None,
                notes: str | None = None) -> dict:
    """Add a new person or organization (no gifts). contact_type is giver unless the user says "as a neighbor"
    or "as community". Use the full name the user gives; a short name that matches one known organization is
    expanded to its exact name, and an ambiguous one comes back as a question to ask the user.
    Applies at once with Undo; an organization can then be researched with Enrich."""
    from service import agent_writes
    return write(agent_writes.add_contact, full_name, donor_type, contact_type or "giver",
                 email, phone, city, notes, actor="agent")


def interests_module():
    try:
        from service import interests
    except ImportError:
        return None
    return interests


def interest_write(fn, *args, **kwargs) -> dict:
    """42's interest writes return {..., undo: "int_..."}; surface it as undo_token like every other write."""
    try:
        out = with_conn(fn, *args, **kwargs)
    except (ValueError, LookupError) as e:
        return {"error": str(e)}
    return {**out, "undo_token": out.get("undo")}


@function_tool
def add_interest(ctx: RunContextWrapper[ChatContext], person_id: int, tag: str, sub_tag: str | None = None) -> dict:
    """Tag a person with an interest area (slug from the interest list, e.g. arts, environment)."""
    i = interests_module()
    if i is None:
        return {"error": "interest tags are not available yet"}
    return interest_write(i.add_interest, person_id, tag, sub_tag, staff="agent")


@function_tool
def remove_interest(ctx: RunContextWrapper[ChatContext], person_id: int, tag: str) -> dict:
    """Remove an interest area from a person (the row is kept, so it isn't re-added; Undo restores it)."""
    i = interests_module()
    if i is None:
        return {"error": "interest tags are not available yet"}
    return interest_write(i.remove_interest, person_id, tag, staff="agent")


@function_tool
def accept_enrichment(ctx: RunContextWrapper[ChatContext], person_id: int, fact_ids: list[str],
                      tags: list[str]) -> dict:
    """Save researched facts and interest tags from the person's latest enrichment proposal."""
    i = interests_module()
    if i is None:
        return {"error": "enrichment review is not available yet"}

    def accept(conn):
        from service import routes_interests
        from service.enrich_agent import read_interest_cache
        row = conn.execute("SELECT full_name FROM donors WHERE id = ?", (person_id,)).fetchone()
        if row is None:
            raise LookupError(f"person {person_id} not found")
        proposal = routes_interests.PROPOSALS.get(person_id) or read_interest_cache().get(row["full_name"])
        if proposal is None:
            raise LookupError("no enrichment proposal for this person yet; research them first")
        return i.accept_enrichment(conn, person_id, proposal, fact_ids, tags,
                                   agent_run_id=f"chat-accept-{uuid.uuid4().hex[:12]}")
    return interest_write(accept)


@function_tool(needs_approval=True)
def merge_duplicate(ctx: RunContextWrapper[ChatContext], suggestion_id: int, keep_id: int | None = None) -> dict:
    """Merge a suggested duplicate pair into one person. Needs the user's approval; Undo splits them again."""
    from service import agent_writes
    return write(agent_writes.merge_duplicate, suggestion_id, keep_id, ctx.context.approved_by, actor="agent")


@function_tool
def dismiss_duplicate(ctx: RunContextWrapper[ChatContext], suggestion_id: int) -> dict:
    """Mark a suggested duplicate pair as not the same person."""
    from service import agent_writes
    return write(agent_writes.dismiss_duplicate, suggestion_id, actor="agent")


@function_tool
def rsvp_event(ctx: RunContextWrapper[ChatContext], event_id: int, person_id: int,
               rsvp: Literal["yes", "no", "maybe"]) -> dict:
    """Record a person's answer to an event invitation."""
    from service import agent_writes
    return write(agent_writes.rsvp_event, event_id, person_id, rsvp, actor="agent")


TaskKind = Literal["call", "email", "review", "prep", "other"]


@function_tool
def create_task(ctx: RunContextWrapper[ChatContext], kind: TaskKind, title: str, why: str | None = None,
                person_id: int | None = None, due: str | None = None, time: str | None = None) -> dict:
    """Create a task. due (YYYY-MM-DD) puts it on the calendar; time is HH:MM."""
    t = tasks_module()
    if t is None:
        return {"error": "tasks are not available yet"}
    return write(lambda conn: t.create_task(conn, kind=kind, title=title, why=why, person_id=person_id, due=due,
                                            time=time, actor="agent"))


@function_tool
def update_task(ctx: RunContextWrapper[ChatContext], task_id: int, title: str | None = None, why: str | None = None,
                due: str | None = None, time: str | None = None, kind: TaskKind | None = None) -> dict:
    """Change a task's title, note, date, time or kind."""
    t = tasks_module()
    if t is None:
        return {"error": "tasks are not available yet"}
    fields = {k: v for k, v in {"title": title, "why": why, "due": due, "time": time, "kind": kind}.items()
              if v is not None}
    return write(lambda conn: t.update_task(conn, task_id, actor="agent", **fields))


@function_tool
def complete_task(ctx: RunContextWrapper[ChatContext], task_id: int, done: bool = True) -> dict:
    """Mark a task done (or not done)."""
    t = tasks_module()
    if t is None:
        return {"error": "tasks are not available yet"}
    return write(lambda conn: t.complete_task(conn, task_id, done=done, actor="agent"))


@function_tool(needs_approval=True)
def delete_task(ctx: RunContextWrapper[ChatContext], task_id: int) -> dict:
    """Delete a task. Needs the user's approval; Undo restores it."""
    t = tasks_module()
    if t is None:
        return {"error": "tasks are not available yet"}
    return write(lambda conn: t.delete_task(conn, task_id, actor="agent"))


@function_tool
def add_calendar_item(ctx: RunContextWrapper[ChatContext], title: str, date: str, time: str | None = None,
                      kind: TaskKind = "other", why: str | None = None, person_id: int | None = None) -> dict:
    """Put something on the calendar on a YYYY-MM-DD date (a dated task)."""
    t = tasks_module()
    if t is None:
        return {"error": "the calendar is not available yet"}
    return write(lambda conn: t.add_calendar_item(conn, title=title, date_=date, time=time, kind=kind, why=why,
                                                  person_id=person_id, actor="agent"))


@function_tool
def move_calendar_item(ctx: RunContextWrapper[ChatContext], ref: str, date: str, time: str | None = None) -> dict:
    """Move a calendar item (ref from get_calendar, e.g. 'task:12') to another date/time."""
    t = tasks_module()
    if t is None:
        return {"error": "the calendar is not available yet"}
    return write(lambda conn: t.move_calendar_item(conn, ref, date_=date, time=time, actor="agent"))


@function_tool(needs_approval=True)
def delete_calendar_item(ctx: RunContextWrapper[ChatContext], ref: str) -> dict:
    """Remove a calendar item. Needs the user's approval; Undo restores it."""
    t = tasks_module()
    if t is None:
        return {"error": "the calendar is not available yet"}
    return write(lambda conn: t.delete_calendar_item(conn, ref, actor="agent"))


def after_call_module():
    try:
        from service import after_call_agent
    except ImportError:
        return None
    return after_call_agent


@function_tool
def get_after_call_actions(ctx: RunContextWrapper[ChatContext], call_note_id: str) -> dict:
    """Suggested follow-ups from a saved call note (tasks, RSVPs, pledges, interest tags), each with an id.
    Nothing is written; apply the ones the user wants with apply_after_call_actions."""
    aca = after_call_module()
    if aca is None:
        return {"error": "after-call actions are not available yet"}
    try:
        return with_conn(aca.propose, call_note_id)
    except LookupError as e:
        return {"error": str(e)}
    except Exception as e:  # another lane's failure: tell the user plainly instead of a raw tool error
        return {"error": f"after-call actions failed ({type(e).__name__}: {e})"}


@function_tool
def apply_after_call_actions(ctx: RunContextWrapper[ChatContext], call_note_id: str,
                             action_ids: list[str]) -> dict:
    """Apply suggested follow-ups from a call note by id (from get_after_call_actions); each applies at most once."""
    aca = after_call_module()
    if aca is None:
        return {"error": "after-call actions are not available yet"}
    try:
        return with_conn(aca.apply_actions, call_note_id, action_ids, actor="agent")
    except LookupError as e:
        return {"error": str(e)}
    except Exception as e:  # another lane's failure: tell the user plainly instead of a raw tool error
        return {"error": f"after-call actions failed ({type(e).__name__}: {e})"}


@function_tool(needs_approval=True)
def send(ctx: RunContextWrapper[ChatContext], batch_id: int, message_ids: list[int] | None = None) -> dict:
    """Send a drafted batch. Needs the user's approval. message_ids lists items needing individual approval
    (organizations, star or big donors) that the user approved; others in the batch go if they need none."""
    from service.main import SendChoice, SendRequest, send_batch
    from fastapi import HTTPException
    req = SendRequest(batch_id=batch_id, approved_by=ctx.context.approved_by or "chat approval",
                      items=[SendChoice(id=i, approve=True) for i in message_ids] if message_ids else None)
    try:
        return send_batch(batch_id, req)
    except HTTPException as e:
        return {"error": str(e.detail)}


@function_tool(needs_approval=True)
def call_person(ctx: RunContextWrapper[ChatContext], person_id: int) -> dict:
    """Phone a person from the staff member's own number. Needs the user's approval. The staff member's phone
    rings first; once they answer, this person's phone rings. The call is recorded after a spoken notice, then
    transcribed, summarized and saved as a call note with suggested follow-ups."""
    from service import phone
    try:
        return with_conn(phone.start_call, person_id)
    except (phone.PhoneError, LookupError) as e:
        return {"error": str(e)}


@function_tool
def undo(ctx: RunContextWrapper[ChatContext], undo_token: str) -> dict:
    """Undo one earlier change by its undo_token."""
    from service import agent_writes, tasks
    try:
        return with_conn(agent_writes.undo, undo_token)
    except (agent_writes.WriteError, tasks.TaskError) as e:
        return {"error": str(e)}


TOOLS = [
    # reads
    find_people, get_person, segment, get_context, search_context, get_events, get_alerts, get_calendar, get_task, get_tasks,
    get_call_notes, build_brief, community_stats,
    # writes (each returns an undo_token)
    update_person, add_contact, add_interest, remove_interest, accept_enrichment, dismiss_duplicate, rsvp_event,
    create_task, update_task, complete_task, add_calendar_item, move_calendar_item, get_after_call_actions,
    apply_after_call_actions,
    draft_email, draft_sms, plan_event_outreach, undo,
    # approval-gated: the run pauses on an approval card
    merge_duplicate, delete_task, delete_calendar_item, send, call_person,
]
APPROVAL_TOOLS = {t.name for t in TOOLS if getattr(t, "needs_approval", False)}


def summarize(output) -> str:
    """One line for the UI's step list."""
    try:
        data = output if isinstance(output, dict) else json.loads(output)
    except (TypeError, ValueError):
        return str(output)[:160]
    if "error" in data:
        return f"error: {data['error']}"
    if isinstance(data.get("task"), dict):                  # get_task
        t = data["task"]
        return f"task #{t.get('id')}: {t.get('title')}" + (" (done)" if t.get("done") else "")
    if "full_name" in data and "gifts" in data:            # get_person: a donor record
        gifts = data.get("gifts") or []
        return f"{data['full_name']}: {len(gifts)} gift{'s' if len(gifts) != 1 else ''}" + (
            f", score {data['score']}" if data.get("score") is not None else "")
    if "batch_id" in data and "sent" in data:   # the send result: approved by a person, then delivered
        blocked = len(data.get("blocked") or [])
        return (f"Approved: batch #{data['batch_id']}, {data['sent']} sent"
                + (f", {blocked} blocked" if blocked else "")
                + (" (dry run)" if data.get("simulated") else ""))
    if "batch_id" in data:
        needs = data.get("needs_individual_approval") or []
        extra = f", {len(needs)} need individual approval" if needs else ""
        return f"batch #{data['batch_id']}: {data.get('drafts', 0)} drafts, pending approval{extra}"
    if "people" in data:
        names = ", ".join(p["full_name"] for p in data["people"][:4])
        return data.get("note") or f"{data.get('count', 0)} people" + (f": {names}" if names else "")
    if "groups" in data:
        return data.get("note") or ", ".join(f"{k}: {v}" for k, v in data["groups"].items())
    if "facts" in data and "profile" in data:
        return f"{len(data['facts'])} facts" + (f" for {data['profile']['name']}" if data["profile"] else "")
    if "events" in data and "givers_only" in data:
        made = [e for e in data["events"] if e.get("batch_id") is not None]
        return (f"{len(made)} event batch{'es' if len(made) != 1 else ''}: "
                + "; ".join(f"{e['title']} ({e['starts_at'][:10]}): {e.get('drafts', 0)} drafts" for e in data["events"]))
    if "events" in data:
        return data.get("note") or f"{len(data['events'])} events"
    if "alerts" in data:
        return data.get("note") or f"{len(data['alerts'])} alerts"
    if "person" in data:
        return f"brief for {data['person']['full_name']}"
    if "results" in data:
        return data.get("note") or f"{len(data['results'])} context results"
    if "tasks" in data:
        return data.get("note") or f"{len(data['tasks'])} tasks"
    if "items" in data and "people" not in data:
        return data.get("note") or f"{len(data['items'])} calendar items"
    if "call_notes" in data:
        return f"{len(data['call_notes'])} call notes"
    if "undone" in data:
        return f"undone: {data.get('action', '')} {data.get('target', '')}".strip()
    if "title" in data and "kind" in data and "id" in data:                       # a task / calendar item
        when = " ".join(x for x in (data.get("due"), data.get("time")) if x)
        state = "deleted" if data.get("deleted_at") else "done" if data.get("done") else "saved"
        return f"task #{data['id']} {state}: {data['title']}" + (f" ({when})" if when else "")
    if "person_id" in data and "contact_type" in data and "full_name" in data and "gifts" not in data:
        return f"added {data['donor_type']} {data['full_name']} (person {data['person_id']}, {data['contact_type']})"
    if "person_id" in data and "after" in data:
        return f"updated person {data['person_id']}: " + ", ".join(f"{k} = {v}" for k, v in data["after"].items())
    if "full_name" in data and "gifts" in data:                                    # get_person
        bits = [b for b in (data.get("status"), f"score {data['score']}" if data.get("score") is not None else None) if b]
        return data["full_name"] + (f" ({', '.join(bits)})" if bits else "")
    if "interests" in data:
        return f"interests: {', '.join(i.get('tag', '') for i in data['interests'])}"
    if "rsvp" in data and "event_id" in data:                                     # rsvp_event
        answer = {"yes": "attending", "no": "not attending", "maybe": "maybe"}.get(data["rsvp"], data["rsvp"])
        when = ""
        if data.get("starts_at"):
            try:
                d = date.fromisoformat(str(data["starts_at"])[:10])
                when = f" ({d:%a %b} {d.day})"
            except ValueError:
                when = f" ({data['starts_at']})"
        who = data.get("full_name") or f"person {data['person_id']}"
        what = data.get("event_title") or f"event {data['event_id']}"
        return f"RSVP: {who} → {what}{when}, {answer}"
    if "suggestion_id" in data:
        return f"duplicate {data['suggestion_id']}: {data.get('status') or 'merged'}"
    return json.dumps(data)[:160]


def output_data(output) -> dict:
    try:
        data = output if isinstance(output, dict) else json.loads(output)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def steps_from(items) -> list[dict]:
    """[{tool, args, summary, status, undo_token}]: each tool call the model made, for the UI's step cards."""
    calls, steps = {}, []
    for item in items:
        if isinstance(item, ToolCallItem):
            raw = item.raw_item
            call_id = getattr(raw, "call_id", None) or getattr(raw, "id", None)
            try:
                args = json.loads(getattr(raw, "arguments", "") or "{}")
            except ValueError:
                args = {}
            calls[call_id] = {"tool": getattr(raw, "name", "tool"), "args": args, "summary": None,
                              "status": "done", "undo_token": None, "call_id": call_id}
            steps.append(calls[call_id])
        elif isinstance(item, ToolCallOutputItem):
            raw = item.raw_item
            call_id = raw.get("call_id") if isinstance(raw, dict) else getattr(raw, "call_id", None)
            if call_id in calls:
                summary = summarize(item.output)
                if calls[call_id]["tool"].startswith("delete_") and not summary.startswith("error"):
                    summary = "deleted: " + summary.split(": ", 1)[-1]     # tasks' public shape has no deleted_at
                calls[call_id]["summary"] = summary
                calls[call_id]["status"] = "error" if summary.startswith("error") else "done"
                calls[call_id]["undo_token"] = output_data(item.output).get("undo_token")
    return steps


# Paused runs waiting on an approval card: run_id -> what rebuilds the same agent + the saved RunState.
PENDING: dict[str, dict] = {}


def build_agent(tab: str, selection: list[int], event_id: int | None, first_turn: bool) -> Agent:
    today = os.getenv("SCORE_AS_OF") or date.today().isoformat()
    picked = f"\nThe user has selected these people (ids): {selection}." if selection else ""
    if event_id is not None:
        picked += f"\nThe user is looking at event id {event_id}."
    first = FIRST_TURN.format(today=today) if first_turn else ""
    return Agent(name="CRM assistant",
                 instructions=INSTRUCTIONS.format(tab=tab, role=TAB_ROLE.get(tab, tab), selection=picked,
                                                  first_turn=first, today=today),
                 model=os.getenv("OPENAI_MODEL_DEFAULT"), tools=TOOLS,
                 model_settings=ModelSettings(reasoning=Reasoning(effort="low")))


def approval_summary(tool: str, args: dict) -> str | None:
    """One plain line for an approval card ("Call Maria Delgado at ***-***-0101"); None = show the arguments."""
    from service.routes_campaigns import mask_address
    if tool == "call_person" and args.get("person_id") is not None:
        rows = query("SELECT full_name, phone FROM donors WHERE id = ?", (args["person_id"],))
        if rows:
            phone = mask_address(rows[0]["phone"], "text")
            return f"Call {rows[0]['full_name']}" + (f" at {phone}" if phone else " (no phone number on file)")
    if tool == "send" and args.get("batch_id") is not None:
        rows = query("SELECT c.name, c.channel, COUNT(m.id) AS n FROM campaigns c LEFT JOIN campaign_messages m "
                     "ON m.campaign_id = c.id WHERE c.id = ? GROUP BY c.id", (args["batch_id"],))
        if rows:
            r = rows[0]
            kind = "email" if r["channel"] == "email" else "text"
            return f"Send {r['n']} {kind}{'s' if r['n'] != 1 else ''}: {r['name']}"
    return None


def approval_items(interruptions) -> list[dict]:
    """The paused calls as approval cards: call_id, tool, args and a plain summary."""
    out = []
    for i in interruptions or []:
        args = output_data(i.arguments)
        out.append({"call_id": i.call_id, "tool": i.name, "args": args, "summary": approval_summary(i.name, args)})
    return out


def respond(result, ctx: ChatContext, spec: dict, shown: list[dict] | None = None) -> dict:
    """The /chat response for a finished or paused run. shown = steps the thread already displays (a resumed
    run): the SDK's resumed result repeats them, so only new steps and the approved call's result go back."""
    from service import routes_campaigns as rc

    done = {s["call_id"] for s in (shown or []) if s["status"] != "awaiting_approval"}
    steps = [s for s in steps_from(result.new_items) if s["call_id"] not in done]
    approvals = approval_items(getattr(result, "interruptions", None))
    run_id = None
    if approvals:
        run_id = uuid.uuid4().hex
        PENDING[run_id] = {**spec, "state": result.to_state().to_string(), "steps": (shown or []) + steps}
        waiting = {a["call_id"] for a in approvals}
        for s in steps:
            if s["call_id"] in waiting:
                verb = s["tool"].split("_")[0] if s["tool"] != "send" else "send"
                s.update(status="awaiting_approval", summary=f"waiting for your approval to {verb}")
    batches = []
    if ctx.batches:
        conn = db.connect()
        try:
            batches = [pending_batch(rc.campaign_detail(conn, b)) for b in ctx.batches]
        finally:
            conn.close()
    reply = result.final_output if not approvals else (
        result.final_output or "Waiting for you: " + "; ".join(a["summary"] or a["tool"].replace("_", " ")
                                                              for a in approvals) + ".")
    return {"reply": reply, "tab": ctx.tab, "steps": steps, "run_id": run_id, "approvals": approvals,
            "pending_batch": batches[-1] if batches else None, "batches": batches}


def run_chat(message: str, tab: str, selection: list[int] | None = None, history: list[dict] | None = None,
             event_id: int | None = None) -> dict:
    """What POST /chat runs: {reply, tab, steps, run_id, approvals, pending_batch, batches}.
    approvals non-empty = the run is paused on approval cards; resume with resume_chat(run_id, ...)."""
    turns = [{"role": h["role"], "content": h["content"]} for h in (history or [])[-12:]
             if h.get("role") in ("user", "assistant") and h.get("content")]
    spec = {"tab": tab, "selection": list(selection or []), "event_id": event_id, "first_turn": not turns}
    ctx = ChatContext(tab=tab, selection=spec["selection"])
    agent = build_agent(tab, spec["selection"], event_id, spec["first_turn"])
    result = Runner.run_sync(agent, turns + [{"role": "user", "content": message}], context=ctx, max_turns=12)
    return respond(result, ctx, spec)


def resume_chat(run_id: str, decisions: dict[str, bool], approved_by: str) -> dict:
    """A person approved or declined the paused calls (call_id -> approve). Unanswered calls are declined."""
    spec = PENDING.pop(run_id, None)
    if spec is None:
        raise KeyError(f"no paused run {run_id}")
    ctx = ChatContext(tab=spec["tab"], selection=spec["selection"], approved_by=approved_by)
    agent = build_agent(spec["tab"], spec["selection"], spec["event_id"], spec["first_turn"])
    state = asyncio.run(RunState.from_string(agent, spec["state"], context_override=ctx))
    for item in state.get_interruptions():
        (state.approve if decisions.get(item.call_id) else state.reject)(item)
    result = Runner.run_sync(agent, state, context=ctx, max_turns=12)
    return respond(result, ctx, spec, spec["steps"])
