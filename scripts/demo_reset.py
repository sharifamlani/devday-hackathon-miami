"""Demo rehearsal: reset the laptop DB to empty, warm the upload cache, and check an upload against the answer key.

    python scripts/demo_reset.py              # back up data/donors.db, then reset it to empty
    python scripts/demo_reset.py --warm       # reset, upload data/sample_inputs once through POST /ingest
                                              # (primes data/ingest_cache/), report, reset to empty again
    python scripts/demo_reset.py --check      # after an upload: approve every suggested duplicate on a COPY
                                              # and compare people / gifts / alerts with answer_key.json

Rehearsal flow: --warm (ends with an EMPTY db) -> upload data/sample_inputs in the app -> --check.
(--check straight after --warm fails with "no people": there is nothing uploaded to check yet.)

Options: --db PATH (default $DONORS_DB or data/donors.db), --port 8000 (the service port that must be free
before a reset), --force (reset even if the service answers on --port), --inputs DIR.

Why --warm matters: the upload path asks a model to read and sort the files, and caches every answer in
data/ingest_cache/. After one warm-up run, the on-stage upload replays those answers, so it is fast and the
duplicate count shown on stage is fixed. The cache is kept; only the database is emptied.

Every run is idempotent, prints PASS/FAIL lines, and exits non-zero on any failure:
    0 = all good   1 = a check failed   2 = refused (service running, missing files, bad arguments)
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sqlite3
import sys
import tempfile
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

INPUTS_DIR = REPO_ROOT / "data" / "sample_inputs"
ANSWER_KEY = INPUTS_DIR / "answer_key.json"
DEMO_AS_OF = "2026-11-08"
APPROVER = "demo_reset --check"
REFUSED, FAILED = 2, 1


class Refused(Exception):
    """The script won't run as asked (exit 2)."""


# ---- reset ----------------------------------------------------------------------------------------

