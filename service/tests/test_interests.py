"""B1 interest tags (plan §21.9 smoke #9): only the 17 tags, each sourced; nothing written before Save;
a made-up person gets no tags; staff tags win; undo tokens reverse every write."""
import pydantic
import pytest
from fastapi.testclient import TestClient

from service import db, enrich_agent, interests
from service.enrich_agent import Enrichment, finalize
from service.main import app
from service.routes_interests import PROPOSALS

SEARCHED = "2026-11-08T00:00:00+00:00"


def org_id(name="Frederick A. DeLuca Foundation") -> int:
    conn = db.connect()
    row = conn.execute("SELECT id FROM donors WHERE full_name = ?", (name,)).fetchone()
    conn.close()
    return row["id"]


def counts() -> tuple[int, int]:
    conn = db.connect()
    out = (conn.execute("SELECT COUNT(*) FROM research_facts").fetchone()[0],
           conn.execute("SELECT COUNT(*) FROM donor_interests").fetchone()[0])
    conn.close()
    return out


def proposal() -> dict:
    facts = [{"id": interests.fact_id(f, u), "fact": f, "source_url": u, "retrieved_at": SEARCHED}
             for f, u in [("Funds youth programs in Miami-Dade.", "https://ex.org/youth"),
                          ("Supports scholarships at FIU.", "https://ex.org/fiu")]]
    tags = [{"id": t, "tag": t, "label": interests.LABELS[t], "sub_tag": s, "confidence": "high",
             "evidence": f"Grant to a {t} program.", "source_url": f"https://ex.org/{t}", "source_type": "named_gift"}
            for t, s in [("youth_family", "mentoring"), ("education", "scholarships"), ("arts_culture", None)]]
    return {"identity_match": "confirmed", "identity_basis": ["name", "city"], "facts": facts, "interests": tags,
            "contact": {"website": "https://ex.org"}, "notes": None, "searched_at": SEARCHED}


@pytest.fixture
def client(db_file, monkeypatch):
    PROPOSALS.clear()
    monkeypatch.setattr(enrich_agent, "enrich_full", lambda *a, **k: proposal())
    return TestClient(app)


def test_seed_has_exactly_the_17_approved_tags(client):
    tags = client.get("/interest-tags").json()
    assert [t["slug"] for t in tags] == interests.TAG_SLUGS and len(tags) == 17
    assert all(t["label"] and t["definition"] for t in tags)


def test_agent_schema_only_accepts_the_17_slugs():
    good = {"tag": "animals", "sub_tag": "shelters", "confidence": "high", "evidence": "x",
            "source_url": "https://ex.org", "source_type": "board_seat"}
    enrich_agent.FoundInterest(**good)
    with pytest.raises(pydantic.ValidationError):
        enrich_agent.FoundInterest(**{**good, "tag": "dogs"})
    with pytest.raises(pydantic.ValidationError):
        enrich_agent.FoundInterest(**{**good, "confidence": "certain"})


def test_dry_run_writes_nothing_then_save_writes_only_the_picks(client):
    pid = org_id()
    before = counts()
    body = client.post(f"/enrich/{pid}", params={"dry_run": 1}).json()
    assert body["dry_run"] is True and len(body["facts"]) == 2 and len(body["interests"]) == 3
    assert all(i["tag"] in interests.TAG_SLUGS and i["source_url"] for i in body["interests"])
    assert counts() == before                                     # nothing written before Save

    first_fact = body["facts"][0]["id"]
    saved = client.post(f"/people/{pid}/enrichment/accept", json={"fact_ids": [first_fact], "tags": ["education"]}).json()
    assert saved["saved"] == {"facts": 1, "interests": 1, "contact": {"website": "https://ex.org"},
                              "contact_persisted": False, "skipped_staff_tags": []}
    assert saved["undo"].startswith("int_")
    assert counts() == (before[0] + 1, before[1] + 1)
    tags = client.get(f"/people/{pid}/interests").json()
    assert [(t["tag"], t["sub_tag"], t["set_by"], t["source_url"]) for t in tags] == [
        ("education", "scholarships", "agent", "https://ex.org/education")]


