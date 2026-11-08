"""QA grade of the real ingest path against data/sample_inputs/answer_key.json.

    python qa/ingest_check.py [--runs 2]        # run from the root of the checkout under test

Each run, on a fresh scratch db, through the app's own TestClient:
  1. POST /ingest with every sample file (target=auto).
  2. PRE-APPROVAL: the demo routes don't 500; gifts match the key; every planted duplicate group is either
     merged at ingest on exact identity (same email, or same phone + name) or present as a pending
     suggestion; at least one suggestion is pending (challenge #2: staff approve duplicates before merge).
  3. Staff approve every pending suggestion through POST /duplicates/{id}/merge.
  4. POST-APPROVAL: people / tabs / alerts match the key, and every gift is still attached
     (count and total unchanged across the merges).
Determinism is judged on the pre-approval state. Uses real model calls. Exits 1 on any FAIL.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import unicodedata
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
DEMO_ROUTES = ("/duplicates", "/people?type=community", "/community/stats", "/alerts", "/donors")
RESULTS: list[bool] = []


def check(name: str, ok, evidence: str = "") -> None:
    RESULTS.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {evidence}" if evidence else ""))


def norm(name: str | None) -> str:
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).split().__str__()


def group_of(name: str | None) -> str | None:
    """The answer-key duplicate group a donor name belongs to (any member spelling or the canonical name)."""
    n = norm(name)
    for g in KEY["duplicate_groups"]:
        if any(norm(m) == n for m in g["members"] + [g["canonical"]]):
            return g["group"]
    return None


def snapshot(c, db) -> dict:
    conn = db.connect()
    cols = {row[1] for row in conn.execute("PRAGMA table_info(donors)")}
    people = conn.execute("SELECT full_name, " + ("contact_type" if "contact_type" in cols else "'giver'") + " FROM donors").fetchall()
    gcols = {row[1] for row in conn.execute("PRAGMA table_info(gifts)")}
    ok_where = " WHERE COALESCE(status,'ok')='ok'" if "status" in gcols else ""
    gifts = conn.execute(f"SELECT count(*), COALESCE(sum(amount),0) FROM gifts{ok_where}").fetchone()
    orphans = conn.execute("SELECT count(*) FROM gifts WHERE donor_id NOT IN (SELECT id FROM donors)").fetchone()[0]
    conn.close()
    out = {"names": sorted(p[0] for p in people), "tabs": dict(Counter(p[1] for p in people)),
           "gifts": (gifts[0], round(gifts[1], 2)), "orphans": orphans, "routes": {}}
    for route in DEMO_ROUTES:
        rr = c.get(route)
        out["routes"][route] = rr.status_code
        if route == "/duplicates" and rr.status_code == 200:
            out["pending"] = [d for d in rr.json() if d.get("status", "pending") == "pending"]
        if route == "/alerts" and rr.status_code == 200:
            out["alerts"] = sorted((a.get("donor") or str(a.get("donor_id")), a.get("kind")) for a in rr.json())
    return out


def one_run(i: int) -> dict:
    os.environ["DONORS_DB"] = str(Path(tempfile.mkdtemp()) / f"ingest_run{i}.db")
    from service import db
    db.rebuild(with_seed=False)
    from fastapi.testclient import TestClient
    from service.main import app
    c = TestClient(app, raise_server_exceptions=False)
    files = [("files", (p.name, p.read_bytes())) for p in INPUTS]
    r = c.post("/ingest", files=files, data={"target": "auto"}, timeout=900)
    print(f"\n--- run {i}: POST /ingest {r.status_code} ({len(INPUTS)} files)")
    pre = snapshot(c, db)
    merges = []
    for s in pre.get("pending") or []:
        mr = c.post(f"/duplicates/{s['id']}/merge", json={})
        merges.append(mr.status_code)
    post = snapshot(c, db)
    return {"ingest_status": r.status_code, "pre": pre, "post": post, "merges": merges}


def main() -> int:
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 2
    T = KEY["totals"]; want_tabs = KEY["tab_counts"]; n_people = sum(want_tabs.values())
    want_alerts = sorted((e["donor"], e["kind"]) for e in KEY["gift_alerts_expected"])
    want_gifts = (T["unique_gifts"], T["total_amount"])
    groups = [g["group"] for g in KEY["duplicate_groups"]]
    res = [one_run(i + 1) for i in range(runs)]
    for i, o in enumerate(res, 1):
        pre, post = o["pre"], o["post"]
        print(f"\n=== run {i}: pre-approval")
        check(f"run {i}: POST /ingest 200", o["ingest_status"] == 200, str(o["ingest_status"]))
        for route in DEMO_ROUTES:
            check(f"run {i}: GET {route} 200 after a real upload", pre["routes"][route] == 200, str(pre["routes"][route]))
        check(f"run {i}: gifts {want_gifts[0]} = ${want_gifts[1]:,}",
              pre["gifts"][0] == want_gifts[0] and round(pre["gifts"][1]) == want_gifts[1], f"{pre['gifts'][0]} = ${pre['gifts'][1]:,.0f}")
        pending = pre.get("pending") or []
        pair_groups = [(group_of((s.get("donor_a") or {}).get("full_name")), group_of((s.get("donor_b") or {}).get("full_name"))) for s in pending]
        pending_groups = {a for a, b in pair_groups if a and a == b}
        name_groups = Counter(group_of(n) for n in pre["names"])
        merged_at_ingest = {g for g in groups if name_groups.get(g, 0) == 1 and g not in pending_groups}
        uncovered = [g for g in groups if g not in pending_groups and g not in merged_at_ingest]
        check(f"run {i}: every planted duplicate group is merged on exact identity or pending",
              not uncovered, f"pending groups {sorted(pending_groups)}, merged at ingest {sorted(merged_at_ingest)}, uncovered {uncovered}")
        check(f"run {i}: at least one suggestion pending for staff (challenge #2)", len(pending) >= 1,
              f"{len(pending)} pending ({sum(1 for a, b in pair_groups if not (a and a == b))} not in a planted group)")
        print(f"=== run {i}: after approving all {len(o['merges'])} pending suggestions")
        check(f"run {i}: every merge approval succeeds", all(s == 200 for s in o["merges"]), str(Counter(o["merges"])))
        check(f"run {i}: every gift still attached after merges (count + total unchanged, 0 orphans)",
              post["gifts"] == pre["gifts"] and post["orphans"] == 0, f"{pre['gifts']} -> {post['gifts']}, orphans {post['orphans']}")
        check(f"run {i}: people {n_people}", len(post["names"]) == n_people, str(len(post["names"])))
        check(f"run {i}: tabs {want_tabs}", {k: post["tabs"].get(k, 0) for k in want_tabs} == want_tabs, str(post["tabs"]))
        check(f"run {i}: alerts == key", post.get("alerts") == want_alerts, f"got {post.get('alerts')} | want {want_alerts}")
    if runs > 1:
        same = all(r["pre"]["names"] == res[0]["pre"]["names"] for r in res[1:])
        diff = sorted(set(res[0]["pre"]["names"]) ^ set(res[-1]["pre"]["names"]))
        check("deterministic: identical people across runs (pre-approval)", same, f"differs by {diff[:8]}")
    print(f"\n{sum(RESULTS)}/{len(RESULTS)} PASS")
    return 0 if all(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
