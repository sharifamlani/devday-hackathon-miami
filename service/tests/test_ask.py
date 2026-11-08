"""Ask Donor Desk (issue #36): apply_filter, the rules fallback, and POST /ask with the model mocked.

No network: Runner.run and trace are replaced in every route test that has a "key".
"""

import asyncio
import contextlib
import json
from datetime import date

import agents
import pytest
from fastapi.testclient import TestClient

from service import config, db, routes_ask, score
from service.tests.fixtures_seed import seed
from service.ask_agent import (EXAMPLE_QUESTIONS, AskFilter, AskIntent, AskPlan, DateRange, apply_filter,
                               build_agent, calendar_for, rules_plan, snapshot_examples)
from service.main import app
from service.tests.conftest import AS_OF

QUARTER_THANKS, GONE_QUIET, MONTHLY_LATE, BIG_NOT_CALLED = EXAMPLE_QUESTIONS

# Seed ids (service/tests/fixtures_seed.py SEED_DONORS order): 1 Maria Delgado, 2 María Delgado-Ruiz, 3 James Carter,
# 4 Biscayne Harbor, 5 Robert Nguyen, 6 Angela Brooks, 7 Luis Herrera, 8 Priya Shah, 9 Knight Foundation,
# 10 Amazon, 11 DeLuca Foundation, 12 McDermott Will & Schulte
SEED_EXPECTED = {
    # gave Oct 1 - Nov 7, 2026: Knight $50,000 (Oct 5), James Carter $50 (Oct 15); biggest total first
    QUARTER_THANKS: [9, 3],
    # overdue vs cadence or missed their usual month, by score. Luis Herrera (December giver, window next
    # month) is not quiet; Priya Shah and the on-track orgs are not either
    GONE_QUIET: [1, 12, 5, 2, 6],
    # the only monthly donor, James Carter, gave 23 days ago: nobody is late
    MONTHLY_LATE: [],
    # every big-tier donor; the seed has no approved or sent outreach
    BIG_NOT_CALLED: [11, 4, 9, 10],
}


@pytest.fixture
def seeded(conn):
    seed(conn)
    score.run(conn, AS_OF)
    return conn


@pytest.fixture
def answer_key_db(conn):
    """data/sample_inputs/answer_key.json's 33 canonical donors and every gift, scored as of its as_of."""
    key = json.loads((db.REPO_ROOT / "data" / "sample_inputs" / "answer_key.json").read_text(encoding="utf-8"))
    ids = {}
    for donor in key["canonical_donors"]:
        gifts = [(g["amount"], g["gift_date"], g["channel"]) for g in key["gifts"] if g["donor_id"] == donor["donor_id"]]
        ids[db.insert_donor(conn, {**donor, "gifts": gifts})] = donor["donor_id"]
    conn.commit()
    as_of = date.fromisoformat(key["as_of"])
    score.run(conn, as_of)
    return conn, ids, as_of, key


def ids_for(conn, question, as_of):
    plan = rules_plan(question, as_of)
    assert plan is not None
    return [r["id"] for r in apply_filter(conn, plan.filter, as_of)]


@pytest.mark.parametrize("question", EXAMPLE_QUESTIONS)
def test_example_questions_on_the_seed(seeded, question):
    assert ids_for(seeded, question, AS_OF) == SEED_EXPECTED[question]


def test_example_questions_against_the_answer_key(answer_key_db):
    conn, ids, as_of, key = answer_key_db

    def keys(question):
        return [ids[i] for i in ids_for(conn, question, as_of)]

    quiet = keys(GONE_QUIET)
    assert {c["donor_id"] for c in key["expected_top3_lapsing_as_of_2026_11_08"]} <= set(quiet)
    # not_lapsing_examples: Robert Nguyen (monthly, on track), Priya Raman (gave Nov 2026), Gloria (December)
    assert not {"D02", "D08", "D07"} & set(quiet)

    thanks = keys(QUARTER_THANKS)
    # Everyone with a gift dated Oct 1 to Nov 7 in the key: Priya Raman's Nov 2 check, Robert Nguyen's and
    # Rafael Quintero's monthly gifts, plus the donors in online_gifts_oct_nov_2026.xlsx.
    q4 = {g["donor_id"] for g in key["gifts"] if "2026-10-01" <= g["gift_date"] <= "2026-11-07"}
    assert {"D08", "D02", "D19"} < q4
    assert set(thanks) == q4
    assert keys(MONTHLY_LATE) == []                # the one monthly donor (D02) is on track
    big = keys(BIG_NOT_CALLED)
    assert "D27" in big                            # Veloria Bay Foundation, the star
    rows = {r["id"]: r for r in apply_filter(conn, AskFilter(), as_of)}
    assert all(rows[i]["tier"] == "big" for i, k in ids.items() if k in big)


