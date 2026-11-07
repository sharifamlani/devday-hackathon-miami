"""Outreach guardrails that need no model call: the sample-history rule and the figure check."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from outreach_agent import ModelDraft, build_prompt, check_draft, hides_gifts  # noqa: E402

FACTS = {"O1": {"fact": "The Miami Foundation awarded scholarships totaling $3.45 million to 969 students this year.",
                "url": "https://miamifoundation.org/news/foundation-newsletter-august-2026/"}}
GIFTS = [{"amount": 250000, "gift_date": "2025-06-30", "channel": "check"},
         {"amount": 300000, "gift_date": "2026-06-29", "channel": "check"}]

REAL_ORG = {"id": 11, "full_name": "Frederick A. DeLuca Foundation", "donor_type": "organization",
            "source_row": "SAMPLE", "tier": "big", "is_star": 1}
FICTIONAL_PERSON = {"id": 1, "full_name": "Maria Delgado", "donor_type": "individual",
                    "source_row": "SAMPLE", "tier": "mid", "is_star": 0}


def draft(body: str, subject: str = "A Miami update") -> ModelDraft:
    return ModelDraft(subject=subject, body=body, call_script="Thank you for your partnership.", fact_ids=["O1"])


def test_only_sample_organizations_hide_gifts():
    assert hides_gifts(REAL_ORG)
    assert hides_gifts(REAL_ORG | {"source_row": None, "is_sample": True})
    assert hides_gifts(REAL_ORG | {"source_row": "row 12\nSAMPLE"})          # merged donor
    assert not hides_gifts(FICTIONAL_PERSON)                                   # fictional people keep figures
    assert not hides_gifts(REAL_ORG | {"source_row": "ingest:row 4"})          # real history from ingest


def test_sample_org_draft_rejects_gift_amount_date_year_and_count():
    for body in ["Thank you for your $300,000 gift.",
                 "Thank you for your gift on June 29, 2026.",
                 "Thank you for your support in 2025.",
                 "Thank you for two years of support."]:
        problems = check_draft(draft(body + " We awarded scholarships totaling $3.45 million to 969 students this year."),
                               FACTS, GIFTS, lead_id="O1", hide_gifts=True)
        assert any("SAMPLE gift history" in p for p in problems), body


def test_sample_org_draft_passes_with_partnership_thanks_and_calendar():
    body = ("Thank you for your partnership. We awarded scholarships totaling $3.45 million to 969 students this year. "
            "Early giving opens Saturday, November 14, 2026, and Give Miami Day is Thursday, November 19, 2026.")
    assert check_draft(draft(body), FACTS, GIFTS, lead_id="O1", hide_gifts=True) == []


def test_fictional_individual_keeps_gift_figures():
    body = "Thank you for your $300,000 gift in 2026. We awarded scholarships totaling $3.45 million to 969 students this year."
    assert check_draft(draft(body), FACTS, GIFTS, lead_id="O1", hide_gifts=False) == []


def test_sample_org_prompt_carries_no_gift_figures():
    from datetime import date
    prompt = build_prompt(REAL_ORG, GIFTS, {"status": "on_track", "pattern": {"years": [2025, 2026]}},
                          FACTS, True, date(2026, 11, 8), hide_gifts=True)
    assert "300,000" not in prompt and "2026-06-29" not in prompt and "2025" not in prompt


def test_organizations_always_need_a_human():
    from outreach_agent import is_big
    mcdermott = {"donor_type": "organization", "tier": "mid", "is_star": 0}
    assert is_big(mcdermott)                                                   # status 'draft', conversation ask
    assert is_big(FICTIONAL_PERSON | {"is_star": 1})
    assert not is_big(FICTIONAL_PERSON)                                        # individuals: 'ready'


# ---- prospects ------------------------------------------------------------------------------------

def intro(body: str) -> ModelDraft:
    return ModelDraft(subject="Hello from The Miami Foundation", body=body,
                      call_script="Hi, I'm calling from The Miami Foundation.", fact_ids=["O1"])


def test_prospect_draft_rejects_relationship_claims_and_money_asks():
    from outreach_agent import check_prospect_draft
    ok = "We awarded scholarships totaling $3.45 million to 969 students this year. Could we find 20 minutes for a call?"
    assert check_prospect_draft(intro(ok), FACTS) == []
    for bad in ["Thank you for your continued support.", "We hope you'll renew your commitment.",
                "Would you make a gift this year?", "Please donate at givemiamiday.org.",
                "Could you consider a $5,000 contribution?"]:
        assert check_prospect_draft(intro(ok + " " + bad), FACTS), bad


def test_prospect_ranking_prefers_its_priority():
    from outreach_agent import prospect_as_donor, rank_org_facts
    org_facts = [{"fact": "Vote Miami hosted candidate forums.", "priority": "Civic", "url": "u1"},
                 {"fact": "The Disaster Resilience Fund supports preparedness.", "priority": "Climate & Resilience", "url": "u2"},
                 {"fact": "Miami Open for Business helped small businesses own assets.", "priority": "Prosperity", "url": "u3"}]
    p = {"id": 1, "name": "Sample Insurer", "org_type": "company", "priority": "Climate & Resilience", "matched_traits": []}
    assert rank_org_facts(prospect_as_donor(p), [], org_facts, p["priority"])[0]["url"] == "u2"
    p = p | {"priority": "Prosperity"}
    assert rank_org_facts(prospect_as_donor(p), [], org_facts, p["priority"])[0]["url"] == "u3"
