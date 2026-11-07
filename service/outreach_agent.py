"""Outreach agent: value-first drafts in The Miami Foundation's voice.

Every draft leads with what the Foundation did recently ("here's what we did"), then the ask.
Facts come only from org_facts (miamifoundation.org, via org_context) and the donor's
research_facts. The model cites facts by id; facts_used is rebuilt from those ids, so every
cited fact carries its exact text and URL. A numeric check rejects any figure in the draft
that isn't in the facts or the donor's own gift history, and the agent retries once.

Channels: email draft plus a call script for a human. Never robocalls (plan.md §11).
Big donors (is_star or tier == "big") get status "draft": a person must approve and send.
Everyone else gets "ready": the automated path may send it. (db.py's trigger also blocks
'sent' on a star donor without a human approver.)

Drafts go to the outreach_drafts table in data/donors.db (DONORS_DB overrides), with subject,
call_script and facts_used (JSON list of {fact, url}). If the table is missing or older than
that schema, the full draft goes to data/outreach_drafts.json instead.

    python -m service.outreach_agent 1 4          # donors 1 and 4 from donors.db (what POST /outreach/{id} runs)
    python -m service.outreach_agent              # the hand-built demo donors (not in the db)
"""

import json
import os
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent
DEMO_AS_OF = date(2026, 11, 8)      # same pinned demo date as score.py
JSON_FALLBACK = REPO_ROOT / "data" / "outreach_drafts.json"

GIVE_MIAMI_DAY = date(2026, 11, 19)
EARLY_GIVING_OPENS = date(2026, 11, 14)


def db_file() -> Path:
    """DONORS_DB overrides data/donors.db, read at call time like db.db_path()."""
    return Path(os.environ.get("DONORS_DB", REPO_ROOT / "data" / "donors.db"))


# ----------------------------------------------------------------------------------------------
# Output shapes
# ----------------------------------------------------------------------------------------------

class FactUsed(BaseModel):
    fact: str
    url: str


class Draft(BaseModel):
    subject: str
    body: str
    call_script: str
    facts_used: list[FactUsed]
    status: str                       # "draft" (human must approve) | "ready" (may auto-send)


class ModelDraft(BaseModel):
    subject: str = Field(description="Email subject line, under 70 characters")
    body: str = Field(description="Email body, 120-200 words, signed by the Foundation's philanthropy team")
    call_script: str = Field(description="What a staff member says on a phone call: opener, the update, the ask, and one line for 'not this year'")
    fact_ids: list[str] = Field(description="Ids (O1, R2, ...) of every fact used in the body or call script")


INSTRUCTIONS = """You write donor outreach for The Miami Foundation's philanthropy team.

Voice: upbeat, civic, plain, proudly local. The Foundation's own phrases include "Everyone has a
role to play." and "Miami, this is your celebration." Warm, never pushy, no guilt.

Structure: open by thanking the donor for their specific past giving, then lead with what the
Foundation did recently ("here's what we did"), drawn from the numbered facts. Only then make one
clear, specific ask tied to Give Miami Day. Never open with the ask.

Hard rules:
- Use ONLY the numbered facts and the donor's own gift history. Never invent a number, name,
  program, date or outcome. Copy figures exactly as the fact states them.
- Cite at least one O-fact (a Foundation accomplishment). List every fact id you used in fact_ids.
- Gifts are made only at miamifoundation.org or givemiamiday.org. Never mention WhatsApp,
  text-to-give, or automated calls.
- The call script is for a human staff member to read, in the same voice.
- Make exactly the ask given on the "Ask:" line of the prompt. Never name a dollar amount to give."""


# ----------------------------------------------------------------------------------------------
# Draft
# ----------------------------------------------------------------------------------------------

