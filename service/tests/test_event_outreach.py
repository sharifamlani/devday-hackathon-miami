"""Calendar outreach: one pending batch per event, audience by rule, nothing sent without approval.
86's events agent is replaced by a stand-in with the same rule; no test reaches a model or provider."""

import importlib.machinery
import re
import sys
import types

import httpx
import pytest
from fastapi.testclient import TestClient

from service import campaign_agent as ca
from service import db, event_outreach
from service.main import app

EVENTS = [
    {"title": "Give Miami Day · Early Giving", "starts_at": "2026-11-14", "audience_hint": "giving",
     "source_url": "https://www.givemiamiday.org/"},
    {"title": "The Give Miami 5K: Race + Festival", "starts_at": "2026-11-15", "place": "Maurice A. Ferré Park",
     "audience_hint": "community", "source_url": "https://miamifoundation.org/featured/give-miami-5k/"},
    {"title": "Give Miami Day", "starts_at": "2026-11-19", "audience_hint": "giving",
     "source_url": "https://www.givemiamiday.org/p/new/"},
    {"title": "Puppy Adoption Day at the Park", "starts_at": "2026-11-21", "audience_hint": "pet",
     "source_url": "https://miamifoundation.org/events/puppy-day/"},
]
ASK = re.compile(r"donat|gift|pledge|contribut|givemiamiday\.org", re.I)


def kind(e):
    t = e["title"].lower()
    return "pet" if "puppy" in t else "giving" if "give miami day" in t else "community"


def suggest_audience(event, people, rationale=True):
    k = kind(event)
    if k == "pet":
        chosen = [p for p in people if p.get("has_dog")]
    elif k == "giving":
        chosen = [p for p in people if p.get("contact_type") == "giver"]
    else:
        chosen = [p for p in people if p.get("contact_type") in ("community", "neighbor")]
    return {"event_kind": k, "person_ids": [p["id"] for p in chosen], "why": {}, "rationale": ""}


def draft_event_invite(event, person):
    ask = " Join us at givemiamiday.org." if person["contact_type"] == "giver" and kind(event) == "giving" else ""
    return {"subject": f"You're invited: {event['title']}", "sms": f"{event['title']} {event['source_url']}",
            "email_body": f"Hi {person['full_name']}, {event['title']} is on {event['starts_at']}.{ask}",
            "facts_used": [{"fact": event["title"], "url": event["source_url"]}]}


@pytest.fixture(autouse=True)
def stand_in_events_agent(monkeypatch):
    fake = types.ModuleType("service.events_agent")
    fake.__spec__ = importlib.machinery.ModuleSpec("service.events_agent", None)
    fake.extract_events = lambda refresh=False: [dict(e) for e in EVENTS]
    fake.suggest_audience, fake.draft_event_invite = suggest_audience, draft_event_invite
    monkeypatch.setitem(sys.modules, "service.events_agent", fake)
    monkeypatch.setattr(event_outreach, "load_events", lambda conn: [{**e, "id": i} for i, e in enumerate(EVENTS, 1)])
    monkeypatch.setenv("SCORE_AS_OF", "2026-11-08")

    def refuse(*args, **kwargs):
        raise AssertionError("a test reached the network or the model")
    monkeypatch.setattr(httpx, "post", refuse)
    monkeypatch.setattr(ca, "model_write", refuse)


@pytest.fixture
def three_tabs(db_file, monkeypatch):
    """Seed givers plus Community / Neighbor people, as data's list_people will return them."""
    conn = db.connect()
    extra = [("Ana Community", "community", True, "ana@example.org", None),
             ("Ben Community", "community", False, None, "+13055550199"),
             ("Cy Neighbor", "neighbor", True, "cy@example.org", None),
             ("Di Neighbor", "neighbor", False, None, None)]
    tabs = {}
    for name, tab, dog, email, phone in extra:
        pid = db.insert_donor(conn, {"full_name": name, "donor_type": "individual", "email": email,
                                     "phone": phone, "notes": "SAMPLE"})
        tabs[pid] = (tab, dog)
    conn.commit()
    conn.close()
    real = event_outreach.load_people

    def load_people(conn):
        people, _ = real(conn)
        for p in people:
            tab, dog = tabs.get(p["id"], ("giver", p["id"] == 1))     # Maria (a giver) has a dog too
            p.update(contact_type=tab, has_dog=dog)
        return people, False

    monkeypatch.setattr(event_outreach, "load_people", load_people)
    return tabs


