"""Enrichment research agent: public, professional facts about a donor, each with a source link.

Run from the repo root:
    python -m service.enrich_agent "Frederick A. DeLuca Foundation"
    python -m service.enrich_agent "Jane Doe" --org "Acme Corp" --city Miami --donor-id 7
    python -m service.enrich_agent "Amazon" --focus "Miami giving" --cache   # research live, store in the cache
    python -m service.enrich_agent "Amazon" --interests          # facts + interest tags + contact (B1)
    python -m service.enrich_agent "Amazon" --interests --cache  # research live, store in interest_cache.json

Lookups read data/research_cache.json first (committed, so nothing slow runs live on stage);
pass refresh=True / --refresh to research live anyway.

Public professional information only: what they fund, board roles, foundation ties, press.
No home addresses, family members or personal social media. Every fact keeps a URL that loads;
facts whose URL fails a live check are dropped, never shown. If nothing survives, the result is empty
and the caller shows "no public information found".
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from agents import Agent, ModelSettings, Runner, WebSearchTool
from dotenv import load_dotenv
from openai.types.shared import Reasoning
from pydantic import BaseModel, Field

from service.interests import (LABELS, SUBTAGS, TAGS, Confidence, SourceType, SubTagSlug, TagSlug,
                               fact_id)

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

# Until db.py lands, facts go here; save_facts() is the only writer, so swapping in SQLite is one edit
FACTS_JSON = REPO_ROOT / "data" / "research_facts.json"
# Precomputed research keyed by donor name, committed so the demo never waits on web search
CACHE_JSON = REPO_ROOT / "data" / "research_cache.json"
NO_INFO = "no public information found"
INDIVIDUAL_SKIP = "individual donors are not researched in the demo"
URL_TIMEOUT_S = 8


class Fact(BaseModel):
    fact: str
    source_url: str
    retrieved_at: str  # ISO 8601 UTC, stamped by us when the run finishes
    cached: bool = False  # True when it came from data/research_cache.json because the live run failed


# What the model returns; retrieved_at is stamped in code, not trusted to the model
class ResearchedFact(BaseModel):
    fact: str = Field(description="One short, specific, verifiable sentence")
    source_url: str = Field(description="The exact page the fact came from")


class Research(BaseModel):
    facts: list[ResearchedFact]


INSTRUCTIONS = """You research donors for The Miami Foundation's philanthropy team.
Use web search to find PUBLIC, PROFESSIONAL facts about the donor named by the user:
what they fund, grants and causes, board or leadership roles, foundation ties, employer, press coverage.

Rules:
- Every fact must come from a page you actually found; source_url is that page's exact URL.
- Never invent or guess. If you cannot confirm a fact, leave it out.
- Make sure the results are about THIS donor (use the organization and city to disambiguate).
- Never include home addresses, family members, personal phone numbers or personal social media.
- Return 2 to 5 facts, the most useful for a fundraiser first. If you find nothing reliable, return an empty list.
"""

agent = Agent(
    name="Donor enrichment",
    instructions=INSTRUCTIONS,
    model=os.getenv("OPENAI_MODEL_DEFAULT"),
    tools=[WebSearchTool(search_context_size="low")],
    output_type=Research,
    model_settings=ModelSettings(reasoning=Reasoning(effort="low")),
)


def url_loads(url: str) -> bool:
    """True only when the URL ends (after redirects) in HTTP 200; used to drop facts with dead links."""
    if not url.startswith(("http://", "https://")):
        return False
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (donor-enrichment check)"})
    try:
        with urllib.request.urlopen(request, timeout=URL_TIMEOUT_S) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False


def clean_fact(text: str) -> str:
    """Strip markdown links from fact text; the URL belongs only in source_url.

    Drops parenthetical citations like "([site.org](url))" and turns inline "[text](url)" into "text".
    """
    text = re.sub(r"\s*\(\[[^\]]*\]\([^)]*\)\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    return text.strip()


def read_cache() -> dict[str, list[dict]]:
    return json.loads(CACHE_JSON.read_text(encoding="utf-8")) if CACHE_JSON.exists() else {}


def write_cache(name: str, facts: list[Fact]) -> None:
    """Store one donor's facts in the cache under its name, replacing any earlier entry."""
    cache = read_cache()
    cache[name] = [f.model_dump(exclude={"cached"}) for f in facts]
    CACHE_JSON.parent.mkdir(parents=True, exist_ok=True)
    CACHE_JSON.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def skip_reason(org_name: str | None = None, donor_type: str | None = None) -> str | None:
    """Why a donor is not researched live, or None if it may be.

    Organizations only: the sample individuals are fictional, and a web search on a common name ties
    a real person's board seat and employer to invented gifts (plan §3).
    """
    if donor_type == "individual" or (donor_type != "organization" and not org_name):
        return INDIVIDUAL_SKIP
    return None


