"""Calendar outreach: one pending campaign batch per upcoming event (plan.md §17).

plan_event_outreach("all_upcoming" | event_id) runs, per event:
  events_agent.suggest_audience (the rule picks who) -> draft_event_invite per person (email if there's an
  address, else a text if there's a phone, else skipped) -> ONE campaign (intent 'event_invite',
  campaigns.event_id) via routes_campaigns, so approval works exactly as for any batch: orgs, star and big
  donors need per-item approval, and nothing is sent until a human approves it with POST /send.
An event that already has a batch returns that batch instead of drafting again. Community invites never
carry a donation ask (events_agent's ask_line + check_invite). Until data's contact_type lands, only Givers
exist, and each event says so.
"""
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from service import db

DRAFT_WORKERS = 4
GIVERS_ONLY_NOTE = "only Givers are loaded so far; Neighbors and Community join once uploads assign tabs"
NO_EVENTS_NOTE = "no upcoming events saved yet: run Refresh now to read them from the website"


def events_agent():
    from service import events_agent as ea   # 86's lane; callers turn ImportError into "not available yet"
    return ea


def today() -> str:
    return os.getenv("SCORE_AS_OF") or date.today().isoformat()


def load_events(conn: sqlite3.Connection) -> list[dict]:
    """data's events table when it exists; otherwise the events agent's last good run (ids by position)."""
    from service import routes_data

    if hasattr(routes_data, "list_events"):
        return routes_data.list_events(conn)
    events = events_agent().extract_events(refresh=False)
    return [{**e, "id": i} for i, e in enumerate(events, 1)]


