"""QA check of web/public/snapshot.json (the static data the UI ships with) and, optionally, the live service.

    python qa/snapshot_check.py [web/public/snapshot.json] [--live http://localhost:8000]

Guardrails on every draft in the snapshot, then a live-vs-snapshot comparison of ranking and flags.
Exits 1 on any FAIL.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date

sys.stdout.reconfigure(encoding="utf-8")
args = sys.argv[1:]
path = next((a for a in args if a.endswith(".json")), "web/public/snapshot.json")
live = args[args.index("--live") + 1] if "--live" in args else None
RESULTS: list[bool] = []
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def check(name: str, ok, evidence: str = "") -> None:
    RESULTS.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {evidence}" if evidence else ""))


def wrong_weekdays(text: str) -> list[str]:
    pat = re.compile(rf"({'|'.join(WEEKDAYS)}),?\s+({'|'.join(MONTHS)})\s+(\d{{1,2}})(?:,\s*(\d{{4}}))?")
    return [f"{wd} {m} {d}" for wd, m, d, y in pat.findall(text)
            if WEEKDAYS[date(int(y or 2026), MONTHS.index(m) + 1, int(d)).weekday()] != wd]


snap = json.load(open(path, encoding="utf-8"))
donors, details = snap["donors"], snap["donor_details"]
print(f"snapshot meta: {snap['meta']}")
check("snapshot has donors, details for each, duplicates",
      donors and len(details) == len(donors) and "duplicates" in snap, f"{len(donors)} donors, {len(details)} details")
check("every donor carries is_sample, and the sample donors are flagged",
      all("is_sample" in d for d in donors) and any(d["is_sample"] for d in donors),
      f"{sum(bool(d['is_sample']) for d in donors)}/{len(donors)} flagged")
check("#1 is Maria Delgado", donors[0]["full_name"] == "Maria Delgado", donors[0]["full_name"])

n_drafts = 0
for d in donors:
    det = details[str(d["id"])]
    gifts = det.get("gifts", [])
    for dr in det.get("outreach_drafts", []):
        n_drafts += 1
        text = f"{dr.get('subject') or ''}\n{dr.get('body') or ''}\n{dr.get('call_script') or ''}"
        tag = f"draft {dr['id']} ({d['full_name']}, {d['donor_type']}{', ★' if d.get('is_star') else ''})"
        want = "draft" if d.get("is_star") or d["donor_type"] == "organization" else "ready"
        check(f"{tag}: status {want}", dr["status"] in (want, "approved"), dr["status"])
        facts = dr.get("facts_used")
        facts = json.loads(facts) if isinstance(facts, str) else (facts or [])
        check(f"{tag}: ≥1 sourced fact, every url clickable",
              facts and all(str(f.get("url", "")).startswith("http") and " " not in f["url"] for f in facts),
              f"{len(facts)} fact(s)")
        if d["donor_type"] == "organization":
            amts = {f"{g['amount']:,.0f}" for g in gifts} | {f"{g['amount']:.0f}" for g in gifts}
            shown = sorted(a for a in amts if re.search(rf"(?<![\d,]){re.escape(a)}(?![\d,])", text))
            check(f"{tag}: no invented gift amount", not shown, f"shown: {shown}")
        check(f"{tag}: no Press Forward dollar total",
              not re.search(r"press forward[^.]*\$|\$[^.]*press forward", text, re.I))
        check(f"{tag}: weekdays match dates; no '12 days'", not wrong_weekdays(text) and "12 days" not in text,
              str(wrong_weekdays(text)))
check("snapshot has ≥3 drafts", n_drafts >= 3, str(n_drafts))

if live:
    import httpx
    ld = httpx.get(f"{live.rstrip('/')}/donors", timeout=30).json()
    key = lambda rows: [(r["full_name"], r.get("score"), bool(r.get("is_star")), r.get("status")) for r in rows]
    diff = [(a, b) for a, b in zip(key(donors), key(ld)) if a != b]
    check("live /donors matches the snapshot (order, score, star, status)",
          len(ld) == len(donors) and not diff, f"live {len(ld)} vs snap {len(donors)}; diffs: {diff[:4]}")

print(f"\n{sum(RESULTS)}/{len(RESULTS)} PASS")
sys.exit(0 if all(RESULTS) else 1)
