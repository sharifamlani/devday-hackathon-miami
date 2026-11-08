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


# ------------------------------------------------------------------ same person, written differently (offline)


def _names(people):
    return sorted(ia.best_name(p) for p in people)


def test_variants_of_one_person_collapse():
    ev = {
        "gmd.xlsx": [
            _ev("Robert", "Nguyen", "robert.nguyen@example.org", 100, "2024-01-01", "r:1"),
            _ev("Mildred", "Hayes", "", None, None, "r:2", ctype="beneficiary"),
            _ev("Rosa Elena", "Martinez", "", None, None, "r:3"),
            _ev("Elizabeth", "Fontaine", "liz.fontaine@example.com", 50, "2024-02-02", "r:4"),
            _ev("Dana", "Kowalczyk", "", 25, "2024-03-03", "r:5"),
            _ev("Marcus", "Bell", "", None, None, "r:6"),
            _ev("Marcus", "Oyelaran", "marcus@example.org", 10, "2024-04-04", "r:7"),
        ],
        "log.docx": [
            _ev("Bob", "Nguyen", "", 40, "2024-05-05", "t:1"),  # nickname, no email on this side
            _ev("Liz", "Fontaine", "", 20, "2024-06-06", "t:2"),
            _ev("D.", "Kowalczyk", "", 15, "2024-07-07", "t:3"),  # initial
            _ev("R.", "Nguyen", "", None, None, "t:4"),
        ],
        "signin.xlsx": [
            _ev("Millie", "Hayes", "", None, None, "s:1"),
            _ev("Rosa E.", "Martinez", "", None, None, "s:2"),
        ],
    }
    ev["gmd.xlsx"][1].phone_number = ev["signin.xlsx"][0].phone_number = "305-555-0159"
    ev["gmd.xlsx"][2].phone_number = ev["signin.xlsx"][1].phone_number = "(305) 555-0150"
    people = ia.prepare_people(ev, [])
    assert _names(people) == [
        "Dana Kowalczyk",
        "Elizabeth Fontaine",
        "Marcus Bell",
        "Marcus Oyelaran",
        "Mildred Hayes",
        "Robert Nguyen",
        "Rosa Elena Martinez",
    ]
    rob = next(p for p in people if ia.best_name(p) == "Robert Nguyen")
    assert len(rob["gifts"]) == 2  # both gifts stay on the one person


def test_contradicting_contact_details_are_not_collapsed():
    ev = {
        "a.md": [
            _ev("Dana", "Lee", "dana@one.example.com", 10, "2024-01-01", "r:1"),
            _ev("D.", "Lee", "dee@two.example.com", 10, "2024-02-01", "r:2"),  # a different address: could be someone else
        ]
    }
    assert len(ia.prepare_people(ev, [])) == 2


def test_same_exact_name_with_two_emails_is_one_person_with_both_addresses():
    ev = {
        "a.md": [
            _ev("Priscilla", "Okafor", "priscilla.okafor@example.com", 10, "2024-01-01", "r:1"),
            _ev("Priscilla", "Okafor", "priscilla.okafor.law@example.org", 20, "2025-01-01", "r:2"),
        ]
    }
    (p,) = ia.prepare_people(ev, [])
    assert sorted(p["emails"]) == ["priscilla.okafor.law@example.org", "priscilla.okafor@example.com"]
    assert len(p["gifts"]) == 2


def test_name_fragments_are_dropped_unless_they_match_contact_or_carry_a_gift():
    warnings = []
    ev = {
        "a.md": [
            _ev("Ann", "Lee", "ann@example.com", 10, "2024-01-01", "r:1"),
            _ev("Dwayne", "", "", None, None, "line:1", org="the hardware place"),  # no surname, nothing to match: drop
            _ev("Bob", "N.", "", None, None, "line:2"),
            _ev("Anna", "", "ann@example.com", None, None, "line:3"),  # no surname but Ann's email: same email, same person
            _ev("Cy", "", "", 30, "2024-02-02", "line:4"),  # carries a gift and matches no one: kept, no money is lost
        ]
    }
    people = ia.prepare_people(ev, warnings)
    assert _names(people) == ["Ann Lee", "Cy"]
    assert any("dropped name fragment 'Dwayne'" in w for w in warnings)
    assert sum(len(p["gifts"]) for p in people) == 2


def test_totals_row_is_not_a_person():
    ev = {
        "gmd.xlsx": [
            _ev("", "", "", 8640, "2024-01-01", "row:58", org="Grand total"),
            _ev("Ann", "Lee", "", 5, "2024-01-01", "row:2"),
        ]
    }
    warnings = []
    assert _names(ia.prepare_people(ev, warnings)) == ["Ann Lee"]
    assert any("totals row" in w for w in warnings)


