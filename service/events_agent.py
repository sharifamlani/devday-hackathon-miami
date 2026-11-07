"""Events agent: the org's upcoming events, who to invite, and the invites themselves.

extract_events() finds upcoming events on the org's own site through the Agents SDK's hosted
WebSearchTool (a direct fetch of miamifoundation.org hits a CAPTCHA). An event is kept only if it
has a real future date and its source URL is on an allowed site and among the URLs the run's
searches actually returned ("search-cited"). The context agent's facts are passed in as hints;
they never stand in for a source. Social posts aren't searched (website + news only for now).

suggest_audience() picks people across the three tabs by rule (giving events -> Givers, lapsing
and star first; pet events -> anyone tagged with a dog; community events -> Community + Neighbors
whose interests match), and one model call writes the plain-English rationale.

draft_event_invite() writes an email + SMS: value first, the event details and its source, the
outreach checks (every figure traced, no relationship claims for non-givers, no donation ask to
Community). Organizations and star givers get status 'draft' (a person approves each one).

    python -m service.events_agent --refresh      # live run on the Foundation's site (runtime cache)
    python -m service.events_agent                # cached events
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent
sys.path.insert(0, str(SERVICE_DIR))

from org_context import (FOUNDATION_URLS, clean_text, norm_url, search_agent,  # noqa: E402
                         search_sources, site_host, strip_links)

# Committed, reviewed cache vs gitignored runtime file: same rule as the context agent
EVENTS_CACHE = SERVICE_DIR / "events_cache.json"
EVENTS_LIVE = Path(os.environ.get("EVENTS_LIVE", REPO_ROOT / "data" / "events_live.json"))
DRAFTS_FALLBACK = REPO_ROOT / "data" / "event_drafts.json"

# Sites an org runs besides its main one; an event sourced there is still the org's own
SISTER_SITES = {"miamifoundation.org": {"givemiamiday.org"}}
# ...but those sites also host OTHER nonprofits' pages, which are never the org's own events
OTHER_ORG_PATHS = ("/organization/", "/organizations/", "/nonprofit/")


def own_page(url: str) -> bool:
    return not any(part in url for part in OTHER_ORG_PATHS)


# ----------------------------------------------------------------------------------------------
# Extract
# ----------------------------------------------------------------------------------------------

class FoundEvent(BaseModel):
    title: str
    starts_at: str = Field(description="YYYY-MM-DD, or YYYY-MM-DDTHH:MM if a start time is shown")
    ends_at: str = Field(description="Same format, or empty if not shown")
    place: str = Field(description="Venue and city as shown, or empty")
    kind: str = Field(description="giving (a giving day or fundraiser) | pet (animals, dogs) | community (anything else)")
    source_url: str = Field(description="The exact page URL, as returned by search, that states this date")
    quote: str = Field(description="A short verbatim span from the result that states the date")


class FoundEvents(BaseModel):
    events: list[FoundEvent]


def today_str() -> str:
    return os.environ.get("SCORE_AS_OF") or date.today().isoformat()


def valid_when(s: str) -> bool:
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?", s or ""))


def read_runs(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save_run(host: str, events: list[dict], write_cache: bool) -> None:
    for path in [EVENTS_LIVE] + ([EVENTS_CACHE] if write_cache else []):
        runs = read_runs(path)
        runs[host] = events
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(runs, indent=2, ensure_ascii=False), encoding="utf-8")


def validate_events(found: list, cited: set[str], allowed: set[str], today: str, captured_at: str) -> tuple[list[dict], list[str]]:
    kept, dropped, seen = [], [], set()
    for e in found:
        url = norm_url(e.source_url)
        if site_host(url) not in allowed:
            dropped.append(f"off-site {url}")
        elif not own_page(url):
            dropped.append(f"another org's page {url}")
        elif url not in cited:
            dropped.append(f"url not returned by search {url}")
        elif not valid_when(e.starts_at):
            dropped.append(f"no real date: {e.title}")
        elif e.starts_at[:10] < today:
            dropped.append(f"past: {e.title} {e.starts_at}")
        elif (e.title.lower(), e.starts_at[:10]) in seen:
            dropped.append(f"duplicate: {e.title}")
        else:
            seen.add((e.title.lower(), e.starts_at[:10]))
            kind = event_kind({"title": e.title, "audience_hint": e.kind})
            kept.append({"title": clean_text(strip_links(e.title)), "starts_at": e.starts_at,
                         "ends_at": e.ends_at if valid_when(e.ends_at) else None,
                         "place": clean_text(strip_links(e.place)) or None, "audience_hint": kind,
                         "source_url": url, "source": "website" if site_host(url) in allowed else "search",
                         "quote": clean_text(strip_links(e.quote)), "verification": "search-cited",
                         "captured_at": captured_at})
    kept.sort(key=lambda e: e["starts_at"])
    return kept, dropped


def extract_events(context_facts: list[dict] | None = None, refresh: bool = False,
                   website: str = FOUNDATION_URLS["website"], write_cache: bool = False) -> list[dict]:
    """Upcoming events for the org at `website`. refresh=False returns the last good run
    (runtime file, then the committed cache). Live runs write only the runtime file unless
    write_cache=True. context_facts (from org_context) are passed as hints."""
    host = site_host(website)
    today = today_str()
    if not refresh:
        for path in (EVENTS_LIVE, EVENTS_CACHE):
            events = read_runs(path).get(host)
            if events is not None:
                return [e for e in events if e["starts_at"][:10] >= today and own_page(e["source_url"])]

    from agents import Runner
    load_dotenv(REPO_ROOT / ".env")
    allowed = {host} | SISTER_SITES.get(host, set())
    hints = "\n".join(f"- {f['fact']} ({f.get('posted_at') or f.get('date') or 'undated'})"
                      for f in (context_facts or [])[:12])
    sites = " OR ".join(f"site:{h}" for h in sorted(allowed))
    prompt = (f"Today is {today}. Find every upcoming event (on or after today, within ~60 days) that "
              f"{host} runs or promotes: giving days, races, celebrations, forums, community events. "
              f"Search {sites}. Use only pages your searches return; source_url must be that page's exact "
              f"URL and must state the date. Copy dates exactly; never guess a date or a place. "
              f"Plain text, no links or markdown.\n\nRecent context (hints, not sources):\n{hints or '- none'}")
    agent = search_agent("EventsAgent", "You find an organization's upcoming events on its own websites.", FoundEvents)
    result = asyncio.run(Runner.run(agent, prompt))
    captured_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    events, dropped = validate_events(result.final_output.events, search_sources(result), allowed, today, captured_at)
    for d in dropped:
        print(f"  dropped: {d}", file=sys.stderr)
    if events:
        save_run(host, events, write_cache)
    return events


# ----------------------------------------------------------------------------------------------
# Audience
# ----------------------------------------------------------------------------------------------

GIVING_WORDS = ("give miami day", "early giving", "giving day", "fundrais", "gala", "donat")
PET_WORDS = ("dog", "puppy", "puppies", "pet", "animal", "adoption", "paw")


def event_kind(event: dict) -> str:
    """Keywords in the title decide; the search model's label is only a fallback."""
    text = (event.get("title") or "").lower()
    if any(re.search(rf"\b{w}", text) for w in PET_WORDS):
        return "pet"
    if any(w in text for w in GIVING_WORDS):
        return "giving"
    if any(w in text for w in ("race", "festival", "5k", "forum", "summit", "celebration", "fair", "park")):
        return "community"
    return event.get("audience_hint") if event.get("audience_hint") in ("giving", "pet", "community") else "community"


