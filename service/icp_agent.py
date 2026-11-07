"""Ideal donor profile (ICP) + prospect finder: "organizations that look like your best donors, and why."

Pipeline (docs/briefs/icp-and-prospects.md):
    1. icp_stats(conn)          pure Python: giving band, cadence, tiers, priority ties of the org donors
    2. build_icp(stats, facts)  agent, structured output: traits, each backed by {donor, fact, url} evidence
    3. find_prospects(...)      agent + web search: South Florida ORGANIZATIONS matching the ICP, 2+ sourced
                                facts each (URL must return 200), fit_score computed in Python
    4. run_icp(refresh)         cache-first composition; refresh=True runs live and rewrites the cache

These functions are pure: they never write icp_profile/prospects. db.save_icp_run(conn, run_icp()) does.

Run from the repo root:
    python -m service.icp_agent            # print the cached ICP + prospects (< 1 s)
    python -m service.icp_agent --cache    # research live, write data/icp_cache.json
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Literal

from agents import Agent, ModelSettings, Runner, WebSearchTool
from dotenv import load_dotenv
from openai.types.shared import Reasoning
from pydantic import BaseModel, Field

from service import db
import urllib.error
import urllib.request

from service.enrich_agent import clean_fact, read_cache as read_research_cache

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

ICP_CACHE = REPO_ROOT / "data" / "icp_cache.json"
MIN_FACTS = 2
MAX_PROSPECTS = 10

# The Miami Foundation's five priorities (plan §11), matched to research text by keyword in Python
PRIORITIES = {
    "Empower Youth & Families": ["youth", "famil", "child", "school", "student", "girls", "boys", "education"],
    "Generate Prosperity": ["economic", "workforce", "job", "entrepreneur", "small business", "mobility",
                            "training", "prosperity", "career"],
    "Inspire Civic Involvement": ["civic", "journalism", "news", "democracy", "arts", "volunteer", "pro bono",
                                  "legal", "community information"],
    "Build Climate & Disaster Resilience": ["climate", "disaster", "hurricane", "resilien", "crisis relief",
                                            "flood", "sea level"],
    "Eliminate Inequities": ["equity", "inequit", "underserved", "low-income", "justice", "housing",
                             "vulnerable", "equal"],
}
PriorityName = Literal["Empower Youth & Families", "Generate Prosperity", "Inspire Civic Involvement",
                       "Build Climate & Disaster Resilience", "Eliminate Inequities"]
TRAITS = ["sector", "causes", "geography", "foundation_priorities"]


def normalize(name: str) -> str:
    """Case- and punctuation-insensitive name key, for excluding current donors."""
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def url_loads(url: str) -> bool:
    """True only for a final HTTP 200 to a plain script request (Python's own User-Agent, no disguise).

    Stricter than a browser: a site that turns scripts away is dropped rather than worked around,
    so every kept URL also loads for curl and for QA's checks.
    """
    if not url.startswith(("http://", "https://")):
        return False
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False


def priority_hits(text: str) -> list[str]:
    low = text.lower()
    return [p for p, words in PRIORITIES.items() if any(w in low for w in words)]


# --- 1. Stats (deterministic) ---------------------------------------------------------------------

def org_facts(conn) -> list[dict]:
    """Research facts for organization donors: research_facts rows, else the enrich cache by name."""
    orgs = [dict(r) for r in conn.execute(
        "SELECT id, full_name, org_name FROM donors WHERE donor_type = 'organization' ORDER BY id")]
    research_cache = read_research_cache()
    facts = []
    for org in orgs:
        name = org["org_name"] or org["full_name"]
        rows = [dict(r) for r in conn.execute(
            "SELECT fact, source_url FROM research_facts WHERE donor_id = ? ORDER BY id", (org["id"],))]
        if not rows:
            rows = [{"fact": f["fact"], "source_url": f["source_url"]} for f in research_cache.get(name, [])]
        facts += [{"donor": name, "donor_id": org["id"], "fact": r["fact"], "url": r["source_url"]} for r in rows]
    return facts


def icp_stats(conn) -> dict:
    """Giving band, cadence, tiers and priority ties of the organization donors. Pure Python, no LLM."""
    orgs = [dict(r) for r in conn.execute("""
        SELECT d.id, COALESCE(d.org_name, d.full_name) AS name, d.city, d.fund_type,
               s.score, s.tier, s.is_star, s.status
        FROM donors d LEFT JOIN donor_scores s ON s.donor_id = d.id
        WHERE d.donor_type = 'organization' ORDER BY d.id""")]
    facts = org_facts(conn)
    donors = []
    for org in orgs:
        gifts = [dict(r) for r in conn.execute(
            "SELECT amount, gift_date, channel FROM gifts WHERE donor_id = ? ORDER BY gift_date", (org["id"],))]
        dates = [datetime.fromisoformat(g["gift_date"]) for g in gifts]
        gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
        text = " ".join(f["fact"] for f in facts if f["donor"] == org["name"])
        donors.append({
            "id": org["id"], "name": org["name"], "city": org["city"], "fund_type": org["fund_type"],
            "tier": org["tier"], "is_star": bool(org["is_star"]), "score": org["score"], "status": org["status"],
            "lifetime": round(sum(g["amount"] for g in gifts), 2), "gifts": len(gifts),
            "largest": max((g["amount"] for g in gifts), default=0),
            "cadence_days": round(median(gaps)) if gaps else None,
            "last_gift": gifts[-1]["gift_date"] if gifts else None,
            "channels": sorted({g["channel"] for g in gifts if g["channel"]}),
            "research_facts": sum(1 for f in facts if f["donor"] == org["name"]),
            "priorities": priority_hits(text),
        })
    lifetimes = sorted(d["lifetime"] for d in donors if d["gifts"])
    cadences = [d["cadence_days"] for d in donors if d["cadence_days"]]
    return {
        "org_donors": len(donors),
        "researched": sum(1 for d in donors if d["research_facts"]),
        "lifetime_band": {"min": lifetimes[0], "median": median(lifetimes), "max": lifetimes[-1]} if lifetimes else None,
        "median_cadence_days": round(median(cadences)) if cadences else None,
        "tiers": {t: sum(1 for d in donors if d["tier"] == t) for t in ("big", "mid", "small")},
        "stars": sum(1 for d in donors if d["is_star"]),
        "cities": sorted({d["city"] for d in donors if d["city"]}),
        "priority_counts": {p: [d["name"] for d in donors if p in d["priorities"]] for p in PRIORITIES},
        "donors": donors,
    }


def flat_stats(stats: dict) -> dict[str, float]:
    """The {name: number} view the UI shows; priority ties appear as "priority: <name>" counts."""
    band = stats["lifetime_band"] or {}
    flat = {"org_donors": stats["org_donors"], "researched": stats["researched"],
            "lifetime_min": band.get("min"), "lifetime_median": band.get("median"), "lifetime_max": band.get("max"),
            "median_cadence_days": stats["median_cadence_days"], "stars": stats["stars"],
            **{f"tier_{t}": n for t, n in stats["tiers"].items()},
            **{f"priority: {p}": len(names) for p, names in stats["priority_counts"].items()}}
    return {k: v for k, v in flat.items() if v is not None}


def giving_style_trait(stats: dict) -> dict:
    """The giving-style trait is numbers, so Python writes it; evidence cites gift records, not the web."""
    band, cadence = stats["lifetime_band"], stats["median_cadence_days"]
    value = "No gift history yet"
    if band:
        value = (f"Lifetime giving ${band['min']:,.0f}–${band['max']:,.0f} (median ${band['median']:,.0f})"
                 + (f", giving about every {cadence} days" if cadence else "")
                 + f"; {stats['tiers']['big']} big-tier, {stats['stars']} ★")
    evidence = [{"donor": d["name"], "donor_id": d["id"], "url": None,
                 "fact": f"{d['gifts']} gifts, ${d['lifetime']:,.0f} lifetime, tier {d['tier']} (Foundation gift records)"}
                for d in stats["donors"] if d["gifts"]]
    return {"trait": "giving_style", "value": value, "evidence": evidence}


# --- 2. ICP profile (agent) -----------------------------------------------------------------------

class Evidence(BaseModel):
    donor: str
    fact: str = Field(description="Copy the fact text from the input")
    url: str = Field(description="Copy the fact's url from the input exactly")


class Trait(BaseModel):
    trait: Literal["sector", "causes", "geography", "foundation_priorities"]
    value: str = Field(description="One plain sentence a fundraiser can act on")
    evidence: list[Evidence]


class Profile(BaseModel):
    traits: list[Trait]


icp_agent = Agent(
    name="ICP builder",
    instructions="""You build The Miami Foundation's ideal ORGANIZATION donor profile from its current
organization donors. You get Python-computed stats and a list of sourced research facts.
Write exactly one trait for each of: sector, causes, geography, foundation_priorities.
- foundation_priorities names which of the Foundation's five priorities these donors' work ties to.
- Every trait cites 1-4 evidence items copied EXACTLY (donor, fact, url) from the input facts.
- Use only the input. Never add facts, numbers or URLs that are not in it.""",
    model=os.getenv("OPENAI_MODEL_DEFAULT"),
    output_type=Profile,
    model_settings=ModelSettings(reasoning=Reasoning(effort="low")),
)


def build_icp(stats: dict, facts: list[dict]) -> dict:
    """ICP traits with evidence. Evidence the model did not copy from `facts` is dropped."""
    known = {(f["donor"], f["url"]): f for f in facts}
    for_model = [{k: f[k] for k in ("donor", "fact", "url")} for f in facts]
    prompt = json.dumps({"stats": {k: v for k, v in stats.items() if k != "donors"}, "facts": for_model}, indent=1)
    profile = Runner.run_sync(icp_agent, prompt).final_output
    traits = []
    for t in profile.traits:
        evidence = [known[(e.donor, e.url)] for e in t.evidence if (e.donor, e.url) in known]
        if evidence:
            traits.append({"trait": t.trait, "value": t.value, "evidence": evidence})
    traits.append(giving_style_trait(stats))
    flat = [{"trait": t["trait"], **e} for t in traits for e in t["evidence"] if e.get("url")]
    return {"traits": traits, "stats": flat_stats(stats), "evidence": flat}


# --- 3. Prospects (agent + web search) ------------------------------------------------------------

class ProspectFact(BaseModel):
    fact: str = Field(description="One short, specific, verifiable sentence")
    url: str = Field(description="The exact page the fact came from")


class Prospect(BaseModel):
    name: str
    org_type: Literal["company", "foundation"]
    city: str
    matched_traits: list[Literal["sector", "causes", "geography", "foundation_priorities"]]
    priority: PriorityName
    facts: list[ProspectFact]


class Prospects(BaseModel):
    prospects: list[Prospect]


prospect_agent = Agent(
    name="Prospect finder",
    instructions="""You find NEW organization donor prospects for The Miami Foundation in South Florida.
Use web search. Every prospect is a company or a foundation with a South Florida presence: never a private
individual, never a government body, never one of the excluded current donors, and never a peer
fundraiser that competes for the same donors (other community foundations, United Ways, federated campaigns).
Favor organizations headquartered or with a major office in Miami-Dade.
For each prospect give 2-3 facts about its public giving, community investment or causes, each with the
exact URL of the page it came from. matched_traits lists which ICP traits it shares (sector, causes,
geography, foundation_priorities); priority is the Foundation priority it fits best.
Never invent facts or URLs. Prefer sources that are plain public pages (news releases, grant pages, annual reports) over pages
that block automated access. Return 12-14 prospects, best fit first.""",
    model=os.getenv("OPENAI_MODEL_DEFAULT"),
    tools=[WebSearchTool(search_context_size="low")],
    output_type=Prospects,
    model_settings=ModelSettings(reasoning=Reasoning(effort="low")),
)


COUNTY_CITIES = {
    "Miami-Dade": ["miami", "miami beach", "coral gables", "doral", "homestead", "aventura", "hialeah",
                   "key biscayne", "north miami", "miami gardens", "miami lakes", "pinecrest", "cutler bay",
                   "palmetto bay", "sunny isles beach", "bal harbour", "south miami", "medley", "sweetwater"],
    "Broward": ["fort lauderdale", "hollywood", "pembroke pines", "miramar", "coral springs", "plantation",
                "sunrise", "davie", "weston", "pompano beach", "deerfield beach", "dania beach",
                "hallandale beach", "lauderhill", "tamarac", "margate"],
    "Palm Beach": ["west palm beach", "boca raton", "delray beach", "boynton beach", "jupiter", "palm beach",
                   "palm beach gardens", "wellington"],
    "Monroe": ["key west", "key largo", "marathon", "islamorada"],
}
# Points out of 100; the model's own matched_traits count least, since it tends to claim every trait
FIT_WEIGHTS = {"geography": 25, "priority_overlap": 35, "primary_priority": 25, "matched_traits": 15}


def county_for(city: str) -> str | None:
    c = normalize(city)
    return next((county for county, cities in COUNTY_CITIES.items() if c in cities), None)


def fit_breakdown(prospect: dict, icp: dict) -> dict:
    """Points per component, all computed in Python from the ICP stats and the prospect's sourced facts.

    geography         Miami-Dade full marks; Broward, Palm Beach or Monroe 60%
    priority_overlap  Foundation priorities in the prospect's facts, weighted by how many current
                      org donors share each one (keyword match, same as icp_stats)
    primary_priority  how many current org donors share the prospect's main priority
    matched_traits    share of the four ICP traits the finder says it matches
    """
    counts = {p: int(icp["stats"].get(f"priority: {p}", 0)) for p in PRIORITIES}
    top = max(counts.values(), default=0) or 1
    total = sum(counts.values()) or 1
    county = county_for(prospect["city"])
    hits = set(priority_hits(" ".join(f["fact"] for f in prospect["facts"])))
    parts = {
        "geography": 1.0 if county == "Miami-Dade" else 0.6 if county else 0.0,
        "priority_overlap": sum(counts.get(p, 0) for p in hits) / total,
        "primary_priority": counts.get(prospect["priority"], 0) / top,
        "matched_traits": len(set(prospect["matched_traits"]) & set(TRAITS)) / len(TRAITS),
    }
    return {k: round(FIT_WEIGHTS[k] * v) for k, v in parts.items()}


def fit_score(prospect: dict, icp: dict) -> int:
    """0-100, the sum of fit_breakdown. Deterministic."""
    return min(100, sum(fit_breakdown(prospect, icp).values()))


def find_prospects(icp: dict, exclude_names: set[str], refresh: bool = False) -> list[dict]:
    """6-10 South Florida organizations matching the ICP, each with 2+ facts whose URLs return 200."""
    if not refresh and ICP_CACHE.exists():
        return read_cache()["prospects"]
    excluded = {normalize(n) for n in exclude_names}
    brief = {"icp": [{"trait": t["trait"], "value": t["value"]} for t in icp["traits"]],
             "exclude": sorted(exclude_names)}
    found = Runner.run_sync(prospect_agent, json.dumps(brief, indent=1)).final_output.prospects

    seen, candidates = set(), []
    for p in found:
        key = normalize(p.name)
        if key in excluded or key in seen:
            continue
        seen.add(key)
        candidates.append(p)
    urls = sorted({f.url for p in candidates for f in p.facts})
    with ThreadPoolExecutor(max_workers=12) as pool:
        alive = dict(zip(urls, pool.map(url_loads, urls)))

    prospects = []
    for p in candidates:
        facts = [{"fact": clean_fact(f.fact), "url": f.url} for f in p.facts if alive.get(f.url)]
        if len(facts) < MIN_FACTS:
            continue
        prospect = {"name": p.name, "org_type": p.org_type, "city": p.city,
                    "matched_traits": sorted(set(p.matched_traits)), "facts": facts,
                    "priority": p.priority, "status": "new"}
        prospect["fit_breakdown"] = fit_breakdown(prospect, icp)
        prospect["fit_score"] = fit_score(prospect, icp)
        prospects.append(prospect)
    prospects.sort(key=lambda p: (-p["fit_score"], p["name"]))
    return prospects[:MAX_PROSPECTS]


# --- 4. Composition + cache -----------------------------------------------------------------------

def read_cache() -> dict:
    return json.loads(ICP_CACHE.read_text(encoding="utf-8"))


def write_cache(run: dict) -> None:
    ICP_CACHE.parent.mkdir(parents=True, exist_ok=True)
    ICP_CACHE.write_text(json.dumps(run, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_profile(refresh: bool = False) -> dict:
    """The ICP {traits, stats, evidence}: from the cache, or built live from donors.db."""
    if not refresh and ICP_CACHE.exists():
        return read_cache()["icp"]
    conn = db.connect()
    try:
        return build_icp(icp_stats(conn), org_facts(conn))
    finally:
        conn.close()


def run_icp(refresh: bool = False) -> dict:
    """{generated_at, icp, prospects}. Cached unless refresh=True; a live run rewrites data/icp_cache.json."""
    if not refresh and ICP_CACHE.exists():
        return read_cache()
    conn = db.connect()
    try:
        donor_names = {r[0] for r in conn.execute("SELECT full_name FROM donors")}
        donor_names |= {r[0] for r in conn.execute("SELECT org_name FROM donors WHERE org_name IS NOT NULL")}
        icp = build_icp(icp_stats(conn), org_facts(conn))
    finally:
        conn.close()
    run = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "icp": icp,
           "prospects": find_prospects(icp, donor_names, refresh=True)}
    write_cache(run)
    return run


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the ideal donor profile and find matching prospects.")
    parser.add_argument("--cache", action="store_true", help="run live and write data/icp_cache.json")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # ★ and curly quotes on a cp1252 Windows console

    start = time.perf_counter()
    run = run_icp(refresh=args.cache)
    elapsed = time.perf_counter() - start

    print(f"ICP ({run['generated_at']})")
    for t in run["icp"]["traits"]:
        print(f"  {t['trait']}: {t['value']}  [{len(t['evidence'])} evidence]")
    print(f"Prospects ({len(run['prospects'])})")
    for p in run["prospects"]:
        print(f"  {p['fit_score']:>3}  {p['name']} ({p['org_type']}, {p['city']}) · {p['priority']} · "
              f"{len(p['facts'])} facts · matches {', '.join(p['matched_traits'])}")
    print(f"{'live' if args.cache else 'cached'} run in {elapsed:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
