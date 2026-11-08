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
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Literal

from agents import Agent, ModelSettings, Runner, WebSearchTool
from dotenv import load_dotenv
from openai.types.shared import Reasoning
from pydantic import BaseModel, Field

from service import db, persona

from service.enrich_agent import clean_fact, read_cache as read_research_cache

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

# A fictional persona (service/persona.py) serves its SAMPLE icp.json: invented prospects, never a web search
ICP_CACHE = persona.pack_file("icp") if persona.is_fictional() else REPO_ROOT / "data" / "icp_cache.json"
MIN_FACTS = 2
# Live runs (POST /icp/run) must fit the spec's 90 s cap; the --cache precompute runs before the demo
# and gets a longer budget so slow searches and page renders still contribute
SEARCH_TIMEOUT_S = 50
PAGE_BUDGET_S = 25
CACHE_SEARCH_TIMEOUT_S = 240
CACHE_PAGE_BUDGET_S = 120
PAGE_LOAD_MS = 15000
SEARCH_KINDS = ["companies with corporate giving programs (banks, utilities, retailers, large employers)",
                "law, accounting and other professional-services firms with pro bono or community giving",
                "private, family and corporate foundations"]
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


def fetch_pages(urls: list[str], budget_s: float) -> dict[str, str | None]:
    """Each URL's text as a visitor sees it, or None. The source of truth is a real browser render.

    Headless Chromium with its default User-Agent (no spoofing). A page counts only if the browser gets
    HTTP 200 and an HTML document; its text is body.innerText, which leaves out hidden elements, so a
    fact buried in a collapsed table or filtered list doesn't count. Pages unfinished at the budget are None.
    """
    urls = [u for u in urls if u.startswith(("http://", "https://"))]
    if not urls:
        return {}
    try:
        return asyncio.run(asyncio.wait_for(_render_all(urls), budget_s))
    except asyncio.TimeoutError:
        return dict(_partial)


_partial: dict[str, str | None] = {}


async def _render_all(urls: list[str]) -> dict[str, str | None]:
    from playwright.async_api import async_playwright
    _partial.clear()
    gate = asyncio.Semaphore(6)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        try:
            async def one(url):
                async with gate:
                    page = await browser.new_page()
                    try:
                        response = await page.goto(url, wait_until="domcontentloaded", timeout=PAGE_LOAD_MS)
                        ok = bool(response) and response.status == 200 and \
                            "html" in (response.headers.get("content-type") or "")
                        if ok:
                            try:
                                await page.wait_for_load_state("networkidle", timeout=4000)
                            except Exception:
                                pass    # busy pages: use what has rendered so far
                        _partial[url] = normalize_text(await page.inner_text("body")) if ok else None
                    except Exception:
                        _partial[url] = None
                    finally:
                        await page.close()
            await asyncio.gather(*(one(u) for u in urls))
        finally:
            await browser.close()
    return dict(_partial)


def normalize_text(text: str) -> str:
    """Lower-case, straight quotes, plain dashes, single spaces: so a quote matches however it was typed."""
    text = text.translate(str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
                                         "\u2013": "-", "\u2014": "-", "\u00a0": " "}))
    return re.sub(r"\s+", " ", text).strip().lower()


def key_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9'-]+", normalize_text(text)) if len(w) >= 4}


def quote_on_page(quote: str, text: str | None) -> bool:
    """True when the quote (6+ words) is on the page verbatim, or 80%+ of its key words are on it."""
    q = normalize_text(quote).strip(" .\"'")
    if not text or len(q.split()) < 6:
        return False
    if q in text:
        return True
    words = key_words(q)
    return bool(words) and len(words & key_words(text)) / len(words) >= 0.8


def numbers_on_page(fact: str, text: str | None) -> bool:
    """Every number in the fact ($25,000, 3,582 hours, 2024) must appear on the page too."""
    page = re.sub(r"(?<=\d),(?=\d)", "", text or "")
    numbers = {n.replace(",", "").rstrip(".") for n in re.findall(r"\d[\d,.]*", fact)}
    return all(n in page for n in numbers if n)


