"""Org context: dated, sourced accomplishments from miamifoundation.org.

The Foundation's website is the only org-context source for the demo (plan.md §2 #5, §11).
Posts come from the site's public WordPress feed, so each fact's date and URL are the site's
own, never the model's. The model only picks the accomplishment out of each post, and must
quote the sentence it came from; facts whose quote isn't in the post text are dropped.

Standing pages (the five priorities, for-donors, who-we-are) add program and impact facts. The
site's bot check answers scripted requests with HTTP 202, so their text is read in a browser into
service/org_pages.json; each page fact is dated with the page's last-updated date and passes the
same quote check. Every fact is tagged with one of the five priorities (PRIORITIES).

Results are cached to service/org_facts.json so the demo never depends on the site being up.

    python service/org_context.py            # refresh news facts from the live feed (keeps page facts)
    python service/org_context.py --pages    # refresh page facts from org_pages.json (keeps news facts)
    python service/org_context.py --show     # print the cached facts
    python service/org_context.py --context [--write-cache]   # live context run (runtime file; + committed cache)
"""

import argparse
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent
CACHE_PATH = SERVICE_DIR / "org_facts.json"
PAGES_PATH = SERVICE_DIR / "org_pages.json"

FEED_URL = "https://miamifoundation.org/wp-json/wp/v2/posts?per_page={n}&_fields=date,link,title,content"
USER_AGENT = "Mozilla/5.0 (DevDay Miami donor tool; contact via repo)"

# Posts that announce events or give advice rather than report something the Foundation did
SKIP_URL_PARTS = ("/blog/",)

MIN_FACTS, MAX_FACTS = 6, 10


# ----------------------------------------------------------------------------------------------
# Fetch: the site's own feed, plain text per post
# ----------------------------------------------------------------------------------------------

def fetch_posts(n: int = 20) -> list[dict]:
    req = urllib.request.Request(FEED_URL.format(n=n), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = json.load(resp)

    posts = []
    for p in raw:
        if any(part in p["link"] for part in SKIP_URL_PARTS):
            continue
        posts.append({
            "date": p["date"][:10],
            "url": p["link"],
            "title": html.unescape(p["title"]["rendered"]),
            "text": html_to_text(p["content"]["rendered"]),
        })
    return posts


def html_to_text(s: str) -> str:
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s).replace(" ", " ")
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", s).strip()


# ----------------------------------------------------------------------------------------------
# Extract: the model picks accomplishments and quotes its source sentence
# ----------------------------------------------------------------------------------------------

PRIORITIES = ("Youth & Families", "Prosperity", "Civic", "Climate & Resilience", "Inequities")
Priority = Literal["Youth & Families", "Prosperity", "Civic", "Climate & Resilience", "Inequities"]

# Older cache rows carry the long priority names; map them onto the five short tags
LONG_PRIORITY = {"youth": "Youth & Families", "prosperity": "Prosperity", "civic": "Civic",
                 "climate": "Climate & Resilience", "resilience": "Climate & Resilience", "inequit": "Inequities"}


def normalize_priority(p: str | None) -> str | None:
    if p in PRIORITIES or not p:
        return p
    return next((short for key, short in LONG_PRIORITY.items() if key in p.lower()), None)


class Accomplishment(BaseModel):
    fact: str = Field(description="One plain sentence: what the Foundation (or its partners via the Foundation) did, with the exact numbers from the text")
    quote: str = Field(description="A short verbatim span copied from the text that supports the fact")
    priority: Priority = Field(description="The Foundation priority this fact serves")


class PostFacts(BaseModel):
    accomplishments: list[Accomplishment] = Field(description="0 to 2 concrete accomplishments; empty if the post only announces or advertises something")


class PageFacts(BaseModel):
    accomplishments: list[Accomplishment] = Field(description="2 to 4 concrete programs, investments or results on this page")


EXTRACT_INSTRUCTIONS = """You read one post from The Miami Foundation's website and pull out what the
Foundation actually DID: grants made, money raised, studies published, programs launched, people
convened. Copy numbers exactly as written. Never add a number, name or date that isn't in the post.
If the post reports conflicting totals, leave the total out. Skip pure event invitations and
registration notices. For each accomplishment, copy a short supporting span verbatim into `quote`."""


PAGE_INSTRUCTIONS = """You read one standing page from The Miami Foundation's website (a priority,
donor or about page) and pull out its concrete programs, investments and results: what each program
does, who it serves, money committed or raised, people reached. Copy numbers and years exactly as
written. Never add a number, name or date that isn't on the page. Prefer current programs over
one-time historic relief. For each, copy a short supporting span verbatim into `quote`."""


def extractor(instructions: str, output_type):
    from agents import Agent, ModelSettings
    from openai.types.shared import Reasoning

    return Agent(
        name="OrgContextExtractor",
        instructions=instructions,
        model=os.getenv("OPENAI_MODEL_DEFAULT"),
        output_type=output_type,
        model_settings=ModelSettings(reasoning=Reasoning(effort="low")),
    )