def event_words(event: dict) -> set[str]:
    return set(re.findall(r"[a-z]{3,}", f"{event.get('title', '')} {event.get('place') or ''}".lower()))


def is_star_or_org(p: dict) -> bool:
    return bool(p.get("is_star")) or p.get("donor_type") == "organization"


def rule_audience(event: dict, people: list[dict]) -> tuple[str, list[dict], dict]:
    """The deterministic part: who, in what order, and a one-line reason each."""
    kind = event_kind(event)
    why = {}
    if kind == "pet":
        chosen = [p for p in people if p.get("has_dog")]
        for p in chosen:
            why[p["id"]] = "tagged as having a dog"
    elif kind == "giving":
        chosen = [p for p in people if p.get("contact_type") == "giver"]
        chosen.sort(key=lambda p: (p.get("status") != "lapsing", not p.get("is_star"), str(p.get("full_name"))))
        for p in chosen:
            tags = [t for t, on in (("lapsing", p.get("status") == "lapsing"), ("star", p.get("is_star"))) if on]
            why[p["id"]] = "giver" + (f" ({', '.join(tags)})" if tags else "")
    else:
        words = event_words(event)
        pool = [p for p in people if p.get("contact_type") in ("community", "neighbor")]
        tagged = [p for p in pool if words & {w.lower() for w in (p.get("interests") or [])}]
        chosen = tagged or pool                       # no interest matches: the whole Community + Neighbors
        for p in chosen:
            hits = sorted(words & {w.lower() for w in (p.get("interests") or [])})
            why[p["id"]] = f"{p.get('contact_type')}" + (f", interested in {', '.join(hits)}" if hits else "")
    return kind, chosen, why