def fact_on_page(fact: str, quote: str, text: str | None) -> bool:
    """The cited page states the fact: its quote and every number in it are on the page."""
    return quote_on_page(quote, text) and numbers_on_page(fact, text)


def priority_hits(text: str) -> list[str]:
    low = text.lower()
    return [p for p, words in PRIORITIES.items() if any(w in low for w in words)]


# --- 1. Stats (deterministic) ---------------------------------------------------------------------

def has_column(conn, table: str, column: str) -> bool:
    return any(c[1] == column for c in conn.execute(f"PRAGMA table_info({table})"))


def giver_orgs_where(conn, alias: str = "") -> str:
    """Organization Givers only: Community or Neighbor organizations (contact_type) aren't donors."""
    a = f"{alias}." if alias else ""
    where = f"{a}donor_type = 'organization'"
    return where + (f" AND {a}contact_type = 'giver'" if has_column(conn, "donors", "contact_type") else "")


def ok_gifts_where(conn) -> str:
    """A declined or failed charge (gifts.status) isn't a gift and never counts toward giving."""
    return " AND status = 'ok'" if has_column(conn, "gifts", "status") else ""


def org_facts(conn) -> list[dict]:
    """Research facts for organization donors: research_facts rows, else the enrich cache by name."""
    orgs = [dict(r) for r in conn.execute(
        f"SELECT id, full_name, org_name FROM donors WHERE {giver_orgs_where(conn)} ORDER BY id")]
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
    orgs = [dict(r) for r in conn.execute(f"""
        SELECT d.id, COALESCE(d.org_name, d.full_name) AS name, d.city, d.fund_type,
               s.score, s.tier, s.is_star, s.status
        FROM donors d LEFT JOIN donor_scores s ON s.donor_id = d.id
        WHERE {giver_orgs_where(conn, "d")} ORDER BY d.id""")]
    ok = ok_gifts_where(conn)
    facts = org_facts(conn)
    donors = []
    for org in orgs:
        gifts = [dict(r) for r in conn.execute(
            f"SELECT amount, gift_date, channel FROM gifts WHERE donor_id = ?{ok} ORDER BY gift_date", (org["id"],))]
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


# --- Org context: what the Foundation has been doing recently (plan §15) ---------------------------

ORG_FACTS_JSON = (persona.pack_file("facts") if persona.is_fictional()   # outreach's website cache, until org_context fills
                  else REPO_ROOT / "service" / "org_facts.json")
RECENT_CONTEXT = 12


def load_org_context(conn) -> list[dict]:
    """The org's own dated, sourced facts, newest first: org_context table, else org_facts.json, else []."""
    rows = []
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT source, url, posted_at, fact, priority FROM org_context ORDER BY posted_at DESC")]
    except Exception:      # table not created yet (8b's schema lands separately)
        pass
    if not rows and ORG_FACTS_JSON.exists():
        data = json.loads(ORG_FACTS_JSON.read_text(encoding="utf-8"))
        rows = [{"source": "website", "url": f["url"], "posted_at": f.get("date"), "fact": f["fact"],
                 "priority": f.get("priority")} for f in data.get("facts", [])]
    for r in rows:
        if r.get("priority") not in PRIORITIES:
            hits = priority_hits(r["fact"])
            r["priority"] = hits[0] if hits else None
    return sorted(rows, key=lambda r: r.get("posted_at") or "", reverse=True)


def recency_weight(posted_at: str | None, as_of: datetime) -> float:
    """Newer work counts more: ≤90 days 1.0, ≤180 0.6, ≤365 0.3, older or undated 0.1."""
    if not posted_at:
        return 0.1
    days = (as_of - datetime.fromisoformat(posted_at[:10])).days
    return 1.0 if days <= 90 else 0.6 if days <= 180 else 0.3 if days <= 365 else 0.1


def recent_context(conn) -> list[dict]:
    """The newest org facts with a recency weight, for steering the search and citing in matches."""
    from service.score import default_as_of
    as_of = datetime.combine(default_as_of(), datetime.min.time())
    return [{**r, "weight": recency_weight(r.get("posted_at"), as_of)}
            for r in load_org_context(conn)[:RECENT_CONTEXT]]


