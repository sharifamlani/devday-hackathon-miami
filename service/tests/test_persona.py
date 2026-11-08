"""The demo persona switch (service/persona.py): the default tidepath pack is fictional end to end.

Hackathon rule: challenges use the fictional org Tidepath and synthetic personal details. So under
tidepath no real organization (the miami_foundation pack's real donors, its research and prospect
caches, The Miami Foundation itself) may reach the seed, the agents' prompts or the UI snapshot.
"""

import json
from datetime import date
from pathlib import Path

import pytest

from service import db, persona

REPO = Path(__file__).resolve().parents[2]
AS_OF = date(2026, 11, 8)


def real_org_names() -> set[str]:
    """Real organizations the original demo used: its org donors, research cache and prospect cache."""
    names = {"Miami Foundation", "miamifoundation", "Knight Foundation", "Amazon", "DeLuca", "McDermott",
             "Will & Schulte", "Shack Society", "Jorge M. Pérez"}
    names |= set(json.loads((REPO / "data" / "research_cache.json").read_text(encoding="utf-8")))
    names |= {p["name"] for p in json.loads((REPO / "data" / "icp_cache.json").read_text(encoding="utf-8"))["prospects"]}
    return names


def leaks(text: str) -> list[str]:
    low = text.lower()
    return sorted(n for n in real_org_names() if n.lower() in low)


@pytest.fixture
def tidepath(monkeypatch):
    monkeypatch.setenv("DONOR_DESK_PERSONA", "tidepath")
    assert persona.is_fictional()


def test_default_persona_is_fictional_tidepath(monkeypatch):
    monkeypatch.delenv("DONOR_DESK_PERSONA", raising=False)
    assert persona.persona_id() == "tidepath" and persona.org_name() == "Tidepath" and persona.is_fictional()
    assert persona.org_urls()["website"] == "https://tidepath.example.org"


def test_tidepath_seed_has_no_real_names_and_keeps_the_planted_cases(tidepath):
    seed = persona.seed_donors()
    assert leaks(json.dumps(seed, ensure_ascii=False)) == []
    assert len(seed) == 18 and all(d.get("source_row") in (None, "SAMPLE") for d in seed)
    for d in seed:                                          # synthetic contact details only
        assert d.get("email") is None or d["email"].split("@")[1].endswith(("example.com", "example.org"))
        assert d.get("phone") is None or "55501" in "".join(ch for ch in d["phone"] if ch.isdigit())
    orgs = [d["full_name"] for d in seed if d["donor_type"] == "organization"]
    assert orgs == ["Biscayne Harbor Family Foundation", "Palmetto Lantern Foundation", "Seagrape Logistics Co.",
                    "Marlowe Tide Foundation", "Quinterra & Vale Law Group"]


def test_flipping_back_restores_the_original_seed_unchanged(monkeypatch):
    monkeypatch.setenv("DONOR_DESK_PERSONA", "tidepath")
    tide = persona.seed_donors()
    monkeypatch.setenv("DONOR_DESK_PERSONA", "miami_foundation")
    assert not persona.is_fictional() and persona.org_name() == "The Miami Foundation"
    miami = persona.seed_donors()
    assert [d["full_name"] for d in miami][8:] == ["John S. and James L. Knight Foundation", "Amazon",
                                                    "Frederick A. DeLuca Foundation", "McDermott Will & Schulte"]
    strip = lambda d: {k: v for k, v in d.items() if k not in ("full_name", "org_name", "notes")}
    assert [strip(d) for d in tide] == [strip(d) for d in miami]          # same ids, tiers, histories
    assert persona.localize("The Miami Foundation's philanthropy team") == "The Miami Foundation's philanthropy team"


def test_prompts_and_templates_speak_as_tidepath(tidepath):
    from service import campaign_agent, enrich_agent, icp_agent, outreach_agent
    texts = [outreach_agent.INSTRUCTIONS, outreach_agent.PROSPECT_INSTRUCTIONS, campaign_agent.CAMPAIGN_INSTRUCTIONS,
             *campaign_agent.INTENT_BRIEFS.values(), *campaign_agent.CHANNEL_BRIEFS.values(),
             enrich_agent.INSTRUCTIONS, icp_agent.icp_agent.instructions, icp_agent.prospect_agent.instructions,
             outreach_agent.ask_for(True, AS_OF), campaign_agent.SIGN_OFF]
    for text in texts:
        assert leaks(text) == [] and "Foundation's" not in text, text
    assert "Tidepath" in outreach_agent.INSTRUCTIONS and "tidepath.example.org/give" in outreach_agent.INSTRUCTIONS


