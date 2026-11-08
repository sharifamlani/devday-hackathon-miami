"""Social context: the Foundation's recent public posts on X, LinkedIn and Instagram.

Public information only. Each platform is read one of two ways:
  * live, through the platform's OFFICIAL API, whenever its token is in the environment
      X          X_BEARER_TOKEN
      Instagram  IG_ACCESS_TOKEN + IG_USER_ID          (Graph API, Business account)
      LinkedIn   LINKEDIN_ACCESS_TOKEN + LINKEDIN_ORG_URN   (Community Management API)
  * from data/social_cache.json (public pages read without logging in), only when there is no token or
    the live call fails; those facts are flagged cached=True
A platform that cannot be read legitimately is recorded as blocked in the cache; nothing here
logs in, uses cookies, or works around a bot wall.

Facts are short verbatim quotes from a post, with that post's own URL and date.

    python service/social_context.py            # print facts + status from the cache
    python service/social_context.py --refresh  # use official APIs where tokens exist
"""

import argparse
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = REPO_ROOT / "data" / "social_cache.json"
PLATFORMS = ("x", "linkedin", "instagram")
USER_AGENT = "DevDay Miami donor tool (official API client)"
MAX_QUOTE = 200


def _load_cache(path: Path | None = None) -> dict:
    with open(path or CACHE_PATH, encoding="utf-8") as f:
        return json.load(f)


def _get_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **headers})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def _now() -> str:
    return datetime.now(timezone.utc).date().isoformat()


# ---------------------------------------------------------------------------------------------
# Official-API adapters (each returns items in the cache schema)
# ---------------------------------------------------------------------------------------------

def _fetch_x(handle: str, n: int) -> list[dict]:
    auth = {"Authorization": "Bearer " + os.environ["X_BEARER_TOKEN"]}
    user = handle.lstrip("@")
    uid = _get_json(f"https://api.x.com/2/users/by/username/{user}", auth)["data"]["id"]
    q = urllib.parse.urlencode({"max_results": max(5, min(n, 100)), "tweet.fields": "created_at",
                                "exclude": "retweets,replies"})
    data = _get_json(f"https://api.x.com/2/users/{uid}/tweets?{q}", auth).get("data", [])
    return [{"platform": "x", "handle": handle, "post_url": f"https://x.com/{user}/status/{t['id']}",
             "posted_at": t["created_at"], "text": t["text"], "captured_at": _now(),
             "capture_method": "X API v2"} for t in data]


def _fetch_instagram(handle: str, n: int) -> list[dict]:
    q = urllib.parse.urlencode({"fields": "caption,permalink,timestamp", "limit": n,
                                "access_token": os.environ["IG_ACCESS_TOKEN"]})
    data = _get_json(f"https://graph.facebook.com/v19.0/{os.environ['IG_USER_ID']}/media?{q}", {})
    return [{"platform": "instagram", "handle": handle, "post_url": m["permalink"],
             "posted_at": m["timestamp"], "text": m["caption"], "captured_at": _now(),
             "capture_method": "Instagram Graph API"} for m in data.get("data", []) if m.get("caption")]


def _fetch_linkedin(handle: str, n: int) -> list[dict]:
    h = {"Authorization": "Bearer " + os.environ["LINKEDIN_ACCESS_TOKEN"],
         "Linkedin-Version": "202401", "X-Restli-Protocol-Version": "2.0.0"}
    author = urllib.parse.quote(os.environ["LINKEDIN_ORG_URN"], safe="")
    data = _get_json(f"https://api.linkedin.com/rest/posts?author={author}&q=author&count={n}", h)
    out = []
    for p in data.get("elements", []):
        if not p.get("commentary"):
            continue
        ts = datetime.fromtimestamp(p["createdAt"] / 1000, timezone.utc).isoformat()
        out.append({"platform": "linkedin", "handle": handle,
                    "post_url": f"https://www.linkedin.com/feed/update/{p['id']}/", "posted_at": ts,
                    "text": p["commentary"], "captured_at": _now(),
                    "capture_method": "LinkedIn Community Management API"})
    return out


_ADAPTERS = {
    "x": (_fetch_x, ("X_BEARER_TOKEN",)),
    "instagram": (_fetch_instagram, ("IG_ACCESS_TOKEN", "IG_USER_ID")),
    "linkedin": (_fetch_linkedin, ("LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORG_URN")),
}


# ---------------------------------------------------------------------------------------------
# Resolution: per platform, API (if refresh + token) else cache else blocked
# ---------------------------------------------------------------------------------------------

def _resolve(refresh: bool, limit: int, cache_path: Path | None = None) -> dict:
    cache = _load_cache(cache_path)
    result = {}
    for plat in PLATFORMS:
        meta = cache["platforms"].get(plat, {})
        items, source = None, None
        fetch, env_keys = _ADAPTERS[plat]
        if all(os.environ.get(k) for k in env_keys):
            try:
                items, source = fetch(meta.get("handle", ""), limit), "api"
            except Exception:  # API down or token rejected: fall back to the cache
                items = None
        if items is None:
            items = [{**i, "cached": True} for i in cache["items"] if i["platform"] == plat]
            source = "cache" if items else "blocked"
        result[plat] = {"source": source, "items": items, "blocked": meta.get("blocked")}
    return result


def _quote(text: str) -> str:
    """Leading span of the post, cut at a sentence end, always a verbatim substring."""
    text = text.strip()
    if len(text) <= MAX_QUOTE:
        return text
    cut = text[:MAX_QUOTE]
    ends = [m.end() for m in re.finditer(r"[.!?](?=\s)", cut)]
    return cut[:ends[-1]].strip() if ends else cut.rsplit(" ", 1)[0].strip()


def get_social_facts(limit: int = 10, refresh: bool = False, cache_path: Path | None = None) -> list[dict]:
    """Newest-first list of {fact, url, date, platform}. The quote inside `fact` is verbatim."""
    resolved = _resolve(refresh, limit, cache_path)
    items = [i for r in resolved.values() for i in r["items"]]
    items.sort(key=lambda i: i["posted_at"], reverse=True)
    facts = []
    for i in items[:limit]:
        quote = _quote(i["text"])
        facts.append({"fact": f'{i["handle"]} on {i["platform"].capitalize()}: "{quote}"',
                      "url": i["post_url"], "date": i["posted_at"][:10], "platform": i["platform"],
                      "quote": quote, "cached": i.get("cached", False)})
    return facts


def social_status(refresh: bool = False, cache_path: Path | None = None) -> dict:
    """Per platform: source (api|cache|blocked), item count, newest date, blocked reason."""
    resolved = _resolve(refresh, 100, cache_path)
    return {p: {"source": r["source"], "count": len(r["items"]),
                "newest": max((i["posted_at"][:10] for i in r["items"]), default=None),
                "blocked": r["blocked"] if r["source"] == "blocked" else None}
            for p, r in resolved.items()}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    print(json.dumps(social_status(a.refresh), indent=2))
    for f in get_social_facts(refresh=a.refresh):
        print(f["date"], f["platform"], f["url"], "\n  ", f["fact"])
