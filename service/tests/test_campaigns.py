"""Campaigns (#38): per-donor drafts (model mocked), approval rules, simulated outbox, output guardrail.

No test calls OpenAI: model_write is replaced in every test, and the default drafter is the template."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from service import campaign_agent as ca
from service import db
from service.main import app
from service.export_snapshot import build_snapshot

# Seed ids (tidepath pack order): 1 Maria Delgado, 3 James Carter, 4 Biscayne Harbor (star org),
# 5 Robert Nguyen, 6 Angela Brooks, 9 Palmetto Lantern Foundation (org, no email), 11 Marlowe Tide (star org)
FIVE = [1, 3, 4, 5, 6]


@pytest.fixture(autouse=True)
def no_live_model(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("a test reached the model")
    monkeypatch.setattr(ca, "model_write", refuse)
    monkeypatch.setenv("CAMPAIGN_DRAFTER", "template")


@pytest.fixture
def client(db_file):
    return TestClient(app)


def by_donor(campaign: dict) -> dict:
    return {m["donor_id"]: m for m in campaign["messages"]}


def test_five_donors_make_five_distinct_model_drafts(client, monkeypatch):
    calls = []

    def fake_model(donor, gifts, why, research, org_facts, facts, intent, channel, today):
        calls.append((donor["id"], intent, channel))
        last = max(gifts, key=lambda g: g["gift_date"]) if gifts else None
        cite = f"your ${last['amount']:,.0f} gift" if last and not ca.oa.hides_gifts(donor) else "your partnership"
        return (f"Thank you, {ca.first_name(donor)}", f"Dear {ca.first_name(donor)}, thank you for {cite}. "
                f"{facts['O1']['fact']}", [facts["O1"]])

    monkeypatch.setattr(ca, "model_available", lambda: True)
    monkeypatch.setattr(ca, "model_write", fake_model)

    r = client.post("/campaigns", json={"donor_ids": FIVE, "intent": "thank_you", "channel": "email"})

    assert r.status_code == 200, r.text
    c = r.json()
    assert sorted(i for i, _, _ in calls) == FIVE and {(i, c_) for _, i, c_ in calls} == {("thank_you", "email")}
    assert len(c["messages"]) == 5 and len({m["body"] for m in c["messages"]}) == 5
    assert all(m["drafted_by"] == "model" and m["status"] == "draft" and m["flags"] == [] for m in c["messages"])
    assert "$3,000 gift" in by_donor(c)[1]["body"]          # Maria's last gift: a real record fact
    assert all(m["facts_used"] and m["facts_used"][0]["url"].startswith(("http", "sample://")) for m in c["messages"])
    assert c["name"] == "Thank you · Email · 5 donors" and c["counts"]["total"] == 5


def test_template_drafts_are_labelled_and_cite_the_record(client):
    c = client.post("/campaigns", json={"donor_ids": FIVE, "intent": "re_engage", "channel": "email",
                                        "name": "Fall re-engage"}).json()
    msgs = by_donor(c)
    assert c["name"] == "Fall re-engage"
    assert all(m["drafted_by"] == "template" and "no AI" in m["draft_note"] for m in msgs.values())
    assert "$3,000 gift on November 20, 2025" in msgs[1]["body"]      # Maria Delgado's last gift
    assert "$50 gift" in msgs[3]["body"]                              # James Carter's monthly gift
    assert "Endowment fund" in msgs[4]["body"]                        # star org: its fund, no figures
    assert "givemiamiday.org" in msgs[1]["body"] and "call or coffee" in msgs[4]["body"]
    assert len({m["body"] for m in msgs.values()}) == 5
    assert all(m["flags"] == [] for m in msgs.values())


def test_model_failure_falls_back_to_a_labelled_template(client, monkeypatch):
    def broken(*args, **kwargs):
        raise TimeoutError("model stalled")
    monkeypatch.setattr(ca, "model_available", lambda: True)
    monkeypatch.setattr(ca, "model_write", broken)

    m = client.post("/campaigns", json={"donor_ids": [1], "intent": "check_in", "channel": "email"}).json()["messages"][0]

    assert m["drafted_by"] == "template" and "TimeoutError" in m["draft_note"]


def test_unknown_donor_is_404_and_nothing_is_saved(client):
    r = client.post("/campaigns", json={"donor_ids": [1, 999], "intent": "thank_you", "channel": "email"})
    assert r.status_code == 404 and "999" in r.json()["detail"]
    assert client.get("/campaigns").json() == []


def test_star_and_org_donors_cannot_be_bulk_approved(client):
    c = client.post("/campaigns", json={"donor_ids": FIVE + [9, 11], "intent": "thank_you", "channel": "email"}).json()
    msgs = by_donor(c)
    assert {i for i, m in msgs.items() if m["needs_individual_approval"]} == {4, 9, 11}
    assert msgs[4]["approval_reason"] == "Star donor" and msgs[9]["approval_reason"] == "Organization"

    r = client.post(f"/campaigns/{c['id']}/approve-small").json()

    after = by_donor(r["campaign"])
    assert r["approved"] == 4 and r["left_for_individual_approval"] == 3
    assert {i for i, m in after.items() if m["status"] == "approved"} == {1, 3, 5, 6}
    assert all(after[i]["status"] == "draft" for i in (4, 9, 11))
    assert all(after[i]["approved_via"] == "bulk" for i in (1, 3, 5, 6))

    # the database refuses a bulk approval of a star donor even if a caller tries
    conn = db.connect()
    with pytest.raises(sqlite3.IntegrityError, match="individual approval"):
        conn.execute("UPDATE campaign_messages SET status = 'approved', approved_by = 'x', approved_via = 'bulk' "
                     "WHERE id = ?", (msgs[4]["id"],))
    with pytest.raises(sqlite3.IntegrityError, match="named human approver"):
        conn.execute("UPDATE campaign_messages SET status = 'sent' WHERE id = ?", (msgs[11]["id"],))
    conn.close()

    # a person approves the star donor individually
    star = client.patch(f"/campaigns/{c['id']}/messages/{msgs[4]['id']}",
                        json={"status": "approved", "approved_by": "Sharif"}).json()
    assert star["status"] == "approved" and star["approved_by"] == "Sharif" and star["approved_via"] == "individual"


def test_send_moves_approved_messages_to_a_masked_simulated_outbox(client):
    c = client.post("/campaigns", json={"donor_ids": [1, 5, 9, 6], "intent": "thank_you", "channel": "email"}).json()
    msgs = by_donor(c)
    client.post(f"/campaigns/{c['id']}/approve-small")
    client.patch(f"/campaigns/{c['id']}/messages/{msgs[9]['id']}", json={"status": "approved"})   # Palmetto Lantern: no email
    client.patch(f"/campaigns/{c['id']}/messages/{msgs[6]['id']}", json={"status": "skipped"})

    r = client.post(f"/campaigns/{c['id']}/send").json()

    assert r["simulated"] is True and r["sent"] == 2
    assert r["no_address"] == [{"message_id": msgs[9]["id"], "donor_name": "Palmetto Lantern Foundation",
                                "reason": "no email on file"}]
    out = client.get("/outbox").json()
    assert {o["donor_name"] for o in out} == {"Maria Delgado", "Robert Nguyen"}
    maria = next(o for o in out if o["donor_id"] == 1)
    assert maria["to"] == "m***@example.com" and "maria.delgado" not in str(out)
    assert maria["channel"] == "email" and maria["sent_at"] and maria["simulated"] is True
    assert maria["campaign_name"] == c["name"]
    sent = by_donor(client.get(f"/campaigns/{c['id']}").json())
    assert sent[1]["status"] == "sent" and sent[6]["status"] == "skipped" and sent[9]["status"] == "approved"
    # a sent message can't be edited, and sending again sends nothing new
    assert client.patch(f"/campaigns/{c['id']}/messages/{msgs[1]['id']}", json={"body": "x"}).status_code == 409
    assert client.post(f"/campaigns/{c['id']}/send").json()["sent"] == 0


def test_send_calls_the_single_delivery_hook_once_per_message(client, monkeypatch):
    from service import routes_campaigns
    assert routes_campaigns.deliver is routes_campaigns.simulated_adapter      # default: simulated, sends nothing
    calls = []
    monkeypatch.setattr(routes_campaigns, "deliver", lambda *a: calls.append(a) or {"delivered": False})
    c = client.post("/campaigns", json={"donor_ids": [1, 3], "intent": "check_in", "channel": "email"}).json()
    client.post(f"/campaigns/{c['id']}/approve-small")
    assert client.post(f"/campaigns/{c['id']}/send").json()["sent"] == 2
    assert sorted(a[1] for a in calls) == ["jcarter@example.com", "maria.delgado@example.com"]
    assert len(client.get("/outbox").json()) == 2


def test_text_campaign_masks_phone_and_stays_under_320(client):
    c = client.post("/campaigns", json={"donor_ids": [1, 9, 11], "intent": "re_engage", "channel": "text"}).json()
    assert all(len(m["body"]) <= ca.SMS_MAX and m["subject"] is None for m in c["messages"])
    assert by_donor(c)[1]["to"] == "***-***-0101"
    client.post(f"/campaigns/{c['id']}/approve-small")
    client.post(f"/campaigns/{c['id']}/send")
    assert client.get(f"/outbox?campaign_id={c['id']}").json()[0]["to"] == "***-***-0101"


def test_guardrail_flags_an_invented_amount_and_blocks_approval(client):
    c = client.post("/campaigns", json={"donor_ids": [1], "intent": "thank_you", "channel": "email"}).json()
    m = c["messages"][0]
    url = f"/campaigns/{c['id']}/messages/{m['id']}"

    edited = client.patch(url, json={"body": m["body"] + "\n\nA $5,000 gift would mean the world."}).json()

    assert any("$5,000" in f for f in edited["flags"])
    r = client.patch(url, json={"status": "approved"})
    assert r.status_code == 409 and "$5,000" in r.json()["detail"]
    assert client.post(f"/campaigns/{c['id']}/approve-small").json()["approved"] == 0     # bulk skips it too
    fixed = client.patch(url, json={"body": m["body"], "status": "approved"}).json()
    assert fixed["flags"] == [] and fixed["status"] == "approved"


def test_editing_an_approved_message_needs_a_fresh_approval(client):
    c = client.post("/campaigns", json={"donor_ids": [1], "intent": "thank_you", "channel": "email"}).json()
    url = f"/campaigns/{c['id']}/messages/{c['messages'][0]['id']}"
    client.patch(url, json={"status": "approved"})
    m = client.patch(url, json={"body": "Dear Maria, thank you for your $3,000 gift."}).json()
    assert m["status"] == "draft" and m["approved_by"] is None


# ---------- the guardrail itself (plain code) ----------

DONOR = {"id": 1, "full_name": "Maria Delgado", "first_name": "Maria", "donor_type": "individual",
         "source_row": "SAMPLE", "tier": "mid", "is_star": False}
GIFTS = [{"amount": 3000, "gift_date": "2025-11-20", "channel": "Give Miami Day"}]
FACTS = {"O1": {"fact": "The Foundation awarded scholarships totaling $3.45 million to 969 students.",
                "url": "https://miamifoundation.org/x", "date": "2026-08-01"}}


@pytest.mark.parametrize("text, bad", [
    ("Thank you for your $5,000 gift.", "$5,000"),
    ("Thank you for your $3,000 gift on March 3, 2024.", "March 3, 2024"),
    ("We raised $2 million last year.", "$2 million"),
    ("Your gift on 2025-11-21 helped.", "2025-11-21"),
])
def test_check_message_rejects_figures_not_in_the_record(text, bad):
    assert any(bad in f for f in ca.check_message(text, DONOR, GIFTS, FACTS, "email"))


def test_check_message_allows_record_facts_and_the_calendar():
    text = ("Thank you for your $3,000 gift on November 20, 2025. We awarded scholarships totaling $3.45 million. "
            "Early giving opens Saturday, November 14, 2026; Give Miami Day is Nov 19.")
    assert ca.check_message(text, DONOR, GIFTS, FACTS, "email") == []


def test_sample_org_figures_are_flagged_and_texts_are_capped():
    org = DONOR | {"full_name": "Knight Foundation", "donor_type": "organization", "tier": "big"}
    assert any("SAMPLE gift history" in f for f in ca.check_message("Thanks for your $3,000 gift.", org, GIFTS, FACTS, "email"))
    assert any("320" in f for f in ca.check_message("x" * 321, DONOR, GIFTS, FACTS, "text"))


def test_beneficiaries_get_no_money_ask():
    person = DONOR | {"contact_type": "beneficiary"}
    assert any("money ask" in f for f in ca.check_message("Please donate at givemiamiday.org", person, [], FACTS, "text"))
    d = ca.template_draft(person, [], {}, FACTS, "re_engage", "text")
    assert "givemiamiday" not in d.body and ca.check_message(d.body, person, [], FACTS, "text") == []


def test_snapshot_carries_a_sample_campaign_and_template_drafts(db_file):
    conn = db.connect(db_file)
    snap = build_snapshot(conn, rescore=False)
    conn.close()
    demo = snap["campaigns_demo"]
    assert len(demo["campaigns"]) == 1 and demo["outbox"] == []
    sample = demo["campaigns"][0]
    assert len(sample["messages"]) == 5 and all(m["drafted_by"] == "template" for m in sample["messages"])
    assert set(demo["drafts"]["1"]) == {f"{i}:{c}" for i in ca.INTENTS for c in ca.CHANNELS}
    assert "@example.com" not in str(demo).replace("***@example.com", "")   # only masked addresses
    with db.connect(db_file) as c2:
        assert c2.execute("SELECT COUNT(*) FROM campaigns").fetchone()[0] == 0    # the export writes nothing
