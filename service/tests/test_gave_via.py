"""'Gave via' after a real upload: channel is often empty and "Give Miami Day" lives only in the gift's source
row (the file name). The agent's filter matches channel or source row, ignoring case and punctuation, with
"GMD" = "Give Miami Day"; declined charges never count (#118)."""

import sqlite3

from service import chat_agent as ca
from service.tests.test_agent_tools import invoke

GMD_FILE = "give_miami_day_export_2022-2025.xlsx | sheet:GMD gifts:row:"   # the real upload's format


def uploaded(db_file):
    """Three GMD givers (channel NULL), one of them also declined later; one stock giver; one declined-only."""
    conn = sqlite3.connect(db_file)
    ids = {}
    for name in ("Gma One", "Gma Two", "Gma Three", "Stock Giver", "Declined Only"):
        ids[name] = conn.execute("INSERT INTO donors (full_name, donor_type, contact_type) VALUES (?, 'individual', "
                                 "'giver')", (name,)).lastrowid
    gift = "INSERT INTO gifts (donor_id, amount, gift_date, channel, source_row, status) VALUES (?, ?, ?, ?, ?, ?)"
    for i, name in enumerate(("Gma One", "Gma Two", "Gma Three")):
        conn.execute(gift, (ids[name], 100, "2025-11-20", None, GMD_FILE + str(9 + i), "ok"))
    conn.execute(gift, (ids["Gma One"], 100, "2026-10-10", None, GMD_FILE + "40", "declined"))
    conn.execute(gift, (ids["Stock Giver"], 5000, "2026-03-01", None, "stock_and_daf_grants.docx | grant 2", "ok"))
    conn.execute(gift, (ids["Declined Only"], 50, "2025-11-20", None, GMD_FILE + "41", "declined"))
    conn.commit()
    sql = conn.execute("SELECT COUNT(DISTINCT donor_id) FROM gifts WHERE status = 'ok' AND "
                       "source_row LIKE 'give_miami_day_export_2022-2025.xlsx%'").fetchone()[0]
    conn.close()
    return ids, sql


def test_give_miami_day_matches_the_upload_file_and_skips_declined(db_file):
    ids, sql_count = uploaded(db_file)
    gmd = {ids[n] for n in ("Gma One", "Gma Two", "Gma Three")}
    for asked in ("Give Miami Day", "give_miami_day", "GMD", "gmd"):
        found = ca.gave_via_ids(asked)
        assert gmd <= found, asked
        assert ids["Declined Only"] not in found and ids["Stock Giver"] not in found
    assert len(gmd) == sql_count == 3


def test_other_channels_still_work(db_file):
    ids, _ = uploaded(db_file)
    assert ids["Stock Giver"] in ca.gave_via_ids("stock")
    assert ca.gave_via_ids("") is None and ca.gave_via_ids(None) is None


def test_find_people_finds_the_give_miami_day_givers(db_file):
    """S1: the agent's find_people with gave_via='Give Miami Day' returns the uploaded GMD givers."""
    ids, _ = uploaded(db_file)
    people = {p["id"] for p in invoke("find_people", gave_via="Give Miami Day", limit=50)["people"]}
    assert {ids[n] for n in ("Gma One", "Gma Two", "Gma Three")} <= people
    assert ids["Declined Only"] not in people and ids["Stock Giver"] not in people


def test_gmd_is_a_whole_word_never_part_of_another(db_file):
    """Reviewer (#188): compacting then substring-matching let 'gmd' match 'Big MD' (bigmd contains gmd)."""
    ids, _ = uploaded(db_file)
    conn = sqlite3.connect(db_file)
    big = conn.execute("INSERT INTO donors (full_name, donor_type) VALUES ('Big MD Donor', 'individual')").lastrowid
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, source_row, status) VALUES "
                 "(?, 500, '2026-01-05', 'Big MD Annual Fund', 'big_md_fund.xlsx | sheet:Big MD:row:3', 'ok')", (big,))
    camel = conn.execute("INSERT INTO donors (full_name, donor_type) VALUES ('Camel Case', 'individual')").lastrowid
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, source_row, status) VALUES "
                 "(?, 75, '2025-11-20', 'GiveMiamiDay', 'online.csv | row 2', 'ok')", (camel,))
    conn.commit()
    conn.close()
    for asked in ("GMD", "Give Miami Day"):
        found = ca.gave_via_ids(asked)
        assert big not in found, asked                          # "Big MD Annual Fund" / sheet "Big MD": no match
        assert camel in found, asked                            # "GiveMiamiDay" run together: still a match
    assert ca._says("give_miami_day_export_2022-2025.xlsx | sheet:GMD gifts:row:9", ["gmd"])
    assert not ca._says("Big MD Annual Fund", ["gmd"])
