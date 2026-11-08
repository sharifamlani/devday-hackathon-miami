"""Count once on merge (lead, after a cold upload double-counted the double-recorded $500 check): when staff merge
two people, a gift recorded on both (check log + spreadsheet, split across two records by the upload) counts once.
The repeat is marked 'duplicate' (kept, never counted), restored on undo, never deleted."""

import json
import sqlite3

import pytest

from service import db, dedupe, gift_alerts, score
from service.tests.conftest import AS_OF

CHECK_LOG = "check_deposit_log_q3_2026.docx | table:1:row:3"
EXPORT = "give_miami_day_export_2022-2025.xlsx | sheet:Online:row:45"


def add(conn, name, gifts, email=None):
    did = db.insert_donor(conn, {"full_name": name, "donor_type": "individual", "email": email,
                                 "source_row": "SAMPLE"})
    for amount, day, source in gifts:
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, source_row) VALUES (?, ?, ?, ?)",
                     (did, amount, day, source))
    return did


def suggest(conn, a, b):
    return conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence) "
                        "VALUES (?, ?, '[\"test\"]', 0.75)", (min(a, b), max(a, b))).lastrowid


def ok_totals(conn):
    n, s = conn.execute("SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM gifts WHERE status = 'ok'").fetchone()
    return n, s


def all_rows(conn):
    return sorted(tuple(r) for r in conn.execute("SELECT id, donor_id, amount, gift_date, status, source_row FROM gifts"))


def test_split_check_counts_once_after_merge_and_undo_restores_it(conn):
    """S1 + S2: the $500 check sits on 'Samuel Achterberg' (check log) and 'S. Achterberg' (export, a day later)."""
    samuel = add(conn, "Samuel Achterberg", [(500, "2026-07-14", CHECK_LOG), (250, "2025-07-10", "x.xlsx | row:1")])
    initial = add(conn, "S. Achterberg", [(500, "2026-07-15", EXPORT)])
    sid = suggest(conn, samuel, initial)
    conn.commit()
    before_rows, before = all_rows(conn), ok_totals(conn)
    assert before == (3, 1250)

    result = dedupe.merge(conn, sid, keep_id=samuel)
    assert ok_totals(conn) == (2, 750)                                     # the $500 counts once
    statuses = {r[5]: r[4] for r in all_rows(conn)}
    assert statuses[CHECK_LOG] == "ok" and statuses[EXPORT] == "duplicate"   # the check-log row is the one kept
    assert len(all_rows(conn)) == 3                                        # nothing deleted
    assert len(result["counted_once"]) == 1

    dedupe.undo_merge(conn, result["merge_id"])
    assert all_rows(conn) == before_rows and ok_totals(conn) == before   # both rows back exactly as before


def test_keeps_the_check_row_whichever_donor_is_kept(conn):
    samuel = add(conn, "Samuel Achterberg", [(500, "2026-07-14", CHECK_LOG)])
    initial = add(conn, "S. Achterberg", [(500, "2026-07-15", EXPORT), (90, "2025-01-01", "y.xlsx | row:2")])
    sid = suggest(conn, samuel, initial)
    conn.commit()
    dedupe.merge(conn, sid, keep_id=initial)                                # the export row's donor is kept
    statuses = {r[5]: r[4] for r in all_rows(conn)}
    assert statuses[CHECK_LOG] == "ok" and statuses[EXPORT] == "duplicate"
    assert ok_totals(conn) == (2, 590)


@pytest.mark.parametrize("second", [
    (500, "2026-07-20", EXPORT),                                           # more than 2 days apart
    (500, "2026-07-15", "check_deposit_log_q3_2026.docx | table:1:row:9"),  # same file: two real checks
    (450, "2026-07-15", EXPORT),                                           # a different amount
])
def test_genuinely_different_gifts_are_both_kept(conn, second):
    """S-neg: only the same amount, within 2 days, from different files, with a check on one side, is a repeat."""
    samuel = add(conn, "Samuel Achterberg", [(500, "2026-07-14", CHECK_LOG)])
    other = add(conn, "S. Achterberg", [second])
    sid = suggest(conn, samuel, other)
    conn.commit()
    before = ok_totals(conn)
    assert dedupe.merge(conn, sid, keep_id=samuel)["counted_once"] == []
    assert ok_totals(conn) == before