def test_organization_variants_their_contact_and_family_fund_collapse():
    ev = {
        "major.xlsx": [
            _ev("", "", "grants@example.org", 100, "2022-01-01", "r:1", org="Veloria Bay Fdn"),
            _ev("", "", "", 100, "2023-01-01", "r:2", org="Veloria Bay Foundation Inc"),
            _ev("", "", "harold@example.org", 50, "2022-12-15", "r:3", org="Harold Whitaker"),
        ],
        "memo.docx": [_ev("", "", "", 10000, "2024-12-20", "r:4", org="Whitaker Family Charitable Fund")],
        "check.docx": [_ev("", "", "", 500, "2026-07-01", "t:1", org="Marrow Lane Print Co.")],
        "intake.docx": [_ev("Bernard", "Okoye", "billing@marrow.example.org", None, None, "f:1", org="Marrow Lane Print Co.")],
    }
    people = ia.prepare_people(ev, [])
    assert _names(people) == ["Harold Whitaker", "Marrow Lane Print Co.", "Veloria Bay Foundation Inc"]
    harold = next(p for p in people if ia.best_name(p) == "Harold Whitaker")
    assert len(harold["gifts"]) == 2


def test_two_people_with_one_surname_do_not_get_the_family_fund():
    ev = {
        "a.xlsx": [
            _ev("Harold", "Whitaker", "h@example.org", 5, "2024-01-01", "r:1"),
            _ev("Jane", "Whitaker", "j@example.org", 5, "2024-01-01", "r:2"),
            _ev("", "", "", 9, "2024-02-02", "r:3", org="Whitaker Family Charitable Fund"),
        ]
    }
    assert len(ia.prepare_people(ev, [])) == 3


def test_same_files_in_any_order_give_same_people():
    a = {"a.md": [_ev("Ann", "Lee", "", 1, "2024-01-01", "r:1")], "b.md": [_ev("Bo", "Ray", "", 2, "2024-01-01", "r:1")]}
    b = {"b.md": a["b.md"], "a.md": a["a.md"]}
    assert _names(ia.prepare_people(a, [])) == _names(ia.prepare_people(b, []))


# ------------------------------------------------------------------ cache: same input, same model answer


def test_model_answers_are_cached_by_content(tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace

    monkeypatch.setenv("INGEST_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("INGEST_CACHE", raising=False)
    calls = []

    async def fake_run(agent, prompt):
        calls.append(prompt)
        out = ia.Judgments(people=[ia.Judgment(key="p0", contact_type="giver", reason=f"v{len(calls)}")])
        return SimpleNamespace(final_output=out)

    monkeypatch.setattr("agents.Runner.run", staticmethod(fake_run))
    first = asyncio.run(ia._run_cached("judge", ia._judge_agent(), "same prompt", ia.Judgments))
    again = asyncio.run(ia._run_cached("judge", ia._judge_agent(), "same prompt", ia.Judgments))
    other = asyncio.run(ia._run_cached("judge", ia._judge_agent(), "another prompt", ia.Judgments))
    assert len(calls) == 2 and first == again and other.people[0].reason == "v2"
    monkeypatch.setenv("INGEST_CACHE", "off")
    asyncio.run(ia._run_cached("judge", ia._judge_agent(), "same prompt", ia.Judgments))
    assert len(calls) == 3  # cache off: a fresh model answer


# ------------------------------------------------------------------ demographics: JSON the readers can parse


def test_demographics_are_stored_as_json_per_field():
    d = ia.Demographics(age_range="born 1984", gender="female", language="Spanish", programs=["pantry"], summary="Self-reported: born 1984")
    where = "community.docx: section 'Intake Form 6'"
    stored = json.loads(ia.demographics_json(d, where))
    assert stored["age_range"] == {"value": "born 1984", "source_row": where}
    assert stored["programs"]["value"] == ["pantry"] and stored["summary"]["value"].startswith("Self-reported")
    assert "household_size" not in stored and ia.demographics_json(ia.Demographics(), "x") is None
    assert ia.Judgment(key="p0", contact_type="community", reason="r", demographics="born 1984").demographics.summary == "born 1984"


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "r.db"))
    db.rebuild(with_seed=False)
    from service.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_routes_survive_free_text_demographics(tmp_path, monkeypatch):
    """Rows written by an older import hold plain text in donors.demographics; the readers must not 500."""
    c = _client(tmp_path, monkeypatch)
    conn = db.connect()
    texts = ["Self-reported: born 1984; female; Spanish at home", json.dumps({"zip": {"value": "33125", "source_row": "x"}}), None, "[1, 2]"]
    for n, demo in enumerate(texts):
        conn.execute(
            "INSERT INTO donors (full_name, donor_type, contact_type, demographics, interests) "
            "VALUES (?, 'individual', 'community', ?, '[]')",
            (f"Pat Person{n}", demo),
        )
    conn.commit()
    ids = [r[0] for r in conn.execute("SELECT id FROM donors")]
    conn.close()
    for route in ("/people?type=community", "/community/stats", "/duplicates", "/donors"):
        assert c.get(route).status_code == 200, route
    for i in ids:
        assert c.get(f"/donors/{i}").status_code == 200
    body = c.get("/people?type=community").json()
    rows = body["people"] if isinstance(body, dict) else body
    assert any(str(r["demographics"].get("summary", {}).get("value", "")).startswith("Self-reported") for r in rows)

