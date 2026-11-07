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

sys.stdout.reconfigure(encoding="utf-8")
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
    third = conn.execute("SELECT d.*, s.* FROM donors d JOIN donor_scores s ON s.donor_id=d.id "
                         "WHERE d.donor_type='organization' AND s.is_star=0 ORDER BY s.score DESC LIMIT 1").fetchone()
    targets = [r for r in (top, star, third) if r is not None]

    # --- enrich -> research_facts -------------------------------------------------------------
    from service import enrich_agent
    for r in targets:
        try:
            facts = enrich_agent.enrich_donor(r["full_name"], r["org_name"], r["city"], donor_type=r["donor_type"])
            wrote = enrich_agent.save_facts(r["donor_id"], facts, "qa")
            in_db = conn.execute("SELECT count(*) FROM research_facts WHERE donor_id=?", (r["donor_id"],)).fetchone()[0]
            check(f"enrich writes research_facts for {r['full_name']}", in_db == wrote,
                  f"{wrote} fact(s) returned, {in_db} row(s) in db")
            if r["donor_type"] == "individual":
                # Lead decision (Q1): individuals are fictional, so research must return nothing for them
                check(f"enrich returns 0 facts for fictional individual {r['full_name']}", in_db == 0,
                      f"{in_db} fact(s): {[f.fact[:80] for f in facts]}")
            else:
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

    n_saved = conn.execute("SELECT count(DISTINCT donor_id) FROM outreach_drafts").fetchone()[0]
    check(">= 3 drafts saved, each with call_script + facts_used",
          n_saved >= 3 and not conn.execute("SELECT 1 FROM outreach_drafts WHERE call_script IS NULL OR facts_used IS NULL").fetchone(),
          f"{n_saved} donor(s) with drafts")

    # Smoke 5 + Q3: the CLI drafts from the db named by DONORS_DB, not data/donors.db, and takes
    # star/tier from donor_scores: a ★ donor comes out 'draft', a non-★ org 'ready'
    if not args.no_llm:
        import os, subprocess, tempfile
        scratch = Path(tempfile.mkdtemp()) / "qa.db"
        db.rebuild(scratch)
        before = conn.execute("SELECT count(*) FROM outreach_drafts").fetchone()[0]
        ids = [str(r["donor_id"]) for r in (top, star, third) if r is not None]
        p = subprocess.run([sys.executable, "-m", "service.outreach_agent", *ids], cwd=REPO,
                           env=os.environ | {"DONORS_DB": str(scratch)}, capture_output=True, text=True, timeout=600)
        sc = sqlite3.connect(scratch)
        got = dict(sc.execute("SELECT o.donor_id, o.status FROM outreach_drafts o"))
        stars = dict(sc.execute("SELECT donor_id, is_star FROM donor_scores"))
        sc.close()
        after = conn.execute("SELECT count(*) FROM outreach_drafts").fetchone()[0]
        check("smoke 5: `python -m service.outreach_agent <id>...` writes to $DONORS_DB only",
              p.returncode == 0 and len(got) == len(ids) and after == before,
              f"exit {p.returncode}; scratch drafts {got}; default db {before}->{after}; {p.stderr.strip()[-160:]}")
        sc = sqlite3.connect(scratch)
        orgs = {d for (d,) in sc.execute("SELECT id FROM donors WHERE donor_type='organization'")}
        sc.close()
        # Lead decision: ★ donors and every organization get 'draft' (a human sends); individuals 'ready'
        check("CLI status: ★ or organization -> draft, individual -> ready",
              all(st == ("draft" if stars.get(d) or d in orgs else "ready") for d, st in got.items()),
              f"{ {d: (st, stars.get(d)) for d, st in got.items()} }")

    # --- guardrails ---------------------------------------------------------------------------
    bad = conn.execute("SELECT o.id, o.status FROM outreach_drafts o JOIN donor_scores s ON s.donor_id=o.donor_id "
                       "WHERE s.is_star=1 AND o.status IN ('ready','sent')").fetchall()
    check("no star draft is 'ready' or 'sent'", not bad, f"offending rows: {[tuple(b) for b in bad]}")

    if star is not None:
        for label, sql, params in [
            ("insert", "INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'qa', 'sent')", (star["donor_id"],)),
            ("insert ready", "INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'qa', 'ready')", (star["donor_id"],)),
        ]:
            try:
                conn.execute(sql, params)
                conn.rollback()
                check(f"DB trigger blocks unapproved star send ({label})", False, "insert succeeded")
            except sqlite3.DatabaseError as e:
                check(f"DB trigger blocks unapproved star send ({label})", "star donor" in str(e), str(e))
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
    # Judged the way §9 judges it: a real browser loads each [src] (miamifoundation.org answers scripts with 202)
    import subprocess
    lc = subprocess.run([sys.executable, str(Path(__file__).parent / "link_check.py"), "--from-db", str(db_file),
                         "--from-json", str(REPO / "service" / "org_facts.json")],
                        capture_output=True, text=True, encoding="utf-8", timeout=900)
    bad_links = [l for l in lc.stdout.splitlines() if l.startswith("FAIL")]
    check("every source link loads in a real browser", lc.returncode == 0,
          f"{lc.stdout.count(chr(10) + 'PASS') + lc.stdout.startswith('PASS')} pass; fails: {bad_links}")

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
        # Org donors are real organizations with invented gifts (§3): no invented amount may appear in their draft
        dtype = conn.execute("SELECT donor_type FROM donors WHERE id=?", (donor_id,)).fetchone()[0]
        if dtype == "organization":
            amts = {f"{g['amount']:,.0f}" for g in gifts} | {f"{g['amount']:.0f}" for g in gifts}
            shown = sorted(a for a in amts if re.search(rf"(?<![\d,]){re.escape(a)}(?![\d,])", text))
            check(f"draft {donor_id} (real org): no invented gift amount in the text", not shown, f"shown: {shown}")

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
        check("every donor carries is_sample (SAMPLE label for the UI)",
              all("is_sample" in d for d in after) and any(d["is_sample"] for d in after),
              f"{sum(bool(d.get('is_sample')) for d in after)}/{len(after)} flagged")
    except Exception:
        check("routes run", False, traceback.format_exc().splitlines()[-1])

    # --- every local branch (all worktrees share one .git): none may track origin/main ---------
    import subprocess
    refs = subprocess.run(["git", "for-each-ref", "--format=%(refname:short) %(upstream:short)", "refs/heads"],
                          capture_output=True, text=True, cwd=REPO).stdout.splitlines()
    on_main = [line.split()[0] for line in refs
               if len(line.split()) == 2 and line.split()[1] == "origin/main" and line.split()[0] != "main"]
    check("no local feature branch tracks origin/main", not on_main, f"tracking origin/main: {on_main}")

    # --- whole db: no fictional individual carries research ----------------------------------
    leaked = conn.execute("SELECT d.full_name, count(*) FROM research_facts f JOIN donors d ON d.id=f.donor_id "
                          "WHERE d.donor_type='individual' GROUP BY d.id").fetchall()
    check("0 research_facts on individual donors", not leaked, f"{[tuple(x) for x in leaked]}")

    fails = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} PASS")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