def cached_facts(name: str) -> list[Fact] | None:
    """The committed cache's facts for this name, each flagged cached=True; None when it has none."""
    cached = read_cache().get(name)
    return None if cached is None else [Fact(**{**f, "cached": True}) for f in cached]


def enrich_donor(name: str, org_name: str | None = None, city: str | None = None,
                 focus: str | None = None, refresh: bool = False,
                 donor_type: str | None = None, use_cache: bool = False) -> list[Fact]:
    """Research one donor and return sourced facts whose URLs load. Empty list means nothing public found.

    Always a live run. data/research_cache.json is read only when the live run raises (refresh=False),
    and those facts come back flagged cached=True so the UI can say so. use_cache=True serves the cache
    without a model call: the precompute pipeline's explicit snapshot build, never the app.
    focus steers the search (e.g. "Miami giving").
    Individuals are never researched live (see skip_reason); cached entries are vetted organizations.
    """
    if use_cache and not refresh:
        cached = cached_facts(name)
        if cached is not None:
            return cached
    if skip_reason(org_name, donor_type):
        return []
    try:
        if focus:   # the CLI's steered search: facts only, no identity data to check
            return research_live(name, org_name, city, focus)
        found = enrich_full(name, org_name, city, donor_type, refresh=True)
        return [Fact(fact=f["fact"], source_url=f["source_url"], retrieved_at=f["retrieved_at"]) for f in found["facts"]]
    except Exception:
        cached = None if refresh else cached_facts(name)
        if cached is None:
            raise
        return cached


def research_live(name: str, org_name: str | None, city: str | None, focus: str | None) -> list[Fact]:
    query = f"Donor: {name}"
    if org_name:
        query += f"\nOrganization: {org_name}"
    if city:
        query += f"\nCity: {city}"
    if focus:
        query += f"\nFocus the research on: {focus}"

    result = Runner.run_sync(agent, query)
    retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    researched = result.final_output.facts

    # Check every link in parallel and keep only facts whose source actually loads
    with ThreadPoolExecutor(max_workers=8) as pool:
        alive = list(pool.map(url_loads, [f.source_url for f in researched]))
    return [Fact(fact=clean_fact(f.fact), source_url=f.source_url, retrieved_at=retrieved_at)
            for f, ok in zip(researched, alive) if ok]


def save_facts(donor_id: int, facts: list[Fact], agent_run_id: str) -> int:
    """Write facts as research_facts rows (donor_id, fact, source_url, retrieved_at, agent_run_id).

    Writes to data/donors.db (via service.db) when that db exists; otherwise falls back to
    data/research_facts.json. Idempotent: a (donor_id, source_url, fact) already saved is skipped,
    so repeated runs never duplicate a fact. Returns rows actually written.
    """
    try:
        from service import db
    except ImportError:
        db = None
    if db is not None and db.db_path().exists():
        conn = db.connect()
        db.create_schema(conn)          # an older donors.db gains research_facts.cached
        written = 0
        with conn:
            for f in facts:
                written += conn.execute(
                    "INSERT INTO research_facts (donor_id, fact, source_url, retrieved_at, agent_run_id, cached) "
                    "SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM research_facts "
                    "WHERE donor_id = ? AND source_url = ? AND fact = ?)",
                    (donor_id, f.fact, f.source_url, f.retrieved_at, agent_run_id, int(f.cached),
                     donor_id, f.source_url, f.fact),
                ).rowcount
        conn.close()
        return written

    rows = json.loads(FACTS_JSON.read_text(encoding="utf-8")) if FACTS_JSON.exists() else []
    seen = {(r["donor_id"], r["source_url"], r["fact"]) for r in rows}
    new_rows = []
    for f in facts:
        key = (donor_id, f.source_url, f.fact)
        if key not in seen:
            seen.add(key)
            new_rows.append({"donor_id": donor_id, **f.model_dump(), "agent_run_id": agent_run_id})
    rows.extend(new_rows)
    FACTS_JSON.parent.mkdir(parents=True, exist_ok=True)
    FACTS_JSON.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    return len(new_rows)


# --- Interest areas (B1, plan §21.2.6): facts + interest tags + public contact in one structured run ---

# Precomputed interest proposals keyed by donor name (facts stay in research_cache.json)
INTEREST_CACHE_JSON = REPO_ROOT / "data" / "interest_cache.json"
IDENTITY_UNSAFE = ("ambiguous", "not_found")