def grounded_facts(result, doc: dict, kind: str, date: str, priority: str | None = None) -> list[dict]:
    """Keep only accomplishments whose quote is in the source text."""
    facts = []
    for a in result.final_output.accomplishments:
        if not is_grounded(a.quote, doc["text"]):
            print(f"  dropped (quote not in source): {a.fact[:70]}", file=sys.stderr)
            continue
        facts.append({"date": date, "kind": kind, "title": doc["title"], "fact": a.fact, "quote": a.quote,
                      "priority": priority or a.priority, "url": doc["url"]})
    return facts


def extract_facts(posts: list[dict]) -> list[dict]:
    from agents import Runner

    agent = extractor(EXTRACT_INSTRUCTIONS, PostFacts)
    facts = []
    for post in posts:
        prompt = f"Title: {post['title']}\nPublished: {post['date']}\n\n{post['text'][:12000]}"
        result = Runner.run_sync(agent, prompt)
        facts += grounded_facts(result, post, "news", post["date"])
        print(f"  {post['date']}  {len(result.final_output.accomplishments)} fact(s)  {post['url']}", file=sys.stderr)
        if len(facts) >= MAX_FACTS:
            break
    return facts[:MAX_FACTS]


def extract_page_facts(pages: list[dict]) -> list[dict]:
    """Priority pages are tagged with their own priority; donor/about pages (priority null in
    org_pages.json) describe the whole Foundation, so their facts carry no priority.
    A page fact's date is the page's last-updated date."""
    from agents import Runner

    agent = extractor(PAGE_INSTRUCTIONS, PageFacts)
    facts = []
    for page in pages:
        prompt = f"Page: {page['title']}\nLast updated: {page['updated']}\n\n{page['text'][:12000]}"
        result = Runner.run_sync(agent, prompt)
        got = grounded_facts(result, page, "page", page["updated"], page.get("priority"))
        if page.get("priority") is None:          # donor/about pages describe the whole Foundation
            got = [f | {"priority": None} for f in got]
        facts += got
        print(f"  {page['updated']}  {len(got)} fact(s)  {page['url']}", file=sys.stderr)
    return facts


def is_grounded(quote: str, text: str) -> bool:
    norm = lambda s: re.sub(r"[^a-z0-9$%]+", " ", s.lower()).strip()
    return bool(quote.strip()) and norm(quote) in norm(text)


# ----------------------------------------------------------------------------------------------
# Cache
# ----------------------------------------------------------------------------------------------

def cached_facts() -> list[dict]:
    if not CACHE_PATH.exists():
        return []
    facts = json.loads(CACHE_PATH.read_text(encoding="utf-8"))["facts"]
    return [f | {"kind": f.get("kind", "news"), "priority": normalize_priority(f.get("priority"))} for f in facts]


def write_cache(facts: list[dict]) -> None:
    CACHE_PATH.write_text(json.dumps({
        "source": "https://miamifoundation.org",      # news facts: the site's posts feed; page facts: org_pages.json
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "facts": facts,
    }, indent=2, ensure_ascii=False), encoding="utf-8")


def refresh_news(n_posts: int = 20) -> list[dict]:
    """Re-read the news feed; keeps the cached page facts."""
    load_dotenv(REPO_ROOT / ".env")
    news = [scrub(f) for f in extract_facts(fetch_posts(n_posts))]
    if len(news) < MIN_FACTS:
        raise RuntimeError(f"only {len(news)} grounded news facts (need {MIN_FACTS}); cache left unchanged")
    facts = news + [f for f in cached_facts() if f["kind"] == "page"]
    write_cache(facts)
    return facts


def refresh_pages() -> list[dict]:
    """Re-extract page facts from org_pages.json (the browser-read page text); keeps the news facts.
    Fails unless every one of the five priorities ends up with at least one fact."""
    load_dotenv(REPO_ROOT / ".env")
    pages = json.loads(PAGES_PATH.read_text(encoding="utf-8"))["pages"]
    page_facts = [scrub(f) for f in extract_page_facts(pages)]
    facts = [f for f in cached_facts() if f["kind"] == "news"] + page_facts
    missing = [p for p in PRIORITIES if not any(f["priority"] == p for f in facts)]
    if missing:
        raise RuntimeError(f"no facts for priorities {missing}; cache left unchanged")
    write_cache(facts)
    return facts


def load_org_facts() -> list[dict]:
    """Every org fact outreach may cite, newest first, from the cache only (never the network):
    org_facts.json plus the context agent's facts (the org_context table when db.py has it,
    else service/context_cache.json). Duplicates by url + fact are dropped."""
    facts, seen = [], set()
    for f in [scrub(f) for f in cached_facts()] + context_as_org_facts():
        key = (f["url"], re.sub(r"\W+", " ", f["fact"].lower())[:60])
        if key not in seen:
            seen.add(key)
            facts.append(f)
    return sorted(facts, key=lambda f: f.get("date") or "", reverse=True)


