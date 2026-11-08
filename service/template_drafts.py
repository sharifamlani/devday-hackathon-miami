"""Deterministic outreach drafts with no model call, for rebuilding the demo snapshot without AI.

The pipeline uses these instead of outreach_agent when CAMPAIGN_DRAFTER=template (service/pipeline.py
template_drafter). Same signatures and return type as outreach_agent.draft_outreach / draft_prospect, so
save_draft stores them the same way. The words come only from the donor's record and the org's own facts:
a donor draft is campaign_agent's re-engage email template plus a short call script; a prospect draft is a
first touch that passes outreach_agent.check_prospect_draft (no relationship claimed, no money ask).
"""

from __future__ import annotations

from datetime import date

from service import campaign_agent as ca
from service import outreach_agent as oa
from service import persona


def _mid_sentence(text: str) -> str:
    """'The X Fund gives...' reads 'the X Fund gives...' after 'We noticed that'."""
    return "t" + text[1:] if text.startswith("The ") else text


def _facts_used(used: list[dict]) -> list[oa.FactUsed]:
    return [oa.FactUsed(fact=f["fact"], url=f["url"], date=f.get("date")) for f in used if f]


def call_script(donor: dict, gifts: list[dict], facts: dict, big: bool) -> str:
    """What a staff member says: opener, the thank-you, one fact, the ask, and a line for 'not this year'."""
    staff = (persona.current().get("staff") or {}).get("name")
    who = f"{staff} from {ca.ORG}" if staff else ca.ORG
    lead = facts.get("O1")
    ask = ("Could we set up a short call or coffee about your year-end giving?" if big else
           f"Give Miami Day is {oa.long_date(oa.GIVE_MIAMI_DAY)}, and early giving opens "
           f"{oa.long_date(oa.EARLY_GIVING_OPENS)}. Would you like to be part of it again?")
    lines = [f"Hi {ca.first_name(donor)}, this is {who}.",
             f"I'm calling to thank you for {ca.thanks_for(donor, gifts, facts)}.",
             f"One thing your support helped with: {lead['fact']}" if lead else "",
             ask,
             "If this year isn't the right time, that's completely fine. Thank you for everything you've done."]
    return "\n".join(line for line in lines if line)


def draft_outreach(donor: dict, gifts: list[dict], score_why, research_facts: list[dict],
                   org_facts: list[dict], today: date | None = None) -> oa.Draft:
    """A re-engage email (campaign_agent's template) and a call script; status follows outreach_agent.is_big."""
    today = today or oa.as_of_date(score_why)
    facts = ca.numbered_facts(donor, gifts, research_facts, org_facts)
    email = ca.template_draft(donor, gifts, score_why if isinstance(score_why, dict) else None, facts,
                              "re_engage", "email", today)
    big = oa.is_big(donor)
    return oa.Draft(subject=email.subject or "", body=email.body,
                    call_script=call_script(donor, gifts, facts, big),
                    facts_used=_facts_used(email.facts_used), status="draft" if big else "ready")


def draft_prospect(prospect: dict, profile: dict, org_facts: list[dict], today: date | None = None) -> oa.Draft:
    """A first touch: who we are, the org fact that fits them best (O1), why them (their first fact), and a
    request for a short conversation. Always status 'draft'."""
    research = [{"fact": f["fact"], "source_url": f.get("url") or f.get("source_url", "")}
                for f in (prospect.get("facts") or [])]
    ranked = oa.rank_org_facts(oa.prospect_as_donor(prospect), research, org_facts, prospect.get("priority"))
    lead = ranked[0] if ranked else None
    why = research[0] if research else None
    name = prospect.get("name") or "there"
    mission = persona.current().get("mission")
    body = "\n\n".join(p for p in (
        f"Dear {name} team,",
        f"I'm reaching out from {ca.ORG}." + (f" {mission}" if mission else ""),
        f"Recently: {lead['fact']}" if lead else "",
        f"We noticed that {_mid_sentence(why['fact'].removeprefix('SAMPLE: '))}" if why else "",
        persona.localize("Would you be open to a short call or coffee to talk about Miami's priorities?"),
        f"Warmly,\n{ca.SIGN_OFF}") if p)
    script = "\n".join(p for p in (
        f"Hi, this is {ca.ORG}. We haven't worked together before, so I'll be brief.",
        f"Recently: {lead['fact']}" if lead else "",
        persona.localize("Could we set up a short call or coffee to talk about Miami's priorities?")) if p)
    used = [{"fact": lead["fact"], "url": lead["url"], "date": lead.get("date")}] if lead else []
    used += [{"fact": why["fact"], "url": why["source_url"]}] if why else []
    return oa.Draft(subject=f"Introducing {ca.ORG}", body=body, call_script=script,
                    facts_used=_facts_used(used), status="draft")
