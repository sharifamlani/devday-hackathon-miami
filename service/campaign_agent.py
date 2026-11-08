"""Campaign drafts (#38): one personal email or text per donor, for a bulk campaign.

Reuses outreach_agent (lane 86) instead of rewriting it: the same fact ranking (rank_org_facts),
the same human-approval rule (is_big: star, big tier or organization), the same sample-history rule
(hides_gifts) and the same figure check (check_draft, gift_mentions). A re-engage email IS the
outreach agent's draft (draft_outreach). Thank-you and check-in emails and every text go through
one small campaign agent with the same voice and fact rules.

Without an OpenAI key (or with CAMPAIGN_DRAFTER=template) every draft comes from a deterministic
template built only from the donor's record and the org facts, and is labelled drafted_by="template".

Output guardrail (plain code, check_message): a draft may not contain a dollar amount or a date
that isn't in the donor's record, the org facts, or the Give Miami Day calendar. Flagged drafts
can't be approved until a person edits them. Texts are capped at 320 characters, and a person
tagged beneficiary (plan.md §16 contact_type, once it exists) never gets a money ask.

Nothing here sends anything. Sending is routes_campaigns.py's simulated outbox.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import date

from pydantic import BaseModel, Field

from service import outreach_agent as oa

INTENTS = ("thank_you", "re_engage", "check_in")
CHANNELS = ("email", "text")
INTENT_LABELS = {"thank_you": "Thank you", "re_engage": "Re-engage", "check_in": "Check in"}
SMS_MAX = 320
SIGN_OFF = "The Miami Foundation philanthropy team"


# ----------------------------------------------------------------------------------------------
# Output shape
# ----------------------------------------------------------------------------------------------

@dataclass
class CampaignDraft:
    subject: str | None
    body: str
    facts_used: list[dict]                       # [{fact, url, date}]
    drafted_by: str                              # "model" | "template"
    note: str | None = None                      # why a template was used, and story kinds that were missing
    flags: list[str] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)   # story facts cited (§21.2.4): [{id, kind, title, fact, url, date, context_id}]


class CampaignModelDraft(BaseModel):
    subject: str = Field(description="Email subject under 70 characters; empty string for a text message")
    body: str = Field(description="The message body")
    fact_ids: list[str] = Field(description="Ids (O1, R2, ...) of every fact used in the body")


# ----------------------------------------------------------------------------------------------
# Approval rule and record helpers (outreach_agent's rules, not new ones)
# ----------------------------------------------------------------------------------------------

def needs_individual_approval(donor: dict) -> bool:
    """Star, big-tier and organization donors always need a person to approve them one by one."""
    return oa.is_big(donor)


def approval_reason(donor: dict) -> str | None:
    if donor.get("is_star"):
        return "Star donor"
    if donor.get("donor_type") == "organization":
        return "Organization"
    if donor.get("tier") == "big":
        return "Big donor"
    return None


def is_beneficiary(donor: dict) -> bool:
    """plan.md §16 contact classes; the column doesn't exist yet, so this is False until it does."""
    return (donor.get("contact_type") or "").lower() == "beneficiary"


def numbered_facts(donor: dict, gifts: list[dict], research: list[dict], org_facts: list[dict],
                   story: dict | None = None) -> dict:
    """O1..O4 (org facts, best fit first), S1.. (the story: success story, use of funds, org health from
    the context store) and R1.. (research), numbered as draft_outreach does."""
    channels = " ".join(sorted({g.get("channel") or "" for g in gifts}))
    ranked = oa.rank_org_facts(donor | {"notes": f"{donor.get('notes') or ''} {channels}"}, research, org_facts)
    facts = {f"O{i}": {"fact": f["fact"], "url": f["url"], "date": f.get("date")}
             for i, f in enumerate(ranked[:oa.MAX_ORG_FACTS], 1)}
    facts |= story or {}
    facts |= {f"R{i}": {"fact": f["fact"], "url": f.get("source_url") or f.get("url", ""), "date": None}
              for i, f in enumerate(research, 1)}
    return facts


def story_of(facts: dict) -> dict:
    """The first (newest) S-fact of each story kind present."""
    first = {}
    for k in sorted((k for k in facts if k.startswith("S")), key=lambda k: int(k[1:])):
        first.setdefault(facts[k]["kind"], facts[k])
    return first


