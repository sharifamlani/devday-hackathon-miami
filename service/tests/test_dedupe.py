import json
import sqlite3

import pytest

from service import db, dedupe, score
from service.tests.fixtures_seed import seed
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
    seed(conn)
    n_before = conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0]
    assert dedupe.run(conn) == 1
    s = conn.execute("SELECT * FROM duplicate_suggestions").fetchone()
    names = {r["full_name"] for r in conn.execute(
        "SELECT full_name FROM donors WHERE id IN (?, ?)", (s["donor_a_id"], s["donor_b_id"]))}
    assert names == {"Maria Delgado", "María Delgado-Ruiz"}
    assert conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0] == n_before   # suggest only


def test_merge_moves_everything_and_keeps_decisions(conn):
    seed(conn)
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
    seed(conn)
    dedupe.run(conn)
    s = conn.execute("SELECT * FROM duplicate_suggestions").fetchone()
    with pytest.raises(ValueError):
        dedupe.merge(conn, s["id"], keep_id=9999)
    with pytest.raises(LookupError):
        dedupe.merge(conn, 9999)


def test_star_donor_draft_cannot_be_sent_without_human(conn):
    seed(conn)
    score.run(conn, AS_OF)
    star_id = conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 1").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'hi', 'sent')", (star_id,))
    draft = conn.execute("INSERT INTO outreach_drafts (donor_id, body) VALUES (?, 'hi')", (star_id,)).lastrowid
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE outreach_drafts SET status = 'sent' WHERE id = ?", (draft,))
    conn.execute("UPDATE outreach_drafts SET status = 'sent', approved_by = 'staff@miamifoundation' WHERE id = ?", (draft,))


def test_ready_status_allowed_for_non_star_and_draft_for_star(conn):
    seed(conn)
    score.run(conn, AS_OF)
    small = conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 0 LIMIT 1").fetchone()[0]
    conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'hi', 'ready')", (small,))
    conn.execute("UPDATE outreach_drafts SET status = 'sent' WHERE donor_id = ?", (small,))   # small path may send
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'hi', 'queued')", (small,))


def test_star_draft_can_never_be_ready(conn):
    seed(conn)
    score.run(conn, AS_OF)
    star_id = conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 1").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'hi', 'ready')", (star_id,))
    draft = conn.execute("INSERT INTO outreach_drafts (donor_id, body) VALUES (?, 'hi')", (star_id,)).lastrowid
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE outreach_drafts SET status = 'ready' WHERE id = ?", (draft,))
    conn.execute("UPDATE outreach_drafts SET status = 'approved', approved_by = 'staff' WHERE id = ?", (draft,))


# ---- name-only matching (planted groups in data/sample_inputs/answer_key.json) --------------------

def names_paired(conn, *rows):
    """Insert rows with no contact details and return the suggested (name, name) pairs + reasons."""
    ids = [add(conn, **r) for r in rows]
    donors = [dict(r) for r in conn.execute("SELECT * FROM donors")]
    by_id = {d["id"]: d["full_name"] for d in donors}
    return {(by_id[p["donor_a_id"]], by_id[p["donor_b_id"]]): p for p in dedupe.find_pairs(donors)
            if p["donor_a_id"] in ids and p["donor_b_id"] in ids}


def test_nickname_and_initial_with_same_surname(conn):
    pairs = names_paired(conn, {"full_name": "Robert Nguyen"}, {"full_name": "Bob Nguyen"}, {"full_name": "R. Nguyen"})
    assert set(pairs) == {("Robert Nguyen", "Bob Nguyen"), ("Robert Nguyen", "R. Nguyen"), ("Bob Nguyen", "R. Nguyen")}
    assert "nickname bob ~ robert" in pairs[("Robert Nguyen", "Bob Nguyen")]["reasons"][0] or \
        "nickname robert ~ bob" in pairs[("Robert Nguyen", "Bob Nguyen")]["reasons"][0]
    assert pairs[("Robert Nguyen", "Bob Nguyen")]["confidence"] == 0.60