def priority_counts(facts: list[dict]) -> dict:
    return {p: sum(f["priority"] == p for f in facts) for p in PRIORITIES}


# Sources disagree on the Press Forward South Florida total: the release says "nearly $1M", the
# September newsletter says $760,000 (plan.md §11). Keep the item, drop the total.
PRESS_FORWARD_TOTAL = re.compile(r"(?:nearly |more than |over )?\$[\d,.]+\s*(?:million|M|K)?\s+in\s+(?=grants|support)", re.I)


def scrub(fact: dict) -> dict:
    if "press forward" not in fact["fact"].lower():
        return fact
    return fact | {k: PRESS_FORWARD_TOTAL.sub("", fact[k]) for k in ("fact", "quote") if k in fact}


# ----------------------------------------------------------------------------------------------
# Context agent: build_context(urls) researches an org's website and news, live, via hosted search
# ----------------------------------------------------------------------------------------------
#
# A direct fetch of miamifoundation.org now hits a CAPTCHA, so the agent reaches the site through
# the Agents SDK's hosted WebSearchTool (OpenAI-side search). Hosted search returns its sources,
# not page text, so live facts are "search-cited": a fact is kept only if its URL is on the org's
# own site AND among the URLs that run's searches actually returned, and it has a date. Its quote
# can't be checked against the page itself. Social URLs are stored on the profile, never fetched.

# The reviewed demo cache is committed and changes only on an explicit --write-cache (the pipeline);
# a live run writes the gitignored runtime file instead, so a run on stage never dirties the repo.
CONTEXT_CACHE = SERVICE_DIR / "context_cache.json"
CONTEXT_LIVE = Path(os.environ.get("CONTEXT_LIVE", REPO_ROOT / "data" / "context_live.json"))
SOCIALS = {"x": ("x_url", "x"), "linkedin": ("linkedin_url", "linkedin"), "instagram": ("instagram_url", "instagram")}
CONTEXT_TIMEOUT_S = 40

# Read from miamifoundation.org's own footer links on 2026-11-07; the site links no X account
FOUNDATION_URLS = {"name": "The Miami Foundation", "website": "https://miamifoundation.org/", "x_url": None,
                   "linkedin_url": "https://www.linkedin.com/company/the-miami-foundation/",
                   "instagram_url": "https://www.instagram.com/miamifoundation/"}


KINDS = ("success_story", "program_update", "use_of_funds", "org_health", "event", "news", "other")
Kind = Literal["success_story", "program_update", "use_of_funds", "org_health", "event", "news", "other"]
STORY_KINDS = ("success_story", "use_of_funds", "org_health")     # what every campaign must draw on (§21.2.4)
KIND_GUIDE = ("success_story = a person, family, group or nonprofit the organization helped, and the result; "
              "use_of_funds = where money went (grants awarded, investments, scholarships paid, dollars to a program); "
              "org_health = how the organization itself is doing (assets, totals raised or invested, records, donor "
              "counts, milestones); program_update = a program launched, expanded or run; event = an upcoming or "
              "recent event; news = other announcements; other = anything else.")


class ContextFact(BaseModel):
    kind: Kind = Field(description=KIND_GUIDE)
    title: str = Field(description="A 3-8 word headline for this fact, no figures that aren't in the fact")
    fact: str = Field(description="One plain sentence about what the organization did or runs, numbers copied exactly")
    quote: str = Field(description="A short verbatim span from the search result that supports the fact")
    url: str = Field(description="The exact page URL on the organization's site where this appears, as returned by search")
    posted_at: str = Field(description="YYYY-MM-DD the page or post was published or last updated; empty if not shown")
    priority: str = Field(description="The organization's own priority or focus area this fact serves, as the site names it")


class ContextFacts(BaseModel):
    facts: list[ContextFact]


class ProfileOut(BaseModel):
    name: str
    priorities: list[str] = Field(description="The organization's own priority or focus areas, short, as its site names them (3-6)")
    voice: list[str] = Field(description="3 to 5 short phrases copied verbatim from the site that show its voice")
    voice_urls: list[str] = Field(description="The pages those phrases came from")


def site_host(url: str | None) -> str:
    host = re.sub(r"^https?://", "", (url or "").strip().lower()).split("/")[0]
    return host.removeprefix("www.")


def norm_url(url: str) -> str:
    """Drop query, fragment and the site's /es/ and /ht/ language prefixes; keep a trailing slash."""
    u = url.split("#")[0].split("?")[0]
    u = re.sub(r"^(https?://[^/]+)/(?:es|ht)/", r"\1/", u)
    return u if u.endswith("/") or "." in u.rsplit("/", 1)[-1] else u + "/"