def sources_of(used: list[dict]) -> list[dict]:
    return [{"kind": f.get("kind"), "title": f.get("title"), "fact": f["fact"], "url": f["url"], "date": f.get("date"),
             "context_id": f.get("context_id")} for f in used if f.get("kind") in oa.STORY_KINDS]


def allowed_facts(research: list[dict], org_facts: list[dict]) -> dict:
    """Every fact a draft (or a person's edit) may draw a figure or date from: all org facts and research."""
    facts = {f"A{i}": {"fact": f["fact"], "url": f.get("url", ""), "date": f.get("date")} for i, f in enumerate(org_facts, 1)}
    facts |= {f"R{i}": {"fact": f["fact"], "url": f.get("source_url") or f.get("url", ""), "date": None}
              for i, f in enumerate(research, 1)}
    return facts


def first_name(donor: dict) -> str:
    if donor.get("donor_type") == "organization":
        return donor.get("org_name") or donor.get("full_name") or "friend"
    return donor.get("first_name") or (donor.get("full_name") or "friend").split()[0]


# ----------------------------------------------------------------------------------------------
# Guardrail: no dollar amount or date that the record and the facts don't hold
# ----------------------------------------------------------------------------------------------

MONEY_RE = re.compile(r"\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s*(million|billion|thousand|[MBK])\b)?", re.I)
MONTH_NAMES = ("january february march april may june july august september october november december").split()
_MONTH_PAT = (r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?"
              r"|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)")
MONTH_DAY_RE = re.compile(rf"\b{_MONTH_PAT}\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b(?:,?\s+(\d{{4}})\b)?", re.I)
ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
SLASH_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b")
UNITS = {"thousand": 1e3, "k": 1e3, "million": 1e6, "m": 1e6, "billion": 1e9, "b": 1e9}


def money_values(text: str) -> list[tuple[str, float]]:
    out = []
    for m in MONEY_RE.finditer(text):
        try:
            value = float(m.group(1).replace(",", "").rstrip("."))
        except ValueError:
            continue
        out.append((m.group(0).strip(), value * UNITS.get((m.group(2) or "").lower(), 1)))
    return out


def month_number(name: str) -> int:
    return next(i for i, full in enumerate(MONTH_NAMES, 1) if full.startswith(name.lower().rstrip(".")[:3]))


def date_mentions(text: str) -> list[tuple[str, int, int, int | None]]:
    """(as written, month, day, year or None) for every calendar date in the text."""
    found = []
    for m in MONTH_DAY_RE.finditer(text):
        day = int(m.group(2))
        if 1 <= day <= 31:
            found.append((m.group(0).strip(), month_number(m.group(1)), day, int(m.group(3)) if m.group(3) else None))
    for m in ISO_RE.finditer(text):
        found.append((m.group(0), int(m.group(2)), int(m.group(3)), int(m.group(1))))
    for m in SLASH_RE.finditer(text):
        year = int(m.group(3))
        found.append((m.group(0), int(m.group(1)), int(m.group(2)), year + 2000 if year < 100 else year))
    return found


def calendar_dates(today: date) -> list[date]:
    """Dates a draft may always name: today and the Give Miami Day calendar the prompt states."""
    return [today, oa.EARLY_GIVING_OPENS, oa.GIVE_MIAMI_DAY]