def test_staff_tags_are_never_overwritten_or_re_added(client):
    pid = org_id()
    client.post(f"/people/{pid}/interests", json={"tag": "education", "sub_tag": "scholarships"})
    client.delete(f"/people/{pid}/interests/arts_culture")       # removed before the agent ever saw it
    client.post(f"/enrich/{pid}", params={"dry_run": 1})
    saved = client.post(f"/people/{pid}/enrichment/accept",
                        json={"fact_ids": [], "tags": ["education", "arts_culture", "youth_family"]}).json()
    assert saved["saved"]["interests"] == 1 and saved["saved"]["skipped_staff_tags"] == ["arts_culture", "education"]
    tags = {t["tag"]: t for t in client.get(f"/people/{pid}/interests").json()}
    assert set(tags) == {"education", "youth_family"}
    assert tags["education"]["set_by"] == "staff" and tags["education"]["source_url"] is None


def test_add_remove_keep_the_row_and_undo_reverses(client):
    pid = org_id()
    r = client.post(f"/people/{pid}/interests", json={"tag": "animals"})
    assert [t["tag"] for t in r.json()] == ["animals"] and r.headers["X-Undo-Token"].startswith("int_")
    removed = client.delete(f"/people/{pid}/interests/animals").json()
    assert removed["removed"] is True and client.get(f"/people/{pid}/interests").json() == []
    kept = client.get(f"/people/{pid}/interests", params={"include_removed": True}).json()
    assert [(t["tag"], t["status"]) for t in kept] == [("animals", "removed")]      # row kept

    conn = db.connect()
    interests.undo(conn, removed["undo"])
    assert [t["status"] for t in interests.list_interests(conn, pid)] == ["active"]
    interests.undo(conn, r.headers["X-Undo-Token"])
    assert interests.list_interests(conn, pid, include_removed=True) == []
    conn.close()


def test_accept_undo_removes_the_saved_facts_and_tags(client):
    pid = org_id()
    before = counts()
    body = client.post(f"/enrich/{pid}", params={"dry_run": 1}).json()
    saved = client.post(f"/people/{pid}/enrichment/accept",
                        json={"fact_ids": [f["id"] for f in body["facts"]], "tags": ["youth_family"]}).json()
    assert counts() == (before[0] + 2, before[1] + 1)
    conn = db.connect()
    interests.undo(conn, saved["undo"])
    conn.close()
    assert counts() == before


def test_bad_input_is_rejected(client):
    pid = org_id()
    assert client.post(f"/people/{pid}/interests", json={"tag": "dogs"}).status_code == 422
    assert client.post(f"/people/{pid}/interests", json={"tag": "animals", "sub_tag": "museums"}).status_code == 422
    assert client.get("/people/99999/interests").status_code == 404
    assert client.post(f"/people/{org_id('Maria Delgado')}/enrichment/accept", json={"tags": []}).status_code == 409


def test_made_up_person_gets_no_tags():
    assert enrich_agent.enrich_full("Marisol Quintero-Bauer", None, "Miami", "individual")["interests"] == []
    # even if the model returned tags, an unfound or ambiguous identity drops them all
    raw = Enrichment(identity_match="not_found", identity_basis=[], facts=[], notes=None,
                     interests=[enrich_agent.FoundInterest(tag="education", sub_tag=None, confidence="high",
                                                           evidence="x", source_url="https://ex.org",
                                                           source_type="board_seat")],
                     contact=enrich_agent.Contact(employer=None, title=None, linkedin_url=None, public_email=None,
                                                  public_phone=None, website=None, source_urls=[],
                                                  location=enrich_agent.Location(city=None, region=None, country=None)))
    for identity in ("not_found", "ambiguous"):
        out = finalize(raw.model_copy(update={"identity_match": identity}), {"https://ex.org": True}, SEARCHED)
        assert out["interests"] == [] and out["facts"] == []