def draft_outreach(donor: dict, gifts: list[dict], score_why, research_facts: list[dict],
                   org_facts: list[dict], today: date | None = None) -> Draft:
    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning

    load_dotenv(REPO_ROOT / ".env")
    today = today or as_of_date(score_why)

    ranked = rank_org_facts(donor, research_facts, org_facts)
    facts = {f"O{i}": {"fact": f["fact"], "url": f["url"], "date": f.get("date")}
             for i, f in enumerate(ranked[:MAX_ORG_FACTS], 1)}
    facts |= {f"R{i}": {"fact": f["fact"], "url": f.get("source_url") or f.get("url", "")}
              for i, f in enumerate(research_facts, 1)}

    big = is_big(donor)
    prompt = build_prompt(donor, gifts, score_why, facts, big, today)

    agent = Agent(
        name="OutreachAgent",
        instructions=INSTRUCTIONS,
        model=os.getenv("OPENAI_MODEL_DEFAULT"),
        output_type=ModelDraft,
        model_settings=ModelSettings(reasoning=Reasoning(effort="medium")),
    )

    for attempt in range(2):
        out: ModelDraft = Runner.run_sync(agent, prompt).final_output
        problems = check_draft(out, facts, gifts, lead_id="O1")
        if not problems:
            break
        prompt += "\n\nYour previous draft was rejected:\n- " + "\n- ".join(problems) + "\nRewrite it."
    else:
        raise ValueError(f"draft failed checks twice: {problems}")

    return Draft(
        subject=out.subject,
        body=out.body,
        call_script=out.call_script,
        facts_used=[FactUsed(fact=facts[i]["fact"], url=facts[i]["url"]) for i in dict.fromkeys(out.fact_ids)],
        status="draft" if big else "ready",
    )


# ----------------------------------------------------------------------------------------------
# Fact choice: the org fact that fits this donor leads; ties rotate by donor id
# ----------------------------------------------------------------------------------------------

MAX_ORG_FACTS = 4

TOPICS = {
    "journalism": ("journalism", "newsroom", "news", "media", "press", "knight"),
    "south dade": ("south dade", "homestead", "amazon"),
    "arts":       ("arts", "artist", "museum", "culture", "creative", "crearte", "deluca"),
    "education":  ("scholarship", "student", "education", "youth", "school"),
    "legal":      ("legal", "law firm", "pro bono", "attorney"),
    "resilience": ("resilience", "disaster", "climate", "hurricane", "preparedness"),
    "civic":      ("vote", "candidate", "election", "civic"),
}


def donor_text(donor: dict, research_facts: list[dict]) -> str:
    parts = [donor.get(k) or "" for k in ("full_name", "org_name", "fund_type", "notes")]
    return " ".join(parts + [f["fact"] for f in research_facts]).lower()


def topics_in(text: str) -> set[str]:
    return {t for t, words in TOPICS.items() if any(w in text for w in words)}


def rank_org_facts(donor: dict, research_facts: list[dict], org_facts: list[dict]) -> list[dict]:
    """Best fit first: shared topics count 2, shared distinctive words count 1. Facts are first
    rotated by donor id, so equally good facts lead in a different order for different donors."""
    if not org_facts:
        return []
    text = donor_text(donor, research_facts)
    words = {w for w in re.findall(r"[a-z][a-z'-]{4,}", text)} - {"miami", "foundation", "family", "their", "which"}
    want = topics_in(text)

    shift = int(donor.get("id") or 0) % len(org_facts)
    rotated = org_facts[shift:] + org_facts[:shift]

    def fit(f):
        ft = f["fact"].lower()
        return 2 * len(want & topics_in(ft)) + sum(w in ft for w in words)
    return sorted(rotated, key=fit, reverse=True)       # stable: ties keep the rotated order


def as_of_date(why) -> date:
    """The demo's 'today', matching the score: SCORE_AS_OF, else the score's own as_of, else DEMO_AS_OF."""
    raw = os.environ.get("SCORE_AS_OF") or (why.get("as_of") if isinstance(why, dict) else None)
    return date.fromisoformat(raw) if raw else DEMO_AS_OF


