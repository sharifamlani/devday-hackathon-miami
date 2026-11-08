"""Re-cut web/public/snapshot.json (the Vercel preview's data) from a full fresh run on this checkout.

    python scripts/regen_snapshot.py --env-file <repo>/.env
    python scripts/regen_snapshot.py --check-only            # privacy + size check of the current file

The live onboarding path, in-process (the same app and routes the UI calls; no port is opened):
    empty scratch db -> POST /ingest (the 8 sample files, target auto) -> POST /context/run {website}
    -> wait for GET /context/refresh "done" (the background invites) -> POST /tasks/generate
    -> export_snapshot (masked on the way out) -> GATE line -> privacy check.

The privacy check fails (exit 1) on any full email or phone, any filled transcript/call_notes/notes value, any "crm_"
a file over the size limit. Exit 2: refused (missing env file, the refresh never finished).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

OUT = REPO_ROOT / "web" / "public" / "snapshot.json"
WEBSITE = "https://miamifoundation.org"
AS_OF = "2026-11-08"
FAILED, REFUSED = 1, 2


def privacy_problems(text: str, max_bytes: int) -> list[str]:
    """What would leak or break the preview; [] when the file is fit to publish."""
    from service.public_mode import BLANK_KEYS, EMAIL_RE, PHONE_RE

    problems = []
    emails = [e for e in EMAIL_RE.findall(text) if "***@" not in e]
    if emails:
        problems.append(f"{len(emails)} unmasked emails, e.g. {emails[0]}")
    phones = PHONE_RE.findall(text)
    if phones:
        problems.append(f"{len(phones)} unmasked phones, e.g. {phones[0]}")
    filled: dict[str, int] = {}

    def walk(value, key=""):
        if key.lower() in BLANK_KEYS and value not in (None, "", []):
            filled[key] = filled.get(key, 0) + 1
        for k, v in (value.items() if isinstance(value, dict) else enumerate(value) if isinstance(value, list)
                     else ()):
            walk(v, k if isinstance(k, str) else key)

    walk(json.loads(text))
    problems += [f'{n} non-empty "{k}" values' for k, n in sorted(filled.items())]
    crm = re.findall(r'"crm_\w+"\s*:', text)
    if crm:
        problems.append(f"{len(crm)} crm_* keys")
    size = len(text.encode("utf-8"))
    if size > max_bytes:
        problems.append(f"{size:,} bytes, over {max_bytes:,}")
    return problems


def gate(snap: dict, size: int, refresh: str) -> dict:
    """The counts the PR body reports (gifts: status ok only, as the app counts them)."""
    home = snap.get("home_summary") or {}
    gifts = [g for d in (snap.get("donor_details") or {}).values() for g in (d.get("gifts") or [])
             if g.get("status", "ok") == "ok"]
    events = snap.get("events") or []
    quarters = (snap.get("target_quarters") or {}).get("quarters") or []
    return {"refresh": refresh, "people": (snap.get("people") or {}).get("counts"),
            "gifts": len(gifts), "gifts_total": round(sum(float(g.get("amount") or 0) for g in gifts), 2),
            "q4_raised": quarters[-1]["raised"] if quarters else None,
            "events": len(events), "invites": sum(int(e.get("drafts_ready") or 0) for e in events),
            "duplicates": len(snap.get("duplicates") or []), "at_risk": home.get("gifts_at_risk"),
            "tasks_today": home.get("tasks_today"), "facts": len((snap.get("context") or {}).get("facts") or []),
            "bytes": size}


def run(db_path: Path, website: str, timeout_s: float, log=print) -> tuple[dict, str]:
    """The onboarding path against a fresh db; returns (unmasked snapshot, final refresh status)."""
    from fastapi.testclient import TestClient

    from scripts.demo_reset import INPUTS_DIR, input_files
    from service import db
    from service.export_snapshot import build_snapshot
    from service.main import app

    files = input_files(INPUTS_DIR)
    with TestClient(app) as c:
        t = time.monotonic()
        r = c.post("/ingest", data={"target": "auto"}, files=[("files", (p.name, p.read_bytes())) for p in files])
        r.raise_for_status()
        log(f"PASS ingest {len(files)} files in {time.monotonic() - t:.0f} s")
        r = c.post("/context/run", json={"website": website})
        r.raise_for_status()
        body = r.json()
        log(f"PASS context/run {body.get('state')} served_from={body.get('served_from')} "
            f"calendar={json.dumps(body.get('calendar'))[:160]}")
        status, deadline = "idle", time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            status = c.get("/context/refresh").json().get("status")
            if status in ("done", "failed"):
                break
            time.sleep(5)
        log(f"{'PASS' if status == 'done' else 'FAIL'} context/refresh {status}")
        r = c.post("/tasks/generate")
        r.raise_for_status()
        log(f"PASS tasks/generate {json.dumps(r.json())[:160]}")
    conn = db.connect(db_path)
    try:
        return build_snapshot(conn), status
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--env-file", type=Path, default=REPO_ROOT / ".env", help="the .env with OPENAI_API_KEY")
    ap.add_argument("--db", type=Path, default=None, help="scratch db (default: a new temp file; never data/donors.db)")
    ap.add_argument("--website", default=WEBSITE)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--timeout", type=float, default=900, help="seconds to wait for the background invites")
    ap.add_argument("--check-only", action="store_true", help="only check the current --out file")
    args = ap.parse_args()

    if args.check_only:
        from service.export_snapshot import MAX_BYTES
        problems = privacy_problems(args.out.read_text(encoding="utf-8"), MAX_BYTES)
        print("\n".join(f"FAIL {p}" for p in problems) or f"PASS privacy + size: {args.out}")
        return FAILED if problems else 0

    if not args.env_file.is_file():
        print(f"REFUSED no env file at {args.env_file} (pass --env-file)")
        return REFUSED
    from dotenv import load_dotenv
    load_dotenv(args.env_file)
    db_path = args.db or Path(tempfile.mkdtemp(prefix="regen_snapshot_")) / "donors.db"
    if db_path.resolve() == (REPO_ROOT / "data" / "donors.db").resolve():
        print("REFUSED --db must be a scratch file, not data/donors.db")
        return REFUSED
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.unlink(missing_ok=True)
    os.environ["DONORS_DB"] = str(db_path)
    os.environ["SCORE_AS_OF"] = AS_OF
    print(f".... fresh run on {db_path} (as of {AS_OF}, website {args.website})")

    snap, status = run(db_path, args.website, args.timeout)          # service modules import from here on
    from service.export_snapshot import MAX_BYTES, public_snapshot, write_snapshot
    size = write_snapshot(public_snapshot(snap), args.out)
    print("GATE " + json.dumps(gate(snap, size, status)))
    problems = privacy_problems(args.out.read_text(encoding="utf-8"), MAX_BYTES)
    print("\n".join(f"FAIL {p}" for p in problems) or "PASS privacy: 0 unmasked emails/phones, 0 filled "
          "transcript/call_notes/notes, 0 crm_* keys")
    if status != "done":
        return REFUSED
    return FAILED if problems else 0


if __name__ == "__main__":
    sys.exit(main())
