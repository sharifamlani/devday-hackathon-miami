"""Outreach agent: value-first drafts in the demo org's voice (written for The Miami Foundation; the
active persona's wording is swapped in by persona.localize, see service/persona.py).

Every draft leads with what the Foundation did recently ("here's what we did"), then the ask.
Facts come only from org_facts (miamifoundation.org, via org_context) and the donor's
research_facts. The model cites facts by id; facts_used is rebuilt from those ids, so every
cited fact carries its exact text and URL. A numeric check rejects any figure in the draft
that isn't in the facts or the donor's own gift history, and the agent retries once.

Channels: email draft plus a call script for a human. Never robocalls (plan.md §11).
Big donors (is_star or tier == "big") and every organization get status "draft": a person must
approve and send. Individuals get "ready": the automated path may send it. (db.py's trigger also blocks
'sent' on a star donor without a human approver.)

Drafts go to the outreach_drafts table in data/donors.db (DONORS_DB overrides), with subject,
call_script and facts_used (JSON list of {fact, url}). If the table is missing or older than
that schema, the full draft goes to data/outreach_drafts.json instead.

    python -m service.outreach_agent 1 11             # donors 1 and 11 (what POST /outreach/{id} runs)
    python -m service.outreach_agent --prospect 3     # prospect 3's first touch (POST /prospects/{id}/outreach)

Prospects (organizations that have never given) get a first-touch draft: it leads with the
Foundation fact that best fits the prospect's priority and matched traits, uses only the
prospect's sourced facts, makes no money ask and claims no relationship, and always has status
'draft'. draft_prospect() is pure (the pipeline saves); draft_for_prospect() loads and saves.
"""

import json
import os
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

try:                                                  # imported as service.outreach_agent or as outreach_agent
    from service import persona
except ImportError:
    import persona

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
    date: str | None = None           # the source's posted/updated date, when known


class Draft(BaseModel):
    subject: str
    body: str
    call_script: str
    facts_used: list[FactUsed]
    status: str                       # "draft" (human must approve) | "ready" (may auto-send)


class ModelDraft(BaseModel):
    subject: str = Field(description="Email subject line, under 70 characters")
    body: str = Field(description=persona.localize("Email body, 120-200 words, signed by the Foundation's philanthropy team"))
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
INSTRUCTIONS = persona.localize(INSTRUCTIONS)


# ----------------------------------------------------------------------------------------------
# Draft
# ----------------------------------------------------------------------------------------------

def draft_outreach(donor: dict, gifts: list[dict], score_why, research_facts: list[dict],
                   org_facts: list[dict], today: date | None = None) -> Draft:
    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning

    load_dotenv(REPO_ROOT / ".env")
    today = today or as_of_date(score_why)

    channels = " ".join(sorted({g.get("channel") or "" for g in gifts}))   # a Give Miami Day giver fits Give Miami Day facts
    ranked = rank_org_facts(donor | {"notes": f"{donor.get('notes') or ''} {channels}"}, research_facts, org_facts)
    facts = {f"O{i}": {"fact": f["fact"], "url": f["url"], "date": f.get("date")}
             for i, f in enumerate(ranked[:MAX_ORG_FACTS], 1)}
    facts |= {f"R{i}": {"fact": f["fact"], "url": f.get("source_url") or f.get("url", "")}
              for i, f in enumerate(research_facts, 1)}

    big = is_big(donor)
    hide = hides_gifts(donor)
    prompt = build_prompt(donor, gifts, score_why, facts, big, today, hide)

    agent = Agent(
        name="OutreachAgent",
        instructions=INSTRUCTIONS,
        model=bounded_model(),
        output_type=ModelDraft,
        model_settings=ModelSettings(reasoning=Reasoning(effort="medium")),
    )

    for attempt in range(2):
        out: ModelDraft = Runner.run_sync(agent, prompt).final_output
        problems = check_draft(out, facts, gifts, lead_id="O1", hide_gifts=hide)
        if not problems:
            break
        prompt += "\n\nYour previous draft was rejected:\n- " + "\n- ".join(problems) + "\nRewrite it."
    else:
        raise ValueError(f"draft failed checks twice: {problems}")

    return Draft(
        subject=out.subject,
        body=out.body,
        call_script=out.call_script,
        facts_used=[FactUsed(fact=facts[i]["fact"], url=facts[i]["url"], date=facts[i].get("date")) for i in dict.fromkeys(out.fact_ids)],
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
    "give miami day": ("give miami day",),
    "business":   ("small business", "small-business", "lending", "bank", "workforce", "jobs", "living wage", "wells fargo"),
}