def test_finalize_drops_dead_links_and_caps_faith_based():
    def tag(t, url, conf="high", kind="statement", sub=None):
        return enrich_agent.FoundInterest(tag=t, sub_tag=sub, confidence=conf, evidence="e", source_url=url,
                                          source_type=kind)
    raw = Enrichment(identity_match="confirmed", identity_basis=["name", "city"], notes=None,
                     facts=[enrich_agent.ResearchedFact(fact="f", source_url="https://dead")],
                     interests=[tag("faith_based", "https://ok/1"), tag("animals", "https://dead"),
                                tag("education", "https://ok/2", sub="museums")],   # wrong sub-tag for education
                     contact=enrich_agent.Contact(employer=None, title=None, linkedin_url=None, public_email=None,
                                                  public_phone="305", website=None, source_urls=["https://dead"],
                                                  location=enrich_agent.Location(city=None, region=None, country=None)))
    out = finalize(raw, {"https://ok/1": True, "https://ok/2": True}, SEARCHED)
    assert out["facts"] == [] and out["contact"] == {}                      # dead links drop
    got = {i["tag"]: i for i in out["interests"]}
    assert set(got) == {"faith_based", "education"}
    assert got["faith_based"]["confidence"] == "medium"                     # no named gift or role
    assert got["education"]["sub_tag"] is None


def test_plain_enrich_still_saves_research_facts(client, monkeypatch):
    pid = org_id()
    fact = enrich_agent.Fact(fact="Funds youth programs in Miami-Dade.", source_url="https://ex.org/a",
                             retrieved_at=SEARCHED)
    monkeypatch.setattr(enrich_agent, "enrich_donor", lambda *a, **k: [fact])
    body = client.post(f"/enrich/{pid}").json()
    assert body["saved"] == 1 and body["facts"][0]["source_url"] == "https://ex.org/a" and "dry_run" not in body


def test_only_shared_mailboxes_are_kept_as_public_email():
    assert enrich_agent.generic_mailbox("info@ex.org") == "info@ex.org"
    assert enrich_agent.generic_mailbox("grants@ex.org") == "grants@ex.org"
    assert enrich_agent.generic_mailbox("jsmith@ex.org") is None          # a named person's address
    assert enrich_agent.generic_mailbox(None) is None


def test_schema_stays_write_free_and_seeding_is_once(tmp_path):
    """create_schema runs on every request: once the tables exist it must not write (seeding is separate)."""
    path = tmp_path / "donors.db"
    conn = db.connect(path)
    db.create_schema(conn)
    interests.ensure_seeded(conn)
    changes = conn.total_changes
    db.create_schema(conn)
    interests.ensure_seeded(conn)
    assert conn.total_changes == changes                               # no writes on the second pass
    assert len(interests.list_tags(conn)) == 17
    conn.close()


def test_post_undo_reverts_once_then_refuses(client):
    """3a's POST /undo/{token} routes int_ tokens here: 200 and reverted, then 4xx (never 500) on reuse."""
    pid = org_id()
    token = client.post(f"/people/{pid}/interests", json={"tag": "animals"}).headers["X-Undo-Token"]
    assert [t["tag"] for t in client.get(f"/people/{pid}/interests").json()] == ["animals"]
    first = client.post(f"/undo/{token}")
    assert first.status_code == 200 and first.json()["undone"] is True
    assert client.get(f"/people/{pid}/interests", params={"include_removed": True}).json() == []
    again = client.post(f"/undo/{token}")
    assert again.status_code == 422 and "already undone" in again.json()["detail"]
    for bad in ("int_not-base64", "int_e30", "int_eyJvcCI6IngifQ"):   # garbage, {}, {"op":"x"}
        assert client.post(f"/undo/{bad}").status_code == 422


def test_undo_raises_value_error_for_unknown_or_reused_tokens(db_file):
    conn = db.connect()
    pid = conn.execute("SELECT id FROM donors LIMIT 1").fetchone()[0]
    token = interests.add_interest(conn, pid, "animals", actor="agent")["undo"]
    logged = conn.execute("SELECT actor, action, target FROM agent_actions WHERE token = ?", (token,)).fetchone()
    assert tuple(logged) == ("agent", "add_interest", f"person:{pid}")
    interests.undo(conn, token)
    with pytest.raises(ValueError):
        interests.undo(conn, token)                                   # already undone
    conn.execute("DELETE FROM agent_actions WHERE token = ?", (token,))
    conn.commit()
    with pytest.raises(ValueError):
        interests.undo(conn, token)                                   # unknown
    conn.close()


def test_tag_slugs_needs_no_database():
    """after_call_agent calls interests.tag_slugs() with no connection."""
    slugs = interests.tag_slugs()
    assert slugs == interests.TAG_SLUGS and len(slugs) == 17
    slugs.append("x")                                                   # a copy: callers can't change the constant
    assert len(interests.TAG_SLUGS) == 17


