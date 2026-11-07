import json
import sqlite3

import pytest

from service import db, dedupe, score
from service.tests.conftest import AS_OF


def add(conn, **donor):
    donor.setdefault("donor_type", "individual")
    return db.insert_donor(conn, donor)


def test_shared_email_in_emails_all_is_suggested(conn):
    a = add(conn, full_name="Maria Delgado", email="maria.delgado@example.com")
    b = add(conn, full_name="M. Ruiz", email="work@x.com", emails_all=["work@x.com", " Maria.Delgado@Example.com "])
    pairs = dedupe.find_pairs([dict(r) for r in conn.execute("SELECT * FROM donors")])
    assert len(pairs) == 1
    assert (pairs[0]["donor_a_id"], pairs[0]["donor_b_id"]) == (a, b)
    assert pairs[0]["confidence"] == 0.95


def test_close_name_and_same_phone_is_suggested(conn):
    add(conn, full_name="Robert Nguyen", phone="+1 (305) 555-0177")
    add(conn, full_name="Robert J. Nguyen", phone="305.555.0177")
    pairs = dedupe.find_pairs([dict(r) for r in conn.execute("SELECT * FROM donors")])
    assert len(pairs) == 1 and pairs[0]["confidence"] == 0.90


def test_close_name_and_same_city_is_suggested_low_confidence(conn):
    add(conn, full_name="Angela Brooks", city="Homestead", state="FL")
    add(conn, full_name="Angela Brookes", city="homestead", state="FL")
    pairs = dedupe.find_pairs([dict(r) for r in conn.execute("SELECT * FROM donors")])
    assert len(pairs) == 1 and pairs[0]["confidence"] == 0.70


def test_different_people_same_city_not_suggested(conn):
    add(conn, full_name="Angela Brooks", city="Miami", state="FL", phone="3055550001")
    add(conn, full_name="Luis Herrera", city="Miami", state="FL", phone="3055550002")
    add(conn, full_name="Maria Lopez", city="Miami", state="FL")
    add(conn, full_name="Maria Delgado", city="Miami", state="FL")
    assert dedupe.find_pairs([dict(r) for r in conn.execute("SELECT * FROM donors")]) == []


def test_seed_planted_duplicate_found_and_run_never_merges(conn):
    db.seed(conn)
    n_before = conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0]
    assert dedupe.run(conn) == 1
    s = conn.execute("SELECT * FROM duplicate_suggestions").fetchone()
    names = {r["full_name"] for r in conn.execute(
        "SELECT full_name FROM donors WHERE id IN (?, ?)", (s["donor_a_id"], s["donor_b_id"]))}
    assert names == {"Maria Delgado", "María Delgado-Ruiz"}
    assert conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0] == n_before   # suggest only


def test_merge_moves_everything_and_keeps_decisions(conn):
    db.seed(conn)
    score.run(conn, AS_OF)
    dedupe.run(conn)
    s = conn.execute("SELECT * FROM duplicate_suggestions").fetchone()
    conn.execute("INSERT INTO research_facts (donor_id, fact, source_url) VALUES (?, 'fact', 'https://x')",
                 (s["donor_b_id"],))
    gifts_total = conn.execute(
        "SELECT COUNT(*) FROM gifts WHERE donor_id IN (?, ?)", (s["donor_a_id"], s["donor_b_id"])).fetchone()[0]

    result = dedupe.merge(conn, s["id"])
    keep, gone = result["kept_donor_id"], result["removed_donor_id"]
    assert keep == s["donor_a_id"]                         # Maria Delgado has more gifts
    assert conn.execute("SELECT COUNT(*) FROM donors WHERE id = ?", (gone,)).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM gifts WHERE donor_id = ?", (keep,)).fetchone()[0] == gifts_total
    assert conn.execute("SELECT COUNT(*) FROM research_facts WHERE donor_id = ?", (keep,)).fetchone()[0] == 1
    emails = json.loads(conn.execute("SELECT emails_all FROM donors WHERE id = ?", (keep,)).fetchone()[0])
    assert "mdelgado@work.example.com" in emails and "maria.delgado@example.com" in emails

    with pytest.raises(ValueError):
        dedupe.merge(conn, s["id"])                         # already merged
    dedupe.run(conn)                                        # rerun keeps the decision
    assert conn.execute("SELECT status FROM duplicate_suggestions WHERE id = ?", (s["id"],)).fetchone()[0] == "merged"


def test_merge_rejects_keep_id_outside_pair(conn):
    db.seed(conn)
    dedupe.run(conn)
    s = conn.execute("SELECT * FROM duplicate_suggestions").fetchone()
    with pytest.raises(ValueError):
        dedupe.merge(conn, s["id"], keep_id=9999)
    with pytest.raises(LookupError):
        dedupe.merge(conn, 9999)


def test_star_donor_draft_cannot_be_sent_without_human(conn):
    db.seed(conn)
    score.run(conn, AS_OF)
    star_id = conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 1").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'hi', 'sent')", (star_id,))
    draft = conn.execute("INSERT INTO outreach_drafts (donor_id, body) VALUES (?, 'hi')", (star_id,)).lastrowid
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE outreach_drafts SET status = 'sent' WHERE id = ?", (draft,))
    conn.execute("UPDATE outreach_drafts SET status = 'sent', approved_by = 'staff@miamifoundation' WHERE id = ?", (draft,))


def test_ready_status_allowed_for_non_star_and_draft_for_star(conn):
    db.seed(conn)
    score.run(conn, AS_OF)
    small = conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 0 LIMIT 1").fetchone()[0]
    conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'hi', 'ready')", (small,))
    conn.execute("UPDATE outreach_drafts SET status = 'sent' WHERE donor_id = ?", (small,))   # small path may send
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'hi', 'queued')", (small,))


def test_star_draft_can_never_be_ready(conn):
    db.seed(conn)
    score.run(conn, AS_OF)
    star_id = conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 1").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'hi', 'ready')", (star_id,))
    draft = conn.execute("INSERT INTO outreach_drafts (donor_id, body) VALUES (?, 'hi')", (star_id,)).lastrowid
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE outreach_drafts SET status = 'ready' WHERE id = ?", (draft,))
    conn.execute("UPDATE outreach_drafts SET status = 'approved', approved_by = 'staff' WHERE id = ?", (draft,))