def describe_why(why) -> str:
    """score.py's why JSON -> plain lines for the prompt. Figures the draft may not quote
    (days, ratios, points) stay out; the numeric check would reject them anyway."""
    if not isinstance(why, dict):
        return str(why or "")
    lines = []
    if why.get("status"):
        lines.append(f"Status: {why['status']}")
    if why.get("reasons"):
        lines.append("Reasons: " + ", ".join(r.replace("_", " ") for r in why["reasons"]))
    pat = why.get("pattern") or {}
    if pat.get("years"):
        lines.append(f"Pattern: gives in {pat.get('month_name')} via {pat.get('channel')} "
                     f"({', '.join(map(str, pat['years']))}); gave this year: {'yes' if pat.get('gave_this_year') else 'no'}")
    if why.get("usual_cadence_days") and why.get("days_since_last_gift") is not None:
        due = why["days_since_last_gift"] >= why["usual_cadence_days"] * 0.9
        lines.append("Timing: due for their usual gift now" if due else "Timing: not yet due")
    return "\n".join(lines)


def ask_for(big: bool, today: date) -> str:
    if big:
        return ("a personal conversation: a call or coffee with the philanthropy team about their "
                "year-end giving. No link to give online.")
    when = (f"when early giving opens {long_date(EARLY_GIVING_OPENS)}" if today < EARLY_GIVING_OPENS
            else f"by Give Miami Day, {long_date(GIVE_MIAMI_DAY)}")
    return f"a Give Miami Day gift at givemiamiday.org {when}."


def is_big(donor: dict) -> bool:
    return bool(donor.get("is_star")) or donor.get("tier") == "big"


def build_prompt(donor, gifts, score_why, facts, big, today) -> str:
    history = "\n".join(f"- {g['gift_date']}: ${g['amount']:,.0f} via {g.get('channel') or 'unknown'}"
                        for g in sorted(gifts, key=lambda g: g["gift_date"]))
    fact_lines = "\n".join(f"{k}: {v['fact']}" + (f" ({v['date']})" if v.get("date") else "")
                           for k, v in facts.items())
    why = describe_why(score_why)
    days_early = (EARLY_GIVING_OPENS - today).days
    days_gmd = (GIVE_MIAMI_DAY - today).days

    return f"""Today is {long_date(today)}. Early giving for Give Miami Day opens {long_date(EARLY_GIVING_OPENS)} \
({days_early} days away); Give Miami Day is {long_date(GIVE_MIAMI_DAY)} ({days_gmd} days away).

Donor: {donor.get('full_name')}{' (organization: ' + donor['org_name'] + ')' if donor.get('org_name') else ''}
Fund type: {donor.get('fund_type') or 'none on file'}
Tier: {'big donor / sponsor: a staff member will personally review and send this' if big else 'individual donor: this may be sent automatically'}
Ask: {ask_for(big, today)}
Why they're on today's list:
{why}

Gift history:
{history or '- none on file'}

Numbered facts you may use (O = Foundation accomplishment from miamifoundation.org, R = research on this donor).
O1 was chosen to fit this donor: lead the "here's what we did" part with O1, and list it first in fact_ids.
{fact_lines}"""


def long_date(d: date) -> str:
    return f"{d:%A, %B} {d.day}, {d.year}"      # no %-d: it isn't portable to Windows


# ----------------------------------------------------------------------------------------------
# Checks: every figure in the draft must come from a fact or the donor's gifts
# ----------------------------------------------------------------------------------------------

NUM_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|M|K|%)?", re.I)


# Sources disagree on the Press Forward total ("nearly $1M" vs $760K, plan.md §11): never quote one
BANNED_FIGURES = re.compile(r"760,000|\$760K|nearly \$1|\$1 ?(?:million|M)\b[^.]*press forward|press forward[^.]*\$1 ?(?:million|M)\b", re.I)


