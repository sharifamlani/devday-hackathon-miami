"""Ingest adapter tests. Needs stat-mcp PR #59 (stat_mcp.file_ingest / transactions).

Offline: normalizers, tab rules, cross-file check dedupe, DB writes from injected events, the router.
End to end: data/sample_inputs/ through POST /ingest, graded against answer_key.json (needs OPENAI_API_KEY).
"""

import json
import os
import re
import sqlite3
import unicodedata
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import config, db, ingest_adapter as ia, ingest_router

SAMPLES = Path(__file__).resolve().parents[2] / "data" / "sample_inputs"
KEY = json.loads((SAMPLES / "answer_key.json").read_text(encoding="utf-8"))
FILES = KEY["files"]


def _ev(first, last="", email="", amount=None, date=None, loc="row:1", notes=None, org=None, channel=None, ctype="contact"):
    from stat_mcp.schemas import ImportedTransaction

    return ImportedTransaction(
        first_name=first,
        last_name=last,
        email_address=email,
        organization=org,
        transaction_type="gift" if amount is not None else "profile",
        amount=Decimal(str(amount)) if amount is not None else None,
        transaction_date=date,
        source_location=loc,
        notes=notes,
        channel=channel,
        contact_type=ctype,
    )


def test_normalizers():
    assert ia.norm_email(" Maria.Delgado@Example.COM ") == "maria.delgado@example.com"
    assert ia.norm_email("not an email") is None
    assert ia.norm_phone("(305) 555-0101") == "305-555-0101"
    assert ia.norm_phone("1 305 555 0101") == "305-555-0101"
    assert ia.norm_amount("$1,250.50") == 1250.5 and ia.norm_amount("pledge") is None
    assert ia.norm_date("11/17/2022") == "2022-11-17" and ia.norm_date("Nov 17, 2022") == "2022-11-17"
    assert ia.norm_date("September 15, 2026") == "2026-09-15"  # 'Sept' rule must not mangle 'September'
    assert ia.norm_date("Sept 22", 2026) == "2026-09-22"
    assert ia.norm_date("sometime") is None


def test_tab_rules():
    assert ia.decide_tab("auto", True, "neighbor", "") == ("giver", None)
    assert ia.decide_tab("auto", False, "community", "")[0] == "community"
    assert ia.decide_tab("auto", False, "neighbor", "")[0] == "neighbor"
    tab, review = ia.decide_tab("auto", False, "giver", "pledge")
    assert tab == "neighbor" and review
    assert ia.decide_tab("community", True, "giver", "") == ("community", None)


def test_same_check_in_two_files_counts_once():
    g = lambda src, ch=None: {
        "amount": 500.0,
        "gift_date": "2026-07-14" if "log" in src else "2026-07-15",
        "channel": ch,
        "status": "ok",
        "source_row": f"{src} | x",
    }
    out = ia.collapse_cross_file_repeats([g("sheet.xlsx"), g("check_deposit_log.docx")], [])
    assert len(out) == 1 and "check_deposit_log" in out[0]["source_row"]
    two = [g("a.xlsx"), {**g("b.xlsx"), "gift_date": "2026-09-01"}]
    assert len(ia.collapse_cross_file_repeats(two, [])) == 2  # no check involved, keep both


def _events():
    return {
        "a.md": [
            _ev("Ann", "Lee", "Ann@Example.com", 100, "2024-03-04", "row:1"),
            _ev("Ann", "Lee", "ann@example.com", 100, "2024-03-04", "row:1"),  # exact repeat of the same row
            _ev("Ann", "Lee", "ann@example.com", 50, "2025-03-04", "row:5"),
            _ev("Hye", "Park", "", 40, "2026-10-10", "row:8"),
            _ev("Hye", "Park", "", 40, "2026-11-10", "row:9", notes="monthly - card declined"),
            _ev("Dee", "Ortiz", "", None, None, "line:3", ctype="beneficiary"),
            _ev("Eli", "Fox", "", None, None, "line:4"),
            _ev("", "", "", 25, "Sept 22", "line:6", org="Halcyon Reef Dental Group"),
        ]
    }