def test_sample_sources_are_accepted_never_fetched(tidepath, monkeypatch):
    from service import enrich_agent
    monkeypatch.setattr(enrich_agent.urllib.request, "urlopen", lambda *a, **k: pytest.fail("fetched"))
    assert enrich_agent.url_loads("sample://tidepath/fall-mentor-match")
    facts = enrich_agent.enrich_donor("Marlowe Tide Foundation", refresh=True, donor_type="organization")
    assert facts and all(f.source_url.startswith("sample://tidepath/") and f.fact.startswith("SAMPLE:") for f in facts)
    assert enrich_agent.enrich_donor("Some Ingested Org", refresh=True, donor_type="organization") == []


def test_context_for_the_sample_site_comes_from_the_pack(tidepath, monkeypatch):
    from service import org_context
    monkeypatch.setattr(org_context, "resolves", lambda host: pytest.fail("looked up a host"))
    out = org_context.build_context(persona.org_urls(), refresh=True)
    assert out["profile"]["name"] == "Tidepath" and len(out["facts"]) >= 8
    assert all(f["url"].startswith("sample://tidepath/") and f["verification"] == "sample" for f in out["facts"])
    assert [f["posted_at"] for f in out["facts"]] == sorted((f["posted_at"] for f in out["facts"]), reverse=True)
    facts = org_context.load_org_facts()
    assert facts and leaks(json.dumps(facts, ensure_ascii=False)) == []


def test_template_drafts_pass_the_outreach_checks(tidepath, db_file):
    from service import outreach_agent as oa, template_drafts
    from service.org_context import load_org_facts
    from service.routes_data import get_donor
    org_facts = load_org_facts()
    conn = db.connect()
    for donor_id in (1, 3, 11):
        d = get_donor(donor_id, conn)
        draft = template_drafts.draft_outreach(d, d["gifts"], d["why"], d["research_facts"], org_facts, today=AS_OF)
        assert draft.status == ("draft" if oa.is_big(d) else "ready") and draft.facts_used and draft.call_script
        assert leaks(draft.body + draft.call_script) == []
    conn.close()
    prospect = json.loads(persona.pack_file("icp").read_text(encoding="utf-8"))["prospects"][0]
    draft = template_drafts.draft_prospect(prospect, {}, org_facts, today=AS_OF)
    facts = {f"O{i}": {"fact": f.fact, "url": f.url} for i, f in enumerate(draft.facts_used, 1)}
    model = oa.ModelDraft(subject=draft.subject, body=draft.body, call_script=draft.call_script, fact_ids=["O1"])
    assert oa.check_prospect_draft(model, facts) == [] and draft.status == "draft"


def test_tidepath_snapshot_has_every_ui_key_and_no_real_names(tidepath, tmp_path, monkeypatch):
    """The no-AI rebuild (pipeline + CAMPAIGN_DRAFTER=template), the way web/public/snapshot.json is made."""
    from service import pipeline
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "donors.db"))
    monkeypatch.setenv("CAMPAIGN_DRAFTER", "template")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    out = tmp_path / "snapshot.json"
    report = pipeline.run_pipeline(AS_OF, out=out)
    status = {r["stage"]: r["status"] for r in report}
    assert status.pop("events") in ("ok", "missing")            # events_agent (PR #49) may not be on this build
    assert set(status.values()) == {"ok"}, report
    text = out.read_text(encoding="utf-8")
    assert leaks(text) == []
    snap = json.loads(text)
    for key in ("targets", "campaigns_demo", "ask_examples", "context", "donor_details", "icp", "prospects"):
        assert snap[key], key
    assert snap["context"]["profile"]["name"] == "Tidepath"
    assert all(f["url"].startswith("sample://") for f in snap["context"]["facts"])
    details = snap["donor_details"]
    assert any(d["research_facts"] for d in details.values()) and any(d["outreach_drafts"] for d in details.values())
    for d in details.values():
        assert all(f["source_url"].startswith("sample://") for f in d["research_facts"])