def search_sources(result) -> set[str]:
    """Every URL the run's hosted searches returned or opened."""
    urls = set()
    for item in result.new_items:
        raw = getattr(item, "raw_item", None)
        if type(raw).__name__ != "ResponseFunctionWebSearch":
            continue
        action = raw.action
        for s in getattr(action, "sources", None) or []:
            if getattr(s, "url", None):
                urls.add(norm_url(s.url))
        if getattr(action, "url", None):
            urls.add(norm_url(action.url))
    return urls


def search_model():
    from agents import OpenAIResponsesModel
    from openai import AsyncOpenAI
    client = AsyncOpenAI(timeout=CONTEXT_TIMEOUT_S, max_retries=1)
    return OpenAIResponsesModel(model=os.getenv("OPENAI_MODEL_DEFAULT"), openai_client=client)


def search_agent(name: str, instructions: str, output_type):
    from agents import Agent, ModelSettings, WebSearchTool
    from openai.types.shared import Reasoning
    return Agent(name=name, instructions=instructions, model=search_model(), tools=[WebSearchTool()],
                 output_type=output_type,
                 model_settings=ModelSettings(reasoning=Reasoning(effort="low"),
                                              response_include=["web_search_call.action.sources"]))


def context_prompts(host: str, today: str, priorities: list[str]) -> dict:
    tag = (f"priority must be exactly one of: {' | '.join(priorities)}." if priorities
           else "priority is the organization's own focus area, as its site names it.")
    rules = (f"Search only {host} (use site:{host}). Use only pages your searches return; the url must be that "
             "page's exact URL. Copy numbers exactly; never add a number, name or date that isn't in the result. "
             "posted_at is the date shown for that page or post (YYYY-MM-DD); leave it empty if none is shown. "
             f"Plain text only: no links or markdown in fact or quote. {tag}")
    story = ("Cover, wherever the site has them, at least two of each: success stories (who was helped and the "
             "result), how money is being spent (grants, investments, scholarships paid), and how the organization "
             f"is doing (assets, totals raised or invested, records, milestones). Classify each fact's kind: {KIND_GUIDE}")
    return {
        "website": (f"Find 8-10 concrete programs, investments or results from {host}'s own dated pages: "
                    f"year-in-review posts, impact reports, program launches and announcements, newest first. {story} {rules}"),
        "news": (f"Find 8-10 accomplishments from {host}'s news posts and newsletters published in the 90 days "
                 f"before {today}, newest first. {story} {rules}"),
    }


async def run_context_searches(host: str, today: str, priorities: list[str], progress) -> tuple[dict, dict]:
    import asyncio
    from agents import Runner

    prompts = context_prompts(host, today, priorities)
    profile_agent = search_agent("ContextProfile", f"Search only {host} (site:{host}). Report the organization's "
                                 "name, its own priority areas as the site names them, and 3-5 short phrases copied "
                                 "verbatim from the site that show its voice, with the pages they came from.", ProfileOut)

    async def one(source: str, agent, prompt: str):
        progress(source, "running")
        try:
            r = await Runner.run(agent, prompt)
            return source, r, None
        except Exception as e:                       # one source failing must not sink the others
            return source, None, f"error: {type(e).__name__}"

    jobs = [one("profile", profile_agent, f"Profile of {host}")]
    jobs += [one(s, search_agent(f"Context-{s}", "You research an organization's own website.", ContextFacts), p)
             for s, p in prompts.items()]
    results = {s: (r, err) for s, r, err in await asyncio.gather(*jobs)}
    return results, prompts


def strip_links(s: str) -> str:
    """Hosted search tends to append '([site](url))' citations inside text; facts stay plain."""
    s = re.sub(r"\s*\(\[[^\]]*\]\([^)]*\)\)", "", s or "")
    return re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s).strip()


MOJIBAKE = ("â€", "â", "Ã©", "Ã¡", "Ã±", "Â ")


def clean_text(s: str | None) -> str:
    """Repair UTF-8 that was decoded as cp1252 somewhere upstream ('â€œ' -> '“'); leave good text alone."""
    s = s or ""
    if not any(m in s for m in MOJIBAKE):
        return s
    raw = bytearray()
    for ch in s:                                      # cp1252 where it maps, else the raw byte (0x81, 0x8d, 0x9d...)
        try:
            raw += ch.encode("cp1252")
        except UnicodeEncodeError:
            if ord(ch) > 0xFF:
                return s
            raw.append(ord(ch))
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return s


def clean_phrase(s: str) -> str:
    """A voice phrase, repaired and without the quote marks search wraps around it."""
    return clean_text(strip_links(s)).strip().strip('"“”\'‘’').strip()


def apply_request(out: dict, urls: dict, website: str | None, socials: dict) -> dict:
    """Profile URLs always come from the request; a cached run only supplies facts, voice and
    priorities. Social status follows the request too. Every string is repaired on the way out."""
    out = json.loads(json.dumps(out))                 # never mutate the cached copy
    prof = out["profile"]
    prof.update({"website": website, "x_url": socials["x"], "linkedin_url": socials["linkedin"],
                 "instagram_url": socials["instagram"], "name": urls.get("name") or prof.get("name")})
    prof["voice"]["phrases"] = [clean_phrase(v) for v in prof["voice"].get("phrases", [])]
    for f in out["facts"]:
        f["fact"], f["quote"] = clean_text(f.get("fact")), clean_text(f.get("quote"))
        f["cached"] = True
    for k, u in socials.items():
        out["sources"][k] = "skipped"
        out["source_notes"][k] = "saved, not connected" if u else "not provided"
    return out


