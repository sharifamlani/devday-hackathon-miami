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
    assert 1 <= r.INVITE_WORKERS_FLOOR <= r.INVITE_WORKERS <= 16


def test_concurrency_never_exceeds_the_gate(monkeypatch):
    import threading
    import time as _time

    monkeypatch.setattr(r, "INVITE_WORKERS", 3)
    monkeypatch.setattr(r, "INVITE_WORKERS_FLOOR", 2)
    people = [{"id": i, "full_name": f"Giver {i}", "contact_type": "giver"} for i in range(10)]
    lock, active, peak = threading.Lock(), [0], [0]

    def invite(e, p):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        _time.sleep(0.05)
        with lock:
            active[0] -= 1
        return {"subject": "s", "email_body": "b", "sms": "t"}

    out = r.draft_invites_for(sqlite3.connect(":memory:"), [GMD], {}, False, people, audience=everyone,
                              invite=invite, save=lambda *a: None)
    assert out["drafted"] == 10 and peak[0] <= 3
    assert out["stats"]["calls"] == 10 and out["stats"]["concurrency"] == [3, 3]


def test_a_429_lowers_concurrency_to_the_floor_and_the_batch_still_drafts(monkeypatch):
    import threading
    import time as _time

    no_wait(monkeypatch)
    monkeypatch.setattr(r, "INVITE_WORKERS", 4)
    monkeypatch.setattr(r, "INVITE_WORKERS_FLOOR", 2)
    people = [{"id": i, "full_name": f"Giver {i}", "contact_type": "giver"} for i in range(12)]
    lock, active, peak_after, hit = threading.Lock(), [0], [0], []

    def invite(e, p):
        with lock:
            if not hit and p["id"] == 0:
                hit.append(True)
                raise RateLimitError("Rate limit reached")
            active[0] += 1
            if hit:
                peak_after[0] = max(peak_after[0], active[0])
        _time.sleep(0.05)
        with lock:
            active[0] -= 1
        return {"subject": "s", "email_body": "b", "sms": "t"}

    out = r.draft_invites_for(sqlite3.connect(":memory:"), [GMD], {}, False, people, audience=everyone,
                              invite=invite, save=lambda *a: None)
    assert out["drafted"] == 12 and out["errors"] == []
    assert out["stats"]["concurrency"] == [4, 2] and out["stats"]["retries"] == {"429": 1}


def test_per_event_caps_the_invites_drafted():
    people = [{"id": i, "full_name": f"Giver {i}", "contact_type": "giver"} for i in range(10)]
    out = r.draft_invites_for(sqlite3.connect(":memory:"), [GMD], {}, False, people, audience=everyone,
                              invite=lambda e, p: {"subject": "s", "email_body": "b", "sms": "t"},
                              save=lambda *a: None, per_event=4)
    assert out["attempted"] == 4 and out["drafted"] == 4


def test_setup_invites_use_the_setup_cap_and_a_0_of_n_handoff_fails(db_file, monkeypatch):
    from service import config, main
    from service import refresh as service_refresh

    seen = []

    def none_drafted(conn, events, ids, stored, people=None, **k):
        seen.append(k.get("per_event"))
        return {"drafts": {"Give Miami Day": 0}, "attempted": 3, "drafted": 0,
                "errors": ["invite Give Miami Day -> 1: RateLimitError [429]: slow down"], "stats": {}}

    monkeypatch.setattr(service_refresh, "draft_invites_for", none_drafted)
    with main.REFRESH_LOCK:
        main.PENDING_INVITES[:] = [([GMD], {}, False)]
    changes, error = main.pending_invites({"facts": {"added": 1}})
    assert seen == [config.SETUP_DRAFTS_PER_EVENT]
    assert error.startswith("onboarding invites: 0 of 3 invites drafted") and "[429]" in error
    assert changes["onboarding_invites"]["drafted"] == 0 and changes["facts"] == {"added": 1}

    main.invites_job([GMD], {}, False)                        # the fast path's job: same cap, same failure rule
    assert seen[-1] == config.SETUP_DRAFTS_PER_EVENT
    assert main.refresh_job_state()["status"] == "failed"
    with main.REFRESH_LOCK:                                   # leave the shared job as other tests expect it
        main.REFRESH_JOB.update(status="idle", detail=None, changes=None)


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