class FoundInterest(BaseModel):
    tag: TagSlug
    sub_tag: SubTagSlug | None = Field(description="A sub-tag of THIS tag, or null")
    confidence: Confidence
    evidence: str = Field(description="Short quote or paraphrase from the source, under 300 characters")
    source_url: str = Field(description="The exact page that shows this evidence")
    source_type: SourceType


class Location(BaseModel):
    city: str | None
    region: str | None
    country: str | None


class Contact(BaseModel):
    employer: str | None
    title: str | None
    linkedin_url: str | None
    public_email: str | None
    public_phone: str | None
    website: str | None
    location: Location
    source_urls: list[str] = Field(description="Pages that show these contact values")


class Enrichment(BaseModel):
    identity_match: Literal["confirmed", "probable", "ambiguous", "not_found"]
    identity_basis: list[str] = Field(description="What matched, e.g. name, employer, city")
    facts: list[ResearchedFact]
    interests: list[FoundInterest]
    contact: Contact
    notes: str | None


TAXONOMY = "\n".join(f"- {slug} ({label}): {definition}. Sub-tags: {', '.join(subs)}"
                     for slug, label, definition, subs, _, _ in TAGS)

ENRICH_INSTRUCTIONS = f"""You research donors for a community foundation's philanthropy team. Use web search to find
PUBLIC, PROFESSIONAL information about the donor named by the user, and return:
1. facts: 2-5 short, specific facts useful to a fundraiser (what they fund, board roles, foundation ties, press),
   each with the exact URL of the page it came from.
2. interests: the causes this donor supports, tagged ONLY from this list (tag and sub-tag slugs exactly):
{TAXONOMY}
3. contact: public professional contact details (website, public email or phone, employer, title, city), each
   shown on a page listed in source_urls; null when not found. Never guess a value.

Evidence for an interest, strongest first: board or officer seat at a cause org > named gift or grant to a
cause org > named fund > public statement > event sponsor or host > volunteer or advisory role > event
attendance or professional focus > social follow (never enough alone).
Confidence: high = a board seat, named gift or named fund (or two independent mid signals) with identity
matched on two attributes; medium = one statement, sponsorship or volunteer role with identity matched on
two attributes; low = a weak signal or identity matched on name only.

Rules:
- Every interest cites a source_url and a short evidence quote from that page. No URL, no tag.
- Untagged beats guessed: return an empty interests list when evidence is thin.
- Never infer an interest from who the donor appears to be: race, ethnicity or national origin (including
  from a name), religion, sexual orientation, disability, health, age or politics. Tag immigrant services or
  faith-based only for a documented gift, role or statement about that cause.
- If two different people or organizations could match, set identity_match to "ambiguous" and return no
  interests. If you find nothing about this donor, set "not_found".
- Public professional information only: no home addresses, family members or personal social accounts.
"""

enrichment_agent = Agent(
    name="Donor enrichment (interests)",
    instructions=ENRICH_INSTRUCTIONS,
    model=os.getenv("OPENAI_MODEL_DEFAULT"),
    tools=[WebSearchTool(search_context_size="low")],
    output_type=Enrichment,
    model_settings=ModelSettings(reasoning=Reasoning(effort="low")),
)

CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2}
# An organization's public email is kept only when it's a shared mailbox, never a named person's address
GENERIC_MAILBOXES = ("info", "contact", "hello", "grants", "giving", "media", "press", "communications",
                     "office", "admin", "general", "inquiries", "community", "foundation", "philanthropy")


def generic_mailbox(email: str | None) -> str | None:
    local = (email or "").split("@")[0].lower()
    return email if email and any(local.startswith(m) for m in GENERIC_MAILBOXES) else None


# --- Identity: a name match alone never counts (c9: "Whitaker Family Charitable Fund" got a South Carolina
# org's tags). A run is trusted only when the org's name AND one more attribute from the donor row match what
# the agent found on a page that loads: the city, the state, or a website domain = the donor's email domain.