def port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def copy_db(src: Path, dest: Path) -> Path:
    """A consistent copy through SQLite's backup API (safe even while another process has the file open)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(src)
    target = sqlite3.connect(dest)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    return dest


def backup_db(path: Path, now: datetime | None = None) -> Path | None:
    """data/donors.db -> data/donors.backup-YYYYmmdd-HHMMSS.db (covered by the data/*.db ignore rule).
    None when there is nothing to back up."""
    if not path.exists() or path.stat().st_size == 0:
        return None
    stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    return copy_db(path, path.with_name(f"{path.stem}.backup-{stamp}{path.suffix}"))


def row_counts(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    conn = sqlite3.connect(path)
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' "
                                             "AND name IN ('donors', 'gifts', 'duplicate_suggestions')")]
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
    finally:
        conn.close()


def reset(path: Path, port: int, force: bool = False, log=print, backup: bool = True) -> Path | None:
    """Back up, then empty the DB (schema kept). Refuses while the service answers on `port`."""
    if port_in_use(port) and not force:
        raise Refused(f"the service is answering on port {port}: stop it first (Ctrl+C in its terminal), "
                      f"or pass --force to reset anyway")
    from service import db

    before = row_counts(path)
    saved = backup_db(path) if backup else None
    db.reset_db(path)
    after = row_counts(path)
    log(f"PASS reset {path} (backup: {saved or ('skipped' if not backup else 'none, the db was empty or missing')}; "
        f"before {before or 'no db'}, after {after})")
    if any(after.values()):
        raise RuntimeError(f"reset left rows behind: {after}")
    return saved


# ---- warm-up --------------------------------------------------------------------------------------

def input_files(inputs: Path) -> list[Path]:
    """The files a person would drag into the upload screen: everything but the answer key and _README."""
    files = sorted(p for p in inputs.iterdir() if p.is_file() and p.name != "answer_key.json"
                   and not p.name.startswith(("_", ".")))
    if not files:
        raise Refused(f"no input files in {inputs}")
    return files


def upload_via_service(files: list[Path], target: str = "auto") -> dict:
    """POST /ingest on the real app, in-process: the same route, adapter and cache the UI upload uses."""
    from fastapi.testclient import TestClient

    from service.main import app

    with TestClient(app) as client:                      # runs the app's startup hooks (schema migration)
        r = client.post("/ingest", data={"target": target},
                        files=[("files", (p.name, p.read_bytes())) for p in files])
    if r.status_code != 200:
        raise RuntimeError(f"POST /ingest answered {r.status_code}: {r.text[:300]}")
    return r.json()


def cache_files(cache_dir: Path) -> int:
    return sum(1 for p in cache_dir.rglob("*") if p.is_file()) if cache_dir.exists() else 0


def warm(path: Path, port: int, inputs: Path, force: bool = False, upload=upload_via_service, log=print) -> dict:
    """reset -> one upload of the sample inputs (primes the model-answer cache) -> report -> reset again."""
    from service.ingest_adapter import _cache_dir

    cache_dir = _cache_dir()
    reset(path, port, force, log)
    files = input_files(inputs)
    before = cache_files(cache_dir) if cache_dir else 0
    log(f".... warm-up upload of {len(files)} files through POST /ingest (a cold cache asks the model; "
        f"this can take a few minutes)")
    result = upload(files)
    counts = row_counts(path)
    after = cache_files(cache_dir) if cache_dir else 0
    pending = counts.get("duplicate_suggestions", 0)
    log(f"PASS warm-up upload: {counts.get('donors', 0)} people, {counts.get('gifts', 0)} gifts, "
        f"{pending} duplicate suggestions (this is the count staff will see on stage)")
    if cache_dir is None:
        log("FAIL the ingest cache is off (INGEST_CACHE=off): the stage upload will call the model live")
    else:
        log(f"PASS ingest cache {cache_dir}: {before} -> {after} cached answers")
    reset(path, port, force=True, log=log, backup=False)  # port checked above; the warm-up db is throwaway
    return {"result": result, "counts": counts, "cache_before": before, "cache_after": after,
            "cache_on": cache_dir is not None}


# ---- check ----------------------------------------------------------------------------------------

def expected_from_answer_key(key_path: Path = ANSWER_KEY) -> dict:
    key = json.loads(key_path.read_text(encoding="utf-8"))
    return {
        "tabs": {t: key["tab_counts"][t] for t in ("giver", "neighbor", "community")},
        "gifts": key["totals"]["unique_gifts"],
        "amount": key["totals"]["total_amount"],
        "alerts": sorted(a["donor"] for a in key["gift_alerts_expected"]),
        "as_of": key.get("as_of") or DEMO_AS_OF,
    }


def gift_totals(conn: sqlite3.Connection) -> tuple[int, float]:
    has_status = any(r[1] == "status" for r in conn.execute("PRAGMA table_info(gifts)"))
    where = " WHERE status = 'ok'" if has_status else ""
    n, total = conn.execute(f"SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM gifts{where}").fetchone()
    return n, float(total)


def observe(copy_path: Path, as_of: str, log=print) -> dict:
    """Read counts, approve every pending duplicate through POST /duplicates/{id}/merge, read again.
    Runs on `copy_path` only (DONORS_DB points there for the duration)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from service import gift_alerts, routes_data

    app = FastAPI()
    app.include_router(routes_data.router)
    app.include_router(gift_alerts.router)
    old = os.environ.get("DONORS_DB")
    os.environ["DONORS_DB"] = str(copy_path)
    try:
        c = TestClient(app)
        pre = c.get("/people").json()["counts"]
        conn = sqlite3.connect(copy_path)
        pre_gifts = gift_totals(conn)
        conn.close()
        approved = []
        for _ in range(500):                              # a merge can supersede other suggestions: re-read
            pending = c.get("/duplicates").json()
            if not pending:
                break
            s = pending[0]
            r = c.post(f"/duplicates/{s['id']}/merge", json={"approved_by": APPROVER})
            if r.status_code != 200:
                raise RuntimeError(f"merge {s['id']} answered {r.status_code}: {r.text[:200]}")
            approved.append(f"{s['donor_a']['full_name']} + {s['donor_b']['full_name']} "
                            f"({s['confidence']:.2f}: {s['reasons'][0]})")
        post = c.get("/people").json()["counts"]
        alerts = c.get("/alerts", params={"as_of": as_of}).json()
    finally:
        if old is None:
            os.environ.pop("DONORS_DB", None)
        else:
            os.environ["DONORS_DB"] = old
    conn = sqlite3.connect(copy_path)
    post_gifts = gift_totals(conn)
    conn.close()
    return {"pre": pre, "post": post, "approved": approved, "pre_gifts": pre_gifts, "post_gifts": post_gifts,
            "alerts": sorted({a["donor"] for a in alerts if a.get("donor")}), "alert_count": len(alerts)}


def compare(expected: dict, observed: dict) -> list[tuple[bool, str]]:
    """PASS/FAIL lines for an observed upload against the expected numbers."""
    lines = []
    for tab in ("giver", "neighbor", "community"):
        got, want = observed["post"].get(tab, 0), expected["tabs"][tab]
        label = {"giver": "Givers", "neighbor": "Neighbors", "community": "Community"}[tab]
        lines.append((got == want, f"{label} after approving duplicates: {got} (expected {want}; "
                                   f"{observed['pre'].get(tab, 0)} before approval)"))
    for label, (n, total) in (("before approval", observed["pre_gifts"]), ("after approval", observed["post_gifts"])):
        ok = n == expected["gifts"] and round(total, 2) == round(float(expected["amount"]), 2)
        lines.append((ok, f"gifts {label}: {n} / ${total:,.0f} (expected {expected['gifts']} / "
                          f"${expected['amount']:,.0f})"))
    norm = lambda names: sorted(n.strip().lower() for n in names)          # noqa: E731
    ok = observed["alert_count"] == len(expected["alerts"]) and norm(observed["alerts"]) == norm(expected["alerts"])
    detail = ""
    if not ok:
        missing = sorted(set(norm(expected["alerts"])) - set(norm(observed["alerts"])))
        extra = sorted(set(norm(observed["alerts"])) - set(norm(expected["alerts"])))
        detail = f"; missing {missing}, unexpected {extra}"
    lines.append((ok, f"gift alerts: {observed['alert_count']} (expected {len(expected['alerts'])}: "
                      f"{', '.join(expected['alerts'])}){detail}"))
    return lines


def check(path: Path, expected: dict | None = None, log=print) -> bool:
    """Verify an upload against the answer key without touching `path`: all merges happen on a copy."""
    expected = expected or expected_from_answer_key()
    if not path.exists() or not row_counts(path).get("donors"):
        log(f"FAIL {path} has no people: upload data/sample_inputs in the app (or run --warm) first")
        return False
    with tempfile.TemporaryDirectory() as tmp:
        copy = copy_db(path, Path(tmp) / "check.db")
        observed = observe(copy, expected["as_of"], log)
    log(f".... approved {len(observed['approved'])} duplicate suggestions on a copy (the real db is unchanged):")
    for line in observed["approved"]:
        log(f"       {line}")
    lines = compare(expected, observed)
    for ok, line in lines:
        log(f"{'PASS' if ok else 'FAIL'} {line}")
    return all(ok for ok, _ in lines)


# ---- run commands ---------------------------------------------------------------------------------

def run_commands(port: int, path: Path) -> str:
    api = f"http://127.0.0.1:{port}"
    db_env = "" if path == default_db_path() else f'DONORS_DB="{path}" '
    return f"""
Start the demo (two terminals, from the repo root):
  1. Service (Git Bash):
       {db_env}.venv/Scripts/python.exe -m uvicorn service.main:app --host 127.0.0.1 --port {port}
  2. Web, live mode against the service (Git Bash):
       cd web && VITE_DATA_MODE=local VITE_API_URL={api} npm run dev -- --port 5173
     PowerShell instead:
       cd web; $env:VITE_DATA_MODE="local"; $env:VITE_API_URL="{api}"; npm run dev -- --port 5173
     (5173 busy? use --port 5174; both are allowed by the service's CORS list)
  Then open http://localhost:5173, upload every file in data/sample_inputs/ except answer_key.json,
  and run `python scripts/demo_reset.py --check` to compare the upload with the answer key."""


def default_db_path() -> Path:
    from service import db

    return Path(db.DEFAULT_DB_PATH)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reset, warm and check the demo database")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--warm", action="store_true", help="reset, upload the sample inputs once (primes the "
                                                           "ingest cache), report, reset again")
    mode.add_argument("--check", action="store_true", help="compare the current upload with answer_key.json")
    parser.add_argument("--db", default=None, help="database (default $DONORS_DB or data/donors.db)")
    parser.add_argument("--port", type=int, default=8000, help="service port that must be free for a reset")
    parser.add_argument("--force", action="store_true", help="reset even if the service answers on --port")
    parser.add_argument("--inputs", default=str(INPUTS_DIR), help="folder of files to upload (--warm)")
    args = parser.parse_args(argv)

    if args.warm:
        # A cold cache can take longer than the route's 120 s deadline; the warm-up waits for it.
        os.environ.setdefault("AGENT_DEADLINE_S", "900")
    from service import config  # noqa: F401  (pins SCORE_AS_OF before any other service module)
    from service import db

    path = Path(args.db).resolve() if args.db else Path(db.db_path()).resolve()
    os.environ["DONORS_DB"] = str(path)           # every service module reads the same file
    try:
        if args.check:
            ok = check(path)
            print(f"\n{'PASS' if ok else 'FAIL'} overall: the upload {'matches' if ok else 'does not match'} "
                  f"the answer key")
            return 0 if ok else FAILED
        if args.warm:
            info = warm(path, args.port, Path(args.inputs), args.force)
            ok = info["cache_on"]
        else:
            reset(path, args.port, args.force)
            ok = True
        print(run_commands(args.port, path))
        return 0 if ok else FAILED
    except Refused as e:
        print(f"REFUSED {e}")
        return REFUSED
    except Exception as e:                           # noqa: BLE001  (any failure is a FAIL line + exit 1)
        print(f"FAIL {type(e).__name__}: {e}")
        return FAILED


if __name__ == "__main__":
    raise SystemExit(main())