def test_no_check_on_either_side_is_not_a_repeat(conn):
    a = add(conn, "Ann Lee", [(500, "2026-07-14", "online_gifts.xlsx | row:3")])
    b = add(conn, "A. Lee", [(500, "2026-07-15", "give_miami_day_export_2022-2025.xlsx | sheet:Online:row:9")])
    sid = suggest(conn, a, b)
    conn.commit()
    assert dedupe.merge(conn, sid, keep_id=a)["counted_once"] == []


def test_gifts_already_on_one_person_never_change(conn):
    """Only pairs spanning the two merged people count: ingest's own judgement on one person is left alone."""
    samuel = add(conn, "Samuel Achterberg", [(500, "2026-07-14", CHECK_LOG), (500, "2026-07-15", EXPORT)])
    other = add(conn, "S. Achterberg", [(75, "2025-02-02", "z.md | line:4")])
    sid = suggest(conn, samuel, other)
    conn.commit()
    assert dedupe.merge(conn, sid, keep_id=samuel)["counted_once"] == []
    assert ok_totals(conn) == (3, 1075)


def test_a_duplicate_row_is_neither_a_gift_nor_a_failure_for_alerts(conn):
    monthly = add(conn, "Hye Park", [(40, f"2026-{m:02d}-10", "online.xlsx | row:%d" % m) for m in range(6, 11)])
    conn.execute("UPDATE gifts SET status = 'duplicate' WHERE donor_id = ? AND gift_date = '2026-10-10'", (monthly,))
    conn.commit()
    assert not [a for a in gift_alerts.alerts(conn, AS_OF) if a["donor_id"] == monthly and a["kind"] == "failed"]
    score.run(conn, AS_OF)
    why = json.loads(conn.execute("SELECT why FROM donor_scores WHERE donor_id = ?", (monthly,)).fetchone()[0])
    assert why["gift_count"] == 4                                           # the duplicate isn't counted


def test_a_rebuild_that_crashed_halfway_recovers(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE donors (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL);
        CREATE TABLE gifts (id INTEGER PRIMARY KEY, donor_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
            amount REAL NOT NULL, gift_date TEXT NOT NULL, channel TEXT, fund_type TEXT, source_row TEXT,
            status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'declined', 'failed')));
        CREATE TABLE gifts_new (id INTEGER PRIMARY KEY);
        INSERT INTO donors VALUES (1, 'Ann');
        INSERT INTO gifts (id, donor_id, amount, gift_date) VALUES (7, 1, 40, '2026-10-10');
    """)
    old.commit()
    old.close()
    conn = db.connect(path)
    assert db.migrate_gifts_status_check(conn) is True
    assert tuple(conn.execute("SELECT id, amount, status FROM gifts").fetchone()) == (7, 40.0, "ok")
    assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'gifts_new'").fetchone()
    conn.close()


def test_an_older_gifts_table_is_rebuilt_to_allow_duplicate(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE donors (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL);
        CREATE TABLE gifts (id INTEGER PRIMARY KEY, donor_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
            amount REAL NOT NULL, gift_date TEXT NOT NULL, channel TEXT, fund_type TEXT, source_row TEXT,
            status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'declined', 'failed')));
        CREATE INDEX idx_gifts_donor ON gifts(donor_id);
        INSERT INTO donors VALUES (1, 'Ann');
        INSERT INTO gifts (id, donor_id, amount, gift_date, status) VALUES (7, 1, 40, '2026-10-10', 'declined');
    """)
    old.commit()
    old.close()
    conn = db.connect(path)
    db.create_schema(conn, force=True)
    assert tuple(conn.execute("SELECT id, donor_id, amount, status FROM gifts").fetchone()) == (7, 1, 40.0, "declined")
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, status) VALUES (1, 5, '2026-01-01', 'duplicate')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, status) VALUES (1, 5, '2026-01-01', 'pending')")
    assert db.migrate_gifts_status_check(conn) is False                    # idempotent
    assert conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_gifts_donor'").fetchone()
    conn.close()