def test_liz_elizabeth_millie_mildred_teo_teodoro(conn):
    pairs = names_paired(conn, {"full_name": "Elizabeth Fontaine"}, {"full_name": "Liz Fontaine"},
                         {"full_name": "Mildred Hayes"}, {"full_name": "Millie Hayes"},
                         {"full_name": "Teodoro Salinas"}, {"full_name": "Teo Salinas"})
    assert set(pairs) == {("Elizabeth Fontaine", "Liz Fontaine"), ("Mildred Hayes", "Millie Hayes"),
                          ("Teodoro Salinas", "Teo Salinas")}


def test_nickname_plus_same_phone_is_high_confidence(conn):
    pairs = names_paired(conn, {"full_name": "Mildred Hayes", "phone": "305-555-0190"},
                         {"full_name": "Millie Hayes", "phone": "(305) 555-0190"})
    assert pairs[("Mildred Hayes", "Millie Hayes")]["confidence"] == 0.90


def test_initial_first_name_and_surname_initial_from_signin_sheets(conn):
    pairs = names_paired(conn, {"full_name": "Dana Kowalczyk"}, {"full_name": "D. Kowalczyk"},
                         {"full_name": "Maria Delgado"}, {"full_name": "Maria D."},
                         {"full_name": "Lucia Ferrante"}, {"full_name": "Lucia F"})
    assert set(pairs) == {("Dana Kowalczyk", "D. Kowalczyk"), ("Maria Delgado", "Maria D."),
                          ("Lucia Ferrante", "Lucia F")}


def test_same_name_with_no_contact_overlap(conn):
    pairs = names_paired(conn, {"full_name": "Priscilla Okafor", "email": "priscilla.okafor@example.com"},
                         {"full_name": "Priscilla Okafor", "email": "priscilla.okafor.law@example.org"},
                         {"full_name": "Lucia Ferrante"}, {"full_name": "Lucia Ferrante"})
    assert pairs[("Priscilla Okafor", "Priscilla Okafor")]["confidence"] == 0.75
    assert pairs[("Lucia Ferrante", "Lucia Ferrante")]["reasons"] == ["same name: Lucia Ferrante"]


def test_organization_suffixes_abbreviations_and_short_names(conn):
    orgs = [{"full_name": n, "donor_type": "organization"} for n in
            ["Tamarind Quay Hardware LLC", "Tamarind Quay Hdwe, L.L.C.", "Tamarind Quay Hardware, LLC",
             "Veloria Bay Foundation", "Veloria Bay Foundation Inc", "Tamarind Quay"]]
    pairs = names_paired(conn, *orgs)
    assert pairs[("Tamarind Quay Hardware LLC", "Tamarind Quay Hdwe, L.L.C.")]["confidence"] == 0.80
    assert ("Tamarind Quay Hardware LLC", "Tamarind Quay Hardware, LLC") in pairs
    assert ("Veloria Bay Foundation", "Veloria Bay Foundation Inc") in pairs
    assert pairs[("Tamarind Quay Hardware LLC", "Tamarind Quay")]["reasons"][0].startswith("shortened organization name")
    assert not any("Veloria" in a and "Tamarind" in b or "Tamarind" in a and "Veloria" in b for a, b in pairs)


def test_donor_and_family_fund(conn):
    pairs = names_paired(conn, {"full_name": "Harold Whitaker"},
                         {"full_name": "Whitaker Family Charitable Fund", "donor_type": "individual"},
                         {"full_name": "Grace Whitaker"})
    assert pairs[("Harold Whitaker", "Whitaker Family Charitable Fund")]["reasons"][0].startswith("fund named for")
    assert ("Harold Whitaker", "Grace Whitaker") not in pairs                 # different first names


