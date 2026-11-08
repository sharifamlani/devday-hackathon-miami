"""Live checks for calling a donor from your own phone (service/phone.py). Run from the repo root.

    python scripts/smoke-twilio-call.py account                    read-only: Twilio account type, numbers, verified caller IDs
    python scripts/smoke-twilio-call.py preview --donor 3          GET /phone/preview on the running service
    python scripts/smoke-twilio-call.py call --donor 3             REAL CALL: rings STAFF_PHONE, then the donor; polls to the end
    python scripts/smoke-twilio-call.py ground --call <id>         the phone_calls row, its call note, recordings left on Twilio

The service must be running for preview/call (uvicorn service.main:app --port 8000). Exit code 0 = PASS.
Phone numbers are printed masked (***0142); credentials are never printed.
"""

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
TWILIO = "https://api.twilio.com/2010-04-01/Accounts/{sid}"


def twilio_get(path: str, **params) -> dict:
    sid, token = os.getenv("TWILIO_ACCOUNT_SID"), os.getenv("TWILIO_AUTH_TOKEN")
    if not (sid and token):
        sys.exit("FAIL: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set in .env")
    r = httpx.get(TWILIO.format(sid=sid) + path, auth=(sid, token), params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def masked(number: str | None) -> str:
    return f"***{number[-4:]}" if number else "(none)"


def account(_args) -> int:
    acct = twilio_get(".json")
    numbers = twilio_get("/IncomingPhoneNumbers.json").get("incoming_phone_numbers", [])
    ids = [i["phone_number"] for i in twilio_get("/OutgoingCallerIds.json").get("outgoing_caller_ids", [])]
    staff = os.getenv("STAFF_PHONE", "")
    staff_digits = "".join(c for c in staff if c.isdigit())[-10:]
    verified = any(i.endswith(staff_digits) for i in ids) if staff_digits else False
    print(f"account: {acct.get('type')} {acct.get('status')}")
    print(f"twilio numbers: {len(numbers)}  verified caller IDs: {[masked(i) for i in ids]}")
    print(f"STAFF_PHONE: {masked(staff_digits or None)}  verified: {verified}")
    ok = acct.get("status") == "active" and verified
    print("PASS" if ok else "FAIL: STAFF_PHONE must be a verified caller ID on an active account")
    return 0 if ok else 1


def preview(args) -> int:
    r = httpx.get(f"{args.base}/phone/preview", params={"donor_id": args.donor}, timeout=30)
    print(r.status_code, r.json())
    return 0 if r.status_code == 200 and r.json().get("ready") else 1


def call(args) -> int:
    r = httpx.post(f"{args.base}/phone/calls", json={"donor_id": args.donor}, timeout=60)
    if r.status_code != 200:
        print(f"FAIL: {r.status_code} {r.json().get('detail')}")
        return 1
    call_id, last, t0 = r.json()["id"], None, time.monotonic()
    print(f"call {call_id}: answer your phone")
    while True:
        c = httpx.get(f"{args.base}/phone/calls/{call_id}", timeout=30).json()
        state = (c["status"], c["detail"])
        if state != last:
            print(f"  {time.monotonic() - t0:6.1f}s  {c['status']:<14} {c['detail'] or ''}")
            last = state
        if c["status"] in ("done", "failed"):
            break
        time.sleep(1.5)
    if c["status"] == "failed":
        print(f"FAIL: {c['detail']}")
        return 1
    res = c["result"]
    print(f"note {c['note_id']} · {c['duration_sec']} s · {res.get('transcript_lines')} lines · summary by {res.get('summary_source')}")
    for line in res.get("summary", []):
        print(f"  • {line}")
    for a in res.get("actions", []):
        print(f"  → {a['type']}: {a['label']}")
    print("PASS")
    return 0


def ground(args) -> int:
    conn = sqlite3.connect(os.getenv("DONORS_DB", ROOT / "data" / "donors.db"))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM phone_calls WHERE id = ?", (args.call,)).fetchone()
    if row is None:
        print("FAIL: no such phone call")
        return 1
    note = conn.execute("SELECT id, destinations, json_array_length(transcript) AS lines FROM call_notes WHERE id = ?",
                        (row["note_id"],)).fetchone() if row["note_id"] else None
    left = len(twilio_get("/Recordings.json", CallSid=row["staff_call_sid"]).get("recordings", [])) \
        if row["staff_call_sid"] else 0
    print(f"phone_calls: status={row['status']} note_id={row['note_id']} duration={row['duration_sec']}s")
    print(f"call_notes: {dict(note) if note else None}")
    print(f"recordings left on Twilio: {left}")
    keep = os.getenv("PHONE_KEEP_RECORDING", "").strip() in ("1", "on", "true")
    ok = row["status"] == "done" and note is not None and note["lines"] > 0 and (keep or left == 0)
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", default="http://127.0.0.1:8000")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("account")
    for name in ("preview", "call"):
        sub.add_parser(name).add_argument("--donor", type=int, required=True)
    sub.add_parser("ground").add_argument("--call", required=True)
    args = p.parse_args()
    sys.exit({"account": account, "preview": preview, "call": call, "ground": ground}[args.cmd](args))
