"""Score correctness on hand-built histories (plan §8/§9: the lapsing Give Miami Day giver ranks #1)."""

from datetime import date

from service import db, score
from service.tests.conftest import AS_OF

GMD_YEARS = [("2022-11-17"), ("2023-11-16"), ("2024-11-21"), ("2025-11-20")]


def gifts(*pairs, channel="online"):
    return [{"amount": a, "gift_date": d, "channel": channel} for a, d in pairs]


def test_lapsing_give_miami_day_giver_is_lapsing_with_seasonal_why():
    r = score.score_donor(gifts(*[(2500, d) for d in GMD_YEARS], channel="Give Miami Day"), AS_OF)
    assert r["status"] == "lapsing"
    assert "missed_seasonal_window" in r["why"]["reasons"]
    assert r["why"]["pattern"]["month_name"] == "November"
    assert r["why"]["pattern"]["channel"] == "Give Miami Day"
    assert r["why"]["pattern"]["gave_this_year"] is False
    assert r["why"]["give_miami_day"] == {"date": "2026-11-19", "days_away": 12}
    assert r["score"] >= 80


def test_same_donor_who_already_gave_this_year_is_on_track_and_low():
    history = [(2500, d) for d in GMD_YEARS] + [(2500, "2026-11-02")]
    r = score.score_donor(gifts(*history, channel="Give Miami Day"), AS_OF)
    assert r["status"] == "on_track"
    assert r["score"] < 50


def test_lapsing_gmd_giver_ranks_first_on_seed_and_on_track_ranks_below_every_lapsing(conn):
    db.seed(conn)
    score.run(conn, AS_OF)
    ranked = conn.execute(
        "SELECT d.full_name, s.score, s.status FROM donor_scores s JOIN donors d ON d.id = s.donor_id "
        "ORDER BY s.score DESC").fetchall()
    assert ranked[0]["full_name"] == "Maria Delgado"
    assert ranked[0]["status"] == "lapsing"

    lapsing = [r["score"] for r in ranked if r["status"] == "lapsing"]
    on_track = [r for r in ranked if r["status"] == "on_track"]
    assert lapsing and on_track
    carter = next(r for r in ranked if r["full_name"] == "James Carter")
    assert carter["status"] == "on_track"
    assert carter["score"] < 50
    assert all(r["score"] < min(lapsing) for r in on_track)


def test_overdue_quarterly_donor_is_lapsing():
    r = score.score_donor(gifts((500, "2025-10-10"), (500, "2026-01-12"), (500, "2026-04-09")), AS_OF)
    assert r["status"] == "lapsing"
    assert "overdue_vs_cadence" in r["why"]["reasons"]
    assert 80 <= r["why"]["usual_cadence_days"] <= 100


def test_long_lapsed_single_gift_scores_low():
    r = score.score_donor(gifts((100, "2019-05-03")), AS_OF)
    assert r["status"] == "lapsed"
    assert r["why"]["cadence_basis"] == "assumed_yearly"
    assert r["score"] < 35


def test_no_gifts_scores_zero():
    r = score.score_donor([], AS_OF)
    assert (r["score"], r["status"], r["tier"], r["is_star"]) == (0, "no_gifts", "small", False)


def test_tiers_and_star():
    star = score.score_donor(gifts((600_000, "2025-09-09"), (450_000, "2026-09-08")), AS_OF)
    assert star["tier"] == "big" and star["is_star"] is True
    assert "shack_society_level" in star["why"]["reasons"]
    assert score.score_donor(gifts((12_000, "2026-01-01")), AS_OF)["tier"] == "big"      # one big gift
    assert score.score_donor(gifts((900, "2025-01-01"), (900, "2026-01-01")), AS_OF)["tier"] == "mid"
    assert score.score_donor(gifts((50, "2026-01-01")), AS_OF)["tier"] == "small"
    assert score.score_donor(gifts((999_999, "2026-01-01")), AS_OF)["is_star"] is False


def test_future_gifts_are_ignored():
    r = score.score_donor(gifts((100, "2026-10-01"), (5000, "2026-12-01")), AS_OF)
    assert r["why"]["gift_count"] == 1 and r["why"]["lifetime_total"] == 100


def test_deterministic_and_bounded(conn):
    db.seed(conn)
    score.run(conn, AS_OF)
    first = [tuple(r) for r in conn.execute("SELECT donor_id, score, tier, is_star, status, why FROM donor_scores")]
    score.run(conn, AS_OF)
    second = [tuple(r) for r in conn.execute("SELECT donor_id, score, tier, is_star, status, why FROM donor_scores")]
    assert first == second
    assert all(0 <= r[1] <= 100 for r in first)


def test_points_add_up_to_score():
    r = score.score_donor(gifts(*[(2500, d) for d in GMD_YEARS]), AS_OF)
    assert abs(sum(r["why"]["points"].values()) - r["score"]) <= 0.5


def test_default_as_of_respects_env(monkeypatch):
    monkeypatch.setenv("SCORE_AS_OF", "2026-11-09")
    assert score.default_as_of() == date(2026, 11, 9)


def test_default_as_of_is_demo_day_and_give_miami_day_is_computed(monkeypatch):
    monkeypatch.delenv("SCORE_AS_OF", raising=False)
    assert score.default_as_of() == date(2026, 11, 8)
    r = score.score_donor(gifts(*[(2500, d) for d in GMD_YEARS]), score.default_as_of())
    assert r["why"]["give_miami_day"] == {"date": "2026-11-19", "days_away": 11}
    assert r["status"] == "lapsing"