def check_message(text: str, donor: dict, gifts: list[dict], facts: dict, channel: str,
                  today: date | None = None) -> list[str]:
    """Plain-code output guardrail. Returns human-readable flags; [] means the draft may be approved."""
    today = today or oa.as_of_date(None)
    hide = oa.hides_gifts(donor)
    fact_text = " ".join(f["fact"] for f in facts.values())
    flags = []

    allowed_money = [v for _, v in money_values(fact_text)]
    if not hide:
        allowed_money += [float(g["amount"]) for g in gifts]
    for written, value in money_values(text):
        if not any(abs(value - a) < 0.5 for a in allowed_money):
            flags.append(f"{written} is not in this donor's record or the org facts")

    allowed_dates: list[tuple[int, int, int | None]] = [(d.month, d.day, d.year) for d in calendar_dates(today)]
    allowed_dates += [(mo, d, y) for _, mo, d, y in date_mentions(fact_text)]
    for f in facts.values():
        if f.get("date"):
            y, mo, d = (int(p) for p in str(f["date"])[:10].split("-"))
            allowed_dates.append((mo, d, y))
    if not hide:
        for g in gifts:
            y, mo, d = (int(p) for p in str(g["gift_date"])[:10].split("-"))
            allowed_dates.append((mo, d, y))
    for written, mo, d, y in date_mentions(text):
        if not any(mo == am and d == ad and (y is None or ay is None or y == ay) for am, ad, ay in allowed_dates):
            flags.append(f"the date '{written}' is not in this donor's record or the org facts")

    if hide:      # a real organization with an invented (SAMPLE) gift history: never quote it
        for hit in oa.gift_mentions(text, gifts):
            if hit not in fact_text:
                flags.append(f"'{hit}' comes from a SAMPLE gift history; thank them for their partnership instead")

    flags += oa.declined_mentions(text, oa.declined_for(donor.get("id")), gifts)   # never thank a declined charge
    if oa.BANNED_FIGURES.search(text):
        flags.append("never state a Press Forward South Florida total")
    if channel == "text" and len(text) > SMS_MAX:
        flags.append(f"this text is {len(text)} characters; the limit is {SMS_MAX}")
    if is_beneficiary(donor) and (m := oa.MONEY_ASK_RE.search(text)):
        flags.append(f"'{m.group(0)}' is a money ask; people we help never get one")
    return sorted(set(flags))


# ----------------------------------------------------------------------------------------------
# Template: deterministic, record facts only (the no-key path and the snapshot's drafts)
# ----------------------------------------------------------------------------------------------

def money(amount: float) -> str:
    return f"${amount:,.0f}"


def thanks_for(donor: dict, gifts: list[dict], facts: dict) -> str:
    """The record fact the draft cites: the last gift for a person, the fund or research for an org."""
    if gifts and not oa.hides_gifts(donor):
        last = max(gifts, key=lambda g: g["gift_date"])
        return f"your {money(last['amount'])} gift on {oa.long_date(date.fromisoformat(last['gift_date'][:10])).split(', ', 1)[1]}"
    if donor.get("fund_type"):
        return f"your partnership through your {donor['fund_type']} fund"
    return "your partnership with The Miami Foundation" if donor.get("donor_type") == "organization" else "your support"


def shorten(text: str, limit: int) -> str:
    """Cut at a word boundary, never inside a figure."""
    if len(text) <= limit:
        return text
    cut = text[:max(limit - 1, 0)].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "…"