def suggest_audience(event: dict, people: list[dict], rationale: bool = True) -> dict:
    """{event_kind, person_ids (ordered), why: {id: reason}, rationale}. The rule decides; the model
    only explains the choice in one or two plain sentences."""
    kind, chosen, why = rule_audience(event, people)
    text = ""
    if rationale and chosen:
        from agents import Agent, Runner
        from outreach_agent import bounded_model
        load_dotenv(REPO_ROOT / ".env")
        counts = {}
        for p in chosen:
            counts[p.get("contact_type") or "unknown"] = counts.get(p.get("contact_type") or "unknown", 0) + 1
        agent = Agent(name="AudienceRationale", model=bounded_model(),
                      instructions="In one or two plain sentences, explain to nonprofit staff why this audience "
                                   "fits this event. Use only the facts given; no numbers that aren't given.")
        text = Runner.run_sync(agent, f"Event: {event['title']} on {event['starts_at']} ({kind}). "
                                      f"Audience: {len(chosen)} people {counts}. Rule used: {sorted(set(why.values()))[:6]}").final_output
    return {"event_kind": kind, "person_ids": [p["id"] for p in chosen], "why": why, "rationale": str(text).strip()}


# ----------------------------------------------------------------------------------------------
# Invites
# ----------------------------------------------------------------------------------------------

class InviteOut(BaseModel):
    subject: str = Field(description="Email subject, under 70 characters")
    email_body: str = Field(description="80-150 words, signed by the Foundation team")
    sms: str = Field(description="Under 300 characters including the event link")


INVITE_INSTRUCTIONS = """You write an event invitation from The Miami Foundation in its voice: upbeat,
civic, plain, proudly local. Lead with value (what the event is and why it matters to this person),
then the event details exactly as given (date, time, place) and the source link, then a simple
invitation to come. Use ONLY the event details and the person facts given; never invent a number,
name, time, place or outcome. The SMS is short, friendly, and includes the source link.
Write dates exactly as given in "When:" (weekday and month name), never as numbers like 2026-11-19.
If a "Value:" fact is given, use it as the opening value line, copied faithfully.
Never describe the person by a category ("as a giver", "as a neighbor", "community member").
Follow the "Ask:" line exactly."""


def ask_line(kind: str, person: dict) -> str:
    if person.get("contact_type") == "community":
        return "an invitation to attend only. NEVER ask for a donation, gift, pledge or contribution."
    if person.get("contact_type") == "giver" and kind == "giving":
        return ("an invitation to join, mentioning they can take part at givemiamiday.org; no dollar amount."
                if not is_star_or_org(person) else "an invitation to talk or join; no dollar amount, no link to give.")
    return "an invitation to attend. No donation ask."


def value_fact(event: dict, org_facts: list[dict]) -> dict | None:
    """The org fact that best fits this event, newest first among equals; None if nothing fits
    (an unrelated fact makes a worse invite than none)."""
    from outreach_agent import GENERIC_WORDS, rank_org_facts, topics_in
    title = event.get("title") or ""
    dated = [f for f in org_facts if f.get("date")]
    if not dated:
        return None
    top = rank_org_facts({"id": 0, "full_name": title, "notes": title}, [], dated)[0]
    words = set(re.findall(r"[a-z][a-z'-]{4,}", title.lower())) - GENERIC_WORDS
    fits = topics_in(title.lower()) & topics_in(top["fact"].lower()) or any(w in top["fact"].lower() for w in words)
    return top if fits else None