def _judgments():
    J = ia.Judgment
    return {
        "p0": J(key="p0", contact_type="giver", reason="gave"),
        "p1": J(key="p1", contact_type="giver", reason="gave"),
        "p2": J(key="p2", contact_type="community", reason="intake form", has_dog=True, interests=["gardening"]),
        "p3": J(key="p3", contact_type="giver", reason="says he will give", ambiguous=True),
        "p4": J(key="p4", contact_type="giver", reason="gave"),
    }


@pytest.mark.parametrize("with_status", [True, False])
def test_ingest_events_writes_db(tmp_path, with_status):
    conn = db.connect(tmp_path / "t.db")
    db.create_schema(conn)
    has_status = "status" in {r[1] for r in conn.execute("PRAGMA table_info(gifts)")}
    if with_status and not has_status:
        conn.execute("ALTER TABLE gifts ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'")
    elif not with_status and has_status:
        pytest.skip("gifts.status is part of the schema now (#60); the no-status path can't occur")
    res = ia.ingest_events(_events(), "auto", conn, judgments=_judgments())
    assert res["people_added"] == 5
    assert res["by_tab"] == {"giver": 3, "neighbor": 1, "community": 1}
    assert [f["name"] for f in res["flagged_for_review"]] == ["Eli Fox"]  # says giver, no gift, flagged
    ann = conn.execute("SELECT * FROM donors WHERE full_name='Ann Lee'").fetchone()
    assert ann["email"] == "ann@example.com" and ann["first_name"] == "Ann"
    org = conn.execute("SELECT donor_type FROM donors WHERE full_name LIKE 'Halcyon%'").fetchone()
    assert org["donor_type"] == "organization"
    if with_status:
        assert res["gifts_added"] == 5
        assert (
            conn.execute("SELECT status FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE d.full_name='Hye Park'").fetchone()[0]
            == "declined"
        )
    else:
        assert res["gifts_added"] == 4 and any("declined" in w for w in res["warnings"])
    # With the three tabs (#60) only Givers get a propensity score; Neighbors/Community are not scored.
    assert conn.execute("SELECT COUNT(*) FROM donor_scores").fetchone()[0] == res["by_tab"]["giver"]


def test_router_unreadable_file_refuses_whole_batch(tmp_path, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "r.db"))
    app = FastAPI()
    app.include_router(ingest_router.router)
    c = TestClient(app)
    assert c.post("/ingest", files=[("files", ("a.md", b"hi", "text/plain"))], data={"target": "bogus"}).status_code == 422
    r = c.post("/ingest", files=[("files", ("b.exe", b"x", "x/y"))], data={"target": "giver"})
    assert r.status_code == 422 and "b.exe" in r.json()["detail"] and "Nothing was imported" in r.json()["detail"]
    assert (
        not (tmp_path / "r.db").exists()
        or sqlite3.connect(tmp_path / "r.db").execute("SELECT COUNT(*) FROM donors").fetchone()[0] == 0
    )


def test_dry_run_writes_nothing_and_unusable_gifts_go_to_review(tmp_path):
    conn = db.connect(tmp_path / "d.db")
    db.create_schema(conn)
    ev = {
        "a.md": [
            _ev("Ann", "Lee", "ann@example.com", 100, "2024-03-04", "row:1"),
            _ev("Bo", "Ray", "bo@example.com", 50, "someday", "row:2"),
        ]
    }
    review = []
    people = ia.prepare_people(ev, [], review)
    assert [r["person"] for r in review] == ["Bo Ray"]
    res = ia.ingest_events(ev, "giver", conn, judgments={}, people=people, review_required=review, dry_run=True)
    assert res["people_added"] == 2 and res["gifts_added"] == 1 and res["dry_run"] is True
    assert conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM gifts").fetchone()[0] == 0


def test_grouping_is_exact_email_or_exact_name():
    ev = {
        "a.md": [
            _ev("Ann", "Lee", "ann@example.com", 10, "2024-01-01", "r:1"),
            _ev("A.", "Lee", "ANN@example.com", 10, "2024-02-01", "r:2"),  # same email -> same person
            _ev("Ann", "Lee", "", 10, "2024-03-01", "r:3"),  # same exact name -> same person
            _ev("Anne", "Lee", "", 10, "2024-04-01", "r:4"),
        ]
    }  # fuzzy -> left for dedupe
    assert len(ia.build_people(ev, [])) == 2