def match_priority(label: str, priorities: list[str]) -> str | None:
    """Map a fact's free-text priority onto the org's priority list (the Foundation's five short tags
    when it's miamifoundation.org)."""
    short = normalize_priority(label)
    if short in priorities:
        return short
    words = set(re.findall(r"[a-z]{4,}", (label or "").lower()))
    best = max(priorities, key=lambda p: len(words & set(re.findall(r"[a-z]{4,}", p.lower()))), default=None)
    return best if best and words & set(re.findall(r"[a-z]{4,}", best.lower())) else None


def read_runs(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def cached_run(host: str) -> dict | None:
    """The last good run for this site: the runtime file first, then the committed cache."""
    for path in (CONTEXT_LIVE, CONTEXT_CACHE):
        run = read_runs(path).get(host)
        if run:
            return run
    return None


def save_run(host: str, out: dict, write_cache: bool = False) -> list[str]:
    """Store a good run in the runtime file, and in the committed cache only when asked."""
    written = []
    for path in [CONTEXT_LIVE] + ([CONTEXT_CACHE] if write_cache else []):
        runs = read_runs(path)
        runs[host] = out
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(runs, indent=2, ensure_ascii=False), encoding="utf-8")
        written.append(str(path))
    return written


def build_context(urls: dict, refresh: bool = False, progress=None, write_cache: bool = False) -> dict:
    """The context agent. urls: {name, website, x_url, linkedin_url, instagram_url} (bare x/linkedin/
    instagram keys also accepted; None = not provided). Pure: no db writes (db.save_context stores it).
    refresh=False returns the last good run (data/context_live.json, then the committed
    service/context_cache.json) when there is one. A live run writes data/context_live.json;
    write_cache=True (the pipeline's --write-cache) also rewrites the committed cache.
    progress(source, status) is called as each source starts and finishes."""
    import asyncio
    import time
    from datetime import date as _date

    progress = progress or (lambda source, status: None)
    website = urls.get("website")
    host = site_host(website)
    socials = {k: urls.get(a) or urls.get(b) for k, (a, b) in SOCIALS.items()}
    cached = None if refresh else cached_run(host)

    if cached:
        cached["sources"] = {s: ("cached" if st == "ok" else st) for s, st in cached["sources"].items()}
        cached.setdefault("source_notes", {})
        out = apply_request(cached, urls, website, socials)
        for s, st in out["sources"].items():
            progress(s, out["source_notes"].get(s, st) if s in socials else st)
        return out
    if not host:
        raise ValueError("build_context needs a website URL")

    load_dotenv(REPO_ROOT / ".env")
    started = time.monotonic()
    today = os.environ.get("SCORE_AS_OF") or _date.today().isoformat()
    for k, u in socials.items():
        progress(k, "saved, not connected" if u else "not provided")

    if not resolves(host):                            # no such site: say so, don't search
        err = f"error: DNS: {host} not found"
        for source in ("website", "news"):
            progress(source, err)
        return context_result(urls, website, socials, None, [], [],
                              {s: err for s in ("website", "news")}, {}, started, "")

    known = list(PRIORITIES) if host == "miamifoundation.org" else []   # the Foundation's five tags
    results, _ = asyncio.run(run_context_searches(host, today, known, progress))

    profile_r, _ = results.get("profile", (None, None))
    prof = profile_r.final_output if profile_r else None
    priorities = known or (prof.priorities if prof else [])
    captured_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    facts, sources, dropped = [], {}, {}
    for source in ("website", "news"):
        r, err = results[source]
        if err:
            sources[source] = err
        else:
            kept, dropped[source], sources[source] = validate_source(
                source, r.final_output.facts, search_sources(r), host, priorities, captured_at)
            facts += kept
        progress(source, sources[source] if sources[source].startswith("error") else f"done {sum(f['source'] == source for f in facts)} facts")

    out = context_result(urls, website, socials, prof, priorities, facts, sources, dropped, started, captured_at)
    if facts:                                         # store only a good run
        save_run(host, out, write_cache)
    return out


def resolves(host: str) -> bool:
    import socket
    try:
        socket.getaddrinfo(host, 443)
        return True
    except OSError:
        return False