US_STATES = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california", "CO": "colorado",
    "CT": "connecticut", "DE": "delaware", "DC": "district of columbia", "FL": "florida", "GA": "georgia",
    "HI": "hawaii", "ID": "idaho", "IL": "illinois", "IN": "indiana", "IA": "iowa", "KS": "kansas",
    "KY": "kentucky", "LA": "louisiana", "ME": "maine", "MD": "maryland", "MA": "massachusetts",
    "MI": "michigan", "MN": "minnesota", "MS": "mississippi", "MO": "missouri", "MT": "montana",
    "NE": "nebraska", "NV": "nevada", "NH": "new hampshire", "NJ": "new jersey", "NM": "new mexico",
    "NY": "new york", "NC": "north carolina", "ND": "north dakota", "OH": "ohio", "OK": "oklahoma",
    "OR": "oregon", "PA": "pennsylvania", "RI": "rhode island", "SC": "south carolina", "SD": "south dakota",
    "TN": "tennessee", "TX": "texas", "UT": "utah", "VT": "vermont", "VA": "virginia", "WA": "washington",
    "WV": "west virginia", "WI": "wisconsin", "WY": "wyoming", "PR": "puerto rico",
}
# Mail domains that say nothing about an organization's identity (incl. the sample data's example.* domains)
PERSONAL_DOMAINS = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "me.com",
                    "live.com", "msn.com", "proton.me", "protonmail.com", "example.com", "example.org", "example.net"}
IDENTITY_NOTE = ("Only the name matched: the city, state and website on the pages found don't match this "
                 "donor's record, so nothing was suggested.")


def _norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def state_name(state: str | None) -> str:
    s = _norm(state)
    return US_STATES.get(s.upper(), s) if len(s) == 2 else s


def _domain(value: str | None) -> str:
    v = (value or "").strip().lower()
    v = v.split("@", 1)[1] if "@" in v else re.sub(r"^[a-z]+://", "", v).split("/", 1)[0]
    return v[4:] if v.startswith("www.") else v


def identity_matches(e: "Enrichment", alive: dict[str, bool], city: str | None, state: str | None,
                     email: str | None) -> list[str]:
    """Which donor-row attributes besides the name match what the agent found: city, state, website.

    The agent's location and website count only when a contact source page loads. An empty list means a
    name-only match, which never counts.
    """
    if not any(alive.get(u) for u in e.contact.source_urls):
        return []
    loc = e.contact.location
    matched = []
    if city and loc.city and _norm(city) == _norm(loc.city):
        matched.append("city")
    if state and loc.region and state_name(state) == state_name(loc.region):
        matched.append("state")
    mail = _domain(email)
    site = _domain(e.contact.website)
    if mail and site and mail not in PERSONAL_DOMAINS and (site == mail or site.endswith("." + mail)):
        matched.append("website")
    return matched


def empty_enrichment(reason: str | None = None, identity_match: str = "not_found") -> dict:
    return {"identity_match": identity_match, "identity_basis": [], "facts": [], "interests": [],
            "contact": {}, "notes": reason, "searched_at": None}


def finalize(e: Enrichment, alive: dict[str, bool], searched_at: str) -> dict:
    """Apply the rules in Python: dead links drop, unsafe identity means no tags, faith_based capped."""
    if e.identity_match in IDENTITY_UNSAFE:
        return {**empty_enrichment(e.notes, e.identity_match), "searched_at": searched_at}
    facts = [{"id": fact_id(clean_fact(f.fact), f.source_url), "fact": clean_fact(f.fact),
              "source_url": f.source_url, "retrieved_at": searched_at}
             for f in e.facts if alive.get(f.source_url)]
    best: dict[tuple, dict] = {}
    for i in e.interests:
        if not alive.get(i.source_url):
            continue
        confidence = i.confidence
        if i.tag == "faith_based" and i.source_type not in ("board_seat", "named_gift") and confidence == "high":
            confidence = "medium"            # never above medium without a named gift or role
        sub_tag = i.sub_tag if i.sub_tag in SUBTAGS[i.tag] else None
        item = {"id": i.tag, "tag": i.tag, "label": LABELS[i.tag], "sub_tag": sub_tag, "confidence": confidence,
                "evidence": clean_fact(i.evidence)[:300], "source_url": i.source_url, "source_type": i.source_type}
        key = (i.tag, sub_tag)
        if key not in best or CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[best[key]["confidence"]]:
            best[key] = item
    sources = [u for u in e.contact.source_urls if alive.get(u)]
    contact = {}
    if sources:
        contact = {**e.contact.model_dump(exclude={"source_urls"}), "source_urls": sources}
        contact["public_email"] = generic_mailbox(contact["public_email"])
    return {"identity_match": e.identity_match, "identity_basis": e.identity_basis, "facts": facts,
            "interests": sorted(best.values(), key=lambda i: (-CONFIDENCE_RANK[i["confidence"]], i["tag"])),
            "contact": contact, "notes": e.notes, "searched_at": searched_at}


def read_interest_cache() -> dict[str, dict]:
    return json.loads(INTEREST_CACHE_JSON.read_text(encoding="utf-8")) if INTEREST_CACHE_JSON.exists() else {}


