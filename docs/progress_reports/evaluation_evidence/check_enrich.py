"""c9 evaluator: live enrich dry runs (refresh, no cache) on fictional sample orgs, real orgs, and a made-up person."""
import json, os, sqlite3, sys, time
from fastapi.testclient import TestClient
from service.main import app
conn = sqlite3.connect(os.environ["DONORS_DB"]); conn.row_factory = sqlite3.Row
def add(name, kind, city="Miami"):
    row = conn.execute("select id from donors where full_name = ?", (name,)).fetchone()
    if row: return row[0]
    cid = conn.execute("insert into donors (full_name, donor_type, city, state, source_row) values (?, ?, ?, 'FL', 'c9 eval scratch')", (name, kind, city)).lastrowid
    conn.commit(); return cid
runs = [("fictional sample org", r["id"], r["full_name"]) for r in conn.execute(
    "select id, full_name from donors where donor_type='organization' and full_name in "
    "('Veloria Bay Foundation', 'Ostrander-Pell Charitable Trust', 'Whitaker Family Charitable Fund')")]
for name in ("John S. and James L. Knight Foundation", "Frederick A. DeLuca Foundation", "McDermott Will & Schulte"):
    runs.append(("real org", add(name, "organization"), name))
runs.append(("made-up person", add("Zephyrine Quillabottom-Adeyemi", "individual"), "Zephyrine Quillabottom-Adeyemi"))
with TestClient(app) as c:
    slugs = {t.get("slug") or t.get("tag") for t in c.get("/interest-tags").json()}
    print(f"interest-tags: {len(slugs)} slugs")
    before = conn.execute("select count(*) from donor_interests").fetchone()[0] if conn.execute("select 1 from sqlite_master where name='donor_interests'").fetchone() else None
    for label, did, name in runs:
        t = time.time(); r = c.post(f"/enrich/{did}?dry_run=1&refresh=1", timeout=300)
        b = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text[:200]}
        tags = b.get("interests") or []
        outside = [x.get("tag") for x in tags if x.get("tag") not in slugs]
        unsourced = [x.get("tag") for x in tags if not (x.get("source_url") or x.get("url"))]
        print(f"[{label}] {name}: HTTP {r.status_code} in {time.time()-t:.0f}s | tags {[(x.get('tag'), x.get('sub_tag'), (x.get('source_url') or x.get('url') or '')[:60]) for x in tags]} | outside the 17: {outside} | unsourced: {unsourced} | identity: {b.get('identity') or b.get('status') or ''}")
    after = conn.execute("select count(*) from donor_interests").fetchone()[0] if before is not None else None
    print(f"donor_interests rows before/after dry runs: {before}/{after} (0 writes expected)")