def test_rules_read_each_example_into_an_intent():
    intents = {q: rules_plan(q, AS_OF).intent for q in EXAMPLE_QUESTIONS}
    assert intents[QUARTER_THANKS] == AskIntent(kind="thank_you", channel_hint="email")
    assert intents[GONE_QUIET].kind == "re_engage"
    assert intents[MONTHLY_LATE].kind == "check_in"
    assert intents[BIG_NOT_CALLED].kind == "check_in"
    thanks = rules_plan(QUARTER_THANKS, AS_OF)
    assert thanks.filter.gave_between == DateRange(start="2026-10-01", end="2026-11-07")
    assert "(Oct 1 to Nov 7, 2026)" in thanks.interpretation
    assert rules_plan("Who gave on Give Miami Day 2024?", AS_OF) is None
    assert rules_plan("big donors we haven’t CALLED   this quarter", AS_OF).filter.tier == ["big"]


def test_calendar_resolves_quarters_and_the_november_push():
    cal = calendar_for(date(2026, 11, 8))
    assert cal["this_quarter"] == {"label": "Q4 2026", "start": "2026-10-01", "end": "2026-12-31"}
    assert cal["last_quarter"] == {"start": "2026-07-01", "end": "2026-09-30"}
    assert cal["november_push"]["give_miami_day"] == "2026-11-19"
    assert calendar_for(date(2026, 2, 3))["last_quarter"] == {"start": "2025-10-01", "end": "2025-12-31"}
    assert calendar_for(date(2026, 2, 3))["this_month"]["end"] == "2026-02-28"


def test_filter_fields(seeded):
    def ids(**spec):
        return [r["id"] for r in apply_filter(seeded, AskFilter(**spec), AS_OF)]

    assert ids(star=True) == [11, 4]
    assert set(ids(star=False)) == set(range(1, 13)) - {11, 4}
    assert ids(donor_type="organization", sort="name") == [10, 4, 11, 9, 12]
    assert ids(channel=["give miami day"]) == [1]
    assert ids(cadence="quarterly") == [5]
    assert ids(cadence="one_time", sort="name") == [6, 2, 8]
    assert ids(status=["lapsed"]) == [2, 6]
    assert ids(tier=["small"], sort="last_gift_oldest") == [6, 2, 8]
    assert ids(last_gift_before="2020-01-01") == [6]
    assert ids(last_gift_after="2026-10-01", sort="last_gift_recent") == [3, 9]
    # amounts look only at the gave_between window when one is set
    window = DateRange(start="2026-01-01", end="2026-12-31")
    assert ids(gave_between=window, min_total=300_000) == [11, 4]
    assert ids(gave_between=window, min_total=400_000) == [4]
    assert ids(gave_between=window, min_gift=450_000) == [4]
    assert ids(gave_between=window, max_gift=100, sort="name") == [3]
    assert ids(min_total=1_000_000) == [11, 4]     # lifetime, by score
    assert ids(sort="score", limit=2) == [1, 7]
    assert ids(limit=0) == [1]                     # clamped to at least 1


