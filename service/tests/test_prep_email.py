"""Email prep: what we sent before, what we did since (sourced facts only), what's coming, and the angle."""

import sqlite3
from datetime import date

from service import db, prep_email

TODAY = date(2026, 11, 8)


def seed_context(conn):
    conn.execute("DELETE FROM org_context")
    for i, (day, fact) in enumerate((("2026-09-23", "Committed $100,000 to Spanish-language news."),
                                      ("2026-10-01", "Two SET Summits trained 300+ nonprofit leaders."),
                                      ("2026-10-15", "A donated home produced the largest gift in its history."),
                                      ("2026-08-01", "An old fact."))):
        conn.execute("INSERT INTO org_context (source, url, posted_at, fact) VALUES ('news', ?, ?, ?)",
                     (f"https://example.org/{i}", day, fact))
    conn.commit()


def givers(conn, n=3):
    return [r[0] for r in conn.execute("SELECT id FROM donors WHERE contact_type = 'giver' ORDER BY id LIMIT ?", (n,))]


def test_first_email_leads_with_the_newest_sourced_facts_and_whats_next(db_file):
    conn = db.connect()
    try:
        db.create_schema(conn)
        seed_context(conn)
        conn.execute("DELETE FROM campaigns")
        ids = givers(conn)
        card = prep_email.build(conn, ids, "Give Miami Day", TODAY)
    finally:
        conn.close()
    assert card["kind"] == "email_prep" and card["audience"]["count"] == 3 and card["person_ids"] == ids
    assert card["last_time"] is None
    assert [f["date"] for f in card["since"]] == ["2026-10-15", "2026-10-01", "2026-09-23"]   # newest 3, sourced
    assert all(f["url"].startswith("https://") for f in card["since"])
    assert card["angle"].startswith("Here's what we've been doing: lead with (X), (Y), (Z)")


def test_after_an_earlier_email_only_newer_facts_count_and_last_time_is_named(db_file):
    conn = db.connect()
    try:
        db.create_schema(conn)
        seed_context(conn)
        ids = givers(conn)
        cur = conn.execute("INSERT INTO campaigns (name, intent, channel, created_at, created_by, status) "
                           "VALUES ('Re-engage · Email', 're_engage', 'email', '2026-09-30T10:00:00', 'test', 'sent')")
        conn.execute("INSERT INTO campaign_messages (campaign_id, donor_id, channel, subject, body, facts_used, flags, "
                     "drafted_by, status, needs_individual_approval) VALUES (?, ?, 'email', 's', 'b', '[]', '[]', "
                     "'template', 'sent', 0)", (cur.lastrowid, ids[0]))
        conn.commit()
        card = prep_email.build(conn, ids, "Give Miami Day", TODAY)
    finally:
        conn.close()
    assert card["last_time"]["name"] == "Re-engage · Email" and card["last_time"]["date"] == "2026-09-30"
    assert card["last_time"]["sent"] == 1
    assert [f["date"] for f in card["since"]] == ["2026-10-15", "2026-10-01"]                # only after Sep 30
    assert card["angle"].startswith("Since we last wrote: lead with (X), (Y)")


def test_no_sourced_facts_means_no_invented_angle(db_file):
    conn = db.connect()
    try:
        db.create_schema(conn)
        conn.execute("DELETE FROM org_context")
        conn.commit()
        card = prep_email.build(conn, givers(conn, 1), "Thank you", TODAY)
    finally:
        conn.close()
    assert card["since"] == [] and "no new sourced updates" in card["angle"]


def test_the_agent_tool_returns_the_card_and_a_one_line_step(db_file):
    from service import chat_agent as ca
    from service.tests.test_agent_tools import invoke
    conn = db.connect()
    try:
        db.create_schema(conn)
        seed_context(conn)
        ids = givers(conn, 2)
    finally:
        conn.close()
    out = invoke("prep_email", person_ids=ids, topic="Give Miami Day")
    assert out["card"]["kind"] == "email_prep" and out["card"]["person_ids"] == ids
    assert ca.summarize(out) == "email prep: Give Miami Day · 2 people · 3 sourced updates"
    assert "error" in invoke("prep_email", person_ids=[], topic="x")
    assert "prep_email" not in ca.APPROVAL_TOOLS


def test_a_batch_drafted_but_never_sent_is_not_last_time(db_file):
    conn = db.connect()
    try:
        db.create_schema(conn)
        seed_context(conn)
        ids = givers(conn)
        cur = conn.execute("INSERT INTO campaigns (name, intent, channel, created_at, created_by, status) "
                           "VALUES ('Draft only', 're_engage', 'email', '2026-11-07T10:00:00', 'test', 'draft')")
        conn.execute("INSERT INTO campaign_messages (campaign_id, donor_id, channel, subject, body, facts_used, flags, "
                     "drafted_by, status, needs_individual_approval) VALUES (?, ?, 'email', 's', 'b', '[]', '[]', "
                     "'template', 'draft', 0)", (cur.lastrowid, ids[0]))
        conn.commit()
        card = prep_email.build(conn, ids, "Give Miami Day", TODAY)
    finally:
        conn.close()
    assert card["last_time"] is None