def test_name_only_matching_does_not_pair_different_people(conn):
    pairs = names_paired(conn, {"full_name": "John Smith"}, {"full_name": "Jane Smith"},
                         {"full_name": "Maria Lopez"}, {"full_name": "Maria Delgado"},
                         {"full_name": "Amerant Bank", "donor_type": "organization"},
                         {"full_name": "Amerant Hardware", "donor_type": "organization"})
    assert pairs == {}


def test_answer_key_planted_groups_found_on_names_alone_with_no_false_pairs():
    """Ground truth: every name variant in answer_key.json as its own record with no contact details."""
    import pathlib
    key = json.loads((pathlib.Path(db.REPO_ROOT) / "data/sample_inputs/answer_key.json").read_text(encoding="utf-8"))
    canon = {c["donor_id"]: c for c in key["canonical_donors"]}
    records, owner = [], {}
    for person in key["people"]:
        names = {r["name_as_written"] for r in person.get("source_rows", []) if r.get("name_as_written")}
        for n in sorted(names | {person["full_name"]}):
            records.append({"id": len(records) + 1, "full_name": n,
                            "donor_type": canon.get(person["person_id"], {}).get("donor_type")})
            owner[len(records)] = person["person_id"]
    pairs = dedupe.find_pairs(records)
    assert [p for p in pairs if owner[p["donor_a_id"]] != owner[p["donor_b_id"]]] == []   # no false pairs

    parent = {r["id"]: r["id"] for r in records}

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x
    for p in pairs:
        parent[find(p["donor_a_id"])] = find(p["donor_b_id"])
    for g in key["duplicate_groups"]:
        members = {m.split(" (")[0] for m in g["members"]}
        ids = [r["id"] for r in records if owner[r["id"]] == g["donor_id"] and r["full_name"] in members]
        assert len({find(i) for i in ids}) == 1, (g["group"], g["members"])



def test_individual_with_a_business_org_name_is_not_merged_into_that_business(conn):
    """demo_reset --check found this: ingest stores a person's business in org_name. Annelise Moreau
    (her own donor, D20) was suggested as a duplicate of Tamarind Quay Hardware, LLC."""
    pairs = names_paired(conn,
                         {"full_name": "Annelise Moreau", "donor_type": "individual",
                          "org_name": "Tamarind Quay Hardware", "email": "annelise.moreau@example.org"},
                         {"full_name": "Tamarind Quay Hardware, LLC", "donor_type": "organization",
                          "org_name": "Tamarind Quay Hardware, LLC", "email": "tamarindquay.accounts@example.com"})
    assert pairs == {}


def test_person_writing_from_the_organizations_mailbox_is_suggested(conn):
    """The answer key's D32: Bernard Okoye writes the checks of Marrow Lane Print Co. from its billing mailbox."""
    pairs = names_paired(conn,
                         {"full_name": "Marrow Lane Print Co.", "donor_type": "organization",
                          "org_name": "Marrow Lane Print Co."},
                         {"full_name": "Bernard Okoye", "donor_type": "individual",
                          "org_name": "Marrow Lane Print Co.", "email": "billing.marrowlane@example.org"})
    (pair,) = pairs.values()
    assert pair["confidence"] == 0.80 and "uses its mailbox billing.marrowlane@example.org" in pair["reasons"][0]


def test_person_sharing_the_organizations_email_is_suggested(conn):
    pairs = names_paired(conn,
                         {"full_name": "Coral Gables Garden Club", "donor_type": "organization",
                          "email": "treasurer@cggc.example.org"},
                         {"full_name": "Ruth Alvarez", "donor_type": "individual", "org_name": "Coral Gables Garden Club",
                          "email": "treasurer@cggc.example.org"})
    (pair,) = pairs.values()
    assert pair["confidence"] == 0.95                                   # the shared email already says it


def test_untyped_row_with_org_name_still_counts_as_an_organization(conn):
    pairs = names_paired(conn, {"full_name": "Veloria Bay Foundation", "donor_type": None, "org_name": "Veloria Bay Foundation"},
                         {"full_name": "Veloria Bay Foundation Inc", "donor_type": "organization"})
    assert len(pairs) == 1
