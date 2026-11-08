"""sms.send_sms / outbound.deliver and the campaign send hook. No test reaches a real provider:
every HTTP call is replaced, and the default (no env) is a dry run."""

import httpx
import pytest
from fastapi.testclient import TestClient

from service import campaign_agent as ca
from service import outbound, sms
from service.main import app


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("a test reached the network")
    monkeypatch.setattr(httpx, "post", refuse)
    monkeypatch.setattr(ca, "model_write", refuse)
    monkeypatch.setenv("CAMPAIGN_DRAFTER", "template")
    for var in ("SMS_PROVIDER", "EMAIL_SEND", "GMAIL_TOKEN_PATH", "SEND_ALLOWLIST"):
        monkeypatch.delenv(var, raising=False)


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code, self._payload, self.text = status_code, payload, str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad", request=None, response=None)


def test_default_is_a_dry_run_for_both_channels():
    assert sms.send_sms("+13055550101", "hi")["status"] == "queued (dry run)"
    assert outbound.deliver("email", "a@example.com", "s", "b") == {
        "channel": "email", "provider": "dryrun", "status": "queued (dry run)", "simulated": True,
        "provider_id": None, "detail": None}


def test_twilio_without_credentials_falls_back_to_dry_run(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    for var in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"):
        monkeypatch.delenv(var, raising=False)
    r = sms.send_sms("+13055550101", "hi")
    assert r["simulated"] is True and r["detail"] == "twilio credentials missing"


def test_twilio_with_credentials_posts_once(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC1")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+13055550000")
    calls = []
    monkeypatch.setattr(httpx, "post", lambda url, **kw: calls.append((url, kw["data"])) or FakeResponse(201, {"sid": "SM9"}))

    r = sms.send_sms("+13055550101", "hi")

    assert r == {"channel": "sms", "provider": "twilio", "status": "sent", "simulated": False,
                 "provider_id": "SM9", "detail": None}
    assert calls == [("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json",
                      {"To": "+13055550101", "From": "+13055550000", "Body": "hi"})]


def test_linq_is_reported_as_dry_run_not_sent(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "linq")
    r = sms.send_sms("+13055550101", "hi")
    assert r["simulated"] is True and r["status"] == "queued (dry run)"


def test_email_on_without_token_stays_dry_run(monkeypatch):
    monkeypatch.setenv("EMAIL_SEND", "on")
    assert outbound.send_email("a@example.com", "s", "b")["provider"] == "dryrun"


def test_campaign_send_logs_dry_run_rows_with_provider(db_file):
    c = TestClient(app)
    camp = c.post("/campaigns", json={"donor_ids": [1, 3], "intent": "check_in", "channel": "email"}).json()
    c.post(f"/campaigns/{camp['id']}/approve-small", json={"approved_by": "Test approver"})

    r = c.post(f"/campaigns/{camp['id']}/send").json()

    assert r["sent"] == 2 and r["simulated"] is True and r["failed"] == []
    rows = c.get("/outbox", params={"campaign_id": camp["id"]}).json()
    assert {(o["provider"], o["delivery_status"], o["simulated"]) for o in rows} == {("dryrun", "queued (dry run)", True)}


def test_failed_delivery_is_not_marked_sent(db_file, monkeypatch):
    monkeypatch.setattr(outbound, "deliver", lambda *a: {"provider": "twilio", "status": "failed: HTTP 400",
                                                          "simulated": False, "provider_id": None, "detail": "x"})
    c = TestClient(app)
    camp = c.post("/campaigns", json={"donor_ids": [1], "intent": "check_in", "channel": "email"}).json()
    c.post(f"/campaigns/{camp['id']}/approve-small", json={"approved_by": "Test approver"})

    r = c.post(f"/campaigns/{camp['id']}/send").json()

    assert r["sent"] == 0 and r["failed"][0]["reason"] == "failed: HTTP 400"
    assert c.get("/outbox", params={"campaign_id": camp["id"]}).json() == []
    assert c.get(f"/campaigns/{camp['id']}").json()["messages"][0]["status"] == "approved"


def test_live_send_skips_recipients_not_on_the_allowlist(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC1")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+13055550000")
    # no allowlist: nothing goes out, and the network is never touched (autouse fixture would raise)
    r = outbound.deliver("text", "+13055550101", None, "hi")
    assert r["provider"] == "dryrun" and r["simulated"] and "SEND_ALLOWLIST" in r["detail"]
    monkeypatch.setenv("SEND_ALLOWLIST", "me@example.com, (305) 555-0199")
    assert outbound.deliver("text", "+13055550101", None, "hi")["provider"] == "dryrun"
    monkeypatch.setenv("EMAIL_SEND", "on")
    assert outbound.deliver("email", "someone@example.com", "s", "b")["provider"] == "dryrun"


def test_allowlisted_recipient_reaches_the_live_adapter(monkeypatch):
    calls = []
    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    monkeypatch.setenv("SEND_ALLOWLIST", "+1 305 555 0199")
    monkeypatch.setattr(outbound, "send_sms", lambda to, body: calls.append(to) or {"provider": "twilio", "status": "sent", "simulated": False, "provider_id": "SM1"})
    r = outbound.deliver("text", "305-555-0199", None, "hi")
    assert calls == ["305-555-0199"] and r["status"] == "sent"