def write_interest_cache(name: str, result: dict) -> None:
    cache = read_interest_cache()
    cache[name] = result
    INTEREST_CACHE_JSON.parent.mkdir(parents=True, exist_ok=True)
    INTEREST_CACHE_JSON.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def enrich_full(name: str, org_name: str | None = None, city: str | None = None,
                donor_type: str | None = None, refresh: bool = False, state: str | None = None,
                email: str | None = None) -> dict:
    """Facts, interest tags and public contact for one donor. Writes nothing (the caller decides).

    Returns {identity_match, identity_basis, facts: [{id, fact, source_url, retrieved_at}],
    interests: [{id, tag, label, sub_tag, confidence, evidence, source_url, source_type}], contact, notes,
    searched_at}. Cached donors (data/interest_cache.json) come back with no model call unless refresh=True.
    Individuals are never researched live (skip_reason): a made-up person gets no tags.
    A live run counts only when the name AND one more attribute match (identity_matches); otherwise it comes
    back as identity_match "ambiguous" with no facts or tags.
    """
    if not refresh:
        cached = read_interest_cache().get(name)
        if cached is not None:
            return cached
    reason = skip_reason(org_name, donor_type)
    if reason:
        return empty_enrichment(reason, "not_researched")

    query = (f"Donor: {name}" + (f"\nOrganization: {org_name}" if org_name else "")
             + (f"\nCity: {city}" if city else "") + (f"\nState: {state}" if state else ""))
    e: Enrichment = Runner.run_sync(enrichment_agent, query).final_output
    searched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    urls = sorted({f.source_url for f in e.facts} | {i.source_url for i in e.interests} | set(e.contact.source_urls))
    with ThreadPoolExecutor(max_workers=8) as pool:
        alive = dict(zip(urls, pool.map(url_loads, urls)))
    result = finalize(e, alive, searched_at)
    if result["identity_match"] in IDENTITY_UNSAFE:
        return result
    matched = identity_matches(e, alive, city, state, email)
    if not matched:
        return {**empty_enrichment(IDENTITY_NOTE, "ambiguous"), "identity_basis": ["name"], "searched_at": searched_at}
    return {**result, "identity_basis": ["name", *matched]}


def main() -> int:
    parser = argparse.ArgumentParser(description="Research a donor's public, professional facts.")
    parser.add_argument("name")
    parser.add_argument("--org", dest="org_name")
    parser.add_argument("--city")
    parser.add_argument("--type", dest="donor_type", default="organization",
                        choices=["organization", "individual"], help="individuals are never researched live")
    parser.add_argument("--focus", help="what the live research should concentrate on")
    parser.add_argument("--donor-id", type=int, help="also save the facts as research_facts rows")
    parser.add_argument("--refresh", action="store_true", help="ignore the cache and research live")
    parser.add_argument("--cache", action="store_true", help="research live and store the result in the cache")
    parser.add_argument("--interests", action="store_true", help="facts + interest tags + contact (enrich_full)")
    args = parser.parse_args()

    if args.interests:
        sys.stdout.reconfigure(encoding="utf-8")
        start = time.perf_counter()
        result = enrich_full(args.name, args.org_name, args.city, args.donor_type, refresh=args.refresh or args.cache)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if args.cache and result["searched_at"]:
            write_interest_cache(args.name, result)
            print(f"cached under {args.name!r} in {INTEREST_CACHE_JSON.relative_to(REPO_ROOT)}")
        print(f"{len(result['interests'])} interest tag(s), {len(result['facts'])} fact(s), "
              f"identity {result['identity_match']}, {time.perf_counter() - start:.1f}s")
        return 0

    start = time.perf_counter()
    facts = enrich_donor(args.name, args.org_name, args.city, args.focus,
                         refresh=args.refresh or args.cache, donor_type=args.donor_type)
    elapsed = time.perf_counter() - start

    if not facts:
        print(skip_reason(args.org_name, args.donor_type) or NO_INFO)
    for i, f in enumerate(facts, 1):
        print(f"{i}. {f.fact}\n   {f.source_url}\n   retrieved {f.retrieved_at}")
    if args.cache:
        if facts:
            write_cache(args.name, facts)
            print(f"cached {len(facts)} fact(s) under {args.name!r} in {CACHE_JSON.relative_to(REPO_ROOT)}")
        else:
            print("nothing cached: no facts survived")
    if args.donor_id is not None:
        run_id = uuid.uuid4().hex[:12]
        print(f"saved {save_facts(args.donor_id, facts, run_id)} fact(s), agent_run_id={run_id}")
    print(f"{len(facts)} fact(s) in {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