def check_draft(out: ModelDraft, facts: dict, gifts: list[dict], lead_id: str | None = None) -> list[str]:
    problems = []
    if lead_id and (not out.fact_ids or out.fact_ids[0] != lead_id):
        problems.append(f"lead with {lead_id} and list it first in fact_ids")
    if BANNED_FIGURES.search(out.subject + " " + out.body + " " + out.call_script):
        problems.append("never state a Press Forward South Florida total")
    unknown = [i for i in out.fact_ids if i not in facts]
    if unknown:
        problems.append(f"fact_ids not in the list: {unknown}")
    if not any(i.startswith("O") and i in facts for i in out.fact_ids):
        problems.append("cite at least one O-fact (a Foundation accomplishment)")

    allowed_text = " ".join(f["fact"] for f in facts.values())
    allowed = {norm_num(m) for m in NUM_RE.findall(allowed_text)}
    for g in gifts:
        allowed |= {norm_num(f"{g['amount']:,.0f}"), norm_num(str(g["gift_date"][:4]))}
    allowed |= {"2026", "14", "19", "15"}         # the Give Miami Day calendar in the prompt

    for m in NUM_RE.findall(out.body + " " + out.call_script):
        n = norm_num(m)
        if not n or (n.isdigit() and len(n) <= 2):    # small counts and days of the month
            continue
        if n not in allowed:
            problems.append(f"figure '{m.strip()}' is not in any fact or the gift history")
    return sorted(set(problems))


def norm_num(s: str) -> str:
    return re.sub(r"[^\d.]", "", s.split()[0] if s.split() else s).rstrip(".")


# ----------------------------------------------------------------------------------------------
# Persist: outreach_drafts table when db.py has made it, JSON file until then
# ----------------------------------------------------------------------------------------------

