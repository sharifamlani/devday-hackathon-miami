"""Org context: dated, sourced accomplishments from miamifoundation.org.

The Foundation's website is the only org-context source for the demo (plan.md §2 #5, §11).
Posts come from the site's public WordPress feed, so each fact's date and URL are the site's
own, never the model's. The model only picks the accomplishment out of each post, and must
quote the sentence it came from; facts whose quote isn't in the post text are dropped.

Results are cached to service/org_facts.json so the demo never depends on the site being up.

    python service/org_context.py            # refresh the cache from the live site
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

from dotenv import load_dotenv
from pydantic import BaseModel, Field

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent
CACHE_PATH = SERVICE_DIR / "org_facts.json"

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

class Accomplishment(BaseModel):
    fact: str = Field(description="One plain sentence: what the Foundation (or its partners via the Foundation) did, with the exact numbers from the post")
    quote: str = Field(description="A short verbatim span copied from the post text that supports the fact")
    priority: str = Field(description="Closest Foundation priority: Empower Youth & Families | Generate Prosperity | Inspire Civic Involvement | Build Climate & Disaster Resilience | Eliminate Inequities")


class PostFacts(BaseModel):
    accomplishments: list[Accomplishment] = Field(description="0 to 2 concrete accomplishments; empty if the post only announces or advertises something")


EXTRACT_INSTRUCTIONS = """You read one post from The Miami Foundation's website and pull out what the
Foundation actually DID: grants made, money raised, studies published, programs launched, people
convened. Copy numbers exactly as written. Never add a number, name or date that isn't in the post.
If the post reports conflicting totals, leave the total out. Skip pure event invitations and
registration notices. For each accomplishment, copy a short supporting span verbatim into `quote`."""


def extract_facts(posts: list[dict]) -> list[dict]:
    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning

    agent = Agent(
        name="OrgContextExtractor",
        instructions=EXTRACT_INSTRUCTIONS,
        model=os.getenv("OPENAI_MODEL_DEFAULT"),
        output_type=PostFacts,
        model_settings=ModelSettings(reasoning=Reasoning(effort="low")),
    )

    facts = []
    for post in posts:
        prompt = f"Title: {post['title']}\nPublished: {post['date']}\n\n{post['text'][:12000]}"
        result = Runner.run_sync(agent, prompt)
        for a in result.final_output.accomplishments:
            if not is_grounded(a.quote, post["text"]):
                print(f"  dropped (quote not in post): {a.fact[:70]}", file=sys.stderr)
                continue
            facts.append({
                "date": post["date"],
                "title": post["title"],
                "fact": a.fact,
                "quote": a.quote,
                "priority": a.priority,
                "url": post["url"],
            })
        print(f"  {post['date']}  {len(result.final_output.accomplishments)} fact(s)  {post['url']}", file=sys.stderr)
        if len(facts) >= MAX_FACTS:
            break
    return facts[:MAX_FACTS]


def is_grounded(quote: str, text: str) -> bool:
    norm = lambda s: re.sub(r"[^a-z0-9$%]+", " ", s.lower()).strip()
    return bool(quote.strip()) and norm(quote) in norm(text)


# ----------------------------------------------------------------------------------------------
# Cache
# ----------------------------------------------------------------------------------------------

def refresh_cache(n_posts: int = 20) -> list[dict]:
    load_dotenv(REPO_ROOT / ".env")
    posts = fetch_posts(n_posts)
    facts = [scrub(f) for f in extract_facts(posts)]
    if len(facts) < MIN_FACTS:
        raise RuntimeError(f"only {len(facts)} grounded facts (need {MIN_FACTS}); cache left unchanged")
    CACHE_PATH.write_text(json.dumps({
        "source": "https://miamifoundation.org (WordPress feed)",
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "facts": facts,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    return facts


def load_org_facts() -> list[dict]:
    """The cached facts, newest first. This is what outreach_agent reads; it never hits the network."""
    data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return sorted((scrub(f) for f in data["facts"]), key=lambda f: f["date"], reverse=True)


# Sources disagree on the Press Forward South Florida total: the release says "nearly $1M", the
# September newsletter says $760,000 (plan.md §11). Keep the item, drop the total.
PRESS_FORWARD_TOTAL = re.compile(r"(?:nearly |more than |over )?\$[\d,.]+\s*(?:million|M|K)?\s+in\s+(?=grants|support)", re.I)


def scrub(fact: dict) -> dict:
    if "press forward" not in fact["fact"].lower():
        return fact
    return fact | {"fact": PRESS_FORWARD_TOTAL.sub("", fact["fact"])}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true", help="print the cached facts instead of refreshing")
    ap.add_argument("--posts", type=int, default=20)
    args = ap.parse_args()

    facts = load_org_facts() if args.show else refresh_cache(args.posts)
    for f in facts:
        print(f"{f['date']}  {f['fact']}\n            {f['url']}")
    print(f"\n{len(facts)} facts in {CACHE_PATH.relative_to(REPO_ROOT)}")