def test_intake_files_place_people_without_the_model():
    # community / client intake file, no gift: community, whatever the model guessed
    assert ia.decide_tab("auto", False, "neighbor", "", served=True) == ("community", None)
    assert ia.decide_tab("auto", False, "giver", "", served=True, ambiguous=True)[0] == "neighbor"  # model doubts: flagged
    assert ia.decide_tab("auto", True, "community", "", served=True)[0] == "giver"  # a gift on record wins
    # donor intake form, no gift yet, model not in doubt: a new donor
    assert ia.decide_tab("auto", False, "neighbor", "", ambiguous=False, new_donor=True) == ("giver", None)
    assert ia.decide_tab("auto", False, "giver", "pledge", ambiguous=True, new_donor=True)[0] == "neighbor"
    assert ia.served_by_file(["community_intake_forms_2026.docx"]) and not ia.served_by_file(["donor_intake_forms_2026.docx"])
    assert ia.new_donor_by_file(["donor_intake_forms_2026.docx"]) and not ia.new_donor_by_file(["community_intake_forms_2026.docx"])


# ------------------------------------------------------------------ end to end vs the answer key (real model calls)


def _ascii(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower())


needs_key = pytest.mark.skipif(not os.getenv("OPENAI_API_KEY"), reason="needs OPENAI_API_KEY")


def _post_ingest(db_path, files, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(db_path))
    db.rebuild(with_seed=False)
    from service.main import app

    c = TestClient(app, raise_server_exceptions=False)
    r = c.post("/ingest", files=[("files", (n, (SAMPLES / n).read_bytes(), "application/octet-stream")) for n in files], data={"target": "auto"})
    assert r.status_code == 200, r.text
    return c, r.json()


