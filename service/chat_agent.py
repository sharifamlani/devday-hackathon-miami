"""Chat agent (plan.md §17): one Agents SDK agent behind POST /chat, aware of the tab the user is on.

Tools wrap existing code and each step is returned to the UI (name, args, result summary). The model can
look people up, segment, read the org's context and events, and DRAFT email or text batches. It has no tool
that sends: a draft batch is a campaign (routes_campaigns) that a human approves with POST /send/{batch_id};
orgs, star and big donors need per-item approval there. Community outreach never asks for a donation.
"""
import json
import os
from dataclasses import dataclass, field
from typing import Literal

from agents import Agent, ModelSettings, RunContextWrapper, Runner, function_tool
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
- You can DRAFT email or text batches. You cannot send. After drafting, tell the user how many drafts are
  ready, which ones need individual approval (organizations, star or big donors), and that nothing is sent
  until they approve the batch.
- On the community tab, outreach is about programs and help only: never ask for a donation (intent check_in).
- If a tool says data is not loaded yet, say so plainly.
{selection}"""


@dataclass
class ChatContext:
    tab: str
    selection: list[int] = field(default_factory=list)
    batches: list[int] = field(default_factory=list)


def query(sql: str, args: tuple = ()) -> list[dict]:
    conn = db.connect()
    try:
        db.create_schema(conn)
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


def not_loaded(ctx: ChatContext) -> dict:
    return {"people": [], "note": f"the {ctx.tab} list is not loaded yet (uploads for this tab are coming)"}


@function_tool
def find_people(ctx: RunContextWrapper[ChatContext], status: str | None = None, tier: str | None = None,
                star_only: bool = False, limit: int = 25) -> dict:
    """Find people on the current tab. status: lapsing | lapsed | due | on_track. tier: small | mid | major."""
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
    rows = query("SELECT d.id, d.full_name, d.donor_type, s.score, s.tier, s.is_star, s.status FROM donors d "
                 "JOIN donor_scores s ON s.donor_id = d.id" + (" WHERE " + " AND ".join(where) if where else "")
                 + " ORDER BY s.score DESC LIMIT ?", (*args, min(limit, 50)))
    return {"people": rows, "count": len(rows)}


@function_tool
def segment(ctx: RunContextWrapper[ChatContext], by: Literal["status", "tier", "donor_type"] = "status") -> dict:
    """Count people on the current tab, grouped by status, tier or donor_type."""
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


def send_item(m: dict) -> dict:
    """A campaign message in the UI's SendItem shape (addresses already masked)."""
    return {"id": m["id"], "person_id": m["donor_id"], "full_name": m["donor_name"], "contact_type": "giver",
            "channel": m["channel"], "to": m["to"], "subject": m["subject"], "body": m["body"],
            "facts_used": m["facts_used"], "needs_individual_approval": m["needs_individual_approval"],
            "approval_reason": m["approval_reason"], "flags": m["flags"], "status": m["status"]}


def pending_batch(detail: dict) -> dict:
    return {"id": detail["id"], "title": detail["name"], "channel": detail["channel"], "counts": detail["counts"],
            "items": [send_item(m) for m in detail["messages"]]}


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
    gifts = query("SELECT amount, gift_date, channel FROM gifts WHERE donor_id = ? ORDER BY gift_date DESC LIMIT 6",
                  (person_id,))
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
def community_stats(ctx: RunContextWrapper[ChatContext], by: str = "program") -> dict:
    """Counts and breakdowns of the people the Foundation serves, from what it recorded."""
    return {"groups": {}, "note": "community data is not loaded yet (uploads for this tab are coming)"}


TOOLS = [find_people, segment, get_context, get_events, get_alerts, draft_email, draft_sms, build_brief,
         community_stats]


def summarize(output) -> str:
    """One line for the UI's step list."""
    try:
        data = output if isinstance(output, dict) else json.loads(output)
    except (TypeError, ValueError):
        return str(output)[:160]
    if "error" in data:
        return f"error: {data['error']}"
    if "batch_id" in data:
        extra = f", {len(data['needs_individual_approval'])} need individual approval" \
            if data["needs_individual_approval"] else ""
        return f"batch #{data['batch_id']}: {data['drafts']} drafts, pending approval{extra}"
    if "people" in data:
        names = ", ".join(p["full_name"] for p in data["people"][:4])
        return data.get("note") or f"{data.get('count', 0)} people" + (f": {names}" if names else "")
    if "groups" in data:
        return data.get("note") or ", ".join(f"{k}: {v}" for k, v in data["groups"].items())
    if "facts" in data and "profile" in data:
        return f"{len(data['facts'])} facts" + (f" for {data['profile']['name']}" if data["profile"] else "")
    if "events" in data:
        return data.get("note") or f"{len(data['events'])} events"
    if "alerts" in data:
        return data.get("note") or f"{len(data['alerts'])} alerts"
    if "person" in data:
        return f"brief for {data['person']['full_name']}"
    return json.dumps(data)[:160]


def steps_from(items) -> list[dict]:
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
                              "status": "done"}
            steps.append(calls[call_id])
        elif isinstance(item, ToolCallOutputItem):
            raw = item.raw_item
            call_id = raw.get("call_id") if isinstance(raw, dict) else getattr(raw, "call_id", None)
            if call_id in calls:
                summary = summarize(item.output)
                calls[call_id]["summary"] = summary
                calls[call_id]["status"] = "error" if summary.startswith("error") else "done"
    return steps


def run_chat(message: str, tab: str, selection: list[int] | None = None, history: list[dict] | None = None,
             event_id: int | None = None) -> dict:
    """What POST /chat runs: {reply, tab, steps: [{tool, args, summary, status}], pending_batch, batches}."""
    from service import routes_campaigns as rc

    ctx = ChatContext(tab=tab, selection=list(selection or []))
    picked = f"\nThe user has selected these people (ids): {ctx.selection}." if ctx.selection else ""
    if event_id is not None:
        picked += f"\nThe user is looking at event id {event_id}."
    agent = Agent(name="CRM assistant",
                  instructions=INSTRUCTIONS.format(tab=tab, role=TAB_ROLE.get(tab, tab), selection=picked),
                  model=os.getenv("OPENAI_MODEL_DEFAULT"), tools=TOOLS,
                  model_settings=ModelSettings(reasoning=Reasoning(effort="low")))
    turns = [{"role": h["role"], "content": h["content"]} for h in (history or [])[-12:]
             if h.get("role") in ("user", "assistant") and h.get("content")]
    result = Runner.run_sync(agent, turns + [{"role": "user", "content": message}], context=ctx, max_turns=8)

    batches = []
    if ctx.batches:
        conn = db.connect()
        try:
            batches = [pending_batch(rc.campaign_detail(conn, b)) for b in ctx.batches]
        finally:
            conn.close()
    return {"reply": result.final_output, "tab": tab, "steps": steps_from(result.new_items),
            "pending_batch": batches[-1] if batches else None, "batches": batches}