def load_people(conn: sqlite3.Connection) -> tuple[list[dict], bool]:
    """(everyone the audience rule may pick, givers_only). data's list_people carries contact_type,
    has_dog and interests; before it lands every donor is a giver."""
    from service import routes_data

    if hasattr(routes_data, "list_people"):
        return routes_data.list_people(conn), False
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""SELECT d.id, d.full_name, d.first_name, d.donor_type, d.email, d.phone,
                                  s.tier, s.is_star, s.status FROM donors d
                           LEFT JOIN donor_scores s ON s.donor_id = d.id ORDER BY d.id""")
    return [dict(r) | {"contact_type": "giver"} for r in rows], True


def existing_batch(conn: sqlite3.Connection, event_id: int) -> int | None:
    try:
        row = conn.execute("SELECT id FROM campaigns WHERE event_id = ? AND intent = 'event_invite' "
                           "ORDER BY id DESC LIMIT 1", (event_id,)).fetchone()
    except sqlite3.OperationalError:   # campaigns without event_id
        return None
    return row[0] if row else None


def short_date(starts_at: str) -> str:
    d = date.fromisoformat(starts_at[:10])
    return f"{d:%b} {d.day}"


def invite_row(event: dict, person: dict) -> dict:
    """One message for one person, or {"skip": reason}."""
    from service.campaign_agent import CampaignDraft

    channel = "email" if person.get("email") else "text" if person.get("phone") else None
    if channel is None:
        return {"skip": "no email or phone on file"}
    try:
        invite = events_agent().draft_event_invite(event, person)
    except Exception as e:   # the invite failed its own checks twice, or the model failed: leave it out
        return {"skip": f"invite not drafted ({type(e).__name__}: {e})"[:200]}
    body = invite["email_body"] if channel == "email" else invite["sms"]
    used = list(invite.get("facts_used", []))
    note = None
    if channel == "email":                       # §21.2.4: the invite tells the story too, each line cited
        body, story_used, notes = with_story(body)
        used += story_used
        note = " ".join(notes) or None
    draft = CampaignDraft(subject=invite["subject"] if channel == "email" else None, body=body,
                          facts_used=used, drafted_by="model", note=note)
    from service.campaign_agent import sources_of
    draft.sources = sources_of(used)
    return {"donor": person, "channel": channel, "draft": draft}


STORY_LINES = (("success_story", "A story we're proud of"), ("use_of_funds", "Where gifts go"),
               ("org_health", "How the Foundation is doing"))


def with_story(body: str) -> tuple[str, list[dict], list[str]]:
    """The newest success story, use-of-funds and org-health facts from the context store, one line each,
    placed before the sign-off. A missing kind is left out and named for staff; nothing is invented."""
    from service import outreach_agent as oa
    from service.campaign_agent import story_of

    story, notes = oa.story_facts(per_kind=1)
    tale = story_of(story)
    lines = [(label, tale[k]) for k, label in STORY_LINES if k in tale]
    if not lines:
        return body, [], notes
    block = "\n".join(f"{label}: {f['fact']}" for label, f in lines)
    head, sep, sign_off = body.rpartition("\n\n")
    body = f"{head}\n\n{block}{sep}{sign_off}" if sep else f"{body}\n\n{block}"
    return body, [f for _, f in lines], notes


def summary(conn: sqlite3.Connection, event: dict, batch_id: int | None, **extra) -> dict:
    from service import routes_campaigns as rc

    out = {"event_id": event["id"], "title": event["title"], "starts_at": event["starts_at"],
           "source_url": event.get("source_url"), "batch_id": batch_id, **extra}
    if batch_id is not None:
        msgs = rc.campaign_detail(conn, batch_id)["messages"]
        out.update(drafts=len(msgs), status="pending approval (nothing sent)",
                   needs_individual_approval=[m["donor_name"] for m in msgs if m["needs_individual_approval"]])
    return out


def plan_event(conn: sqlite3.Connection, event: dict, people: list[dict], givers_only: bool) -> dict:
    from service import routes_campaigns as rc

    found = existing_batch(conn, event["id"])
    if found is not None:
        return summary(conn, event, found, existing=True)

    audience = events_agent().suggest_audience(event, people, rationale=False)
    by_id = {p["id"]: p for p in people}
    chosen = [by_id[i] for i in audience["person_ids"] if i in by_id][:rc.MAX_DONORS]
    note = GIVERS_ONLY_NOTE if givers_only and audience["event_kind"] != "giving" else None
    with ThreadPoolExecutor(max_workers=DRAFT_WORKERS) as pool:      # one model call per invite
        results = list(pool.map(lambda p: invite_row(event, p), chosen))
    rows = [r for r in results if "skip" not in r]
    skipped = [{"person_id": p["id"], "full_name": p["full_name"], "reason": r["skip"]}
               for p, r in zip(chosen, results) if "skip" in r]
    base = {"event_kind": audience["event_kind"], "audience": len(chosen), "skipped": skipped, "note": note,
            "existing": False}
    if not rows:
        return summary(conn, event, None, drafts=0, reason="no one in the audience can be reached", **base)
    channels = {r["channel"] for r in rows}
    name = f"{event['title']} · {short_date(event['starts_at'])} · {len(rows)} {'person' if len(rows) == 1 else 'people'}"
    batch_id = rc.insert_campaign(conn, name, "event_invite", channels.pop() if len(channels) == 1 else "mixed",
                                  "calendar agent", rows, event_id=event["id"])
    return summary(conn, event, batch_id, **base)


def plan_event_outreach(target: int | str = "all_upcoming") -> dict:
    """{"events": [per-event summary], "givers_only": bool}. Drafts only; nothing is sent."""
    conn = db.connect()
    try:
        db.create_schema(conn)
        events = load_events(conn)
        if target == "all_upcoming":
            picked = [e for e in events if e["starts_at"][:10] >= today()]
        else:
            picked = [e for e in events if e["id"] == int(target)]
            if not picked:
                raise LookupError(f"event {target} not found")
        people, givers_only = load_people(conn)
        out = {"events": [plan_event(conn, e, people, givers_only) for e in picked], "givers_only": givers_only}
        if not picked and target == "all_upcoming":
            out["note"] = NO_EVENTS_NOTE
        return out
    finally:
        conn.close()