def test_only_approved_or_sent_outreach_counts_as_contact(seeded):
    rows = [(11, "approved", "2026-10-02 09:00:00", "2026-10-20T10:00:00+00:00"),   # approved this quarter
            (4, "approved", "2026-09-01 09:00:00", "2026-09-02T10:00:00+00:00"),    # last quarter
            (9, "draft", "2026-10-20 09:00:00", None)]                              # never acted on
    for donor_id, status, created_at, approved_at in rows:
        seeded.execute("INSERT INTO outreach_drafts (donor_id, channel, body, status, created_at, approved_by, "
                       "approved_at) VALUES (?, 'email', 'Hello', ?, ?, ?, ?)",
                       (donor_id, status, created_at, approved_at and "Staff", approved_at))
    seeded.commit()
    assert ids_for(seeded, BIG_NOT_CALLED, AS_OF) == [4, 9, 10]   # only DeLuca was contacted since Oct 1
    assert [r["id"] for r in apply_filter(seeded, AskFilter(has_draft=True), AS_OF)] == [11, 4, 9]
    assert [r["id"] for r in apply_filter(seeded, AskFilter(has_draft=False, tier=["big"]), AS_OF)] == [10]


def test_gifts_after_as_of_are_ignored(seeded):
    seeded.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel) VALUES (6, 900, '2026-12-01', 'online')")
    seeded.commit()
    rows = apply_filter(seeded, AskFilter(gave_between=DateRange(start="2026-10-01")), AS_OF)
    assert 6 not in [r["id"] for r in rows]


def test_rows_match_get_donors_plus_ask(seeded):
    from service.routes_data import list_donors

    by_id = {r["id"]: r for r in list_donors(seeded)}
    for row in apply_filter(seeded, rules_plan(QUARTER_THANKS, AS_OF).filter, AS_OF):
        ask = row.pop("ask")
        assert row == by_id[row["id"]]
        assert ask["period_gifts"] >= 1
    knight = apply_filter(seeded, rules_plan(QUARTER_THANKS, AS_OF).filter, AS_OF)[0]
    assert knight["ask"] == {"period_total": 50000.0, "period_gifts": 1, "last_gift_date": "2026-10-05"}


def test_agent_is_read_only_and_its_schema_is_strict():
    agent = build_agent(AS_OF, None)
    assert agent.tools == [] and agent.handoffs == [] and agent.output_type is AskPlan
    assert "2026-10-01" in agent.instructions         # this quarter, resolved
    schema = agents.AgentOutputSchema(AskPlan, strict_json_schema=True).json_schema()
    assert schema["additionalProperties"] is False
    assert "AskFilter" in json.dumps(schema)


def test_snapshot_examples_use_the_rules(seeded):
    examples = snapshot_examples(seeded, AS_OF.isoformat())
    assert [e["question"] for e in examples] == EXAMPLE_QUESTIONS
    assert {e["question"]: e["donor_ids"] for e in examples} == SEED_EXPECTED
    assert all(e["served_from"] == "rules" for e in examples)
    assert AskFilter(**examples[0]["filter"]).gave_between.start == "2026-10-01"


# ---------------------------------------------------------------------------------------------- route

@pytest.fixture(autouse=True)
def empty_cache():
    routes_ask._model_cache.clear()
    yield
    routes_ask._model_cache.clear()


@pytest.fixture
def client(db_file):
    return TestClient(app)


class FakeResult:
    def __init__(self, plan):
        self.plan = plan

    def final_output_as(self, cls, raise_if_incorrect_type=False):
        assert cls is AskPlan
        return self.plan


@pytest.fixture
def fake_model(monkeypatch):
    """A 'key' plus a Runner.run that returns a canned AskPlan; records what the agent was given."""
    calls = []

    @contextlib.contextmanager
    def fake_trace(name, metadata=None, **_):
        yield type("T", (), {"trace_id": "trace_test123"})()

    def install(plan=None, error=None, delay=0.0):
        async def run(agent, question, **_):
            calls.append({"agent": agent, "question": question})
            if delay:
                await asyncio.sleep(delay)
            if error:
                raise error
            return FakeResult(plan)

        monkeypatch.setattr(config, "HAS_OPENAI_KEY", True)
        monkeypatch.setattr(agents.Runner, "run", run)
        monkeypatch.setattr(agents, "trace", fake_trace)
        return calls

    return install


def db_counts():
    conn = db.connect()
    try:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in db.TABLES}
    finally:
        conn.close()


