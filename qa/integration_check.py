"""QA integration check: run from the root of a merged checkout (all open feature branches merged).

    python qa/integration_check.py              # rebuild db, enrich + outreach on #1 and a star donor, guardrails, routes
    python qa/integration_check.py --no-llm     # skip the outreach model calls (guardrails on whatever is in the db)

Prints one PASS/FAIL line per check and exits non-zero if any FAIL. Never edits service/, web/ or data/
source files; it only rebuilds the gitignored data/donors.db the way `python -m service.db --rebuild` does.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import traceback
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

REPO = Path.cwd()
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "service"))

# The key lives in the main checkout's .env; worktrees don't have one. Load it without copying it.
from dotenv import load_dotenv  # noqa: E402
for env in (REPO / ".env", REPO.parent / "devday_hackathon" / ".env"):
    if env.exists():
        load_dotenv(env)
        break

RESULTS: list[tuple[str, bool, str]] = []
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]


def check(name: str, ok: bool, evidence: str = "") -> bool:
    RESULTS.append((name, ok, evidence))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {evidence}" if evidence else ""))
    return ok


def url_status(url: str) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (qa link check)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def wrong_weekdays(text: str) -> list[str]:
    """Every 'Weekday, Month D[, YYYY]' in text whose weekday doesn't match 2026 (or the year given)."""
    bad = []
    pat = re.compile(rf"({'|'.join(WEEKDAYS)}),?\s+({'|'.join(MONTHS)})\s+(\d{{1,2}})(?:,\s*(\d{{4}}))?")
    for wd, mon, day, yr in pat.findall(text):
        d = date(int(yr or 2026), MONTHS.index(mon) + 1, int(day))
        if WEEKDAYS[d.weekday()] != wd:
            bad.append(f"{wd} {mon} {day} (is {WEEKDAYS[d.weekday()]})")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-llm", action="store_true")
    args = ap.parse_args()

    from service import db
    db_file = db.rebuild()
    conn = db.connect()
    conn.row_factory = sqlite3.Row
    n = conn.execute("SELECT count(*) FROM donors").fetchone()[0]
    check("db rebuilds with seed", n > 0, f"{db_file.name}: {n} donors")

    top = conn.execute("SELECT d.*, s.* FROM donors d JOIN donor_scores s ON s.donor_id=d.id "
                       "ORDER BY s.score DESC LIMIT 1").fetchone()
    star = conn.execute("SELECT d.*, s.* FROM donors d JOIN donor_scores s ON s.donor_id=d.id "
                        "WHERE s.is_star=1 ORDER BY s.score DESC LIMIT 1").fetchone()
    check("a #1 donor and a star donor exist", top is not None and star is not None,
          f"#1={top['full_name'] if top else None} score={top['score'] if top else None}; "
          f"star={star['full_name'] if star else None}")
    targets = [r for r in (top, star) if r is not None]

    # --- enrich -> research_facts -------------------------------------------------------------
    from service import enrich_agent
    for r in targets:
        try:
            facts = enrich_agent.enrich_donor(r["full_name"], r["org_name"], r["city"])
            wrote = enrich_agent.save_facts(r["donor_id"], facts, "qa")
            in_db = conn.execute("SELECT count(*) FROM research_facts WHERE donor_id=?", (r["donor_id"],)).fetchone()[0]
            check(f"enrich writes research_facts for {r['full_name']}", in_db == wrote,
                  f"{wrote} fact(s) returned, {in_db} row(s) in db")
            check(f"enrich finds >=1 sourced fact for {r['full_name']} (drawer research not empty)", in_db >= 1,
                  f"{in_db} fact(s); cache keys = {list(enrich_agent.read_cache())}")
        except Exception as e:
            check(f"enrich runs for {r['full_name']}", False, f"{type(e).__name__}: {e}")

    # --- outreach -> outreach_drafts ----------------------------------------------------------
    import outreach_agent
    from org_context import load_org_facts
    org_facts = load_org_facts()
    drafts = {}
    if not args.no_llm:
        for r in targets:
            donor = dict(r)
            donor["id"] = r["donor_id"]
            gifts = [dict(g) for g in conn.execute("SELECT * FROM gifts WHERE donor_id=?", (r["donor_id"],))]
            rf = [dict(f) for f in conn.execute("SELECT * FROM research_facts WHERE donor_id=?", (r["donor_id"],))]
            try:
                d = outreach_agent.draft_outreach(donor, gifts, json.loads(r["why"]), rf, org_facts,
                                                  today=date(2026, 11, 8))
                drafts[r["donor_id"]] = (d, gifts, rf)
                check(f"outreach drafts {r['full_name']}", True, f"status={d.status}")
            except Exception as e:
                check(f"outreach drafts {r['full_name']}", False, f"{type(e).__name__}: {e}")
                continue
            try:
                where = outreach_agent.save_draft(r["donor_id"], d)
                row = conn.execute("SELECT * FROM outreach_drafts WHERE donor_id=? ORDER BY id DESC LIMIT 1",
                                   (r["donor_id"],)).fetchone()
                check(f"outreach saves to outreach_drafts for {r['full_name']}", row is not None, f"saved to {where}")
            except Exception as e:
                check(f"outreach saves to outreach_drafts for {r['full_name']}", False, f"{type(e).__name__}: {e}")

    # --- guardrails ---------------------------------------------------------------------------
    bad = conn.execute("SELECT o.id, o.status FROM outreach_drafts o JOIN donor_scores s ON s.donor_id=o.donor_id "
                       "WHERE s.is_star=1 AND o.status IN ('ready','sent')").fetchall()
    check("no star draft is 'ready' or 'sent'", not bad, f"offending rows: {[tuple(b) for b in bad]}")

    if star is not None:
        for label, sql, params in [
            ("insert", "INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'qa', 'sent')", (star["donor_id"],)),
        ]:
            try:
                conn.execute(sql, params)
                conn.rollback()
                check(f"DB trigger blocks unapproved star send ({label})", False, "insert succeeded")
            except sqlite3.DatabaseError as e:
                check(f"DB trigger blocks unapproved star send ({label})", "human approver" in str(e), str(e))
        cur = conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'qa', 'draft')",
                           (star["donor_id"],))
        try:
            conn.execute("UPDATE outreach_drafts SET status='sent' WHERE id=?", (cur.lastrowid,))
            check("DB trigger blocks unapproved star send (update)", False, "update succeeded")
        except sqlite3.DatabaseError as e:
            check("DB trigger blocks unapproved star send (update)", "human approver" in str(e), str(e))
        conn.rollback()

    urls = {r["source_url"] for r in conn.execute("SELECT source_url FROM research_facts")}
    urls |= {f["url"] for f in org_facts}
    for d, _, _ in drafts.values():
        urls |= {f.url for f in d.facts_used}
    dead = {u: s for u in sorted(urls) if (s := url_status(u)) != 200}
    check("every source_url returns 200", not dead, f"{len(urls)} checked; non-200: {dead}")

    for donor_id, (d, gifts, rf) in drafts.items():
        text = f"{d.subject}\n{d.body}\n{d.call_script}"
        allowed_text = " ".join([f["fact"] for f in org_facts] + [f["fact"] for f in rf])
        allowed = {outreach_agent.norm_num(m) for m in outreach_agent.NUM_RE.findall(allowed_text)}
        for g in gifts:
            allowed |= {outreach_agent.norm_num(f"{g['amount']:,.0f}"), g["gift_date"][:4]}
        allowed |= {"2026", "14", "19", "15", "8", "11", "6"}
        stray = [m.strip() for m in outreach_agent.NUM_RE.findall(text)
                 if (k := outreach_agent.norm_num(m)) and k not in allowed and not (k.isdigit() and len(k) <= 2)]
        check(f"draft {donor_id}: every figure is in the facts or gift history", not stray, f"stray: {stray}")
        check(f"draft {donor_id}: no Press Forward dollar total",
              not re.search(r"press forward[^.]*\$|\$[^.]*press forward", text, re.I))
        check(f"draft {donor_id}: weekdays match dates", not wrong_weekdays(text), str(wrong_weekdays(text)))
        check(f"draft {donor_id}: no hard-coded '12 days'", "12 days" not in text)

    code = "\n".join(p.read_text(encoding="utf-8") for p in (REPO / "service").rglob("*.py") if "tests" not in p.parts)
    check("service code has no hard-coded '12 days'", "12 days" not in code)
    check("service code weekdays match dates", not wrong_weekdays(code), str(wrong_weekdays(code)))

    # --- routes -------------------------------------------------------------------------------
    try:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from service.routes_data import router
        app = FastAPI()
        app.include_router(router)
        c = TestClient(app)
        r = c.get("/donors")
        rows = r.json()
        check("GET /donors 200 and ranked", r.status_code == 200 and rows[0]["id"] == top["donor_id"],
              f"{r.status_code}, first={rows[0]['full_name']}")
        for t in targets:
            r = c.get(f"/donors/{t['donor_id']}")
            body = r.json()
            check(f"GET /donors/{t['donor_id']} has why/research/drafts", r.status_code == 200
                  and body.get("research_facts") is not None and body.get("outreach_drafts") is not None,
                  f"{r.status_code}; keys={sorted(body)[:12]}; drafts={len(body.get('outreach_drafts') or [])}")
        r = c.get("/duplicates")
        dups = r.json()
        check("GET /duplicates 200 with >=1 suggestion", r.status_code == 200 and len(dups) >= 1,
              f"{r.status_code}, {len(dups)} suggestion(s)")
        if dups:
            r = c.post(f"/duplicates/{dups[0]['id']}/merge", json={})
            after = c.get("/donors").json()
            check("POST /duplicates/{id}/merge merges", r.status_code == 200 and len(after) == len(rows) - 1,
                  f"{r.status_code}; donors {len(rows)} -> {len(after)}")
        check("GET /donors/999999 is 404", c.get("/donors/999999").status_code == 404)
    except Exception:
        check("routes run", False, traceback.format_exc().splitlines()[-1])

    fails = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} PASS")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
