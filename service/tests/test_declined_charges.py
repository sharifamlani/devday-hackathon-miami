"""A declined or failed charge is never a gift: not in what agents see, not in who 'gave', never thanked.
Fixture: Hye-jin Park (fictional), monthly $40 June-September that went through, October 10 declined."""

from datetime import date

import pytest

from service import campaign_agent as ca, db

AS_OF = date(2026, 11, 8)
CHARGES = [("2026-06-10", "ok"), ("2026-07-10", "ok"), ("2026-08-10", "ok"), ("2026-09-10", "ok"), ("2026-10-10", "declined")]


@pytest.fixture
def park(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    monkeypatch.setenv("SCORE_AS_OF", AS_OF.isoformat())
    conn = db.connect(path)
    db.create_schema(conn)
    pid = conn.execute("INSERT INTO donors (full_name, first_name, donor_type) "
                       "VALUES ('Hye-jin Park', 'Hye-jin', 'individual')").lastrowid
    for d, status in CHARGES:
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, 40, ?, ?, ?)",
                     (pid, d, "Recurring card" if status == "ok" else "Declined card", status))
    conn.commit()
    yield conn, pid
    conn.close()


def test_get_person_moves_declined_charges_out_of_gifts(park):
    from service import chat_agent, routes_data
    conn, pid = park
    person = chat_agent.person_record(routes_data.get_donor(pid, conn))
    assert [g["gift_date"] for g in person["gifts"]] == [d for d, s in CHARGES if s == "ok"][::-1] or \
           sorted(g["gift_date"] for g in person["gifts"]) == [d for d, s in CHARGES if s == "ok"]
    assert [g["gift_date"] for g in person["declined_charges"]] == ["2026-10-10"]
    assert len(routes_data.get_donor(pid, conn)["gifts"]) == 5                    # the UI route is unchanged


def test_gave_via_ignores_a_declined_charge(park):
    from service import chat_agent
    _, pid = park
    assert chat_agent.gave_via_ids("declined card") == set()                     # only the declined row has it
    assert chat_agent.gave_via_ids("recurring") == {pid}


def test_ask_does_not_count_a_declined_charge_as_giving(park):
    from service import ask_agent
    conn, pid = park
    october = ask_agent.AskFilter(gave_between=ask_agent.DateRange(start="2026-10-01", end="2026-10-31"))
    assert pid not in {r["id"] for r in ask_agent.apply_filter(conn, october, AS_OF)}
    september = ask_agent.AskFilter(gave_between=ask_agent.DateRange(start="2026-09-01", end="2026-09-30"))
    assert pid in {r["id"] for r in ask_agent.apply_filter(conn, september, AS_OF)}


def test_a_model_draft_that_thanks_the_declined_charge_is_flagged(park, monkeypatch):
    """The scorecard's exact failure, with a stubbed model: the post-check flags it, so it can't be approved."""
    from service import routes_campaigns as rc
    conn, pid = park
    donor, gifts, why, research = rc.load_donor(conn, pid)
    monkeypatch.setattr(ca, "model_write", lambda *a, **k: (
        "Thank you, Hye-jin", "Thank you for giving $40 each month, June\u2013October. It means a lot.", []))
    d = ca.draft_message(donor, gifts, why, research, [], "thank_you", "email", today=AS_OF, use_model=True)
    assert d.drafted_by == "model" and any("October 10 charge was declined" in f for f in d.flags)
    monkeypatch.setattr(ca, "model_write", lambda *a, **k: (
        "Thank you, Hye-jin", "Thank you for giving $40 each month, June\u2013September.", []))
    ok = ca.draft_message(donor, gifts, why, research, [], "thank_you", "email", today=AS_OF, use_model=True)
    assert not any("declined" in f for f in ok.flags)