def validate_source(source: str, found: list, cited: set[str], host: str, priorities: list[str],
                    captured_at: str) -> tuple[list[dict], list[str], str]:
    """Keep a fact only if its URL is on the org's site, among the URLs the search returned, and
    dated. Status is 'ok' only when something survives; otherwise an 'error: ...' that says why."""
    kept, why_dropped = [], []
    for f in found:
        url = norm_url(f.url)
        if site_host(url) != host:
            why_dropped.append(f"off-site url {url}")
        elif url not in cited:
            why_dropped.append(f"url not returned by search {url}")
        elif not re.fullmatch(r"\d{4}-\d{2}-\d{2}", f.posted_at or ""):
            why_dropped.append(f"undated {url}")
        elif "press forward" in f.fact.lower() and re.search(r"760,000|\$760K|nearly \$1", f.fact, re.I):
            why_dropped.append("Press Forward total (sources disagree)")
        else:
            kept.append({"source": source, "url": url, "posted_at": f.posted_at, "fact": clean_text(strip_links(f.fact)),
                         "kind": f.kind if f.kind in KINDS else heuristic_kind(f.fact),
                         "title": clean_text(strip_links(f.title)) or short_title(f.fact),
                         "quote": clean_text(strip_links(f.quote)), "priority": match_priority(f.priority, priorities),
                         "captured_at": captured_at, "verification": "search-cited"})
    if kept:
        status = "ok"
    elif not any(site_host(u) == host for u in cited):
        status = f"error: search found no pages on {host}"
    else:
        status = f"error: no usable facts ({len(why_dropped)} dropped)"
    return kept, why_dropped, status


def org_name(name: str | None) -> str | None:
    """A name, not prose: the model sometimes explains a failure in the name field."""
    name = clean_text(strip_links(name)).strip()
    prose = re.search(r"\b(?:unable|could not|cannot|couldn't|not found|no results|unknown)\b", name, re.I)
    return None if not name or prose or len(name) > 80 or name.count(".") > 1 else name


def context_result(urls, website, socials, prof, priorities, facts, sources, dropped, started, captured_at) -> dict:
    import time
    host = site_host(website)
    notes = {s: (f"done {sum(f['source'] == s for f in facts)} facts" if st == "ok" else st)
             for s, st in sources.items()}
    for k, u in socials.items():
        sources[k] = "skipped"
        notes[k] = "saved, not connected" if u else "not provided"
    facts.sort(key=lambda f: f["posted_at"], reverse=True)
    found = bool(facts)                               # nothing from the site: report nothing about it
    voice_urls = [norm_url(u) for u in (prof.voice_urls if prof else []) if site_host(u) == host] if found else []
    return {
        "profile": {"name": urls.get("name") or (org_name(prof.name) if prof and found else None), "website": website,
                    "x_url": socials["x"], "linkedin_url": socials["linkedin"], "instagram_url": socials["instagram"],
                    "priorities": ([p for p in priorities if any(f["priority"] == p for f in facts)] or list(priorities))
                                  if found else [],
                    "voice": {"phrases": [clean_phrase(v) for v in (prof.voice if prof else [])][:5] if found else [],
                              "urls": voice_urls}},
        "facts": facts,
        "sources": sources,
        "source_notes": notes,
        "dropped": dropped,
        "run_seconds": round(time.monotonic() - started, 1),
        "captured_at": captured_at,
    }


def context_as_org_facts() -> list[dict]:
    """Context facts in the shape outreach ranks: the org_context table if db.py has created it,
    else the cached runs in context_cache.json."""
    rows = []
    db = Path(os.environ.get("DONORS_DB", REPO_ROOT / "data" / "donors.db"))
    if db.exists():
        import sqlite3
        with sqlite3.connect(db) as con:
            con.row_factory = sqlite3.Row
            if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='org_context'").fetchone():
                rows = [dict(r) for r in con.execute("SELECT * FROM org_context")]
    if not rows:                                      # runtime file first, then the committed cache
        runs = read_runs(CONTEXT_CACHE) | read_runs(CONTEXT_LIVE)
        rows = [f for run in runs.values() for f in run["facts"]]
    return [{"date": r.get("posted_at"), "kind": r.get("source"), "fact": r["fact"], "quote": r.get("quote"),
             "priority": normalize_priority(r.get("priority")) or r.get("priority"), "url": r["url"]}
            for r in rows if r.get("fact") and r.get("url")]


# ----------------------------------------------------------------------------------------------
# Context store (§21.2.3): every row has a kind and a title, is embedded, and is searched by
# cosine similarity x recency (half-life 90 days), newest first on ties.
# ----------------------------------------------------------------------------------------------

EMBED_MODEL = "text-embedding-3-small"
HALF_LIFE_DAYS = 90
STORE_COLUMNS = {"kind": "TEXT", "title": "TEXT", "embedding": "BLOB", "cached": "INTEGER NOT NULL DEFAULT 0"}


def short_title(fact: str) -> str:
    words = re.sub(r"^The Miami Foundation('s)?\s+", "", fact or "").split()
    return " ".join(words[:8]).rstrip(",.;:") + ("…" if len(words) > 8 else "")


