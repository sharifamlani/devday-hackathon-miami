"""Chat agent (plan.md §17): one Agents SDK agent behind POST /chat, aware of the tab the user is on.

Tools wrap existing code and each step is returned to the UI (name, args, result summary). The model can
look people up, segment, read the org's context and events, and DRAFT email or text batches. It has no tool
that sends: a draft batch is a campaign (routes_campaigns) that a human approves with POST /send/{batch_id};
orgs, star and big donors need per-item approval there. Community outreach never asks for a donation.
"""
import asyncio
import dataclasses
import json
import os
import re
import uuid
from datetime import date
from dataclasses import dataclass, field
from typing import Literal

from agents import Agent, ModelSettings, RunContextWrapper, Runner, RunState, function_tool
from agents.items import ToolCallItem, ToolCallOutputItem
from openai.types.shared import Reasoning

from service import db, public_mode

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
- The calendar holds organization events only: add_event / move_event / delete_event. A to-do for staff is a task
  (create_task), never a calendar event.
- You can change records directly (people, tasks, calendar, interests, RSVPs, duplicates). Each change applies at
  once and the user sees an Undo button; say what you changed. Sends, merges and deletes wait for the user's
  approval: call the tool, and the user approves or declines on a card.
- When the user shares something about a person (a conversation, family, plans, preferences: "I talked to
  Rafael..."), call update_donor_summary with their words, then confirm "Updated <first name>'s summary". If the
  tool says no one or several people match, ask who they meant; never guess or write it to someone else.
- Enrich protocol ("enrich / research <person>"): call enrich_person. List each proposed fact with its source and
  each proposed interest tag, then ask whether to save them; save only the ones the user agrees to, with
  accept_enrichment(person_id, fact_ids, tags). Nothing is saved before that. If it found nothing (an individual:
  no live web research; or an uncertain identity), say why in one line.
- Call protocol: "call <person>", "phone <person>" or a call task -> call prep_call, and nothing that dials. Its
  sheet has the Call button; that button is how the user calls. Say in a line or two who they are and the
  suggested points; never add facts the sheet does not have. Use call_person only when, after seeing the sheet,
  the user says to dial now (it waits for an approval card; their phone rings first, then the person's, the call
  is recorded with a spoken notice and saved as a call note).
- For event outreach use plan_event_outreach: it makes one batch per event; report each event's drafts and
  who needs individual approval.
- "Who should I call / contact / reach out to / thank today?": call get_call_list and keep its order. It is the
  Home screen's attention list (failed gifts, then late, then new donors to welcome), then lapsing givers by
  score. For each person say why in a few words, add "next step: <next_step>" when next_step isn't null, and when
  phone_on_file is false say "no phone saved; email instead".
- "Work on this task: ... (task #N)" means do the work, not describe it: call get_task(N), then get_person for its
  person, then take the next step yourself. Call/email task about a late or failed gift: draft_email (or
  draft_sms if they give by text) with intent re_engage; a welcome: intent thank_you. Never send; say the
  draft is ready to review. Review task: follow the duplicates protocol. Prep task: list who is invited and what to prepare. End with "Mark done?";
  call complete_task only when the user says so.
- Duplicates protocol ("fix / merge / clean up the duplicates", or a review task): call resolve_duplicates once.
  When the user names the people ("merge Bob Nguyen and Robert Nguyen"), pass names=[both names]: only that pair
  is handled, and if it comes back in to_confirm, show its merge card as below.
  It merges every pair that is 80%+ sure by itself. Say how many it merged and name each pair with its score and
  evidence (each has an Undo on its card). Say the gift totals are unchanged only when gifts_unchanged is true;
  otherwise name each gift in a merged pair's counted_once (the same gift was on both records and now counts
  once: amount and date). Then, for EVERY pair in
  to_confirm, call merge_duplicate (one card per pair, all in this same turn; the person picks Merge or Keep
  separate) and give your findings for each in a short list: the evidence, both records' giving, and what makes it
  uncertain. Keep separate on a card dismisses that pair by itself; don't call dismiss_duplicate after it. With
  nothing pending, say "No possible duplicates right now." Never call resolve_duplicates unless
  the user asked.
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
    blocked: bool = False                       # public preview: a write tool was asked for and refused
    refused_calls: dict[int, str] = field(default_factory=dict)   # person id -> why call_person won't dial


def query(sql: str, args: tuple = ()) -> list[dict]:
    conn = db.connect()
    try:
        db.create_schema(conn)
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


TAB_CONTACT = {"givers": "giver", "neighbors": "neighbor", "community": "community"}


GAVE_VIA_ALIASES = ({"gmd", "give miami day"},)   # "GMD" and "Give Miami Day" are the same thing
JOINED_MIN = 6       # letters run together ("GiveMiamiDay") count only for a phrase this long: never "gmd" in "Big MD"


def _words(text: str | None) -> list[str]:
    """'give_miami_day_export_2022-2025.xlsx | sheet:GMD gifts:row:9' -> ['give', 'miami', 'day', ..., 'gmd', ...]."""
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _says(text: str | None, phrase: list[str]) -> bool:
    """The phrase as whole words in order ("give miami day" in the file name, "gmd" in "sheet:GMD gifts", but not
    "gmd" inside "Big MD"), or, for a long phrase, its letters run together ("GiveMiamiDay")."""
    words, n = _words(text), len(phrase)
    if any(words[i:i + n] == phrase for i in range(len(words) - n + 1)):
        return True
    joined = "".join(phrase)
    return len(joined) >= JOINED_MIN and joined in "".join(words)


