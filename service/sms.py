"""send_sms(): one adapter for texting, so the provider can change late (plan.md §17).

SMS_PROVIDER = dryrun (default) | twilio | linq
- dryrun: nothing leaves the laptop; status "queued (dry run)".
- twilio: Twilio REST API with TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER from .env.
- linq: not wired yet (no API contract in this repo); reported as a dry run, never faked as sent.
Missing credentials always fall back to a dry run. Callers only reach this after a human approved the message.
"""
import os

import httpx

TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"


def provider() -> str:
    return (os.getenv("SMS_PROVIDER") or "dryrun").strip().lower()


def dry_run(to: str, body: str, why: str | None = None) -> dict:
    return {"channel": "sms", "provider": "dryrun", "status": "queued (dry run)", "simulated": True,
            "provider_id": None, "detail": why}


def send_sms(to: str, body: str) -> dict:
    """Send (or dry-run) one text. Returns {channel, provider, status, simulated, provider_id, detail}."""
    chosen = provider()
    if chosen == "twilio":
        sid, token, sender = (os.getenv("TWILIO_ACCOUNT_SID"), os.getenv("TWILIO_AUTH_TOKEN"),
                              os.getenv("TWILIO_PHONE_NUMBER"))
        if not (sid and token and sender):
            return dry_run(to, body, "twilio credentials missing")
        try:
            r = httpx.post(TWILIO_URL.format(sid=sid), auth=(sid, token),
                           data={"To": to, "From": sender, "Body": body}, timeout=30)
        except httpx.HTTPError as e:
            return {"channel": "sms", "provider": "twilio", "status": f"failed: {type(e).__name__}",
                    "simulated": False, "provider_id": None, "detail": str(e)}
        if r.status_code >= 400:
            return {"channel": "sms", "provider": "twilio", "status": f"failed: HTTP {r.status_code}",
                    "simulated": False, "provider_id": None, "detail": r.text[:300]}
        return {"channel": "sms", "provider": "twilio", "status": "sent", "simulated": False,
                "provider_id": r.json().get("sid"), "detail": None}
    if chosen == "linq":
        return dry_run(to, body, "linq adapter not wired yet")
    return dry_run(to, body)