def outbox(c):
    return c.get("/outbox").json()


def test_all_upcoming_makes_one_batch_per_event_with_the_right_audience(three_tabs):
    c = TestClient(app)
    result = event_outreach.plan_event_outreach("all_upcoming")
    by_title = {e["title"]: e for e in result["events"]}

    assert [e["starts_at"] for e in result["events"]] == ["2026-11-14", "2026-11-15", "2026-11-19", "2026-11-21"]
    assert len({e["batch_id"] for e in result["events"] if e["batch_id"]}) == 4
    five_k = by_title["The Give Miami 5K: Race + Festival"]
    names = {m["donor_name"] for m in c.get(f"/campaigns/{five_k['batch_id']}").json()["messages"]}
    assert names == {"Ana Community", "Ben Community", "Cy Neighbor"}
    assert [s["full_name"] for s in five_k["skipped"]] == ["Di Neighbor"]                 # no email or phone
    gmd = c.get(f"/campaigns/{by_title['Give Miami Day']['batch_id']}").json()
    assert all(m["donor_id"] not in three_tabs for m in gmd["messages"])                 # givers only
    assert gmd["name"].startswith("Give Miami Day · Nov 19 · ") and gmd["intent"] == "event_invite"
    assert gmd["event_id"] == by_title["Give Miami Day"]["event_id"]
    assert "Frederick A. DeLuca Foundation" not in {m["donor_name"] for m in gmd["messages"]}  # no contact info
    assert "Biscayne Harbor Family Foundation" in by_title["Give Miami Day"]["needs_individual_approval"]
    assert outbox(c) == []


def test_pet_event_reaches_only_people_with_dogs_and_community_gets_no_ask(three_tabs):
    c = TestClient(app)
    pet = event_outreach.plan_event_outreach(4)["events"][0]
    names = {m["donor_name"] for m in c.get(f"/campaigns/{pet['batch_id']}").json()["messages"]}
    assert names == {"Maria Delgado", "Ana Community", "Cy Neighbor"}

    five_k = event_outreach.plan_event_outreach(2)["events"][0]
    for m in c.get(f"/campaigns/{five_k['batch_id']}").json()["messages"]:
        assert not ASK.search(f"{m['subject'] or ''} {m['body']}")
    assert outbox(c) == []


def test_mixed_batch_keeps_each_message_channel(three_tabs):
    c = TestClient(app)
    five_k = event_outreach.plan_event_outreach(2)["events"][0]
    camp = c.get(f"/campaigns/{five_k['batch_id']}").json()
    assert camp["channel"] == "mixed"
    assert {m["donor_name"]: m["channel"] for m in camp["messages"]} == {
        "Ana Community": "email", "Ben Community": "text", "Cy Neighbor": "email"}


def test_planning_twice_opens_the_same_batch(three_tabs):
    first = event_outreach.plan_event_outreach(1)["events"][0]
    again = event_outreach.plan_event_outreach(1)["events"][0]
    assert again["batch_id"] == first["batch_id"] and again["existing"] is True


def test_route_plans_an_event_and_nothing_sends_until_approved(three_tabs):
    c = TestClient(app)
    r = c.post("/events/3/plan").json()

    assert r["pending_batch"]["id"] == r["batch_id"] and r["pending_batch"]["items"]
    assert c.post("/events/99/plan").status_code == 404
    assert outbox(c) == []
    sent = c.post("/send", json={"batch_id": r["batch_id"], "approved_by": "Test approver"}).json()
    assert sent["sent"] > 0 and all(o["delivery_status"] == "queued (dry run)" for o in sent["outbox"])


def test_without_three_tabs_only_givers_are_planned_and_it_says_so(db_file, monkeypatch):
    from service import routes_data
    monkeypatch.delattr(routes_data, "list_people", raising=False)     # before data's three tabs land
    result = event_outreach.plan_event_outreach("all_upcoming")
    five_k = result["events"][1]
    assert result["givers_only"] is True
    assert five_k["batch_id"] is None and five_k["note"] == event_outreach.GIVERS_ONLY_NOTE


def test_no_saved_events_says_run_refresh(db_file, monkeypatch):
    monkeypatch.setattr(event_outreach, "load_events", lambda conn: [])
    result = event_outreach.plan_event_outreach("all_upcoming")
    assert result["events"] == [] and result["note"] == event_outreach.NO_EVENTS_NOTE
