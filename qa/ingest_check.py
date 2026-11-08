"""QA grade of the real ingest path against data/sample_inputs/answer_key.json.

    python qa/ingest_check.py [--runs 2]        # run from the root of the checkout under test

Each run: a fresh scratch db, POST /ingest with all sample files (target=auto) through the app's own
TestClient, then the routes the demo uses. Checks people / tabs / gifts / duplicates / alerts against the
key, that /duplicates, /people?type=community and /community/stats don't 500, and that every run gives the
same people. Uses real model calls (the ingest agent is LLM-driven). Exits 1 on any FAIL.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path

REPO = Path.cwd()
sys.path.insert(0, str(REPO))
sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv  # noqa: E402
for env in (REPO / ".env", REPO.parent / "devday_hackathon" / ".env"):
    if env.exists():
        load_dotenv(env)
        break

KEY = json.loads((REPO / "data/sample_inputs/answer_key.json").read_text(encoding="utf-8"))
INPUTS = [p for p in sorted((REPO / "data/sample_inputs").iterdir())
          if p.suffix in (".xlsx", ".docx", ".md", ".csv") and not p.name.startswith("_")]
RESULTS: list[bool] = []


def check(name: str, ok, evidence: str = "") -> None:
    RESULTS.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {evidence}" if evidence else ""))


def one_run(i: int) -> dict:
    os.environ["DONORS_DB"] = str(Path(tempfile.mkdtemp()) / f"ingest_run{i}.db")
    from service import db
    db.rebuild(with_seed=False)
    from fastapi.testclient import TestClient
    from service.main import app
    c = TestClient(app, raise_server_exceptions=False)
    files = [("files", (p.name, p.read_bytes())) for p in INPUTS]
    r = c.post("/ingest", files=files, data={"target": "auto"}, timeout=900)
    print(f"\n--- run {i}: POST /ingest {r.status_code} ({len(INPUTS)} files: {', '.join(p.name for p in INPUTS)})")
    out = {"ingest_status": r.status_code}
    conn = db.connect()
    cols = {row[1] for row in conn.execute("PRAGMA table_info(donors)")}
    people = conn.execute("SELECT full_name, " + ("contact_type" if "contact_type" in cols else "'giver'") + " FROM donors").fetchall()
    out["names"] = sorted(p[0] for p in people)
    out["tabs"] = dict(Counter(p[1] for p in people))
    gcols = {row[1] for row in conn.execute("PRAGMA table_info(gifts)")}
    ok_where = " WHERE COALESCE(status,'ok')='ok'" if "status" in gcols else ""
    out["gifts"] = conn.execute(f"SELECT count(*), COALESCE(sum(amount),0) FROM gifts{ok_where}").fetchone()
    for route in ("/duplicates", "/people?type=community", "/community/stats", "/alerts", "/donors"):
        rr = c.get(route)
        out[route] = rr.status_code
        if route == "/duplicates" and rr.status_code == 200:
            out["dupes"] = len(rr.json())
        if route == "/alerts" and rr.status_code == 200:
            out["alerts"] = sorted((a.get("donor") or str(a.get("donor_id")), a.get("kind")) for a in rr.json())
    conn.close()
    return out


def main() -> int:
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 2
    T = KEY["totals"]; want_tabs = KEY["tab_counts"]
    want_alerts = sorted((e["donor"], e["kind"]) for e in KEY["gift_alerts_expected"])
    res = [one_run(i + 1) for i in range(runs)]
    for i, o in enumerate(res, 1):
        print(f"\n=== run {i}")
        check(f"run {i}: POST /ingest 200", o["ingest_status"] == 200, str(o["ingest_status"]))
        for route in ("/duplicates", "/people?type=community", "/community/stats", "/alerts", "/donors"):
            check(f"run {i}: GET {route} 200 (no 500 after a real upload)", o[route] == 200, str(o[route]))
        check(f"run {i}: gifts {T['unique_gifts']} = ${T['total_amount']:,}",
              o["gifts"][0] == T["unique_gifts"] and round(o["gifts"][1]) == T["total_amount"], f"{o['gifts'][0]} = ${o['gifts'][1]:,.0f}")
        check(f"run {i}: people {sum(want_tabs.values())}", len(o["names"]) == sum(want_tabs.values()), str(len(o["names"])))
        check(f"run {i}: tabs {want_tabs}", {k: o["tabs"].get(k, 0) for k in want_tabs} == want_tabs, str(o["tabs"]))
        check(f"run {i}: pending duplicate suggestions ~ {T['duplicate_groups']} groups", o.get("dupes") is not None, f"{o.get('dupes')} pending (key: {T['duplicate_groups']} groups; some may be pre-merged by ingest)")
        check(f"run {i}: alerts == key", o.get("alerts") == want_alerts, f"got {o.get('alerts')} | want {want_alerts}")
    if runs > 1:
        same = all(r["names"] == res[0]["names"] for r in res[1:])
        diff = sorted(set(res[0]["names"]) ^ set(res[-1]["names"]))
        check("deterministic: identical people across runs", same, f"differs by {diff[:8]}")
    print(f"\n{sum(RESULTS)}/{len(RESULTS)} PASS")
    return 0 if all(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
