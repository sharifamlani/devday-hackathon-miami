"""deliver(): the only way an approved message leaves the service. Email or text, dry run by default.

Email goes out through the Gmail API only when EMAIL_SEND=on, using an authorized-user token file
(GMAIL_TOKEN_PATH: JSON with client_id, client_secret, refresh_token; never committed). Otherwise it is a
dry run. Texts go through sms.send_sms (SMS_PROVIDER). Callers only reach this after a human approved
the message (campaign approval rules); the chat agent has no tool that calls it.
"""
import base64
import json
import os
from email.message import EmailMessage
from pathlib import Path

import httpx

from service.sms import send_sms

TOKEN_URL = "https://oauth2.googleapis.com/token"
SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


def email_enabled() -> bool:
    return (os.getenv("EMAIL_SEND") or "").strip().lower() == "on"


def gmail_access_token() -> str:
    token = json.loads(Path(os.environ["GMAIL_TOKEN_PATH"]).read_text(encoding="utf-8"))
    r = httpx.post(TOKEN_URL, data={"client_id": token["client_id"], "client_secret": token["client_secret"],
                                    "refresh_token": token["refresh_token"], "grant_type": "refresh_token"},
                   timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def send_email(to: str, subject: str | None, body: str) -> dict:
    """Send (or dry-run) one email. Returns {channel, provider, status, simulated, provider_id, detail}."""
    if not email_enabled():
        return {"channel": "email", "provider": "dryrun", "status": "queued (dry run)", "simulated": True,
                "provider_id": None, "detail": None}
    if not os.getenv("GMAIL_TOKEN_PATH"):
        return {"channel": "email", "provider": "dryrun", "status": "queued (dry run)", "simulated": True,
                "provider_id": None, "detail": "EMAIL_SEND=on but GMAIL_TOKEN_PATH is not set"}
    msg = EmailMessage()
    msg["To"], msg["Subject"] = to, subject or ""
    msg.set_content(body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    try:
        r = httpx.post(SEND_URL, headers={"Authorization": f"Bearer {gmail_access_token()}"},
                       json={"raw": raw}, timeout=30)
        r.raise_for_status()
    except (httpx.HTTPError, KeyError, OSError, ValueError) as e:
        return {"channel": "email", "provider": "gmail", "status": f"failed: {type(e).__name__}",
                "simulated": False, "provider_id": None, "detail": str(e)[:300]}
    return {"channel": "email", "provider": "gmail", "status": "sent", "simulated": False,
            "provider_id": r.json().get("id"), "detail": None}


def allowlist() -> set[str]:
    """SEND_ALLOWLIST: comma-separated emails / phone numbers a LIVE send may reach (case-insensitive;
    phones compared on digits). Empty or unset = no live sends at all."""
    return {_norm(x) for x in (os.getenv("SEND_ALLOWLIST") or "").split(",") if x.strip()}


def _norm(addr: str) -> str:
    addr = addr.strip().lower()
    digits = "".join(ch for ch in addr if ch.isdigit())
    return digits[-10:] if "@" not in addr and len(digits) >= 7 else addr


def live_requested(channel: str) -> bool:
    if channel == "email":
        return email_enabled()
    return (os.getenv("SMS_PROVIDER") or "dryrun").strip().lower() not in ("", "dryrun")


def deliver(channel: str, to: str, subject: str | None, body: str) -> dict:
    """channel 'email' | 'text' → the matching adapter.

    Safety: a live provider is only used for recipients on SEND_ALLOWLIST. Everyone else gets a dry run,
    so a real Twilio/Gmail account can never reach sample or real donors by accident during a demo."""
    if live_requested(channel) and _norm(to) not in allowlist():
        return {"channel": "email" if channel == "email" else "sms", "provider": "dryrun",
                "status": "queued (dry run)", "simulated": True, "provider_id": None,
                "detail": "recipient not on SEND_ALLOWLIST; live send skipped"}
    return send_email(to, subject, body) if channel == "email" else send_sms(to, body)
