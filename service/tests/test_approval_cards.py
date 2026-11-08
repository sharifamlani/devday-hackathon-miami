"""Approval cards say who and what in plain words: "Send thank-you email to Hye-jin Park" (+N more for a
batch), "Merge Liz Fontaine into Elizabeth Fontaine", "Delete task: ...". Counting only what would go."""

import sqlite3

from service import chat_agent as ca, db, tasks


def setup(db_file, names=("Ana Ruiz", "Ben Cole", "Cara Diaz")):
    conn = sqlite3.connect(db_file)
    ids = [conn.execute("INSERT INTO donors (full_name, donor_type) VALUES (?, 'individual')", (n,)).lastrowid
           for n in names]
    batch = conn.execute("INSERT INTO campaigns (name, intent, channel) VALUES ('GMD thanks', 'thank_you', 'email')"
                         ).lastrowid
    msgs = [conn.execute("INSERT INTO campaign_messages (campaign_id, donor_id, channel, body) VALUES (?, ?, 'email', 'x')",
                         (batch, i)).lastrowid for i in ids]
    conn.commit()
    conn.close()
    return ids, batch, msgs


def test_a_single_send_names_the_recipient_and_the_kind(db_file):
    ids, batch, msgs = setup(db_file, names=("Hye-jin Park",))
    assert ca.approval_summary("send", {"batch_id": batch}) == "Send thank-you email to Hye-jin Park"


def test_a_batch_names_the_first_recipient_and_counts_only_what_would_go(db_file):
    ids, batch, msgs = setup(db_file)
    assert ca.approval_summary("send", {"batch_id": batch}) == "Send thank-you emails to Ana Ruiz +2 more"
    conn = sqlite3.connect(db_file)
    conn.execute("UPDATE campaign_messages SET status = 'skipped' WHERE id = ?", (msgs[0],))
    conn.commit()
    conn.close()
    assert ca.approval_summary("send", {"batch_id": batch}) == "Send thank-you emails to Ben Cole +1 more"
    assert ca.approval_summary("send", {"batch_id": batch, "message_ids": [msgs[2]]}) == \
        "Send thank-you email to Cara Diaz"                                    # only the chosen message
    assert ca.approval_summary("send", {"batch_id": 999999}) is None


def test_merge_and_delete_cards_name_the_records(db_file):
    conn = db.connect(db_file)
    keep, drop = (conn.execute("INSERT INTO donors (full_name, donor_type) VALUES (?, 'individual')", (n,)).lastrowid
                  for n in ("Elizabeth Fontaine", "Liz Fontaine"))
    sid = conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence) "
                       "VALUES (?, ?, '[]', 0.9)", (keep, drop)).lastrowid
    conn.commit()
    task, _ = tasks.create_task(conn, kind="call", title="Call Liz", person_id=drop)
    conn.close()
    assert ca.approval_summary("merge_duplicate", {"suggestion_id": sid}) == "Merge Liz Fontaine into Elizabeth Fontaine"
    assert ca.approval_summary("merge_duplicate", {"suggestion_id": sid, "keep_id": drop}) == \
        "Merge Elizabeth Fontaine into Liz Fontaine"
    assert ca.approval_summary("delete_task", {"task_id": task["id"]}) == "Delete task: Call Liz"
    assert ca.approval_summary("delete_calendar_item", {"ref": f"task:{task['id']}"}) == "Delete calendar item: Call Liz"
    assert ca.approval_summary("delete_calendar_item", {"ref": "event:3"}) is None