# --- Organization identity: name + one more attribute (c9's "Whitaker Family Charitable Fund" case) ---------

def found(city, region, website=None, tags=("education",)):
    """What the agent returns: a confirmed-looking identity located in city/region, with tags and a fact."""
    return Enrichment(
        identity_match="confirmed", identity_basis=["name"], notes=None,
        facts=[enrich_agent.ResearchedFact(fact="Gives to schools.", source_url="https://ex.org/f")],
        interests=[enrich_agent.FoundInterest(tag=t, sub_tag=None, confidence="high", evidence="e",
                                              source_url="https://ex.org/t", source_type="named_gift") for t in tags],
        contact=enrich_agent.Contact(employer=None, title=None, linkedin_url=None, public_email=None,
                                     public_phone=None, website=website, source_urls=["https://ex.org/contact"],
                                     location=enrich_agent.Location(city=city, region=region, country="US")))


@pytest.fixture
def live_agent(monkeypatch):
    """enrich_full's live path with a scripted agent result; every URL loads."""
    monkeypatch.setattr(enrich_agent, "read_interest_cache", lambda: {})
    monkeypatch.setattr(enrich_agent, "url_loads", lambda url: True)
    box = {}
    monkeypatch.setattr(enrich_agent.Runner, "run_sync",
                        lambda agent, query: type("R", (), {"final_output": box["e"]})())
    return box


def test_name_only_match_in_another_state_gets_no_tags(live_agent):
    live_agent["e"] = found("Greenville", "South Carolina")
    out = enrich_agent.enrich_full("Whitaker Family Charitable Fund", "Whitaker Family Charitable Fund", "Miami",
                                   "organization", state="FL")
    assert out["identity_match"] == "ambiguous" and out["interests"] == [] and out["facts"] == []
    assert out["notes"] == enrich_agent.IDENTITY_NOTE and out["identity_basis"] == ["name"]


def test_no_second_attribute_on_the_record_is_ambiguous(live_agent):
    live_agent["e"] = found("Miami", "FL")
    out = enrich_agent.enrich_full("Whitaker Family Charitable Fund", None, None, "organization",
                                   email="harold.whitaker@example.org")      # placeholder domain: no signal
    assert out["identity_match"] == "ambiguous" and out["interests"] == []


def test_knight_in_miami_keeps_its_sourced_tags(live_agent):
    live_agent["e"] = found("Miami", "Florida", tags=("civic_media", "arts_culture"))
    out = enrich_agent.enrich_full("John S. and James L. Knight Foundation", None, "Miami", "organization", state="FL")
    assert out["identity_match"] == "confirmed" and out["identity_basis"] == ["name", "city", "state"]
    assert {i["tag"] for i in out["interests"]} == {"civic_media", "arts_culture"}
    assert all(i["source_url"] for i in out["interests"])


def test_website_matching_the_email_domain_counts(live_agent):
    live_agent["e"] = found(None, None, website="https://www.knightfoundation.org/")
    out = enrich_agent.enrich_full("Knight Foundation", None, None, "organization", email="grants@knightfoundation.org")
    assert out["identity_basis"] == ["name", "website"] and out["interests"]


def test_state_names_and_abbreviations_compare_equal():
    assert enrich_agent.state_name("FL") == enrich_agent.state_name("Florida") == "florida"
    assert enrich_agent.state_name("South Carolina") != enrich_agent.state_name("FL")


def test_cached_proposal_is_returned_without_the_live_check(monkeypatch):
    cached = {"identity_match": "confirmed", "facts": [], "interests": [{"tag": "civic_media"}], "contact": {}}
    monkeypatch.setattr(enrich_agent, "read_interest_cache", lambda: {"John S. and James L. Knight Foundation": cached})
    monkeypatch.setattr(enrich_agent.Runner, "run_sync", lambda *a, **k: (_ for _ in ()).throw(AssertionError("live run")))
    assert enrich_agent.enrich_full("John S. and James L. Knight Foundation", None, None, "organization") is cached


def test_plain_enrich_live_path_is_gated_too(live_agent):
    live_agent["e"] = found("Greenville", "SC")
    assert enrich_agent.enrich_donor("Whitaker Family Charitable Fund", "Whitaker Family Charitable Fund", "Miami",
                                     donor_type="organization") == []
