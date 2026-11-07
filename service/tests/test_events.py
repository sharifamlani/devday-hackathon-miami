"""Events agent rules that need no model call."""

import sys
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from events_agent import check_invite, event_kind, rule_audience, validate_events  # noqa: E402

PEOPLE = [
    {"id": 1, "full_name": "Maria Delgado", "contact_type": "giver", "status": "lapsing", "is_star": 0, "has_dog": False, "email": "m@example.org"},
    {"id": 2, "full_name": "DeLuca Foundation", "contact_type": "giver", "donor_type": "organization", "is_star": 1, "email": "d@example.org"},
    {"id": 3, "full_name": "Ana Ruiz", "contact_type": "community", "has_dog": True, "interests": ["running"], "phone": "+13055550103"},
    {"id": 4, "full_name": "Leo Park", "contact_type": "neighbor", "has_dog": False, "interests": ["arts"], "email": "l@example.org"},
    {"id": 5, "full_name": "Sam Cole", "contact_type": "neighbor", "has_dog": True, "email": "s@example.org"},
    {"id": 6, "full_name": "Bo Diaz", "contact_type": "giver", "status": "on_track", "has_dog": True, "email": "b@example.org"},
    {"id": 7, "full_name": "No Contact", "contact_type": "community", "has_dog": True},
]


def test_pet_event_targets_only_reachable_people_with_dogs():
    kind, chosen, why = rule_audience({"title": "Puppy Outreach Day", "starts_at": "2026-11-21"}, PEOPLE)
    assert kind == "pet" and {p["id"] for p in chosen} == {3, 5, 6}          # 7 has a dog but no email or phone
    assert all(p["has_dog"] and (p.get("email") or p.get("phone")) for p in chosen)


def test_person_id_key_is_accepted():
    people = [{"person_id": 9, "contact_type": "neighbor", "has_dog": True, "email": "x@example.org"}]
    _, chosen, why = rule_audience({"title": "Puppy Day", "starts_at": "2026-11-21"}, people)
    assert [p["id"] for p in chosen] == [9] and 9 in why


def test_giving_event_targets_givers_lapsing_then_star_first():
    kind, chosen, why = rule_audience({"title": "Give Miami Day", "starts_at": "2026-11-19"}, PEOPLE)
    assert kind == "giving" and [p["id"] for p in chosen] == [1, 2, 6]
    assert why[1] == "giver (lapsing)"


def test_community_event_targets_matching_interests_in_community_and_neighbors():
    kind, chosen, _ = rule_audience({"title": "Arts in the Park", "starts_at": "2026-11-22"}, PEOPLE)
    assert kind == "community" and [p["id"] for p in chosen] == [4]


def test_event_needs_a_page_that_states_its_date_and_place():
    from events_agent import verify_sources
    five_k = {"title": "The Give Miami 5K: Race + Festival", "starts_at": "2026-11-15", "place": "Maurice A. Ferré Park",
              "source_url": "https://miamifoundation.org/featured/5k/"}
    pages = {"https://miamifoundation.org/featured/5k/": None,          # bot wall: can't be read
             "https://runsignup.com/race/fl/miami/givemiami5k/": "The Give Miami 5K Sunday, November 15 2026 Maurice A. Ferre Park, Miami"}
    kept, dropped = verify_sources([five_k], set(pages), {"miamifoundation.org"}, fetch=pages.get)
    assert kept[0]["source_url"] == "https://runsignup.com/race/fl/miami/givemiami5k/"
    assert kept[0]["place"] == "Maurice A. Ferré Park" and kept[0]["verification"] == "page-verified"
    # a page with the title but no date: dropped; a page with the date but not the place: place cleared
    kept, dropped = verify_sources([five_k], {"https://runsignup.com/x/"}, {"miamifoundation.org"},
                                   fetch={"https://runsignup.com/x/": "Give Miami 5K registration"}.get)
    assert kept == [] and dropped
    kept, _ = verify_sources([five_k], {"https://runsignup.com/y/"}, {"miamifoundation.org"},
                             fetch={"https://runsignup.com/y/": "Give Miami 5K on November 15"}.get)
    assert kept[0]["place"] is None


def test_events_need_a_future_date_and_a_search_returned_source():
    found = [NS(title="Give Miami Day", starts_at="2026-11-19", ends_at="", place="", kind="giving",
                source_url="https://www.givemiamiday.org/?utm_source=openai", quote="Nov 19"),
             NS(title="Old Gala", starts_at="2026-10-01", ends_at="", place="", kind="giving",
                source_url="https://miamifoundation.org/gala/", quote=""),
             NS(title="Made-up Fair", starts_at="2026-12-01", ends_at="", place="", kind="community",
                source_url="https://miamifoundation.org/fair/", quote=""),
             NS(title="Undated Thing", starts_at="soon", ends_at="", place="", kind="community",
                source_url="https://miamifoundation.org/thing/", quote="")]
    cited = {"https://www.givemiamiday.org/", "https://miamifoundation.org/gala/", "https://miamifoundation.org/thing/"}
    kept, dropped = validate_events(found, cited, {"miamifoundation.org", "givemiamiday.org"}, "2026-11-08", "now")
    assert [e["title"] for e in kept] == ["Give Miami Day"]
    assert len(dropped) == 3


def test_community_invite_rejects_a_donation_ask():
    facts = {"O1": {"fact": "Give Miami 5K 2026-11-15 Maurice A. Ferré Park", "url": "u", "date": "2026-11-15"}}
    ok = NS(subject="Join us at the Give Miami 5K", email_body="Come run with neighbors on November 15.", sms="Give Miami 5K Nov 15! u")
    community = {"id": 3, "contact_type": "community"}
    assert check_invite(ok, facts, community) == []
    bad = NS(subject=ok.subject, email_body=ok.email_body + " Please donate at givemiamiday.org.", sms=ok.sms)
    assert check_invite(bad, facts, community)
    assert event_kind({"title": "Puppy adoption fair"}) == "pet"


def test_events_on_another_nonprofits_page_are_not_the_orgs_events():
    found = [NS(title="Miami Glitter Soiree", starts_at="2026-11-18", ends_at="", place="", kind="community",
                source_url="https://www.givemiamiday.org/organization/Posse/", quote="Nov 18")]
    kept, dropped = validate_events(found, {"https://www.givemiamiday.org/organization/Posse/"},
                                    {"miamifoundation.org", "givemiamiday.org"}, "2026-11-08", "now")
    assert kept == [] and dropped[0].startswith("another org's page")


def test_cached_foundation_events_are_real_and_sourced():
    from events_agent import EVENTS_CACHE, read_runs
    events = read_runs(EVENTS_CACHE)["miamifoundation.org"]
    dates = {e["starts_at"][:10] for e in events}
    assert {"2026-11-14", "2026-11-15", "2026-11-19"} <= dates
    assert all(e["source_url"].startswith("https://") and "/organization/" not in e["source_url"] for e in events)