def gave_via_ids(channel: str | None) -> set[int] | None:
    """Donor ids with an ok gift through a matching channel; None = no filter. Matches gifts.channel or the
    gift's source row (an upload often leaves channel empty: "Give Miami Day" lives only in the file name,
    give_miami_day_export_2022-2025.xlsx), ignoring case and punctuation; "GMD" = "Give Miami Day"."""
    asked = _words(channel)
    if not asked:
        return None
    alias = next((a for a in GAVE_VIA_ALIASES
                  if " ".join(asked) in a or "".join(asked) in {p.replace(" ", "") for p in a}), None)
    phrases = [p.split() for p in alias] if alias else [asked]
    rows = query("SELECT donor_id, channel, source_row FROM gifts "
                 "WHERE COALESCE(status, 'ok') = 'ok'")                    # a declined charge isn't a gift
    return {r["donor_id"] for r in rows
            if any(_says(r["channel"], p) or _says(r["source_row"], p) for p in phrases)}


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


def _stem(word: str) -> str:
    """"scholarships" -> "scholarship", "charities" -> "charity", "boxes" -> "box"; "class" stays."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("ches", "shes", "sses", "xes", "zes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def interest_key(text: str) -> str:
    """Lowercase words with plurals folded, so "Scholarships" and "scholarship" compare equal."""
    return " ".join(_stem(w) for w in re.findall(r"[a-z0-9]+", (text or "").lower()))


def interest_matches(want: str, tags: list[str]) -> bool:
    """want matches a tag at a word start, after folding case and plurals on both sides ("arts" finds
    "Arts & Culture", "environment" finds "environmental justice", "art" doesn't find "heart")."""
    key = interest_key(want)
    return not key or any(re.search(r"\b" + re.escape(key), interest_key(t)) for t in tags)


def with_gifts_and_interests(people: list[dict], no_gift_in_days: int | None, interest: str | None) -> list[dict]:
    """Add last_gift_date and interests to each person; keep only people whose last gift is at least
    no_gift_in_days old (people who never gave are left out) and whose interests mention interest."""
    lasts, tags = last_gift_dates(), interests_by_person()
    today = date.fromisoformat(os.getenv("SCORE_AS_OF") or date.today().isoformat())
    out = []
    for p in people:
        last, mine = lasts.get(p["id"]), tags.get(p["id"], [])
        if no_gift_in_days is not None and (last is None or (today - date.fromisoformat(last[:10])).days < no_gift_in_days):
            continue
        if interest and not interest_matches(interest, mine):
            continue
        out.append(p | {"last_gift_date": last, "interests": mine})
    return out


@function_tool
def find_people(ctx: RunContextWrapper[ChatContext], status: str | None = None, tier: str | None = None,
                star_only: bool = False, gave_via: str | None = None, no_gift_in_days: int | None = None,
                interest: str | None = None, name: str | None = None, limit: int = 25) -> dict:
    """Find people on the current tab, each with last_gift_date and interests. status: lapsing | lapsed | due |
    on_track; "lapsed" also returns the lapsing (about to lapse), with `split` counting each: answer with both
    numbers and the lapsed names, e.g. "1 lapsed (Veloria Bay) and 16 lapsing". count is the full match before
    limit. tier: small | mid | major. gave_via: people with a gift whose channel matches (e.g. "Give Miami Day",
    "event", "check", "online"). no_gift_in_days: people whose last gift is at least that many days old ("hasn't
    given in 7 days" = 7). interest: people whose interests mention it (e.g. "environment", "kids").
    name: people whose name contains it (use it to look someone up by name)."""
    via = gave_via_ids(gave_via)
    statuses = STATUS_ALSO.get(status, (status,)) if status else None
    people = tab_people(ctx.context.tab)
    if people is not None:
        people = [p for p in people if (not statuses or p.get("status") in statuses) and (not tier or p.get("tier") == tier)
                  and (not star_only or p.get("is_star")) and (via is None or p["id"] in via)
                  and (not name or name.strip().lower() in (p.get("full_name") or "").lower())]
        people = with_gifts_and_interests(people, no_gift_in_days, interest)
        keep = ("id", "full_name", "donor_type", "contact_type", "score", "tier", "is_star", "status",
                "last_gift_date", "interests", "next_step")
        return found(status, [{k: p.get(k) for k in keep} for p in people], limit)
    if ctx.context.tab not in ("givers", "home", "calendar"):
        return not_loaded(ctx.context)
    where, args = [], []
    if statuses:
        where.append(f"s.status IN ({', '.join('?' * len(statuses))})")
        args.extend(statuses)
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
    out = found(status, with_gifts_and_interests(rows, no_gift_in_days, interest), limit)
    t = tasks_module()                  # the same next_step GET /people shows: the giver's next open task
    if t is not None:
        with_conn(t.with_next_steps, out["people"])
    return out


# "Lapsed givers" on stage means both: the few already lapsed and the many about to (donor_scores.status).
STATUS_ALSO = {"lapsed": ("lapsed", "lapsing")}


def found(status: str | None, people: list[dict], limit: int) -> dict:
    """find_people's answer: the first `limit` people (at most 50), the full count, and for "lapsed" the split."""
    out = {"people": people[:min(limit, 50)], "count": len(people)}
    if status in STATUS_ALSO:
        lapsed = [p for p in people if p.get("status") == "lapsed"]
        out["split"] = {"lapsed": len(lapsed), "lapsing": len(people) - len(lapsed),
                        "lapsed_names": [p.get("full_name") for p in lapsed]}
    return out


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
    """A campaign message in the UI's SendItem shape (addresses as the API returns them)."""
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


# The call list's order: the Home attention badges worth a call, then lapsing givers (routes_home.BADGE_ORDER).
CALL_BADGES = ("failed", "late", "new")


@function_tool
def get_call_list(ctx: RunContextWrapper[ChatContext], limit: int = 8) -> dict:
    """Who to call or contact today, in the CRM's own order: the Home attention list first (a failed gift, then
    late, then a new donor to welcome), then lapsing givers by score. Each: id, full_name, badge (failed | late | new |
    lapsing), why, next_step (the giver's next open task, or null) and phone_on_file."""
    from service import routes_home, score
    t = tasks_module()
    conn = db.connect()
    try:
        db.create_schema(conn)
        people = [{"id": a["id"], "full_name": a["name"], "badge": a["badge"], "why": a["line"]}
                  for a in routes_home.attention(conn, score.default_as_of(), 50) if a["badge"] in CALL_BADGES]
        seen = {p["id"] for p in people}
        for r in conn.execute("SELECT d.id, d.full_name FROM donors d JOIN donor_scores s ON s.donor_id = d.id "
                              "WHERE s.status = 'lapsing' AND COALESCE(d.contact_type, 'giver') = 'giver' "
                              "ORDER BY s.score DESC, d.id"):
            if r["id"] not in seen:
                people.append({"id": r["id"], "full_name": r["full_name"], "badge": "lapsing",
                               "why": "lapsing: past their usual time to give"})
        people = people[:max(1, min(limit, 25))]
        info = {r["id"]: r for r in conn.execute(
            f"SELECT id, phone, contact_type FROM donors WHERE id IN ({', '.join('?' * len(people)) or 'NULL'})",
            [p["id"] for p in people])}
        for p in people:
            p["contact_type"] = info[p["id"]]["contact_type"] if p["id"] in info else None
            p["phone_on_file"] = bool(p["id"] in info and (info[p["id"]]["phone"] or "").strip())
        if t is not None:
            t.with_next_steps(conn, people)
        else:
            for p in people:
                p["next_step"] = None
        for p in people:
            p.pop("contact_type", None)
        return {"people": people, "count": len(people)}
    finally:
        conn.close()


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
    charge moves to declined_charges, so a draft can never thank anyone for it. A 'duplicate' row (the same gift
    recorded on a merged twin) is in neither list: it isn't a second gift and it isn't a charge that failed.
    The UI route is unchanged."""
    gifts = donor.get("gifts") or []
    ok = [g for g in gifts if (g.get("status") or "ok") == "ok"]
    return donor | {"gifts": ok, "declined_charges": [g for g in gifts if g.get("status") in ("declined", "failed")]}


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


@function_tool
def enrich_person(ctx: RunContextWrapper[ChatContext], person_id: int) -> dict:
    """Research a person or organization from public, professional sources (the donor page's Enrich): proposes
    facts with their sources and interest tags. Writes nothing; save the ones the user agrees to with
    accept_enrichment(person_id, fact_ids, tags). Individuals aren't researched live (D6); the note says so."""
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as Timeout
    from service import enrich_agent, routes_interests
    rows = query("SELECT id, full_name, org_name, city, state, email, donor_type FROM donors WHERE id = ?", (person_id,))
    if not rows:
        return {"error": f"person {person_id} not found"}
    d = rows[0]
    # The research runs its own agent, which can't share this run's event loop: give it a worker thread
    with ThreadPoolExecutor(max_workers=1) as pool:
        job = pool.submit(enrich_agent.enrich_full, d["full_name"], d["org_name"], d["city"], d["donor_type"],
                          False, d["state"], d["email"])
        try:
            result = job.result(timeout=routes_interests.ENRICH_TIMEOUT_S)
        except Timeout:
            return {"error": f"the research took longer than {routes_interests.ENRICH_TIMEOUT_S} s; try again"}
    routes_interests.PROPOSALS[person_id] = result           # what accept_enrichment saves from
    return {"person_id": person_id, "full_name": d["full_name"], "identity_match": result.get("identity_match"),
            "facts": [{"id": f["id"], "fact": f["fact"], "source_url": f["source_url"]} for f in result.get("facts", [])],
            "interests": [{"tag": i["tag"], "label": i.get("label"), "confidence": i.get("confidence"),
                           "evidence": i.get("evidence")} for i in result.get("interests", [])],
            "note": result.get("notes")}


@function_tool(needs_approval=True)
def merge_duplicate(ctx: RunContextWrapper[ChatContext], suggestion_id: int, keep_id: int | None = None) -> dict:
    """Merge a suggested duplicate pair into one person. Needs the user's approval; Undo splits them again."""
    from service import agent_writes
    line = approval_summary("merge_duplicate", {"suggestion_id": suggestion_id, "keep_id": keep_id})  # before the merge
    out = write(agent_writes.merge_duplicate, suggestion_id, keep_id, ctx.context.approved_by, actor="agent")
    if line and "error" not in out:
        out["label"] = "merged " + re.sub(r" \(\d+% match: .*\)$", "", line.removeprefix("Merge "))
    return out


@function_tool
def dismiss_duplicate(ctx: RunContextWrapper[ChatContext], suggestion_id: int) -> dict:
    """Mark a suggested duplicate pair as not the same person."""
    from service import agent_writes
    row = query("SELECT status FROM duplicate_suggestions WHERE id = ?", (suggestion_id,))
    if row and row[0]["status"] == "dismissed":     # Keep separate on its card already did it (keep_separate)
        return {"suggestion_id": suggestion_id, "status": "dismissed", "note": "already kept separate"}
    try:
        return write(agent_writes.dismiss_duplicate, suggestion_id, actor="agent")
    except LookupError as e:                        # not pending any more (merged, superseded) or unknown
        return {"error": str(e)}


# Sharif (Nov 8): a pair at or above this confidence the agent merges by itself when asked to fix duplicates;
# below it, the pair comes to the user on a Merge / Keep separate card with the agent's findings.
AUTO_MERGE_AT = float(os.getenv("AUTO_MERGE_AT", "0.8"))


def duplicate_pairs(conn) -> list[dict]:
    """Pending duplicate pairs, surest first, each side with its giving (gifts that went through), so the
    agent and the user can judge. Addresses are masked."""
    from service.routes_campaigns import mask_address
    out = []
    for s in conn.execute("SELECT * FROM duplicate_suggestions WHERE status = 'pending' ORDER BY confidence DESC, id"):
        sides = {}
        for side in ("a", "b"):
            pid = s[f"donor_{side}_id"]
            d = conn.execute("SELECT id, full_name, donor_type, contact_type, email, phone, city FROM donors WHERE id = ?",
                             (pid,)).fetchone()
            g = conn.execute("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total, MAX(gift_date) AS last FROM gifts "
                             "WHERE donor_id = ? AND COALESCE(status, 'ok') = 'ok'", (pid,)).fetchone()
            sides[side] = None if d is None else {
                **dict(d), "email": mask_address(d["email"], "email"), "phone": mask_address(d["phone"], "text"),
                "gifts": g["n"], "total_given": round(g["total"], 2), "last_gift": g["last"]}
        out.append({"suggestion_id": s["id"], "confidence": s["confidence"], "reasons": json.loads(s["reasons"]),
                    "a": sides["a"], "b": sides["b"]})
    return out


def gift_totals(conn) -> dict:
    """Gifts that went through: the merge must leave these exactly as they were."""
    r = conn.execute("SELECT COUNT(*), ROUND(COALESCE(SUM(amount), 0), 2) FROM gifts "
                     "WHERE COALESCE(status, 'ok') = 'ok'").fetchone()
    return {"count": r[0], "total": r[1]}


def giver_count(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM donors WHERE COALESCE(contact_type, 'giver') = 'giver'").fetchone()[0]


def names_match(pair: dict, names: list[str]) -> bool:
    """Each name the user gave matches one side of the pair (case-insensitive, either way round)."""
    sides = [(pair[k] or {}).get("full_name", "").lower() for k in ("a", "b")]
    wanted = [n.strip().lower() for n in names if n.strip()]
    if not wanted:
        return True
    return all(any(w in side or side in w for side in sides if side) for w in wanted) and (
        len(wanted) < 2 or {i for w in wanted for i, side in enumerate(sides) if side and (w in side or side in w)} == {0, 1})


@function_tool
def resolve_duplicates(ctx: RunContextWrapper[ChatContext], names: list[str] | None = None) -> dict:
    """Duplicates protocol, only when the user asks to fix / merge / clean up duplicates (or works a review task).
    Merges every pending pair that is at least 80% sure, by itself, and returns each with its evidence and an Undo;
    returns the less certain pairs in to_confirm, with both records' giving, for the user to decide.
    names: when the user names the people ("merge Bob Nguyen and Robert Nguyen"), only the pair matching them."""
    from service import agent_writes, dedupe, score
    names = [n for n in (names or []) if n and n.strip()]

    def pending(conn) -> list[dict]:
        return [p for p in duplicate_pairs(conn) if names_match(p, names)]

    def run(conn):
        before = {"gifts": gift_totals(conn), "givers": giver_count(conn)}
        merged, skipped, tried = [], [], set()
        for _ in range(3):        # each merge re-scans, which can surface a new sure pair (a chain of three records)
            sure = [p for p in pending(conn) if p["confidence"] >= AUTO_MERGE_AT and p["suggestion_id"] not in tried]
            if not sure:
                break
            for p in sure:
                tried.add(p["suggestion_id"])
                try:
                    result, token = agent_writes.merge_duplicate(conn, p["suggestion_id"], None,
                                                                 f"agent ({AUTO_MERGE_AT:.0%}+ match)", actor="agent")
                except agent_writes.WriteError as e:      # superseded by an earlier merge in this pass
                    skipped.append({"suggestion_id": p["suggestion_id"], "reason": str(e)})
                    continue
                kept_a = result.get("kept_donor_id") == p["a"]["id"]
                kept, gone = (p["a"], p["b"]) if kept_a else (p["b"], p["a"])
                once = [int(i) for i in result.get("counted_once") or []]     # #185: the same gift on both records
                counted_once = [{"amount": r["amount"], "date": r["gift_date"]} for r in conn.execute(
                    f"SELECT amount, gift_date FROM gifts WHERE id IN ({', '.join('?' * len(once))}) ORDER BY gift_date",
                    once)] if once else []
                kept_name, gone_name = kept["full_name"], gone["full_name"]
                if kept_name == gone_name:   # same name on both records: tell them apart by their giving
                    label = lambda x: f"{x['full_name']} ({x['gifts']} gift{'s' if x['gifts'] != 1 else ''})"   # noqa: E731
                    kept_name, gone_name = label(kept), label(gone)
                merged.append({"suggestion_id": p["suggestion_id"], "confidence": p["confidence"],
                               "reasons": p["reasons"], "kept": kept_name, "merged_in": gone_name,
                               "counted_once": counted_once, "undo_token": token,
                               "undo_merge_id": result.get("merge_id")})
            score.run(conn)
            dedupe.run(conn)
        rest = pending(conn)
        after = {"gifts": gift_totals(conn), "givers": giver_count(conn)}
        out = {"merged": merged, "skipped": skipped, "to_confirm": rest, "gifts": after["gifts"],
               "gifts_unchanged": after["gifts"] == before["gifts"],
               "givers": {"before": before["givers"], "after": after["givers"]}}
        if not merged and not rest:
            out["note"] = (f"No pending duplicate pair for {' and '.join(names)}." if names
                           else "No possible duplicates right now.")
        if merged:
            out["card"] = {"kind": "merged_pairs", "pairs": [
                {"suggestion_id": m["suggestion_id"], "kept": m["kept"], "merged_in": m["merged_in"],
                 "confidence": m["confidence"], "evidence": m["reasons"][0] if m["reasons"] else "",
                 "undo_token": m["undo_token"]} for m in merged]}
        return out
    return with_conn(run)


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


# ---------- calendar v3: organization events (3a). The calendar holds events only; tasks stay on the to-do list.

EventKind = Literal["fundraising", "stewardship", "community", "other"]


def event_write(fn) -> dict:
    """An events_crud write as a tool result: the event + undo_token, or {"error"}."""
    from service import events_crud as ev
    try:
        event, token = with_conn(fn)
    except (ev.EventError, ev.EventNotFound, ev.EventLocked) as e:
        return {"error": str(e)}
    return {**event, "undo_token": token}


@function_tool
def add_event(ctx: RunContextWrapper[ChatContext], title: str, date: str, time: str | None = None,
              place: str | None = None, event_kind: EventKind | None = None, notes: str | None = None) -> dict:
    """Add an organization event to the calendar (a board meeting, a gala, an open house) on a YYYY-MM-DD date,
    optional HH:MM time. Applies at once; the user sees Undo. Tasks go through create_task, not here."""
    from service import events_crud as ev
    return event_write(lambda conn: ev.add_event(conn, title=title, starts_at_=ev.starts_at(day=date, time=time),
                                                 source="agent", actor="agent", place=place, event_kind=event_kind,
                                                 notes=notes))


@function_tool
def move_event(ctx: RunContextWrapper[ChatContext], event_id: int, date: str, time: str | None = None) -> dict:
    """Move an event the staff or the agent added (event_id from get_calendar's ref 'event:N') to a new date/time.
    Events found on the Foundation's website can't be moved here."""
    from service import events_crud as ev
    return event_write(lambda conn: ev.move_event(conn, event_id, day=date, time=time, actor="agent"))


@function_tool(needs_approval=True)
def delete_event(ctx: RunContextWrapper[ChatContext], event_id: int) -> dict:
    """Remove an event the staff or the agent added. Needs the user's approval; Undo puts it back."""
    from service import events_crud as ev
    return event_write(lambda conn: ev.delete_event(conn, event_id, actor="agent"))


@function_tool
def add_calendar_item(ctx: RunContextWrapper[ChatContext], title: str, date: str, time: str | None = None,
                      place: str | None = None) -> dict:
    """Put an organization event on the calendar (same as add_event). A to-do for staff is create_task instead."""
    from service import events_crud as ev
    return event_write(lambda conn: ev.add_event(conn, title=title, starts_at_=ev.starts_at(day=date, time=time),
                                                 source="agent", actor="agent", place=place))


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


def call_refusal(person_id: int) -> str | None:
    """Why a call to this person can't be placed right now, or None. A missing number is said first (it's about
    the person: "Hye-jin Park has no phone number on file"), then the setup reasons ("Phone calls are off...")."""
    from service import phone
    row = query("SELECT full_name, org_name, phone FROM donors WHERE id = ?", (person_id,))
    if row and not phone.e164(row[0]["phone"]):
        return f"{row[0]['full_name'] or row[0]['org_name'] or f'donor {person_id}'} has no phone number on file"
    try:
        ready = with_conn(phone.preview, person_id)
    except LookupError as e:
        return str(e)
    return None if ready["ready"] else ready["reason"]


async def call_needs_approval(ctx: RunContextWrapper[ChatContext], params: dict, call_id: str) -> bool:
    """A call that can't happen gets no approval card: the tool runs at once and says why. call_person never
    dials on that path, even if things change in between."""
    person_id = int(params.get("person_id") or 0)
    reason = call_refusal(person_id)
    if reason:
        ctx.context.refused_calls[person_id] = reason
    return reason is None


@function_tool(needs_approval=call_needs_approval)
def call_person(ctx: RunContextWrapper[ChatContext], person_id: int) -> dict:
    """Phone a person from the staff member's own number. Needs the user's approval. The staff member's phone
    rings first; once they answer, this person's phone rings. The call is recorded after a spoken notice, then
    transcribed, summarized and saved as a call note with suggested follow-ups. If calling isn't possible (calls
    off, no phone number on file) it returns the reason at once, with no approval card: tell the user why."""
    from service import phone
    refused = ctx.context.refused_calls.pop(person_id, None)
    if refused:
        return {"error": refused, "refused": True}
    try:
        return with_conn(phone.start_call, person_id)
    except (phone.PhoneError, LookupError) as e:
        return {"error": str(e)}


@function_tool
def prep_call(ctx: RunContextWrapper[ChatContext], person_id: int) -> dict:
    """Prepare a call: the person's call sheet (relationship with the Foundation, giving history, any declined
    charge, interests, recent call notes, open tasks, sourced facts, suggested talking points). It appears in the
    panel with a Call button, or says there is no phone number on file. Nothing is dialed."""
    from service import call_sheet
    try:
        return {"card": with_conn(call_sheet.build, person_id)}
    except LookupError as e:
        return {"error": str(e)}


@function_tool
def undo(ctx: RunContextWrapper[ChatContext], undo_token: str) -> dict:
    """Undo one earlier change by its undo_token."""
    from service import agent_writes, tasks
    try:
        return with_conn(agent_writes.undo, undo_token)
    except (agent_writes.WriteError, tasks.TaskError) as e:
        return {"error": str(e)}



# ----------------------------------------------------------------------------------------------
# "About <donor>" (service/donor_summary.py): the agent keeps a running summary of each person. Its own block so the
# other lanes editing this file merge cleanly.
# ----------------------------------------------------------------------------------------------

@function_tool
def update_donor_summary(ctx: RunContextWrapper[ChatContext], new_info: str, person_id: int | None = None,
                         name: str | None = None) -> dict:
    """Merge something the user shared about a person (a conversation, family, plans, preferences) into that
    person's About summary; the paragraph is rewritten, never replaced. Pass person_id, or name to look them up.
    new_info is what the user said about them, in their words. No match or several matches returns an error that
    asks who they meant: relay it, never guess."""
    from service import donor_summary
    try:
        return write(donor_summary.update, new_info, person_id=person_id, name=name, kind="chat")
    except donor_summary.WriteError as e:
        return {"error": str(e)}

TOOLS = [
    # reads
    find_people, get_person, segment, get_context, search_context, get_events, get_alerts, get_call_list, get_calendar,
    get_task, get_tasks,
    get_call_notes, build_brief, community_stats, prep_call,
    # writes (each returns an undo_token)
    update_person, add_contact, add_interest, remove_interest, enrich_person, accept_enrichment, dismiss_duplicate, resolve_duplicates, rsvp_event,
    create_task, update_task, complete_task, add_calendar_item, add_event, move_event, delete_event, move_calendar_item, get_after_call_actions,
    apply_after_call_actions, update_donor_summary,
    draft_email, draft_sms, plan_event_outreach, undo,
    # approval-gated: the run pauses on an approval card
    merge_duplicate, delete_task, delete_calendar_item, send, call_person,
]
APPROVAL_TOOLS = {t.name for t in TOOLS if getattr(t, "needs_approval", False)}

# Public preview (PUBLIC_MODE=1): the agent's server-side tools bypass the HTTP allow-list, so every tool that
# is not a plain read is swapped for one that refuses without touching the db.
READ_ONLY_TOOLS = {"find_people", "get_person", "segment", "get_context", "search_context", "get_events", "get_alerts",
                   "get_calendar", "get_task", "get_tasks", "build_brief", "community_stats", "get_call_notes"}
READ_PREFIXES = ("get_", "find_", "search_", "list_")
READ_ONLY_REPLY = "This is a read-only preview, so I can't make changes, draft or send anything. I can look things up for you."


def refuse_in_preview(tool):
    """A tool the preview doesn't allow. A write or send marks the run blocked (the reply becomes READ_ONLY_REPLY);
    a read that isn't on the list just answers empty, so one refused lookup doesn't throw away the whole answer."""
    is_read = tool.name.startswith(READ_PREFIXES)

    async def invoke(ctx, _input):
        if is_read:
            return json.dumps({"note": public_mode.NOT_AVAILABLE, "results": []})
        ctx.context.blocked = True
        return json.dumps({"error": public_mode.NOT_AVAILABLE})
    return dataclasses.replace(tool, on_invoke_tool=invoke, needs_approval=False)


def redacting() -> bool:
    """public_mode.redacting() (22: PUBLIC_MODE and not PUBLIC_SHOW_ALL); before that lands, public mode redacts."""
    return getattr(public_mode, "redacting", lambda: True)()


def masked_in_preview(tool):
    """A read the preview allows, with its output masked before the model sees it (public_mode.mask_json, as for
    every public JSON response): call notes and transcripts come back empty, staff notes blank, emails and phones
    masked. The model can't repeat what it never got."""
    run = tool.on_invoke_tool

    async def invoke(ctx, input):
        out = await run(ctx, input)
        if not redacting():                         # PUBLIC_SHOW_ALL: the demo shows everything, nothing re-hidden
            return out
        try:
            data = out if isinstance(out, (dict, list)) else json.loads(out)
        except (TypeError, ValueError):
            return out
        masked = public_mode.mask_json(data)
        # They exist, they're just not shown here (only reached while redacting; show-all returned above).
        if isinstance(masked, dict) and "call_notes" in masked:
            masked["note"] = "call notes stay private in the public preview"
        return masked if isinstance(out, (dict, list)) else json.dumps(masked)
    return dataclasses.replace(tool, on_invoke_tool=invoke)


def tools_for_mode() -> list:
    if not public_mode.enabled():
        return TOOLS
    return [masked_in_preview(t) if t.name in READ_ONLY_TOOLS else refuse_in_preview(t) for t in TOOLS]


def summarize(output) -> str:
    """One line for the UI's step list."""
    try:
        data = output if isinstance(output, dict) else json.loads(output)
    except (TypeError, ValueError):
        return str(output)[:160]
    if "error" in data:
        return f"error: {data['error']}"
    if data.get("summary_updated"):                                                # update_donor_summary
        return f"Updated {data.get('first_name') or data.get('full_name')}'s summary"
    if isinstance(data.get("saved"), dict) and "facts" in data["saved"]:         # accept_enrichment
        f, i = data["saved"].get("facts", 0), data["saved"].get("interests", 0)
        kept = len(data["saved"].get("skipped_staff_tags") or [])
        return (f"saved {f} fact{'s' if f != 1 else ''} and {i} interest tag{'s' if i != 1 else ''}"
                + (f" ({kept} staff tag{'s' if kept != 1 else ''} kept as is)" if kept else ""))
    if "identity_match" in data and "facts" in data and "interests" in data:     # enrich_person
        nf, ni = len(data["facts"]), len(data["interests"])
        if not nf and not ni:
            return f"{data['full_name']}: nothing to propose" + (f" ({data['note']})" if data.get("note") else "")
        return (f"researched {data['full_name']}: {nf} fact{'s' if nf != 1 else ''}, {ni} interest tag"
                f"{'s' if ni != 1 else ''} proposed (nothing saved yet)")
    if isinstance(data.get("card"), dict) and data["card"].get("kind") == "call_sheet":
        from service import call_sheet
        return call_sheet.summary_line(data["card"])
    if "to_confirm" in data and "merged" in data:          # resolve_duplicates
        if data.get("note"):
            return data["note"]
        n = len(data["merged"])
        return f"merged {n} sure pair{'s' if n != 1 else ''} ({AUTO_MERGE_AT:.0%}+); {len(data['to_confirm'])} to confirm"
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
        return data.get("label") or data.get("note") or f"duplicate {data['suggestion_id']}: {data.get('status') or 'merged'}"
    return json.dumps(data)[:160]


DECLINED = {"merge_duplicate": "kept separate", "send": "not sent", "call_person": "not called",
            "delete_event": "kept (not deleted)", "delete_calendar_item": "kept (not deleted)"}


def nice_when(starts_at: str, with_time: bool = True) -> str:
    """'2026-11-10T15:00' -> 'Tue Nov 10, 3:00 PM'; a date alone -> 'Tue Nov 10'."""
    day = date.fromisoformat(starts_at[:10])
    out = f"{day:%a} {day:%b} {day.day}"
    clock = starts_at[11:16]
    if with_time and len(clock) == 5:
        h, m = int(clock[:2]), int(clock[3:])
        out += f", {h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"
    return out


def event_line(tool: str, data: dict) -> str | None:
    """The step line for an event write (add_event / move_event / delete_event and the calendar-item versions),
    or None when the output isn't an event."""
    if not (isinstance(data, dict) and data.get("title") and data.get("starts_at") and "source" in data
            and "kind" not in data):
        return None
    try:
        if tool.startswith("delete_"):
            day = date.fromisoformat(data["starts_at"][:10])
            return f"Deleted {data['title']} ({day:%b} {day.day})"
        when = nice_when(data["starts_at"])
    except ValueError:
        return None
    return f"Moved {data['title']} to {when}" if tool.startswith("move_") else f"Added {data['title']} · {when}"


def step_summary(tool: str, output) -> str:
    """The step card's line. A card the person declined comes back as the SDK's "Tool execution was not
    approved."; say what that meant instead. Event writes read as a sentence ("Added Board meeting · Tue Nov 10,
    3:00 PM"); other deletes say "deleted: ..." (tasks' public shape has no deleted_at)."""
    if isinstance(output, str) and "not approved" in output.lower():
        return DECLINED.get(tool, "declined")
    line = event_line(tool, output_data(output))
    if line:
        return line
    summary = summarize(output)
    if tool.startswith("delete_") and not summary.startswith("error"):
        summary = "deleted: " + summary.split(": ", 1)[-1]
    return summary


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
            if call_id in calls:      # a resumed run repeats a paused call: one step per call, filled in place
                continue
            calls[call_id] = {"tool": getattr(raw, "name", "tool"), "args": args, "summary": None,
                              "status": "done", "undo_token": None, "call_id": call_id}
            steps.append(calls[call_id])
        elif isinstance(item, ToolCallOutputItem):
            raw = item.raw_item
            call_id = raw.get("call_id") if isinstance(raw, dict) else getattr(raw, "call_id", None)
            if call_id in calls:
                summary = step_summary(calls[call_id]["tool"], item.output)
                calls[call_id]["summary"] = summary
                calls[call_id]["status"] = "error" if summary.startswith("error") else "done"
                calls[call_id]["undo_token"] = output_data(item.output).get("undo_token")
                if output_data(item.output).get("card"):                    # a richer card for the UI (kind = ...)
                    calls[call_id]["card"] = output_data(item.output)["card"]
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
                 model=os.getenv("OPENAI_MODEL_DEFAULT"), tools=tools_for_mode(),
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
        return send_summary(args["batch_id"], args.get("message_ids"))
    if tool == "merge_duplicate" and args.get("suggestion_id") is not None:
        rows = query("SELECT a.id AS a_id, a.full_name AS a_name, b.id AS b_id, b.full_name AS b_name "
                     "FROM duplicate_suggestions s JOIN donors a ON a.id = s.donor_a_id "
                     "JOIN donors b ON b.id = s.donor_b_id WHERE s.id = ?", (args["suggestion_id"],))
        if rows:
            r = rows[0]
            keep_id = args.get("keep_id")
            if keep_id is None:            # dedupe.merge's default keeper: more gifts, ties -> lower id
                counts = {d: query("SELECT COUNT(*) AS n FROM gifts WHERE donor_id = ?", (d,))[0]["n"]
                          for d in (r["a_id"], r["b_id"])}
                keep_id = sorted(counts, key=lambda d: (-counts[d], d))[0]
            keep_a = keep_id == r["a_id"]
            kept, merged = (r["a_name"], r["b_name"]) if keep_a else (r["b_name"], r["a_name"])
            pair = next((p for p in with_conn(duplicate_pairs) if p["suggestion_id"] == args["suggestion_id"]), None)
            if pair is None:
                return f"Merge {merged} into {kept}"
            if kept == merged:             # same name on both records: tell them apart by their giving
                n = lambda x: f"{x['gifts']} gift{'s' if x['gifts'] != 1 else ''}"           # noqa: E731
                k, m = (pair["a"], pair["b"]) if keep_a else (pair["b"], pair["a"])
                kept, merged = f"{kept} ({n(k)})", f"{merged} ({n(m)})"
            giving = " vs ".join(f"{x['gifts']} gift{'s' if x['gifts'] != 1 else ''} · ${x['total_given']:,.0f}"
                                 for x in (pair["a"], pair["b"]) if x)
            evidence = pair["reasons"][0] if pair["reasons"] else "similar records"
            return f"Merge {merged} into {kept} ({pair['confidence']:.0%} match: {evidence}; {giving})"
    if tool == "delete_event" and args.get("event_id") is not None:
        rows = query("SELECT title, starts_at FROM events WHERE id = ?", (args["event_id"],))
        if rows:
            return f"Delete event: {rows[0]['title']} ({rows[0]['starts_at'][:10]})"
    if tool in ("delete_task", "delete_calendar_item"):
        ref = args.get("task_id") if tool == "delete_task" else str(args.get("ref") or "").partition(":")[2]
        rows = query("SELECT title FROM tasks WHERE id = ?", (ref,)) if str(ref or "").isdigit() else []
        if rows:
            return f"Delete {'task' if tool == 'delete_task' else 'calendar item'}: {rows[0]['title']}"
    return None


INTENT_WORDS = {"thank_you": "thank-you", "re_engage": "re-engagement", "check_in": "check-in",
                "event_invite": "event invite"}


def send_summary(batch_id: int, message_ids: list[int] | None = None) -> str | None:
    """"Send thank-you email to Hye-jin Park" / "... +2 more": who would get it, counting only the messages that
    would go (still draft or approved, and only the chosen ones when message_ids is set)."""
    camp = query("SELECT name, intent, channel FROM campaigns WHERE id = ?", (batch_id,))
    if not camp:
        return None
    rows = query("SELECT m.id, m.channel, m.flags, m.needs_individual_approval, d.full_name, d.email, d.phone "
                 "FROM campaign_messages m JOIN donors d ON d.id = m.donor_id "
                 "WHERE m.campaign_id = ? AND m.status IN ('draft', 'approved') ORDER BY m.id", (batch_id,))
    if message_ids:
        chosen = {int(i) for i in message_ids}
        rows = [r for r in rows if r["id"] in chosen]
    if not rows:
        return f"Send {camp[0]['name']}: nothing left to send"
    channels = {r["channel"] for r in rows}
    kind = "email" if channels == {"email"} else "text" if channels == {"text"} else "message"
    what = f"{INTENT_WORDS.get(camp[0]['intent'], '')} {kind}{'s' if len(rows) > 1 else ''}".strip()
    who = rows[0]["full_name"] + (f" +{len(rows) - 1} more" if len(rows) > 1 else "")
    notes = send_notes(rows)
    return f"Send {what} to {who}" + (f" ({' · '.join(notes)})" if notes else "")


def send_notes(rows: list[dict]) -> list[str]:
    """What will hold some messages back, said before Send instead of after (the send rules in routes_campaigns):
    star / big / organization messages need individual approval, a missing address can't be sent, flagged ones
    wait for an edit."""
    individual = sum(1 for r in rows if r["needs_individual_approval"])
    no_email = sum(1 for r in rows if r["channel"] == "email" and not (r["email"] or "").strip())
    no_phone = sum(1 for r in rows if r["channel"] == "text" and not (r["phone"] or "").strip())
    flagged = sum(1 for r in rows if (r["flags"] or "[]") != "[]")
    notes = []
    if individual:
        notes.append(f"{individual} need{'s' if individual == 1 else ''} individual approval")
    if no_email:
        notes.append(f"{no_email} {'has' if no_email == 1 else 'have'} no email")
    if no_phone:
        notes.append(f"{no_phone} {'has' if no_phone == 1 else 'have'} no phone")
    if flagged:
        notes.append(f"{flagged} flagged")
    return notes


def approval_items(interruptions) -> list[dict]:
    """The paused calls as approval cards: call_id, tool, args and a plain summary."""
    out = []
    for i in interruptions or []:
        args = output_data(i.arguments)
        out.append({"call_id": i.call_id, "tool": i.name, "args": args, "summary": approval_summary(i.name, args)})
    return out


def waiting_line(approvals: list[dict]) -> str:
    """The stand-in reply for a run paused on cards with no words of its own. One card: what it does. Several
    (e.g. five merge cards): a count, since each card already says what it does."""
    if len(approvals) == 1:
        a = approvals[0]
        return f"Waiting for you: {a['summary'] or a['tool'].replace('_', ' ')}."
    return f"Waiting for you: {len(approvals)} decisions on the cards above."


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
    reply = result.final_output if not approvals else (result.final_output or waiting_line(approvals))
    if ctx.blocked:
        reply = READ_ONLY_REPLY
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


def keep_separate(interruptions, decisions: dict[str, bool]) -> list[int]:
    """A declined merge card means the person said these are different people: dismiss the pair now (its review
    task retires), since the run may pause again on other cards before the model could. Returns the ids."""
    from service import agent_writes
    done = []
    for item in interruptions:
        if item.name != "merge_duplicate" or decisions.get(item.call_id) is not False:
            continue
        sid = output_data(item.arguments).get("suggestion_id")
        try:
            with_conn(agent_writes.dismiss_duplicate, int(sid), actor="staff")
        except (agent_writes.WriteError, TypeError, ValueError):
            continue
        done.append(int(sid))
    return done


def resume_chat(run_id: str, decisions: dict[str, bool], approved_by: str) -> dict:
    """A person approved or declined some of the paused calls (call_id -> approve). Only those are decided:
    a call left out stays pending, so the run pauses on it again (same call_id, new run_id) and its card still
    works. Approving one of two cards must never decline the other."""
    spec = PENDING.pop(run_id, None)
    if spec is None:
        raise KeyError(f"no paused run {run_id}")
    ctx = ChatContext(tab=spec["tab"], selection=spec["selection"], approved_by=approved_by)
    agent = build_agent(spec["tab"], spec["selection"], spec["event_id"], spec["first_turn"])
    state = asyncio.run(RunState.from_string(agent, spec["state"], context_override=ctx))
    keep_separate(state.get_interruptions(), decisions)
    for item in state.get_interruptions():
        if item.call_id in decisions:
            (state.approve if decisions[item.call_id] else state.reject)(item)
    result = Runner.run_sync(agent, state, context=ctx, max_turns=12)
    return with_outcome(respond(result, ctx, spec, spec["steps"]), decisions, spec["steps"])


# A reply written as if the card were still waiting ("pending deletion", "approve on the card").
STILL_PENDING = re.compile(r"\b(pending|waiting for (your )?approval|ready for (your )?approval|approve (it )?on the card)\b",
                           re.I)


def with_outcome(out: dict, decisions: dict[str, bool], shown: list[dict]) -> dict:
    """After the person decides, the reply says what happened. When the resumed run says nothing, or still talks
    as if the card were waiting, the reply becomes the decided steps' own lines ("Deleted Board meeting (Nov 10).",
    "Kept Board meeting (2026-11-10)."). A run that paused again keeps its reply."""
    if out.get("approvals") or (out.get("reply") and not STILL_PENDING.search(out["reply"])):
        return out
    args = {s["call_id"]: (s["tool"], s.get("args") or {}) for s in shown if s.get("call_id") in decisions}
    lines = []
    for step in out.get("steps") or []:
        if step.get("call_id") not in decisions or step.get("status") == "error":
            continue
        tool, a = args.get(step["call_id"], (step.get("tool") or "", step.get("args") or {}))
        if decisions[step["call_id"]]:
            lines.append(step["summary"][:1].upper() + step["summary"][1:])
        else:
            card = approval_summary(tool, a) or ""
            what = card.split(": ", 1)[1] if ": " in card else ""
            lines.append(f"Kept {what}" if tool.startswith("delete_") and what else
                         (DECLINED.get(tool, "declined")[:1].upper() + DECLINED.get(tool, "declined")[1:]))
    if lines:
        out["reply"] = " ".join(line.rstrip(".") + "." for line in lines)
    return out
