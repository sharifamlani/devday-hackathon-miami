"""Enrichment research agent: public, professional facts about a donor, each with a source link.

Run from the repo root:
    python -m service.enrich_agent "Frederick A. DeLuca Foundation"
    python -m service.enrich_agent "Jane Doe" --org "Acme Corp" --city Miami --donor-id 7
    python -m service.enrich_agent "Amazon" --focus "Miami giving" --cache   # research live, store in the cache

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

from agents import Agent, ModelSettings, Runner, WebSearchTool
from dotenv import load_dotenv
from openai.types.shared import Reasoning
from pydantic import BaseModel, Field

from service import persona

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

# Until db.py lands, facts go here; save_facts() is the only writer, so swapping in SQLite is one edit
FACTS_JSON = REPO_ROOT / "data" / "research_facts.json"
# Precomputed research keyed by donor name, committed so the demo never waits on web search. A fictional
# persona (service/persona.py) uses its own SAMPLE research.json instead: invented facts about invented orgs.
CACHE_JSON = (persona.pack_file("research") if persona.is_fictional()
              else REPO_ROOT / "data" / "research_cache.json")
NO_INFO = "no public information found"
INDIVIDUAL_SKIP = "individual donors are not researched in the demo"
URL_TIMEOUT_S = 8


class Fact(BaseModel):
    fact: str
    source_url: str
    retrieved_at: str  # ISO 8601 UTC, stamped by us when the run finishes


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
INSTRUCTIONS = persona.localize(INSTRUCTIONS)

agent = Agent(
    name="Donor enrichment",
    instructions=INSTRUCTIONS,
    model=os.getenv("OPENAI_MODEL_DEFAULT"),
    tools=[WebSearchTool(search_context_size="low")],
    output_type=Research,
    model_settings=ModelSettings(reasoning=Reasoning(effort="low")),
)


def url_loads(url: str) -> bool:
    """True only when the URL ends (after redirects) in HTTP 200; used to drop facts with dead links.
    A sample://<persona>/<slug> source is a labelled SAMPLE fact: accepted as sample, never fetched."""
    if persona.is_sample_url(url):
        return True
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
    cache[name] = [f.model_dump() for f in facts]
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


def enrich_donor(name: str, org_name: str | None = None, city: str | None = None,
                 focus: str | None = None, refresh: bool = False,
                 donor_type: str | None = None) -> list[Fact]:
    """Research one donor and return sourced facts whose URLs load. Empty list means nothing public found.

    Cached donors come back from data/research_cache.json without a model call unless refresh=True.
    focus steers the search (e.g. "Miami giving"); it only applies to live runs.
    Individuals are never researched live (see skip_reason); cached entries are vetted organizations.
    Under a fictional persona every donor is invented, so a web search could only find some real namesake:
    the pack's SAMPLE facts come back (refresh or not), or nothing.
    """
    if persona.is_fictional():
        return [Fact(**f) for f in read_cache().get(name, [])]
    if not refresh:
        cached = read_cache().get(name)
        if cached is not None:
            return [Fact(**f) for f in cached]
    if skip_reason(org_name, donor_type):
        return []

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
        written = 0
        with conn:
            for f in facts:
                written += conn.execute(
                    "INSERT INTO research_facts (donor_id, fact, source_url, retrieved_at, agent_run_id) "
                    "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM research_facts "
                    "WHERE donor_id = ? AND source_url = ? AND fact = ?)",
                    (donor_id, f.fact, f.source_url, f.retrieved_at, agent_run_id,
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
    args = parser.parse_args()

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