def focus_weights(context: list[dict]) -> dict[str, float]:
    """Recency-weighted count of the org's recent facts per Foundation priority."""
    focus = {p: 0.0 for p in PRIORITIES}
    for c in context:
        if c.get("priority") in focus:
            focus[c["priority"]] += c["weight"]
    return focus


def giving_style_trait(stats: dict) -> dict:
    """The giving-style trait is numbers, so Python writes it; evidence cites gift records, not the web."""
    band, cadence = stats["lifetime_band"], stats["median_cadence_days"]
    value = "No gift history yet"
    if band:
        value = (f"Lifetime giving ${band['min']:,.0f}–${band['max']:,.0f} (median ${band['median']:,.0f})"
                 + (f", giving about every {cadence} days" if cadence else "")
                 + f"; {stats['tiers']['big']} big-tier, {stats['stars']} ★")
    evidence = [{"donor": d["name"], "donor_id": d["id"], "url": None,
                 "fact": persona.localize(f"{d['gifts']} gifts, ${d['lifetime']:,.0f} lifetime, tier {d['tier']} (Foundation gift records)")}
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
    instructions=persona.localize("""You build The Miami Foundation's ideal ORGANIZATION donor profile from its current
organization donors. You get Python-computed stats and a list of sourced research facts.
Write exactly one trait for each of: sector, causes, geography, foundation_priorities.
- foundation_priorities names which of the Foundation's five priorities these donors' work ties to.
- Every trait cites 1-4 evidence items copied EXACTLY (donor, fact, url) from the input facts.
- Use only the input. Never add facts, numbers or URLs that are not in it."""),
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
    url: str = Field(description="The exact page that states the fact")
    quote: str = Field(description="6-30 words copied EXACTLY from that page that state the fact")


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
    instructions=persona.localize("""You find NEW organization donor prospects for The Miami Foundation in South Florida.
Use web search. Every prospect is a company or a foundation with a South Florida presence: never a private
individual, never a government body, never one of the excluded current donors, and never a peer
fundraiser that competes for the same donors (other community foundations, United Ways, federated campaigns).
Favor organizations headquartered or with a major office in Miami-Dade, and organizations that fund what
the Foundation has been doing RECENTLY (recent_focus: its own newest work, newest first).
For each prospect give 2-3 facts about its public giving, community investment or causes. Each fact cites
the exact URL of the page that STATES it (a grants, news or community page, not a homepage that only
links there) and a quote of 6-30 words copied exactly from that page; facts are checked against the page. matched_traits lists which ICP traits it shares (sector, causes,
geography, foundation_priorities); priority is the Foundation priority it fits best.
Never invent facts or URLs. Prefer sources that are plain public pages (news releases, grant pages, annual reports) over pages
that block automated access. Search only for the kind of organization named in search_for. Return 8-10 prospects, best fit first."""),
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
# Points out of 100; the model's own matched_traits count least, since it tends to claim every trait.
# With org context, recent_focus takes points from the donor-based parts; without it, donors only.
FIT_WEIGHTS = {"geography": 25, "priority_overlap": 35, "primary_priority": 25, "matched_traits": 15}
FIT_WEIGHTS_CONTEXT = {"geography": 20, "priority_overlap": 25, "primary_priority": 20, "recent_focus": 20,
                       "matched_traits": 15}


def county_for(city: str) -> str | None:
    c = normalize(city)
    return next((county for county, cities in COUNTY_CITIES.items() if c in cities), None)


def fit_breakdown(prospect: dict, icp: dict) -> dict:
    """Points per component, all computed in Python from the ICP stats and the prospect's sourced facts.

    geography         Miami-Dade full marks; Broward, Palm Beach or Monroe 60%
    priority_overlap  Foundation priorities in the prospect's facts, weighted by how many current
                      org donors share each one (keyword match, same as icp_stats)
    primary_priority  how many current org donors share the prospect's main priority
    recent_focus      (with org context) how much of the org's recent, recency-weighted work sits in the
                      prospect's priorities
    matched_traits    share of the four ICP traits the finder says it matches
    """
    counts = {p: int(icp["stats"].get(f"priority: {p}", 0)) for p in PRIORITIES}
    top = max(counts.values(), default=0) or 1
    total = sum(counts.values()) or 1
    county = county_for(prospect["city"])
    hits = set(priority_hits(" ".join(f["fact"] for f in prospect["facts"])))
    focus = focus_weights(icp.get("recent_context", []))
    weights = FIT_WEIGHTS_CONTEXT if any(focus.values()) else FIT_WEIGHTS
    parts = {
        "geography": 1.0 if county == "Miami-Dade" else 0.6 if county else 0.0,
        "priority_overlap": sum(counts.get(p, 0) for p in hits) / total,
        "primary_priority": counts.get(prospect["priority"], 0) / top,
        "matched_traits": len(set(prospect["matched_traits"]) & set(TRAITS)) / len(TRAITS),
    }
    if any(focus.values()):
        parts["recent_focus"] = max(focus.get(p, 0) for p in hits | {prospect["priority"]}) / max(focus.values())
    return {k: round(weights[k] * v) for k, v in parts.items()}


def matched_context(prospect: dict, icp: dict, limit: int = 2) -> list[dict]:
    """The org's own recent facts in the prospect's priorities (main priority first, then newest)."""
    hits = set(priority_hits(" ".join(f["fact"] for f in prospect["facts"]))) | {prospect["priority"]}
    picks = [c for c in icp.get("recent_context", []) if c.get("priority") in hits]
    picks.sort(key=lambda c: (c["priority"] != prospect["priority"], -c["weight"]))
    return [{"fact": c["fact"], "url": c["url"], "posted_at": c.get("posted_at")} for c in picks[:limit]]


def fit_score(prospect: dict, icp: dict) -> int:
    """0-100, the sum of fit_breakdown. Deterministic."""
    return min(100, sum(fit_breakdown(prospect, icp).values()))


async def run_searches(briefs: list[str], timeout_s: float | None = None) -> list:
    """Run the prospect searches concurrently; a search past its deadline is dropped, not waited on."""
    async def one(brief):
        try:
            result = await asyncio.wait_for(Runner.run(prospect_agent, brief), timeout_s or SEARCH_TIMEOUT_S)
            return result.final_output.prospects
        except asyncio.TimeoutError:
            return []
    return [p for batch in await asyncio.gather(*(one(b) for b in briefs)) for p in batch]


def find_prospects(icp: dict, exclude_names: set[str], refresh: bool = False,
                   precompute: bool = False) -> list[dict]:
    """6-10 South Florida organizations matching the ICP, each with 2+ facts whose URLs return 200."""
    if not refresh and ICP_CACHE.exists():
        return read_cache()["prospects"]
    excluded = {normalize(n) for n in exclude_names}
    brief = {"icp": [{"trait": t["trait"], "value": t["value"]} for t in icp["traits"]],
             "recent_focus": [{"fact": c["fact"], "priority": c["priority"], "posted_at": c.get("posted_at")}
                              for c in icp.get("recent_context", [])],
             "exclude": sorted(exclude_names)}
    # Two searches in parallel (companies, foundations) for a wider pool: many sources fail the page check
    briefs = [json.dumps({**brief, "search_for": kind}, indent=1) for kind in SEARCH_KINDS]
    found = asyncio.run(run_searches(briefs, CACHE_SEARCH_TIMEOUT_S if precompute else SEARCH_TIMEOUT_S))

    seen, candidates = set(), []
    for p in found:
        key = normalize(p.name)
        if key in excluded or key in seen:
            continue
        seen.add(key)
        candidates.append(p)
    urls = sorted({f.url for p in candidates for f in p.facts})
    pages = fetch_pages(urls, CACHE_PAGE_BUDGET_S if precompute else PAGE_BUDGET_S)
    retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    prospects = []
    for p in candidates:
        # A fact stays only if its page loads AND states it: the quote must appear on that page
        facts = [{"fact": clean_fact(f.fact), "url": f.url, "quote": f.quote, "via": "web search",
                  "retrieved_at": retrieved_at}
                 for f in p.facts if fact_on_page(f.fact, f.quote, pages.get(f.url))]
        if len(facts) < MIN_FACTS:
            continue
        prospect = {"name": p.name, "org_type": p.org_type, "city": p.city,
                    "matched_traits": sorted(set(p.matched_traits)), "facts": facts,
                    "priority": p.priority, "status": "new"}
        prospect["matched_context"] = matched_context(prospect, icp)
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
        return {**build_icp(icp_stats(conn), org_facts(conn)), "recent_context": recent_context(conn)}
    finally:
        conn.close()


def reverify(prospects: list[dict], icp: dict, exclude_names: set[str]) -> list[dict]:
    """Re-check cached prospects against their pages today and rescore them against the new ICP.

    Facts without a quote (older caches) can't be checked and are dropped; so is any prospect left with
    fewer than MIN_FACTS facts, or one that has since become a donor.
    """
    excluded = {normalize(n) for n in exclude_names}
    urls = sorted({f["url"] for p in prospects for f in p["facts"] if f.get("quote")})
    pages = fetch_pages(urls, CACHE_PAGE_BUDGET_S)

    kept = []
    for p in prospects:
        facts = [f for f in p["facts"] if f.get("quote") and fact_on_page(f["fact"], f["quote"], pages.get(f["url"]))]
        if len(facts) < MIN_FACTS or normalize(p["name"]) in excluded:
            continue
        p = {**p, "facts": facts}
        p["matched_context"] = matched_context(p, icp)
        p["fit_breakdown"] = fit_breakdown(p, icp)
        p["fit_score"] = fit_score(p, icp)
        kept.append(p)
    return kept


def merge_prospects(new: list[dict], old: list[dict]) -> list[dict]:
    """New finds first, then still-verified earlier ones not found again; best fit first, capped."""
    names = {normalize(p["name"]) for p in new}
    merged = new + [p for p in old if normalize(p["name"]) not in names]
    merged.sort(key=lambda p: (-p["fit_score"], p["name"]))
    return merged[:MAX_PROSPECTS]


def run_icp(refresh: bool = False, precompute: bool = False) -> dict:
    """{generated_at, icp, prospects}. Cached unless refresh=True; a live run rewrites data/icp_cache.json.

    precompute=True (the --cache CLI, run before the demo) gives the searches a longer deadline.
    A fictional persona always gets its SAMPLE pack: a live search would only find real organizations.
    """
    if (not refresh or persona.is_fictional()) and ICP_CACHE.exists():
        return read_cache()
    conn = db.connect()
    try:
        donor_names = {r[0] for r in conn.execute("SELECT full_name FROM donors")}
        donor_names |= {r[0] for r in conn.execute("SELECT org_name FROM donors WHERE org_name IS NOT NULL")}
        icp = {**build_icp(icp_stats(conn), org_facts(conn)), "recent_context": recent_context(conn)}
    finally:
        conn.close()
    prospects = find_prospects(icp, donor_names, refresh=True, precompute=precompute)
    if precompute and ICP_CACHE.exists():
        prospects = merge_prospects(prospects, reverify(read_cache()["prospects"], icp, donor_names))
    run = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "icp": icp,
           "prospects": prospects}
    write_cache(run)
    return run


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the ideal donor profile and find matching prospects.")
    parser.add_argument("--cache", action="store_true", help="run live and write data/icp_cache.json")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # ★ and curly quotes on a cp1252 Windows console

    start = time.perf_counter()
    run = run_icp(refresh=args.cache, precompute=args.cache)
    elapsed = time.perf_counter() - start

    print(f"ICP ({run['generated_at']})")
    for t in run["icp"]["traits"]:
        print(f"  {t['trait']}: {t['value']}  [{len(t['evidence'])} evidence]")
    print(f"Org context: {len(run['icp'].get('recent_context', []))} recent facts steering the search")
    print(f"Prospects ({len(run['prospects'])})")
    for p in run["prospects"]:
        print(f"  {p['fit_score']:>3}  {p['name']} ({p['org_type']}, {p['city']}) · {p['priority']} · "
              f"{len(p['facts'])} facts · matches {', '.join(p['matched_traits'])}")
    print(f"{'live' if args.cache else 'cached'} run in {elapsed:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
