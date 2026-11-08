"""§21.2.4 campaigns always tell the story: a success story, use of funds and org health, each cited;
no uncited claims; a missing kind becomes a note to staff. No network: the story is stood in."""

from datetime import date

import pytest

from service import campaign_agent as ca, event_outreach as eo, outreach_agent as oa

STORY = {
    "S1": {"fact": "Over 300 nonprofit leaders trained at SET Summits to prepare for Give Miami Day.", "url": "https://miamifoundation.org/n/set/",
           "date": "2026-10-01", "kind": "success_story", "context_id": 11, "title": "SET Summits train 300 leaders"},
    "S2": {"fact": "The Miami Foundation awarded scholarships totaling $3.45 million to 969 students.", "url": "https://miamifoundation.org/n/aug/",
           "date": "2026-08-31", "kind": "use_of_funds", "context_id": 12, "title": "$3.45M in scholarships"},
    "S3": {"fact": "Since 1967, The Foundation has invested over $905M in Greater Miami.", "url": "https://miamifoundation.org/who-we-are/",
           "date": "2026-03-26", "kind": "org_health", "context_id": 13, "title": "Over $905M invested since 1967"},
}
DONOR = {"id": 1, "full_name": "Maria Delgado", "first_name": "Maria", "donor_type": "individual", "tier": "mid", "is_star": 0}
GIFTS = [{"amount": 250, "gift_date": "2025-11-20", "channel": "Give Miami Day"}]


@pytest.fixture
def full_story(monkeypatch):
    monkeypatch.setattr(oa, "story_facts", lambda per_kind=2, conn=None: (dict(STORY), []))


def test_every_story_kind_present_must_be_cited():
    facts = dict(STORY)
    assert oa.check_story(["S1", "S2", "S3"], facts) == []
    assert oa.check_story(["S1"], facts) == ["cite at least one [use of funds] S-fact",
                                            "cite at least one [organization health] S-fact"]
    only_two = {k: v for k, v in STORY.items() if k != "S3"}
    assert oa.check_story(["S1", "S2"], only_two) == []                 # no org-health item: nothing to cite


def test_a_figure_from_an_uncited_fact_is_rejected():
    facts = {"O1": {"fact": "Vote Miami hosted three forums.", "url": "u"}} | STORY
    out = oa.ModelDraft(subject="Hi", body="Vote Miami hosted three forums, and 969 students got scholarships.",
                        call_script="", fact_ids=["O1", "S1"])               # S2 (969 students) not cited
    assert any("969" in p for p in oa.check_draft(out, oa.cited_facts(facts, out.fact_ids), [], lead_id="O1"))
    cited = oa.ModelDraft(subject="Hi", body=out.body, call_script="", fact_ids=["O1", "S1", "S2"])
    assert not any("969" in p for p in oa.check_draft(cited, oa.cited_facts(facts, cited.fact_ids), [], lead_id="O1"))


@pytest.mark.parametrize("intent", ["thank_you", "re_engage", "check_in"])
def test_template_email_tells_the_whole_story_with_sources(full_story, intent):
    d = ca.draft_message(DONOR, GIFTS, None, [], [], intent, "email", today=date(2026, 11, 8), use_model=False)
    for f in STORY.values():
        assert f["fact"] in d.body
    assert {s["kind"] for s in d.sources} == set(oa.STORY_KINDS)
    assert all(s["url"].startswith("https://") and s["context_id"] for s in d.sources)
    assert d.flags == []                                                     # every figure traces to a cited fact


def test_missing_kind_is_a_note_to_staff_not_an_invention(monkeypatch):
    two = {k: v for k, v in STORY.items() if k != "S3"}
    monkeypatch.setattr(oa, "story_facts", lambda per_kind=2, conn=None: (two, ["No organization health item in the context store yet, so it was left out."]))
    d = ca.draft_message(DONOR, GIFTS, None, [], [], "thank_you", "email", today=date(2026, 11, 8), use_model=False)
    assert "How the Foundation is doing" not in d.body
    assert "organization health" in d.note and {s["kind"] for s in d.sources} == {"success_story", "use_of_funds"}


def test_text_leads_with_the_success_story_when_it_fits(full_story):
    d = ca.draft_message(DONOR, GIFTS, None, [], [], "thank_you", "text", today=date(2026, 11, 8), use_model=False)
    assert STORY["S1"]["fact"] in d.body and len(d.body) <= ca.SMS_MAX


def test_invite_gets_the_story_before_the_sign_off(full_story, monkeypatch):
    monkeypatch.setattr(oa, "story_facts", lambda per_kind=1, conn=None: (dict(STORY), []))
    body, used, notes = eo.with_story("Hi Ana,\n\nJoin us Sunday.\n\nThe Miami Foundation team")
    assert body.endswith("The Miami Foundation team")
    assert body.index("A story we're proud of") < body.index("The Miami Foundation team")
    assert {f["kind"] for f in used} == set(oa.STORY_KINDS) and notes == []


def test_a_declined_newest_charge_is_never_thanked_as_a_gift(tmp_path):
    """c9's scorecard: Hye-jin Park was thanked for '$40 each month June-October' though Oct 10 was declined."""
    from service import db, routes_campaigns as rc
    conn = db.connect(tmp_path / "d.db")
    db.create_schema(conn)
    hid = conn.execute("INSERT INTO donors (full_name, first_name, donor_type) VALUES ('Hye-jin Park', 'Hye-jin', 'individual')").lastrowid
    for d, status in (("2026-06-10", "ok"), ("2026-07-10", "ok"), ("2026-08-10", "ok"), ("2026-09-10", "ok"), ("2026-10-10", "declined")):
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, 40, ?, 'online', ?)", (hid, d, status))
    conn.commit()
    donor, gifts, why, research = rc.load_donor(conn, hid)
    assert [g["gift_date"] for g in gifts] == ["2026-06-10", "2026-07-10", "2026-08-10", "2026-09-10"]
    d = ca.draft_message(donor, gifts, why, research, [], "thank_you", "email", today=date(2026, 11, 8), use_model=False)
    assert "October" not in d.body and "Oct" not in d.body and "September 10" in d.body
    # a draft that names the declined charge is flagged by the guardrail
    flags = ca.check_message("Thank you for your $40 gift on October 10.", donor, gifts, {}, "email", date(2026, 11, 8))
    assert any("October 10" in f for f in flags)
