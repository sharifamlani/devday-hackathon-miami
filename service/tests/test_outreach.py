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