def draft_event_invite(event: dict, person: dict) -> dict:
    """Email + SMS invite for one person. Status 'draft' for organizations and star givers."""
    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning
    from outreach_agent import MONEY_ASK_RE, RELATIONSHIP_RE, ModelDraft, bounded_model, check_draft

    load_dotenv(REPO_ROOT / ".env")
    from org_context import load_org_facts
    from outreach_agent import long_date
    kind = event_kind(event)
    when = long_date(date.fromisoformat(event["starts_at"][:10])) + (f" at {event['starts_at'][11:16]}" if len(event["starts_at"]) > 10 else "")
    value = value_fact(event, load_org_facts()) if kind != "pet" else None
    details = (f"{event['title']} | starts {event['starts_at']}"
               + (f" | ends {event['ends_at']}" if event.get("ends_at") else "")
               + (f" | at {event['place']}" if event.get("place") else "") + f" | source {event['source_url']}")
    person_bits = ", ".join(f"{k}: {person[k]}" for k in ("first_name", "full_name", "contact_type") if person.get(k))
    if person.get("has_dog") and kind == "pet":
        person_bits += ", has a dog"
    prompt = (f"Event: {details}\nWhen: {when}\nPerson: {person_bits}\nAsk: {ask_line(kind, person)}"
              + (f"\nValue: {value['fact']} (source {value['url']})" if value else ""))
    agent = Agent(name="EventInviteAgent", instructions=INVITE_INSTRUCTIONS, model=bounded_model(),
                  output_type=InviteOut, model_settings=ModelSettings(reasoning=Reasoning(effort="low")))
    facts = {"O1": {"fact": f"{event['title']} {event['starts_at']} {event.get('ends_at') or ''} {event.get('place') or ''}",
                    "url": event["source_url"], "date": event["starts_at"][:10]}}
    if value:
        facts["O2"] = {"fact": value["fact"], "url": value["url"], "date": value.get("date")}
    problems = []
    for attempt in range(2):
        out: InviteOut = Runner.run_sync(agent, prompt).final_output
        problems = check_invite(out, facts, person)
        if not problems:
            break
        prompt += "\n\nYour previous invite was rejected:\n- " + "\n- ".join(problems) + "\nRewrite it."
    else:
        raise ValueError(f"invite failed checks twice: {problems}")
    return {"subject": out.subject, "email_body": out.email_body, "sms": out.sms,
            "facts_used": [{"fact": event["title"], "url": event["source_url"], "date": event["starts_at"][:10]}]
                          + ([{"fact": value["fact"], "url": value["url"], "date": value.get("date")}] if value else []),
            "status": "draft" if is_star_or_org(person) else "ready",
            "channel_email": bool(person.get("email")), "channel_sms": bool(person.get("phone"))}


def check_invite(out, facts: dict, person: dict) -> list[str]:
    from outreach_agent import MONEY_ASK_RE, RELATIONSHIP_RE, ModelDraft, check_draft
    as_draft = ModelDraft(subject=out.subject, body=out.email_body, call_script=out.sms, fact_ids=["O1"])
    problems = check_draft(as_draft, facts, [], lead_id="O1")
    text = " ".join((out.subject, out.email_body, out.sms))
    if person.get("contact_type") == "community" and (m := MONEY_ASK_RE.search(text)):
        problems.append(f"'{m.group(0)}' is a donation ask; Community never gets one")
    if person.get("contact_type") in ("community", "neighbor") and (m := RELATIONSHIP_RE.search(text)):
        problems.append(f"'{m.group(0)}' implies a giving relationship this person doesn't have")
    if len(out.sms) > 320:
        problems.append("SMS is over 320 characters")
    return sorted(set(problems))


def save_invite(event: dict, person: dict, invite: dict) -> str:
    """JSON fallback until the event_drafts table exists (data's writer owns the table)."""
    rows = json.loads(DRAFTS_FALLBACK.read_text(encoding="utf-8")) if DRAFTS_FALLBACK.exists() else []
    rows.append({"event_title": event["title"], "event_starts_at": event["starts_at"], "person_id": person["id"],
                 **invite, "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    DRAFTS_FALLBACK.parent.mkdir(exist_ok=True)
    DRAFTS_FALLBACK.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    return str(DRAFTS_FALLBACK.relative_to(REPO_ROOT))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="search live (writes the gitignored runtime file)")
    ap.add_argument("--write-cache", action="store_true", help="with --refresh: also rewrite the committed cache")
    args = ap.parse_args()
    started = time.monotonic()
    from org_context import load_org_facts
    evs = extract_events(load_org_facts()[:12], refresh=args.refresh, write_cache=args.write_cache)
    for e in evs:
        print(f"{e['starts_at']:<16} [{e['audience_hint']}] {e['title']} @ {e['place'] or '-'}\n                 {e['source_url']}")
    print(f"\n{len(evs)} upcoming events in {time.monotonic() - started:.1f} s")