def _people_rows(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    rows = [dict(x) for x in conn.execute("SELECT * FROM donors ORDER BY full_name")]
    conn.close()
    return rows


@needs_key
def test_end_to_end_sample_inputs(tmp_path, monkeypatch):
    """data/sample_inputs through POST /ingest, graded against whatever answer_key.json is checked in
    (no totals hard-coded here). A second, cache-replayed run must give the identical people."""
    monkeypatch.setenv("INGEST_CACHE_DIR", str(tmp_path / "cache"))  # a cold first run: real model answers
    monkeypatch.delenv("INGEST_CACHE", raising=False)
    c, body = _post_ingest(tmp_path / "run1.db", FILES, monkeypatch)
    rows = _people_rows(tmp_path / "run1.db")
    assigned = {a["donor_id"]: a["tab"] for a in body["assigned"]}
    t = KEY["totals"]

    conn = sqlite3.connect(tmp_path / "run1.db")
    n_gifts, total = conn.execute("SELECT COUNT(*), COALESCE(SUM(amount),0) FROM gifts WHERE status = 'ok'").fetchone()
    scored = conn.execute("SELECT COUNT(*) FROM donor_scores").fetchone()[0]
    failed_in = conn.execute(
        "SELECT COUNT(*) FROM gifts g JOIN donors d ON d.id=g.donor_id "
        "WHERE d.full_name LIKE 'Hye-jin%' AND g.gift_date='2026-10-10' AND g.status = 'ok'"
    ).fetchone()[0]
    conn.close()

    # people: one row per key person, none left over
    def matches(p):
        em = {e.lower() for e in p.get("emails_all", [])}
        nm = {_ascii(x) for x in p.get("names_as_written", []) + [p["full_name"]]}
        return [d for d in rows if _ascii(d["full_name"]) in nm or (em and em & {e.lower() for e in json.loads(d["emails_all"] or "[]")})]

    canon = {d["donor_id"]: d for d in KEY["canonical_donors"]}
    people = [{**canon.get(p["person_id"], {}), **p} for p in KEY["people"]]
    hit = {p["person_id"]: matches(p) for p in people}
    extra = [d["full_name"] for d in rows if not any(d in m for m in hit.values())]
    assert len(rows) == len(KEY["people"]), (len(rows), extra)
    assert all(len(m) == 1 for m in hit.values()), {k: [d["full_name"] for d in m] for k, m in hit.items() if len(m) != 1}
    by_tab = {tb: sum(1 for d in rows if assigned[d["id"]] == tb) for tb in ("giver", "neighbor", "community")}
    assert by_tab == KEY["tab_counts"]
    wrong = [p["full_name"] for p in people if assigned[hit[p["person_id"]][0]["id"]] != p["tab"]]
    assert not wrong, wrong

    # the ambiguous few are flagged for review, nobody else
    flagged = {_ascii(f["name"]) for f in body["flagged_for_review"]}
    assert flagged == {_ascii(p["full_name"]) for p in KEY["people"] if p["ambiguous"]}

    # money: exact, with the declined charge left out
    assert n_gifts == t["unique_gifts"] and round(total) == t["total_amount"] and failed_in == 0
    assert scored == by_tab["giver"]  # only Givers are scored

    # the routes the demo opens next all answer, and the gift alerts are the key's five
    for route in ("/duplicates", "/people?type=community", "/community/stats", "/donors"):
        assert c.get(route).status_code == 200, route
    for r in rows:
        if r["contact_type"] == "community":
            assert c.get(f"/donors/{r['id']}").status_code == 200
    alerts = c.get("/alerts")
    assert alerts.status_code == 200
    assert sorted((a["donor"], a["kind"]) for a in alerts.json()) == sorted((e["donor"], e["kind"]) for e in KEY["gift_alerts_expected"])

    # determinism: the same files again give the same people, in the same tabs, with the same flags
    _, body2 = _post_ingest(tmp_path / "run2.db", list(reversed(FILES)), monkeypatch)  # even dragged in another order
    again = _people_rows(tmp_path / "run2.db")
    assert [d["full_name"] for d in again] == [d["full_name"] for d in rows]
    assert body2["by_tab"] == body["by_tab"] and body2["gifts_added"] == body["gifts_added"]
    assert sorted(f["name"] for f in body2["flagged_for_review"]) == sorted(f["name"] for f in body["flagged_for_review"])


@needs_key
def test_five_file_upload_keeps_every_gift(tmp_path, monkeypatch):
    """The UI's gift-only path (notes, check log, donor intake, GMD export, stock/DAF memo): every key gift that
    lives in those files must arrive, matched on amount and date."""
    five = [
        "board_retreat_notes.md",
        "check_deposit_log_q3_2026.docx",
        "donor_intake_forms_2026.docx",
        "give_miami_day_export_2022-2025.xlsx",
        "stock_and_daf_grants.docx",
    ]
    monkeypatch.setenv("INGEST_CACHE_DIR", str(tmp_path / "cache"))
    _post_ingest(tmp_path / "five.db", five, monkeypatch)
    conn = sqlite3.connect(tmp_path / "five.db")
    got = sorted((round(a, 2), d) for a, d in conn.execute("SELECT amount, gift_date FROM gifts WHERE status = 'ok'"))
    conn.close()
    want = sorted((float(g["amount"]), g["gift_date"]) for g in KEY["gifts"] if g["source"]["file"] in five)
    assert got == want


def test_missing_people_from_prose_skip_fragments_and_variants_of_listed_people(monkeypatch):
    import asyncio

    ev = {"a.md": [_ev("Mildred", "Hayes", "", None, None, "r:1"), _ev("Ann", "Lee", "ann@example.com", 5, "2024-01-01", "r:2")]}

    async def read_all(files, warnings):
        return ev

    async def nothing(*a, **k):
        return None

    async def judge_all(people, prose, warnings):
        return {}

    def extra(name):
        return ia.ExtraPerson(name=name, contact_type="neighbor", reason="r", where="line 1")

    async def missing(people, prose, warnings):
        return [extra("Dwayne (from the hardware place)"), extra("Millie Hayes"), extra("Bob N."), extra("Zed Quill")]

    monkeypatch.setattr(ia, "_read_all", read_all)
    monkeypatch.setattr(ia, "_prose_context", lambda files: "notes")
    monkeypatch.setattr(ia, "_review_prose_gifts", nothing)
    monkeypatch.setattr(ia, "_judge_all", judge_all)
    monkeypatch.setattr(ia, "_find_missing_people", missing)
    _, people, _ = asyncio.run(ia._prepare([("a.md", b"")], "auto", [], []))
    assert sorted(p["names"][0] for p in people) == ["Ann Lee", "Mildred Hayes", "Zed Quill"]
