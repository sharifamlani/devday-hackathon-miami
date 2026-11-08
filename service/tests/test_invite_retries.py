"""The invite batch under load: a capped pool, backoff retries on 429 / 5xx, the real error status in the log,
and a batch that drafts 0 of N reported as failed, never done (no model calls)."""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import refresh as r  # noqa: E402

GMD = {"title": "Give Miami Day", "starts_at": "2026-11-19", "ends_at": None, "place": None,
       "source_url": "https://www.givemiamiday.org/", "audience_hint": "giving"}
PEOPLE = [{"id": i, "full_name": f"Giver {i}", "contact_type": "giver"} for i in (1, 2, 3)]


class RateLimitError(Exception):
    """Shaped like openai.RateLimitError: a status_code on the exception."""
    status_code = 429


class InternalServerError(Exception):
    status_code = 500


def everyone(e, people, rationale):
    return {"person_ids": [p["id"] for p in people]}


def batch(invite):
    conn = sqlite3.connect(":memory:")
    return r.draft_invites_for(conn, [GMD], {}, False, PEOPLE, audience=everyone, invite=invite,
                               save=lambda *a: None)


def no_wait(monkeypatch):
    monkeypatch.setattr(r, "INVITE_RETRY_DELAYS_S", (0, 0, 0))


def test_a_rate_limit_is_retried_until_the_invite_drafts(monkeypatch):
    no_wait(monkeypatch)
    calls = {}

    def invite(e, p):
        calls[p["id"]] = calls.get(p["id"], 0) + 1
        if calls[p["id"]] <= 2:                                   # two 429s, then the call goes through
            raise RateLimitError("Rate limit reached for requests")
        return {"subject": "s", "email_body": "b", "sms": "t"}

    out = batch(invite)
    assert out["drafted"] == 3 and out["attempted"] == 3 and out["errors"] == []
    assert calls == {1: 3, 2: 3, 3: 3}
    assert r.invites_failed(out) is None


def test_a_persistent_429_ends_failed_with_the_status_named(monkeypatch):
    no_wait(monkeypatch)
    calls = []

    def invite(e, p):
        calls.append(p["id"])
        raise RateLimitError("Rate limit reached for requests")

    out = batch(invite)
    assert len(calls) == 3 * 4                                    # first try + 3 retries, per person
    assert out["drafted"] == 0 and out["attempted"] == 3
    assert all("RateLimitError [429]" in e for e in out["errors"])
    reason = r.invites_failed(out)
    assert reason.startswith("0 of 3 invites drafted") and "[429]" in reason


def test_a_server_error_wrapped_by_the_sdk_is_still_retried(monkeypatch):
    no_wait(monkeypatch)
    calls = []

    def invite(e, p):
        calls.append(p["id"])
        if len([c for c in calls if c == p["id"]]) == 1:
            try:
                raise InternalServerError("upstream")
            except InternalServerError as inner:                  # the SDK re-raising with the cause attached
                raise RuntimeError("Error getting response") from inner
        return {"subject": "s", "email_body": "b", "sms": "t"}

    assert batch(invite)["drafted"] == 3 and len(calls) == 6


def test_a_draft_that_fails_its_checks_is_not_retried(monkeypatch):
    no_wait(monkeypatch)
    calls = []

    def invite(e, p):
        calls.append(p["id"])
        raise ValueError("invite failed checks twice: ['names an amount']")

    out = batch(invite)
    assert len(calls) == 3 and out["drafted"] == 0
    assert "ValueError: invite failed checks twice" in out["errors"][0]


def test_some_drafted_is_not_a_failure(monkeypatch):
    no_wait(monkeypatch)

    def invite(e, p):
        if p["id"] == 1:
            raise ValueError("bad")
        return {"subject": "s", "email_body": "b", "sms": "t"}

    out = batch(invite)
    assert out["drafted"] == 2 and r.invites_failed(out) is None


def test_no_invites_to_draft_is_not_a_failure():
    assert r.invites_failed({"drafts": {}, "attempted": 0, "drafted": 0, "errors": []}) is None


def test_the_pool_is_capped():
    assert 1 <= r.INVITE_WORKERS <= 8


def test_run_refresh_reports_failed_when_no_invite_drafted(db_file, monkeypatch):
    from service import main
    from service import refresh as service_refresh

    monkeypatch.setattr(main, "org_urls", lambda conn: {"website": "https://miamifoundation.org"})
    monkeypatch.setattr(service_refresh, "refresh", lambda conn, urls: {
        "drafts": {"Give Miami Day": 0}, "errors": ["invite Give Miami Day -> 1: RateLimitError [429]: slow down"],
        "invites": {"attempted": 60, "drafted": 0, "failed": "0 of 60 invites drafted (first error: ... [429] ...)"}})
    out = main.run_refresh()
    assert out["state"] == "failed" and out["detail"].startswith("0 of 60 invites drafted")


def test_run_refresh_is_done_when_invites_drafted(db_file, monkeypatch):
    from service import main
    from service import refresh as service_refresh

    monkeypatch.setattr(main, "org_urls", lambda conn: {"website": "https://miamifoundation.org"})
    monkeypatch.setattr(service_refresh, "refresh", lambda conn, urls: {
        "drafts": {"Give Miami Day": 60}, "errors": [], "invites": {"attempted": 60, "drafted": 60, "failed": None}})
    assert main.run_refresh()["state"] == "done"