# words every donor record or fact shares; matching on them is noise
GENERIC_WORDS = {"miami", "foundation", "family", "their", "which", "donor", "donors", "sample", "advised",
                 "giver", "givers", "giving", "gifts", "lapsing", "organization", "individual"}


def donor_text(donor: dict, research_facts: list[dict]) -> str:
    parts = [donor.get(k) or "" for k in ("full_name", "org_name", "fund_type", "notes")]
    return " ".join(parts + [f["fact"] for f in research_facts]).lower()


def topics_in(text: str) -> set[str]:
    return {t for t, words in TOPICS.items() if any(w in text for w in words)}


def rank_org_facts(donor: dict, research_facts: list[dict], org_facts: list[dict],
                   priority: str | None = None) -> list[dict]:
    """Best fit first: same Foundation priority counts 3, shared topics 2, shared distinctive
    words 1. Facts are first rotated by id, so equally good facts lead in a different order for
    different donors or prospects."""
    if not org_facts:
        return []
    text = donor_text(donor, research_facts)
    words = {w for w in re.findall(r"[a-z][a-z'-]{4,}", text)} - GENERIC_WORDS
    want = topics_in(text)

    shift = int(donor.get("id") or 0) % len(org_facts)
    rotated = org_facts[shift:] + org_facts[:shift]

    def fit(f):
        ft = f["fact"].lower()
        same_priority = 3 if priority and f.get("priority") == priority else 0
        return same_priority + 2 * len(want & topics_in(ft)) + sum(w in ft for w in words)
    # best fit first, then the newest; equal fit and date keep the rotated order (sort is stable)
    return sorted(rotated, key=lambda f: (fit(f), f.get("date") or ""), reverse=True)


def as_of_date(why) -> date:
    """The demo's 'today', matching the score: SCORE_AS_OF, else the score's own as_of, else DEMO_AS_OF."""
    raw = os.environ.get("SCORE_AS_OF") or (why.get("as_of") if isinstance(why, dict) else None)
    return date.fromisoformat(raw) if raw else DEMO_AS_OF


def describe_why(why, hide_gifts: bool = False) -> str:
    """score.py's why JSON -> plain lines for the prompt. Figures the draft may not quote
    (days, ratios, points) stay out; the numeric check would reject them anyway."""
    if not isinstance(why, dict):
        return "" if hide_gifts else str(why or "")
    lines = []
    if why.get("status"):
        lines.append(f"Status: {why['status']}")
    if hide_gifts:
        return "\n".join(lines)
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
        return persona.localize("a personal conversation: a call or coffee with the philanthropy team about their "
                                "year-end giving. No link to give online.")
    when = (f"when early giving opens {long_date(EARLY_GIVING_OPENS)}" if today < EARLY_GIVING_OPENS
            else f"by Give Miami Day, {long_date(GIVE_MIAMI_DAY)}")
    return f"a Give Miami Day gift at givemiamiday.org {when}."


OPENAI_TIMEOUT_S, OPENAI_RETRIES = 90, 2


def bounded_model():
    """The default model on its own client with a 90 s timeout and 2 retries, so one stalled call
    can't hang POST /outreach/{id} for the SDK's 600 s default (seen once in the pipeline)."""
    from agents import OpenAIResponsesModel
    from openai import AsyncOpenAI
    client = AsyncOpenAI(timeout=OPENAI_TIMEOUT_S, max_retries=OPENAI_RETRIES)
    return OpenAIResponsesModel(model=os.getenv("OPENAI_MODEL_DEFAULT"), openai_client=client)