def template_draft(donor: dict, gifts: list[dict], why: dict | None, facts: dict, intent: str, channel: str,
                   today: date | None = None, note: str | None = None) -> CampaignDraft:
    today = today or oa.as_of_date(why)
    name = first_name(donor)
    big = needs_individual_approval(donor)
    beneficiary = is_beneficiary(donor)
    lead = facts.get("O1")
    used = [lead] if lead else []
    thanks = thanks_for(donor, gifts, facts)
    if intent == "re_engage" and beneficiary:
        intent = "check_in"                      # people we help never get an ask

    if channel == "text":
        greeting = f"Hi {name}, it's The Miami Foundation."
        opener = {"thank_you": f"Thank you for {thanks}.",
                  "re_engage": f"Thank you for {thanks}.",
                  "check_in": "Just checking in." if beneficiary else f"Thanks again for {thanks}."}[intent]
        closing = {"thank_you": "",
                   "re_engage": ("Could we call you this month?" if big
                                 else f"Give Miami Day is {oa.GIVE_MIAMI_DAY:%b} {oa.GIVE_MIAMI_DAY.day}: givemiamiday.org"),
                   "check_in": "Reply anytime."}[intent]
        tail = " ".join(p for p in (closing, "Reply STOP to opt out.") if p)
        head = f"{greeting} {opener}"
        room = SMS_MAX - len(head) - len(tail) - 2
        tale = story_of(facts).get("success_story")
        org = ([tale] if tale else []) + [facts[k] for k in sorted(facts) if k.startswith("O")]
        fits = next((f for f in org if len(f["fact"]) <= room), None)   # the success story if it fits whole
        pick = fits or lead
        news = (pick["fact"] if fits else shorten(pick["fact"], room)) if pick and room > 40 else ""
        used = [pick] if news else []
        body = " ".join(p for p in (head, news, tail) if p)
        return CampaignDraft(subject=None, body=shorten(body, SMS_MAX), facts_used=used, drafted_by="template", note=note)

    news = f"From The Miami Foundation's work: {lead['fact']}" if lead else ""
    tale = story_of(facts)
    told = [(label, tale[k]) for k, label in (("success_story", "A story we're proud of"),
                                               ("use_of_funds", "Where gifts go"),
                                               ("org_health", "How the Foundation is doing")) if k in tale]
    story = "\n".join(f"{label}: {f['fact']}" for label, f in told)
    used += [f for _, f in told if f is not lead]
    if intent == "thank_you":
        subject = f"Thank you, {name}"
        opener = f"Thank you for {thanks}. Gifts like yours are how Miami's community foundation shows up for this city."
        closing = "There's no ask in this note. We simply wanted you to know your support matters."
    elif intent == "re_engage":
        subject = f"{name}, here's what we did this year"
        opener = f"Thank you for {thanks}. We've missed hearing from you, and we wanted to share an update."
        closing = ("We'd love to catch up. Could we set up a short call or coffee with our philanthropy team "
                   "about your year-end giving?" if big else
                   f"Early giving for Give Miami Day opens {oa.long_date(oa.EARLY_GIVING_OPENS)}, and Give Miami Day "
                   f"is {oa.long_date(oa.GIVE_MIAMI_DAY)}. If you'd like to be part of it again, you can give at "
                   "givemiamiday.org.")
    else:
        subject = "Checking in from The Miami Foundation"
        opener = ("We wanted to check in and see how you're doing." if beneficiary else
                  f"We wanted to check in, and to thank you again for {thanks}.")
        closing = "If you have questions or ideas, simply reply to this email. We'd love to hear from you."
    body = "\n\n".join(p for p in (f"Dear {name},", opener, news, story, closing, f"With gratitude,\n{SIGN_OFF}") if p)
    return CampaignDraft(subject=subject, body=body, facts_used=used, drafted_by="template", note=note)


# ----------------------------------------------------------------------------------------------
# Model path (mocked in tests): reuse draft_outreach for a re-engage email, else the campaign agent
# ----------------------------------------------------------------------------------------------

def model_available() -> bool:
    if os.getenv("CAMPAIGN_DRAFTER", "").lower() == "template":
        return False
    return bool(os.getenv("OPENAI_API_KEY")) and bool(os.getenv("OPENAI_MODEL_DEFAULT"))


INTENT_BRIEFS = {
    "thank_you": "Thank the donor warmly for their specific past giving, then share one thing the Foundation "
                 "did recently, leading with O1. Make no ask of any kind.",
    "re_engage": "Thank the donor for their past giving, lead with what the Foundation did recently (O1), then "
                 "make exactly the ask on the 'Ask:' line. Never open with the ask.",
    "check_in": "A friendly check-in: share one recent Foundation update, leading with O1, and invite them to reply "
                "with questions. Make no money ask.",
}
CHANNEL_BRIEFS = {
    "email": "Write an email: subject under 70 characters, body 90-160 words, signed by The Miami Foundation's "
             "philanthropy team.",
    "text": f"Write a text message: at most {SMS_MAX - 20} characters, set subject to an empty string, plain words, "
            "start with 'Hi <first name>, it's The Miami Foundation.', end with 'Reply STOP to opt out.' No links "
            "except givemiamiday.org.",
}
CAMPAIGN_INSTRUCTIONS = """You write campaign messages for The Miami Foundation's philanthropy team.

Voice: upbeat, civic, plain, proudly local. Warm, never pushy, no guilt.

Hard rules:
- Use ONLY the numbered facts and the donor's own gift history. Never invent a number, name,
  program, date or outcome. Copy figures exactly as the fact states them. Never name an amount to give.
- Lead with O1 and list it first in fact_ids; list every fact id you used.
- Gifts are made only at miamifoundation.org or givemiamiday.org. Never mention WhatsApp,
  text-to-give, or automated calls."""