def heuristic_kind(text: str) -> str:
    """The no-model fallback (and a backstop for legacy rows): keyword rules, conservative."""
    t = (text or "").lower()
    if re.search(r"\b(invested over|assets|record|raised|fundholders|donors|milestone|anniversary|\$1 billion)\b", t):
        return "org_health"
    if re.search(r"\b(awarded|grants? (to|of|totaling)|investment in|invest(ed|ing) \$|scholarships totaling|committed \$|\$[\d,.]+ (in|to))\b", t):
        return "use_of_funds"
    if re.search(r"\b(helped|served|students|families|graduat|received|benefit|reached)\b", t):
        return "success_story"
    if re.search(r"\b(launch|program|initiative|fund\b|fellows)\b", t):
        return "program_update"
    return "news"


class Classified(BaseModel):
    i: int
    kind: Kind = Field(description=KIND_GUIDE)
    title: str = Field(description="A 3-8 word headline, no figures that aren't in the fact")


class ClassifiedBatch(BaseModel):
    items: list[Classified]


def classify_facts(facts: list[str]) -> list[tuple[str, str]]:
    """(kind, title) per fact: one structured-output model call for the batch, keyword rules without a key."""
    if not facts:
        return []
    fallback = [(heuristic_kind(f), short_title(f)) for f in facts]
    load_dotenv(REPO_ROOT / ".env")
    if not (os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_MODEL_DEFAULT")):
        return fallback
    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning
    try:
        from service.outreach_agent import bounded_model
    except ImportError:                                   # imported as a top-level module (scripts, tests)
        from outreach_agent import bounded_model
    try:
        agent = Agent(name="ContextClassifier", model=bounded_model(), output_type=ClassifiedBatch,
                      instructions="Classify each numbered fact about a nonprofit into exactly one kind and give it a "
                                   "short headline. " + KIND_GUIDE,
                      model_settings=ModelSettings(reasoning=Reasoning(effort="low")))
        out = Runner.run_sync(agent, "\n".join(f"{i}. {f}" for i, f in enumerate(facts))).final_output
        got = {c.i: (c.kind, clean_text(c.title) or short_title(facts[c.i])) for c in out.items if 0 <= c.i < len(facts)}
        return [got.get(i, fallback[i]) for i in range(len(facts))]
    except Exception:
        return fallback


def embed_texts(texts: list[str]) -> list[bytes | None]:
    """float32 embeddings as bytes, one OpenAI call for the batch; None each when there's no key or it fails."""
    import numpy as np
    if not texts:
        return []
    load_dotenv(REPO_ROOT / ".env")
    if not os.getenv("OPENAI_API_KEY"):
        return [None] * len(texts)
    try:
        from openai import OpenAI
        resp = OpenAI(timeout=CONTEXT_TIMEOUT_S, max_retries=1).embeddings.create(model=EMBED_MODEL, input=texts)
        return [np.asarray(d.embedding, dtype=np.float32).tobytes() for d in sorted(resp.data, key=lambda d: d.index)]
    except Exception:
        return [None] * len(texts)


def store_connection(conn=None):
    """The donors.db connection (DONORS_DB overrides), with the store's columns present."""
    import sqlite3
    if conn is None:
        db = Path(os.environ.get("DONORS_DB", REPO_ROOT / "data" / "donors.db"))
        if not db.exists():
            return None
        conn = sqlite3.connect(db)
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='org_context'").fetchone():
        return conn
    have = {r[1] for r in conn.execute("PRAGMA table_info(org_context)")}
    for name, kind in STORE_COLUMNS.items():             # same guarded columns as db.ADDED_COLUMNS
        if name not in have:
            conn.execute(f"ALTER TABLE org_context ADD COLUMN {name} {kind}")
    return conn


def index_context(conn=None) -> dict:
    """Give every org_context row a kind, a title and an embedding. The kind and title come from the
    run that found the fact (runtime file, then the committed cache) when it has them; otherwise one
    batched model call classifies the rest. Idempotent: rows already indexed are left alone."""
    import sqlite3
    conn = store_connection(conn)
    if conn is None or not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='org_context'").fetchone():
        return {"classified": 0, "embedded": 0}
    known = {}
    for path in (CONTEXT_CACHE, CONTEXT_LIVE):           # live last, so the newest run wins
        for run in read_runs(path).values():
            for f in run.get("facts", []):
                if f.get("kind") in KINDS:
                    known[(norm_url(f["url"]), f["fact"])] = (f["kind"], f.get("title") or short_title(f["fact"]), bool(f.get("cached")))
    rows = conn.execute("SELECT id, url, fact, kind, title, embedding FROM org_context").fetchall()
    todo = [r for r in rows if r[3] is None or not r[4]]
    unknown = [r for r in todo if (norm_url(r[1]), r[2]) not in known]
    guessed = dict(zip([r[0] for r in unknown], classify_facts([r[2] for r in unknown])))
    for r in todo:
        kind, title, cached = known.get((norm_url(r[1]), r[2]), (*guessed.get(r[0], (heuristic_kind(r[2]), short_title(r[2]))), False))
        conn.execute("UPDATE org_context SET kind = COALESCE(kind, ?), title = COALESCE(title, ?), cached = ? WHERE id = ?",
                     (kind, title, int(cached), r[0]))
    missing = conn.execute("SELECT id, title, fact FROM org_context WHERE embedding IS NULL").fetchall()
    vectors = embed_texts([f"{t or ''}. {f}" for _, t, f in missing])
    for (rid, _, _), v in zip(missing, vectors):
        if v is not None:
            conn.execute("UPDATE org_context SET embedding = ? WHERE id = ?", (sqlite3.Binary(v), rid))
    conn.commit()
    return {"classified": len(todo), "embedded": sum(v is not None for v in vectors)}


def recency_weight(posted_at: str | None, as_of: str) -> float:
    if not posted_at:
        return 0.25                                       # undated: kept, but behind anything dated
    from datetime import date as _d
    age = max((_d.fromisoformat(as_of[:10]) - _d.fromisoformat(posted_at[:10])).days, 0)
    return 0.5 ** (age / HALF_LIFE_DAYS)


def search_context(query: str | None = None, kinds: list[str] | tuple[str, ...] | None = None, k: int = 8,
                   conn=None, as_of: str | None = None) -> list[dict]:
    """[{id, kind, title, text, source_url, posted_at, score}] best first. score = cosine(query, row) x
    recency weight; with no query (or no embeddings) it's recency alone, so the newest come first.
    Ties go to the newest. Indexes any unindexed rows first."""
    import numpy as np
    conn = store_connection(conn)
    if conn is None or not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='org_context'").fetchone():
        return []
    index_context(conn)
    as_of = as_of or os.environ.get("SCORE_AS_OF") or datetime.now(timezone.utc).date().isoformat()
    kinds = [x for x in (kinds or []) if x in KINDS]
    sql = "SELECT id, kind, title, fact, url, posted_at, embedding FROM org_context"
    rows = conn.execute(sql + (f" WHERE kind IN ({','.join('?' * len(kinds))})" if kinds else ""), kinds).fetchall()
    qv = None
    if query and query.strip():
        got = embed_texts([query.strip()])
        if got and got[0] is not None:
            qv = np.frombuffer(got[0], dtype=np.float32)
    out = []
    for rid, kind, title, fact, url, posted_at, emb in rows:
        score = recency_weight(posted_at, as_of)
        if qv is not None and emb:
            v = np.frombuffer(emb, dtype=np.float32)
            score *= max(float(v @ qv / (np.linalg.norm(v) * np.linalg.norm(qv) or 1.0)), 0.0)
        out.append({"id": rid, "kind": kind, "title": title, "text": fact, "source_url": url,
                    "posted_at": posted_at, "score": round(score, 4)})
    out.sort(key=lambda r: (r["score"], r["posted_at"] or ""), reverse=True)
    return out[:max(int(k), 0)]


def after_context_saved(conn=None) -> dict:
    """What the onboarding run does once save_context has stored the facts: index the store, then
    generate the day's tasks (3a's generator) once that exists."""
    done = {"index": index_context(conn), "tasks": None}
    try:
        from service import tasks as _tasks              # 3a's lane; not landed yet on every branch
        gen = getattr(_tasks, "generate_tasks", None) or getattr(_tasks, "generate", None)
        if gen:
            done["tasks"] = gen(store_connection(conn))
    except ImportError:
        done["tasks"] = "tasks generator not available yet"
    return done


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true", help="print the cached facts instead of refreshing")
    ap.add_argument("--pages", action="store_true", help="refresh page facts from org_pages.json (not the news feed)")
    ap.add_argument("--posts", type=int, default=20)
    ap.add_argument("--context", action="store_true", help="run the context agent live on the Foundation's URLs")
    ap.add_argument("--write-cache", action="store_true", help="with --context: also rewrite the committed context_cache.json")
    args = ap.parse_args()

    if args.context:
        res = build_context(FOUNDATION_URLS, refresh=True, write_cache=args.write_cache,
                            progress=lambda s, st: print(f"  [{s}] {st}", file=sys.stderr))
        for f in res["facts"]:
            print(f"{f['posted_at']}  [{f['source']}|{f['priority']}]  {f['fact']}\n            {f['url']}")
        print(f"\n{len(res['facts'])} facts in {res['run_seconds']} s · sources {res['source_notes']}")
        print(f"dropped: { {k: len(v) for k, v in res['dropped'].items()} }  voice: {res['profile']['voice']['phrases']}")
        sys.exit(0)

    facts = load_org_facts() if args.show else refresh_pages() if args.pages else refresh_news(args.posts)
    for f in facts:
        print(f"{f['date']}  [{f['kind']}|{f['priority']}]  {f['fact']}\n            {f['url']}")
    print(f"\n{len(facts)} facts in {CACHE_PATH.relative_to(REPO_ROOT)}: {priority_counts(facts)}")
