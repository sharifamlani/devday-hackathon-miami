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
    """The cached facts, newest first. This is what outreach_agent reads; it never hits the network."""
    return sorted((scrub(f) for f in cached_facts()), key=lambda f: f["date"], reverse=True)


def priority_counts(facts: list[dict]) -> dict:
    return {p: sum(f["priority"] == p for f in facts) for p in PRIORITIES}


# Sources disagree on the Press Forward South Florida total: the release says "nearly $1M", the
# September newsletter says $760,000 (plan.md §11). Keep the item, drop the total.
PRESS_FORWARD_TOTAL = re.compile(r"(?:nearly |more than |over )?\$[\d,.]+\s*(?:million|M|K)?\s+in\s+(?=grants|support)", re.I)


def scrub(fact: dict) -> dict:
    if "press forward" not in fact["fact"].lower():
        return fact
    return fact | {k: PRESS_FORWARD_TOTAL.sub("", fact[k]) for k in ("fact", "quote") if k in fact}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true", help="print the cached facts instead of refreshing")
    ap.add_argument("--pages", action="store_true", help="refresh page facts from org_pages.json (not the news feed)")
    ap.add_argument("--posts", type=int, default=20)
    args = ap.parse_args()

    facts = load_org_facts() if args.show else refresh_pages() if args.pages else refresh_news(args.posts)
    for f in facts:
        print(f"{f['date']}  [{f['kind']}|{f['priority']}]  {f['fact']}\n            {f['url']}")
    print(f"\n{len(facts)} facts in {CACHE_PATH.relative_to(REPO_ROOT)}: {priority_counts(facts)}")