def test_route_without_a_key_answers_the_examples_by_rules(client, monkeypatch):
    monkeypatch.setattr(config, "HAS_OPENAI_KEY", False)
    before = db_counts()
    for question, expected in SEED_EXPECTED.items():
        body = client.post("/ask", json={"question": question}).json()
        assert body["served_from"] == "rules" and body["understood"] is True
        assert body["donor_ids"] == expected == [d["id"] for d in body["donors"]]
        assert body["trace_id"] is None and "OPENAI_API_KEY" in body["detail"]
        assert body["as_of"] == AS_OF.isoformat()
    assert db_counts() == before                       # read-only
    thanks = client.post("/ask", json={"question": QUARTER_THANKS}).json()
    assert thanks["next_action"] == {"label": "Draft thank-you notes for these 2",
                                     "intent": {"kind": "thank_you", "channel_hint": "email"}, "donor_ids": [9, 3]}
    assert client.post("/ask", json={"question": MONTHLY_LATE}).json()["next_action"] is None


def test_route_free_text_without_a_key_is_not_understood(client, monkeypatch):
    monkeypatch.setattr(config, "HAS_OPENAI_KEY", False)
    body = client.post("/ask", json={"question": "Who gave on Give Miami Day 2024?"}).json()
    assert body["understood"] is False and body["donors"] == [] and body["served_from"] == "rules"


def test_route_uses_the_model_plan_and_plain_code(client, fake_model):
    plan = AskPlan(interpretation="Star donors, by score.", filter=AskFilter(star=True),
                   intent=AskIntent(kind="check_in"))
    calls = fake_model(plan)
    body = client.post("/ask", json={"question": "Who are our stars?"}).json()
    assert body["served_from"] == "model" and body["trace_id"] == "trace_test123"
    assert body["donor_ids"] == [11, 4] and body["interpretation"] == "Star donors, by score."
    assert calls[0]["question"] == "Who are our stars?"
    assert calls[0]["agent"].tools == [] and calls[0]["agent"].output_type is AskPlan

    again = client.post("/ask", json={"question": "  who are our STARS? "}).json()
    assert again["served_from"] == "cache" and again["trace_id"] == "trace_test123"
    assert again["donor_ids"] == [11, 4] and len(calls) == 1


@pytest.mark.parametrize("failure", ["error", "timeout"])
def test_route_falls_back_to_rules_when_the_model_fails(client, fake_model, monkeypatch, failure):
    if failure == "timeout":
        monkeypatch.setattr(routes_ask, "ASK_DEADLINE_S", 0.05)
        fake_model(AskPlan(interpretation="x", filter=AskFilter(), intent=AskIntent(kind="check_in")), delay=1.0)
    else:
        fake_model(error=RuntimeError("boom"))
    body = client.post("/ask", json={"question": GONE_QUIET}).json()
    assert body["served_from"] == "rules" and body["donor_ids"] == SEED_EXPECTED[GONE_QUIET]
    assert ("longer than" if failure == "timeout" else "RuntimeError") in body["detail"]
    assert routes_ask._model_cache == {}               # a failure is never cached


def test_route_applies_an_edited_filter_without_the_model(client, fake_model):
    calls = fake_model(error=AssertionError("the model must not run for an edited filter"))
    edited = rules_plan(GONE_QUIET, AS_OF).filter.model_copy(update={"tier": ["small"]})
    body = client.post("/ask", json={"question": GONE_QUIET, "filter": edited.model_dump(),
                                     "intent": {"kind": "re_engage", "channel_hint": "text"}}).json()
    assert body["served_from"] == "edited" and calls == []
    assert body["donor_ids"] == [2, 6]
    assert body["intent"] == {"kind": "re_engage", "channel_hint": "text"}


def test_route_rejects_a_bad_filter(client):
    assert client.post("/ask", json={"question": "x", "filter": {"last_gift_before": "last week"}}).status_code == 422
    assert client.post("/ask", json={"question": "x", "filter": {"tier": ["huge"]}}).status_code == 422
    assert client.post("/ask", json={"question": ""}).status_code == 422