def model_write(donor: dict, gifts: list[dict], why: dict | None, research: list[dict], org_facts: list[dict],
                facts: dict, intent: str, channel: str, today: date) -> tuple[str | None, str, list[dict]]:
    """One model draft: (subject, body, facts_used). Raises if the model's draft fails the checks twice."""
    if intent == "re_engage" and channel == "email" and not is_beneficiary(donor):
        d = oa.draft_outreach(donor, gifts, why, research, org_facts, today)
        return d.subject, d.body, [f.model_dump() for f in d.facts_used]

    from agents import Agent, ModelSettings, Runner
    from openai.types.shared import Reasoning

    oa.load_dotenv(oa.REPO_ROOT / ".env")       # the model client needs the key, whoever called first
    big = needs_individual_approval(donor)
    hide = oa.hides_gifts(donor)
    ask = (oa.ask_for(big, today) if intent == "re_engage" and not is_beneficiary(donor) else "none: no ask of any kind.")
    prompt = (oa.build_prompt(donor, gifts, why, facts, big, today, hide).replace(f"Ask: {oa.ask_for(big, today)}", f"Ask: {ask}")
              + f"\n\nCampaign: {INTENT_LABELS[intent]}. {INTENT_BRIEFS[intent]}\n{CHANNEL_BRIEFS[channel]}")
    agent = Agent(name="CampaignAgent", instructions=CAMPAIGN_INSTRUCTIONS, model=oa.bounded_model(),
                  output_type=CampaignModelDraft, model_settings=ModelSettings(reasoning=Reasoning(effort="low")))
    problems: list[str] = []
    for _ in range(2):
        out: CampaignModelDraft = Runner.run_sync(agent, prompt).final_output
        problems = oa.check_draft(oa.ModelDraft(subject=out.subject, body=out.body, call_script="", fact_ids=out.fact_ids),
                                  oa.cited_facts(facts, out.fact_ids), gifts, lead_id="O1" if "O1" in facts else None,
                                  hide_gifts=hide)
        if channel == "email":                   # a 300-character text can't carry all three; it cites what it uses
            problems += oa.check_story(out.fact_ids, facts)
        problems += check_message(f"{out.subject} {out.body}", donor, gifts, facts, channel, today)
        if not problems:
            break
        prompt += "\n\nYour previous draft was rejected:\n- " + "\n- ".join(problems) + "\nRewrite it."
    else:
        raise ValueError(f"campaign draft failed checks twice: {problems}")
    used = [facts[i] for i in dict.fromkeys(out.fact_ids) if i in facts]
    return (out.subject or None) if channel == "email" else None, out.body, used


def draft_message(donor: dict, gifts: list[dict], why: dict | None, research: list[dict], org_facts: list[dict],
                  intent: str, channel: str, today: date | None = None, use_model: bool | None = None) -> CampaignDraft:
    """One campaign draft for one donor, always run through the guardrail. Never raises for a model failure:
    the template takes over, labelled with the reason."""
    if intent not in INTENTS or channel not in CHANNELS:
        raise ValueError(f"unknown intent/channel {intent}/{channel}")
    today = today or oa.as_of_date(why)
    story, story_notes = oa.story_facts()
    facts = numbered_facts(donor, gifts, research, org_facts, story)
    use_model = model_available() if use_model is None else use_model

    draft = None
    if use_model:
        try:
            subject, body, used = model_write(donor, gifts, why, research, org_facts, facts, intent, channel, today)
            draft = CampaignDraft(subject=subject, body=body, facts_used=used, drafted_by="model")
        except Exception as e:  # model error or a draft that failed its checks: never leave the row empty
            draft = template_draft(donor, gifts, why, facts, intent, channel, today,
                                   note=f"Template draft: the outreach agent failed ({type(e).__name__}).")
    if draft is None:
        draft = template_draft(donor, gifts, why, facts, intent, channel, today,
                               note="Template draft: no OpenAI key on this build, so no AI was used.")
    draft.flags = check_message(f"{draft.subject or ''} {draft.body}", donor, gifts,
                                allowed_facts(research, org_facts) | story, channel, today)
    draft.sources = sources_of(draft.facts_used)
    if story_notes:                              # staff are told when a story kind is missing; nothing is invented
        draft.note = " ".join(p for p in (draft.note, *story_notes) if p)
    return draft
