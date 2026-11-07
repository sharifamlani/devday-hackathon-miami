"""QA probe of the running donor service over real HTTP.

    python qa/service_check.py [http://localhost:8000] [--merge]

Creates drafts (normal use) but does not merge duplicates unless --merge, so the demo data stays intact.
Prints one PASS/FAIL line per check; exits 1 on any FAIL.
"""

from __future__ import annotations

import sys
import time

import httpx

sys.stdout.reconfigure(encoding="utf-8")
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:8000").rstrip("/")
RESULTS: list[bool] = []


def check(name: str, ok: bool, evidence: str = "") -> bool:
    RESULTS.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {evidence}" if evidence else ""))
    return ok


def main() -> int:
    c = httpx.Client(base_url=BASE, timeout=300)

    h = c.get("/health").json()
    check("/health ok, key present, as_of 2026-11-08", h.get("ok") and h.get("openai_key")
          and str(h.get("score_as_of")).startswith("2026-11-08"), str(h))

    t = time.perf_counter()
    r = c.get("/donors")
    secs = time.perf_counter() - t
    donors = r.json()
    check("GET /donors 200 in <= 10 s", r.status_code == 200 and secs <= 10, f"{r.status_code} in {secs:.2f}s, {len(donors)} donors")
    check("#1 is the planted lapsing giver", donors[0]["full_name"] == "Maria Delgado", donors[0]["full_name"])
    by_name = {d["full_name"]: d for d in donors}
    star = next((d for d in donors if d.get("is_star")), None)
    org = next((d for d in donors if d.get("donor_type") == "organization" and not d.get("is_star")), None)
    indiv = donors[0]
    check("a star and a non-star org exist", bool(star and org), f"star={star and star['full_name']}, org={org and org['full_name']}")

    r = c.get(f"/donors/{indiv['id']}")
    d = r.json()
    check("GET /donors/{id} has why + research_facts + outreach_drafts",
          r.status_code == 200 and all(k in d for k in ("research_facts", "outreach_drafts")) and (d.get("why") or d.get("score")),
          f"keys={sorted(d)}")

    r = c.post(f"/enrich/{indiv['id']}")
    e = r.json()
    check("POST /enrich on an individual returns 0 facts (no research on fictional people)",
          r.status_code == 200 and e.get("facts") == [] and e.get("saved") == 0, f"{r.status_code} {str(e)[:160]}")

    r = c.post(f"/enrich/{star['id']}")
    e = r.json()
    check("POST /enrich on the star org returns sourced facts",
          r.status_code == 200 and len(e.get("facts", [])) >= 1 and all(f.get("source_url", "").startswith("http") for f in e["facts"]),
          f"{r.status_code}, {len(e.get('facts', []))} fact(s)")

    for label, who, want in (("star", star, "draft"), ("organization", org, "draft"), ("individual", indiv, "ready")):
        t = time.perf_counter()
        r = c.post(f"/outreach/{who['id']}")
        o = r.json()
        check(f"POST /outreach on {label} -> status {want}, saved with an id",
              r.status_code == 200 and o.get("status") == want and isinstance(o.get("draft_id"), int)
              and len(o.get("facts_used") or []) >= 1,
              f"{r.status_code} in {time.perf_counter() - t:.1f}s; status={o.get('status')} draft_id={o.get('draft_id')} "
              f"facts_used={len(o.get('facts_used') or [])}")
        if label == "star":
            star_draft = o.get("draft_id")

    if star_draft:
        for body, code in (({}, 422), ({"approved_by": ""}, 422), ({"approved_by": "   "}, 422)):
            r = c.post(f"/drafts/{star_draft}/approve", json=body)
            check(f"approve with {body} is refused ({code})", r.status_code == code, f"{r.status_code} {r.text[:100]}")
        r = c.post(f"/drafts/{star_draft}/approve", json={"approved_by": "QA reviewer"})
        a = r.json()
        check("approve with a named person -> approved, approved_by recorded",
              r.status_code == 200 and a.get("status") == "approved" and a.get("approved_by") == "QA reviewer", str(a)[:160])
    check("approve an unknown draft is 404", c.post("/drafts/999999/approve", json={"approved_by": "QA"}).status_code == 404)

    sd = c.get(f"/donors/{star['id']}").json()
    bad = [x for x in sd.get("outreach_drafts", []) if x.get("status") in ("ready", "sent")]
    check("star donor has no 'ready' or 'sent' draft", not bad, str(bad)[:160])
    paths = c.get("/openapi.json").json()["paths"]
    check("no API route sends a message (a human sends outside the tool)", not any("send" in p for p in paths), str(list(paths)))

    for m, p in (("get", "/donors/999999"), ("post", "/enrich/999999"), ("post", "/outreach/999999")):
        r = getattr(c, m)(p)
        check(f"{m.upper()} {p} is 404", r.status_code == 404, str(r.status_code))
    check("GET /donors/abc is 422", c.get("/donors/abc").status_code == 422)

    pre = {"Access-Control-Request-Method": "GET"}
    r = c.options("/donors", headers=pre | {"Origin": "http://localhost:5174"})
    check("CORS allows the UI origin :5174", r.headers.get("access-control-allow-origin") == "http://localhost:5174",
          str(r.headers.get("access-control-allow-origin")))
    r = c.options("/donors", headers=pre | {"Origin": "https://evil.example"})
    check("CORS refuses an unknown origin", r.headers.get("access-control-allow-origin") not in ("*", "https://evil.example"),
          str(r.headers.get("access-control-allow-origin")))

    r = c.get("/duplicates")
    dups = r.json()
    check("GET /duplicates 200 with >=1 suggestion", r.status_code == 200 and len(dups) >= 1, f"{len(dups)} suggestion(s)")
    if "--merge" in sys.argv and dups:
        n = len(donors)
        r = c.post(f"/duplicates/{dups[0]['id']}/merge", json={})
        check("merge reduces the donor count by 1", r.status_code == 200 and len(c.get("/donors").json()) == n - 1)

    print(f"\n{sum(RESULTS)}/{len(RESULTS)} PASS")
    return 0 if all(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
