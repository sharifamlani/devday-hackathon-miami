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


# ---- context agent (no network) -------------------------------------------------------------------

def test_context_helpers_clean_urls_and_text():
    from org_context import match_priority, norm_url, PRIORITIES, site_host, strip_links
    assert norm_url("https://miamifoundation.org/es/news/x?utm_source=openai#a") == "https://miamifoundation.org/news/x/"
    assert site_host("https://www.MiamiFoundation.org/who-we-are/") == "miamifoundation.org"
    assert strip_links("All of us, together. ([miamifoundation.org](https://miamifoundation.org/?utm_source=openai))") == "All of us, together."
    assert match_priority("Generating Prosperity", list(PRIORITIES)) == "Prosperity"


def test_build_context_without_refresh_returns_the_cached_run():
    from org_context import FOUNDATION_URLS, build_context
    seen = []
    res = build_context(FOUNDATION_URLS, refresh=False, progress=lambda s, st: seen.append((s, st)))
    assert len(res["facts"]) >= 10 and {"website", "news"} <= {f["source"] for f in res["facts"]}
    assert all(f["url"] and f["posted_at"] for f in res["facts"])
    assert res["sources"]["website"] == "cached" and res["sources"]["linkedin"] == "skipped"
    assert res["source_notes"]["linkedin"] == "saved, not connected"
    assert ("website", "cached") in seen


def test_live_runs_never_rewrite_the_committed_cache(tmp_path, monkeypatch):
    import org_context
    committed, live = tmp_path / "context_cache.json", tmp_path / "data" / "context_live.json"
    committed.write_text('{"miamifoundation.org": {"facts": [{"fact": "old", "url": "u0"}], "sources": {}}}', encoding="utf-8")
    monkeypatch.setattr(org_context, "CONTEXT_CACHE", committed)
    monkeypatch.setattr(org_context, "CONTEXT_LIVE", live)
    before = committed.read_text(encoding="utf-8")

    run = {"facts": [{"fact": "new", "url": "u1"}], "sources": {"website": "ok"}}
    org_context.save_run("miamifoundation.org", run)                       # a live run
    assert committed.read_text(encoding="utf-8") == before                 # committed cache untouched
    assert org_context.cached_run("miamifoundation.org")["facts"][0]["fact"] == "new"   # runtime read first

    org_context.save_run("miamifoundation.org", run, write_cache=True)    # the pipeline's --write-cache
    assert '"new"' in committed.read_text(encoding="utf-8")


def test_unreachable_site_is_an_error_not_done(tmp_path, monkeypatch):
    import org_context
    monkeypatch.setattr(org_context, "CONTEXT_LIVE", tmp_path / "live.json")
    seen = []
    res = org_context.build_context({"website": "https://no-such-org-qa.invalid"}, refresh=True,
                                    progress=lambda s, st: seen.append((s, st)))
    assert res["facts"] == []
    assert res["sources"]["website"].startswith("error") and res["sources"]["news"].startswith("error")
    assert res["source_notes"]["website"].startswith("error")
    assert ("website", res["sources"]["website"]) in seen
    assert not (tmp_path / "live.json").exists()                          # a failed run is never cached


def test_zero_surviving_facts_is_an_error():
    from types import SimpleNamespace as F
    from org_context import validate_source
    found = [F(url="https://miamifoundation.org/x/", posted_at="", fact="undated", quote="q", priority="Civic")]
    kept, dropped, status = validate_source("website", found, {"https://miamifoundation.org/x/"},
                                            "miamifoundation.org", ["Civic"], "now")
    assert kept == [] and status == "error: no usable facts (1 dropped)"
    kept, dropped, status = validate_source("website", [], set(), "miamifoundation.org", ["Civic"], "now")
    assert status == "error: search found no pages on miamifoundation.org"


def test_cached_run_keeps_the_request_urls():
    from org_context import build_context
    res = build_context({"website": "https://miamifoundation.org/", "x_url": "https://x.com/example"}, refresh=False)
    p = res["profile"]
    assert p["x_url"] == "https://x.com/example" and p["instagram_url"] is None and p["linkedin_url"] is None
    assert res["source_notes"]["x"] == "saved, not connected"
    assert res["source_notes"]["instagram"] == "not provided"


def test_cached_strings_are_clean_utf8():
    import json
    from org_context import CONTEXT_CACHE, clean_text, clean_phrase
    raw = CONTEXT_CACHE.read_text(encoding="utf-8")
    assert "\u00e2\u20ac" not in raw and "\u00e2\x80" not in raw                 # no mojibake ("â€")
    for run in json.loads(raw).values():
        assert all(p == clean_phrase(p) for p in run["profile"]["voice"]["phrases"])   # no wrapping quotes
    good = "\u201cWe invest in leaders.\u201d"
    assert clean_text(good.encode("utf-8").decode("latin-1")) == good