# ------------------------------------------------------------------ end to end vs the answer key


def _ascii(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower())


needs_key = pytest.mark.skipif(not os.getenv("OPENAI_API_KEY"), reason="needs OPENAI_API_KEY")


@needs_key
def test_end_to_end_sample_inputs(tmp_path, monkeypatch):
    path = tmp_path / "e2e.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    app = FastAPI()
    app.include_router(ingest_router.router)
    c = TestClient(app)
    files = [("files", (n, (SAMPLES / n).read_bytes(), "application/octet-stream")) for n in FILES]
    r = c.post("/ingest", files=files, data={"target": "auto"})
    assert r.status_code == 200, r.text
    body = r.json()
    print("\nRESPONSE:", json.dumps({k: v for k, v in body.items() if k not in ("flagged_for_review", "assigned")}))

    t = KEY["totals"]
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    n_people = conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0]
    has_status = "status" in {x[1] for x in conn.execute("PRAGMA table_info(gifts)")}
    ok = " WHERE status = 'ok'" if has_status else ""  # declined/failed charges are excluded from totals
    n_gifts, total = conn.execute("SELECT COUNT(*), COALESCE(SUM(amount),0) FROM gifts" + ok).fetchone()
    rows = [dict(x) for x in conn.execute("SELECT * FROM donors")]
    assigned = {a["donor_id"]: a["tab"] for a in body["assigned"]}

    def matches(p):
        em = {e.lower() for e in p.get("emails_all", [])}
        nm = {_ascii(x) for x in p.get("names_as_written", []) + [p["full_name"]]}
        return [
            d
            for d in rows
            if _ascii(d["full_name"]) in nm or (em and em & {e.lower() for e in json.loads(d["emails_all"] or "[]")})
        ]

    canon = {d["donor_id"]: d for d in KEY["canonical_donors"]}
    people = [{**canon.get(p["person_id"], {}), **p} for p in KEY["people"]]
    found = [p for p in people if matches(p)]
    right = [p for p in found if any(assigned[d["id"]] == p["tab"] for d in matches(p))]
    per_tab = {
        tb: (sum(1 for p in right if p["tab"] == tb), sum(1 for p in found if p["tab"] == tb))
        for tb in ("giver", "neighbor", "community")
    }
    flagged_names = {_ascii(f["name"]) for f in body["flagged_for_review"]}
    amb = [p for p in KEY["people"] if p["ambiguous"]]
    amb_hit = [p["full_name"] for p in amb if _ascii(p["full_name"]) in flagged_names]
    failed_in = conn.execute(
        "SELECT COUNT(*) FROM gifts g JOIN donors d ON d.id=g.donor_id "
        "WHERE d.full_name LIKE 'Hye-jin%' AND g.gift_date='2026-10-10'" + (" AND g.status = 'ok'" if has_status else "")
    ).fetchone()[0]
    print(
        f"people in db {n_people} vs key {len(KEY['people'])} persons; key persons found {len(found)}/{len(people)}; "
        f"gifts {n_gifts} vs {t['unique_gifts']}; total {total:,.0f} vs {t['total_amount']:,}; "
        f"tab accuracy {len(right)}/{len(found)} per tab {per_tab}; ambiguous flagged {amb_hit} of "
        f"{[p['full_name'] for p in amb]}; declined charge counted as ok gift: {failed_in}; seconds {body['seconds']}"
    )
    assert len(found) / len(people) >= 0.9
    assert abs(n_gifts - t["unique_gifts"]) <= 0.02 * t["unique_gifts"]
    assert abs(total - t["total_amount"]) <= 0.02 * t["total_amount"]
    assert failed_in == 0
    assert len(right) / len(found) >= 0.95
    assert len(amb_hit) == len(amb)
    assert conn.execute("SELECT COUNT(*) FROM donor_scores").fetchone()[0] == n_people
    assert sum(body["by_tab"].values()) == n_people