def is_big(donor: dict) -> bool:
    """Needs a human: star, big tier, or any organization (corporate and foundation
    relationships are personal). Drives status 'draft' and the conversation ask."""
    return bool(donor.get("is_star")) or donor.get("tier") == "big" or donor.get("donor_type") == "organization"


def hides_gifts(donor: dict) -> bool:
    """A real organization with an invented (SAMPLE) gift history: never quote its gifts
    (plan.md §3). Fictional individuals keep their sample figures."""
    # same test as data's is_sample; a merged donor joins its source rows with newlines
    sample = bool(donor.get("is_sample")) or "SAMPLE" in str(donor.get("source_row") or "").splitlines()
    return donor.get("donor_type") == "organization" and sample


SAMPLE_HISTORY_NOTE = ("on file, but it is SAMPLE data invented for a real organization. Do not mention any "
                       "gift amount, date, year or number of gifts. Thank them for their partnership and support.")


def build_prompt(donor, gifts, score_why, facts, big, today, hide_gifts: bool = False) -> str:
    history = "\n".join(f"- {g['gift_date']}: ${g['amount']:,.0f} via {g.get('channel') or 'unknown'}"
                        for g in sorted(gifts, key=lambda g: g["gift_date"]))
    if hide_gifts:
        history = f"- {SAMPLE_HISTORY_NOTE}"
    fact_lines = "\n".join(f"{k}: {v['fact']}" + (f" ({v['date']})" if v.get("date") else "")
                           for k, v in facts.items())
    why = describe_why(score_why, hide_gifts)
    days_early = (EARLY_GIVING_OPENS - today).days
    days_gmd = (GIVE_MIAMI_DAY - today).days

    return persona.localize(f"""Today is {long_date(today)}. Early giving for Give Miami Day opens {long_date(EARLY_GIVING_OPENS)} \
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
""") + fact_lines


def long_date(d: date) -> str:
    return f"{d:%A, %B} {d.day}, {d.year}"      # no %-d: it isn't portable to Windows


# ----------------------------------------------------------------------------------------------
# Checks: every figure in the draft must come from a fact or the donor's gifts
# ----------------------------------------------------------------------------------------------

NUM_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|M|K|%)?", re.I)


# Sources disagree on the Press Forward total ("nearly $1M" vs $760K, plan.md §11): never quote one
BANNED_FIGURES = re.compile(r"760,000|\$760K|nearly \$1|\$1 ?(?:million|M)\b[^.]*press forward|press forward[^.]*\$1 ?(?:million|M)\b", re.I)


NUMBER_WORDS = r"(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|many)"
GIFT_COUNT_RE = re.compile(rf"\b{NUMBER_WORDS}\s+(?:consecutive\s+|straight\s+)?(?:gifts?|years?|donations?)\b", re.I)
MONTHS = ("January February March April May June July August September October November December").split()


def gift_mentions(text: str, gifts: list[dict]) -> list[str]:
    """Gift amounts, dates, years and counts from a donor's history that appear in the text.
    The Give Miami Day calendar dates in the prompt are not gift dates, so they're removed first."""
    for d in (EARLY_GIVING_OPENS, GIVE_MIAMI_DAY):
        text = text.replace(long_date(d), " ").replace(f"{d:%B} {d.day}", " ")
    found = []
    nums = {norm_num(m) for m in NUM_RE.findall(text)}
    for g in gifts:
        amount = f"{g['amount']:,.0f}"
        if norm_num(amount) in nums:
            found.append(f"${amount}")
        y, m, d = g["gift_date"][:10].split("-")
        if g["gift_date"][:10] in text or f"{MONTHS[int(m) - 1]} {int(d)}" in text:
            found.append(g["gift_date"][:10])
        if re.search(rf"\b{y}\b", text):
            found.append(y)
    found += [m.group(0) for m in GIFT_COUNT_RE.finditer(text)]
    return sorted(set(found))