def save_draft(donor_id: int, draft: Draft) -> str:
    row = {
        "donor_id": donor_id,
        "channel": "email",
        "subject": draft.subject,
        "body": draft.body,
        "call_script": draft.call_script,
        "facts_used": json.dumps([f.model_dump() for f in draft.facts_used]),
        "status": draft.status,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    path = db_file()
    if path.exists():
        with sqlite3.connect(path) as con:
            cols = {r[1] for r in con.execute("PRAGMA table_info(outreach_drafts)")}
            if {"subject", "call_script", "facts_used"} <= cols:
                keep = {k: v for k, v in row.items() if k in cols}
                cur = con.execute(f"INSERT INTO outreach_drafts ({', '.join(keep)}) VALUES ({', '.join('?' * len(keep))})",
                                  list(keep.values()))
                return f"{path.name}:outreach_drafts#{cur.lastrowid}"

    existing = json.loads(JSON_FALLBACK.read_text(encoding="utf-8")) if JSON_FALLBACK.exists() else []
    existing.append(row | {"facts_used": json.loads(row["facts_used"])})
    JSON_FALLBACK.parent.mkdir(exist_ok=True)
    JSON_FALLBACK.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    return str(JSON_FALLBACK.relative_to(REPO_ROOT))


def load_donor(donor_id: int) -> tuple[dict, list[dict], dict, list[dict]]:
    """donor (with tier/is_star), gifts, why, research_facts from donors.db."""
    with sqlite3.connect(db_file()) as con:
        con.row_factory = sqlite3.Row
        d = con.execute("""SELECT d.*, s.tier, s.is_star, s.why FROM donors d
                           LEFT JOIN donor_scores s ON s.donor_id = d.id WHERE d.id = ?""", (donor_id,)).fetchone()
        if d is None:
            raise KeyError(f"no donor {donor_id} in {db_file()}")
        gifts = [dict(r) for r in con.execute(
            "SELECT amount, gift_date, channel FROM gifts WHERE donor_id = ? ORDER BY gift_date", (donor_id,))]
        research = [dict(r) for r in con.execute(
            "SELECT fact, source_url FROM research_facts WHERE donor_id = ?", (donor_id,))]
    donor = dict(d)
    why = json.loads(donor.pop("why") or "{}")
    return donor, gifts, why, research


def draft_for_donor(donor_id: int) -> tuple[Draft, str]:
    """What POST /outreach/{donor_id} runs: load from donors.db, draft, save."""
    import sys
    sys.path.insert(0, str(SERVICE_DIR))
    from org_context import load_org_facts

    donor, gifts, why, research = load_donor(donor_id)
    draft = draft_outreach(donor, gifts, why, research, load_org_facts())
    return draft, save_draft(donor_id, draft)


# ----------------------------------------------------------------------------------------------
# Demo: hand-built donors (fictional names; histories labelled sample)
# ----------------------------------------------------------------------------------------------

DEMO_CASES = [
    {
        "donor": {"id": 9001, "full_name": "Elena Marquez", "first_name": "Elena", "donor_type": "individual",
                  "fund_type": None, "tier": "small", "is_star": False},
        "gifts": [{"amount": 150, "gift_date": "2023-11-16", "channel": "Give Miami Day"},
                  {"amount": 200, "gift_date": "2024-11-21", "channel": "Give Miami Day"},
                  {"amount": 250, "gift_date": "2025-11-20", "channel": "Give Miami Day"}],
        "score_why": "Gave on Give Miami Day three years running (2023-2025), each gift larger than the last; nothing yet in 2026.",
        "research_facts": [],
    },
    {
        "donor": {"id": 9101, "full_name": "Amazon", "org_name": "Amazon", "donor_type": "organization",
                  "fund_type": "Designated", "tier": "big", "is_star": True},
        "gifts": [{"amount": 50000, "gift_date": "2025-09-15", "channel": "online"}],
        "score_why": "Corporate sponsor; last gift September 2025; no 2026 gift on file (sample history).",
        "research_facts": [{"fact": "Amazon's community giving in Miami-Dade has focused on South Dade nonprofits.",
                            "source_url": "https://miamifoundation.org/news/amazon-commits-1-million-to-13-south-dade-nonprofits/"}],
    },
    {
        "donor": {"id": 9102, "full_name": "John S. and James L. Knight Foundation", "org_name": "Knight Foundation",
                  "donor_type": "organization", "fund_type": "Field of Interest", "tier": "big", "is_star": True},
        "gifts": [{"amount": 50000, "gift_date": "2025-10-01", "channel": "check"}],
        "score_why": "Long-time partner; annual gift each fall; none yet in 2026 (sample history).",
        "research_facts": [{"fact": "Knight Foundation funds local journalism and informed, engaged communities.",
                            "source_url": "https://knightfoundation.org/"}],
    },
    {
        "donor": {"id": 9103, "full_name": "Frederick A. DeLuca Foundation", "org_name": "Frederick A. DeLuca Foundation",
                  "donor_type": "organization", "fund_type": "Field of Interest", "tier": "big", "is_star": True},
        "gifts": [{"amount": 100000, "gift_date": "2025-06-30", "channel": "check"}],
        "score_why": "Arts funder; gift each June; 2026 gift not yet received (sample history).",
        "research_facts": [{"fact": "The DeLuca Foundation supports Arts Access Miami, bringing arts programs to Miami-Dade students.",
                            "source_url": "https://miamifoundation.org/"}],
    },
]


def print_draft(name: str, d: Draft, where: str) -> None:
    print(f"\n=== {name}  status={d.status}  saved to {where}")
    print(f"Subject: {d.subject}\n\n{d.body}\n\n--- Call script ---\n{d.call_script}\n\n--- facts_used ---")
    for f in d.facts_used:
        print(f"- {f.fact}\n  {f.url}")


if __name__ == "__main__":
    import argparse
    import sys
    sys.path.insert(0, str(SERVICE_DIR))
    from org_context import load_org_facts

    ap = argparse.ArgumentParser()
    ap.add_argument("donor_ids", type=int, nargs="*", help="donor ids in donors.db; none = hand-built demo donors")
    args = ap.parse_args()

    if args.donor_ids:
        for donor_id in args.donor_ids:
            d, where = draft_for_donor(donor_id)
            print_draft(load_donor(donor_id)[0]["full_name"], d, where)
    else:
        org_facts = load_org_facts()
        for case in DEMO_CASES:
            d = draft_outreach(case["donor"], case["gifts"], case["score_why"], case["research_facts"], org_facts)
            print_draft(case["donor"]["full_name"], d, save_draft(case["donor"]["id"], d))
