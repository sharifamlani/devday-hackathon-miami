"""Which organization the demo runs as (the persona), and its SAMPLE data pack.

The hackathon rules ask for made-up data, so the default persona is the fictional Tidepath. One switch
picks it: service/org_config.json "persona" (default "tidepath"); DONOR_DESK_PERSONA overrides the file.
Restart the service (and rerun the pipeline / export) after flipping: cache paths are read at import.

A pack is service/personas/<id>/:
    persona.json   org profile: name, city, mission, fiscal year, staff, website, sign-off, gift sites,
                   priorities, voice, and the prompt wording to swap in (localize)
    donors.json    the SAMPLE seed donors that db.seed() inserts
    facts.json     the org's own facts outreach may cite (service/org_facts.json shape)
    research.json  research facts by donor name (data/research_cache.json shape)
    icp.json       ideal donor profile + prospects (data/icp_cache.json shape)
persona.json "files" can point any of these at an existing file instead, which is how the
miami_foundation pack keeps using the original caches without copying them.

A fictional persona ("fictional": true) is invented end to end: its facts cite sample://<id>/<slug>
(never fetched, never linked), its context comes from the pack instead of a website read, and nothing
about a real organization is researched for it.
"""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent
PERSONAS_DIR = SERVICE_DIR / "personas"
ORG_CONFIG = SERVICE_DIR / "org_config.json"
DEFAULT_PERSONA = "tidepath"
SAMPLE_SCHEME = "sample://"


def persona_id() -> str:
    """DONOR_DESK_PERSONA, else org_config.json "persona", else tidepath."""
    env = (os.environ.get("DONOR_DESK_PERSONA") or "").strip()
    if env:
        return env
    try:
        return json.loads(ORG_CONFIG.read_text(encoding="utf-8")).get("persona") or DEFAULT_PERSONA
    except (OSError, ValueError):
        return DEFAULT_PERSONA


@lru_cache(maxsize=None)
def _load(pid: str) -> dict:
    path = PERSONAS_DIR / pid / "persona.json"
    if not path.exists():
        known = sorted(p.name for p in PERSONAS_DIR.iterdir() if (p / "persona.json").exists())
        raise ValueError(f"unknown persona {pid!r}; packs: {', '.join(known)}")
    return json.loads(path.read_text(encoding="utf-8"))


def current() -> dict:
    """The active persona.json (read once per persona id)."""
    return _load(persona_id())


def is_fictional() -> bool:
    return bool(current().get("fictional"))


def org_name() -> str:
    return current()["name"]


def sign_off() -> str:
    return current().get("sign_off") or f"The {org_name()} team"


def pack_file(kind: str, default: Path | None = None) -> Path:
    """Where the active pack keeps `kind` (facts | research | icp | donors): a "files" override (repo-relative),
    else personas/<id>/<kind>.json. `default` is returned when neither exists."""
    pid = persona_id()
    override = (current().get("files") or {}).get(kind)
    path = REPO_ROOT / override if override else PERSONAS_DIR / pid / f"{kind}.json"
    return path if path.exists() or default is None else default


def read_pack(kind: str, empty):
    path = pack_file(kind)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else empty


def seed_donors() -> list[dict]:
    """The SAMPLE seed for db.seed(): gifts as (amount, date, channel)."""
    donors = read_pack("donors", {"donors": []})["donors"]
    return [{**d, "gifts": [tuple(g) for g in d.get("gifts") or []]} for d in donors]


def org_urls() -> dict:
    """{name, website, x_url, linkedin_url, instagram_url}: what the context stage reads (onboarding screen 2)."""
    p = current()
    return {k: p.get(k) for k in ("name", "website", "x_url", "linkedin_url", "instagram_url")}


def is_sample_url(url: str | None) -> bool:
    """A sample://<persona>/<slug> source: invented for the demo, never fetched or linked."""
    return (url or "").startswith(SAMPLE_SCHEME)


def localize(text: str) -> str:
    """Rewrite the Miami Foundation wording the prompts and templates were written in into the active
    persona's (persona.json "wording"; longest phrase first). Identity for a persona without wording."""
    wording = {k: v for k, v in (current().get("wording") or {}).items() if not k.startswith("_")}
    if not wording or not text:
        return text
    pattern = re.compile("|".join(re.escape(k) for k in sorted(wording, key=len, reverse=True)))
    return pattern.sub(lambda m: wording[m.group(0)], text)


def _host(url: str | None) -> str:
    return re.sub(r"^https?://", "", (url or "").strip().lower()).split("/")[0].removeprefix("www.")


def sample_context(urls: dict | None = None) -> dict | None:
    """For a fictional persona whose own (sample) website is asked for: the pack's context, in
    org_context.build_context's shape, without reading anything. None otherwise (read the site as usual)."""
    p = current()
    website = (urls or {}).get("website") if urls else p.get("website")
    if not p.get("fictional") or not _host(website) or _host(website) != _host(p.get("website")):
        return None
    facts_pack = read_pack("facts", {"facts": []})
    captured_at = facts_pack.get("retrieved_at")
    facts = [{"source": "news" if f.get("kind") == "news" else "website", "url": f["url"],
              "posted_at": f.get("date"), "fact": f["fact"], "quote": f.get("quote"),
              "priority": f.get("priority"), "captured_at": captured_at, "verification": "sample"}
             for f in facts_pack["facts"]]
    facts.sort(key=lambda f: f["posted_at"] or "", reverse=True)
    socials = {"x": (urls or {}).get("x_url"), "linkedin": (urls or {}).get("linkedin_url"),
               "instagram": (urls or {}).get("instagram_url")}
    counts = {s: sum(f["source"] == s for f in facts) for s in ("website", "news")}
    return {
        "profile": {"name": p["name"], "website": website, "x_url": socials["x"],
                    "linkedin_url": socials["linkedin"], "instagram_url": socials["instagram"],
                    "priorities": list(p.get("priorities") or []),
                    "voice": {"phrases": list((p.get("voice") or {}).get("phrases") or []),
                              "urls": [f"{SAMPLE_SCHEME}{p['id']}/voice"]}},
        "facts": facts,
        "sources": {"website": "cached", "news": "cached", **{k: "skipped" for k in socials}},
        "source_notes": {**{s: f"SAMPLE: {counts[s]} facts from the {p['name']} pack" for s in counts},
                         **{k: "saved, not connected" if u else "not provided" for k, u in socials.items()}},
        "dropped": {},
        "run_seconds": 0.0,
        "captured_at": captured_at,
    }