def check_draft(out: ModelDraft, facts: dict, gifts: list[dict], lead_id: str | None = None,
                hide_gifts: bool = False) -> list[str]:
    problems = []
    if hide_gifts:
        allowed_text = " ".join(f["fact"] for f in facts.values())
        for hit in gift_mentions(out.subject + " " + out.body + " " + out.call_script, gifts):
            if hit not in allowed_text:
                problems.append(f"'{hit}' comes from a SAMPLE gift history; thank them for their partnership instead")
        gifts = []      # and no gift figure counts as allowed below
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

def save_draft(donor_id: int | None, draft: Draft, prospect_id: int | None = None) -> str:
    """A draft belongs to exactly one donor or one prospect (db.py's CHECK)."""
    row = {
        "donor_id": donor_id,
        "prospect_id": prospect_id,
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
            needed = {"subject", "call_script", "facts_used"} | ({"prospect_id"} if prospect_id else set())
            if needed <= cols:
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
# Prospects: a first touch to an organization that has never given
# ----------------------------------------------------------------------------------------------

PROSPECT_INSTRUCTIONS = """You write a first-touch introduction from The Miami Foundation's
philanthropy team to an organization that has NEVER given to the Foundation.

Voice: upbeat, civic, plain, proudly local. Warm and brief, never salesy.

Structure: introduce the Foundation in one line, then lead with O1 (the Foundation's own work that
fits this organization), then one sentence on why you're reaching out to them, drawn only from
their R-facts. End by asking for a short conversation (a call or coffee) about Miami's priorities.

Hard rules:
- This organization is not a donor. Never thank them for support, gifts or partnership, never
  say "continue", "renew" or "again", and never imply any existing relationship.
- No money ask: no dollar amount, no "donate", "give", "gift", "contribute" or "pledge" request,
  no link to give.
- Use ONLY the numbered facts. Never invent a number, name, program, date or outcome. Copy figures
  exactly. Lead with O1 and list it first in fact_ids; list every fact id you used.
- Write about the organization only from its R-facts; if an R-fact isn't needed, leave it out.
- The call script is for a human staff member, same rules."""
PROSPECT_INSTRUCTIONS = persona.localize(PROSPECT_INSTRUCTIONS)

RELATIONSHIP_RE = re.compile(
    r"thank(?:s| you) for (?:your )?(?:continued |ongoing |past |generous )?(?:support|gifts?|giving|partnership|generosity)"
    r"|\b(?:renew|continue your|again this year|once again)\b|valued (?:donor|partner|supporter)"
    r"|your (?:past|previous|recent) (?:gift|giving|support)", re.I)
MONEY_ASK_RE = re.compile(
    r"\b(?:donat\w*|pledg\w*|contribut(?:e|ion)s?|make a (?:gift|donation)|give (?:at|to|online|today)"
    r"|givemiamiday\.org)\b|\$\s?\d[\d,]*\s*(?:gift|donation|contribution)", re.I)


def check_prospect_draft(out: ModelDraft, facts: dict, lead_id: str = "O1") -> list[str]:
    problems = check_draft(out, facts, [], lead_id=lead_id)
    text = " ".join((out.subject, out.body, out.call_script))
    if m := RELATIONSHIP_RE.search(text):
        problems.append(f"'{m.group(0)}' implies a relationship this prospect doesn't have")
    if m := MONEY_ASK_RE.search(text):
        problems.append(f"'{m.group(0)}' is a money ask; ask only for a conversation")
    return sorted(set(problems))


def prospect_as_donor(prospect: dict) -> dict:
    """The fields rank_org_facts reads, built from a prospect."""
    return {"id": prospect.get("id"), "full_name": prospect.get("name"), "org_name": prospect.get("name"),
            "fund_type": None, "notes": " ".join([prospect.get("org_type") or "", prospect.get("priority") or ""]
                                                 + list(prospect.get("matched_traits") or []))}


def draft_prospect(prospect: dict, profile: dict, org_facts: list[dict], today: date | None = None) -> Draft:
    """First-touch draft for an ICP prospect. Pure: the caller saves it. Status is always 'draft'."""
    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning

    load_dotenv(REPO_ROOT / ".env")
    today = today or as_of_date(None)
    research = [{"fact": f["fact"], "source_url": f.get("url") or f.get("source_url", "")}
                for f in (prospect.get("facts") or [])]
    ranked = rank_org_facts(prospect_as_donor(prospect), research, org_facts, prospect.get("priority"))
    facts = {f"O{i}": {"fact": f["fact"], "url": f["url"], "date": f.get("date")}
             for i, f in enumerate(ranked[:MAX_ORG_FACTS], 1)}
    facts |= {f"R{i}": {"fact": f["fact"], "url": f["source_url"]} for i, f in enumerate(research, 1)}

    fact_lines = "\n".join(f"{k}: {v['fact']}" + (f" ({v['date']})" if v.get("date") else "")
                           for k, v in facts.items())
    traits = ", ".join(prospect.get("matched_traits") or []) or "none listed"
    prompt = persona.localize(f"""Today is {long_date(today)}.

Organization: {prospect.get('name')} ({prospect.get('org_type') or 'organization'}, {prospect.get('city') or 'South Florida'})
Foundation priority it fits: {prospect.get('priority') or 'not set'}
Why it matches our current donors (internal, don't quote as fact): {traits}

Numbered facts you may use (O = the Foundation's own work from miamifoundation.org, R = sourced facts about this organization).
O1 was chosen to fit this organization: lead with O1, and list it first in fact_ids.
""") + fact_lines

    agent = Agent(
        name="ProspectOutreachAgent",
        instructions=PROSPECT_INSTRUCTIONS,
        model=bounded_model(),
        output_type=ModelDraft,
        model_settings=ModelSettings(reasoning=Reasoning(effort="medium")),
    )
    for attempt in range(2):
        out: ModelDraft = Runner.run_sync(agent, prompt).final_output
        problems = check_prospect_draft(out, facts)
        if not problems:
            break
        prompt += "\n\nYour previous draft was rejected:\n- " + "\n- ".join(problems) + "\nRewrite it."
    else:
        raise ValueError(f"prospect draft failed checks twice: {problems}")

    return Draft(
        subject=out.subject,
        body=out.body,
        call_script=out.call_script,
        facts_used=[FactUsed(fact=facts[i]["fact"], url=facts[i]["url"], date=facts[i].get("date")) for i in dict.fromkeys(out.fact_ids)],
        status="draft",
    )


def load_prospect(prospect_id: int) -> tuple[dict, dict]:
    """prospect (JSON columns decoded) and the latest icp_profile from donors.db."""
    with sqlite3.connect(db_file()) as con:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM prospects WHERE id = ?", (prospect_id,)).fetchone()
        if row is None:
            raise KeyError(f"no prospect {prospect_id} in {db_file()}")
        icp = con.execute("SELECT traits, stats, evidence FROM icp_profile ORDER BY id DESC LIMIT 1").fetchone()
    prospect = dict(row)
    for k in ("matched_traits", "facts"):
        prospect[k] = json.loads(prospect.get(k) or "[]")
    profile = {k: json.loads(icp[k]) for k in ("traits", "stats", "evidence")} if icp else {}
    return prospect, profile


def draft_for_prospect(prospect_id: int) -> tuple[Draft, str]:
    """What POST /prospects/{id}/outreach runs: load from donors.db, draft, save with prospect_id."""
    import sys
    sys.path.insert(0, str(SERVICE_DIR))
    from org_context import load_org_facts

    prospect, profile = load_prospect(prospect_id)
    draft = draft_prospect(prospect, profile, load_org_facts())
    return draft, save_draft(None, draft, prospect_id=prospect_id)


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
    ap.add_argument("ids", type=int, nargs="+", help="donor ids (or prospect ids with --prospect) in donors.db")
    ap.add_argument("--prospect", action="store_true", help="the ids are prospects: write first-touch drafts")
    args = ap.parse_args()

    for i in args.ids:
        if args.prospect:
            d, where = draft_for_prospect(i)
            print_draft(load_prospect(i)[0]["name"], d, where)
        else:
            d, where = draft_for_donor(i)
            print_draft(load_donor(i)[0]["full_name"], d, where)
