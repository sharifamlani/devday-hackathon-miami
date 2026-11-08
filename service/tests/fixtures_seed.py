"""SAMPLE seed donors, for tests only. The running app starts empty: every record comes from uploading the
files in data/sample_inputs/. Use `seed(conn)` (or `db.rebuild(path, with_seed=True)`) in a test that wants
the fictional hand-built histories."""

from __future__ import annotations

import sqlite3

from service.db import insert_donor

# SAMPLE seed: fictional, hand-built histories so scoring/dedupe/UI aren't blocked on ingest.
# Give Miami Day dates: Thu Nov 16 2023, Thu Nov 21 2024, Thu Nov 20 2025 (2026 is Thu Nov 19).
SEED_DONORS = [
    {
        "full_name": "Maria Delgado", "first_name": "Maria", "last_name": "Delgado",
        "donor_type": "individual", "email": "maria.delgado@example.com",
        "emails_all": ["maria.delgado@example.com"], "phone": "+13055550101",
        "city": "Miami", "state": "FL", "fund_type": "Donor Advised",
        "notes": "SAMPLE: lapsing Give Miami Day giver",
        "gifts": [(2500, "2022-11-17", "Give Miami Day"), (2500, "2023-11-16", "Give Miami Day"),
                  (3000, "2024-11-21", "Give Miami Day"), (3000, "2025-11-20", "Give Miami Day")],
    },
    {
        "full_name": "María Delgado-Ruiz", "first_name": "María", "last_name": "Delgado-Ruiz",
        "donor_type": "individual", "email": "mdelgado@work.example.com",
        "emails_all": ["mdelgado@work.example.com", "Maria.Delgado@example.com"], "phone": "(305) 555-0101",
        "city": "Miami", "state": "FL", "fund_type": None,
        "notes": "SAMPLE: planted duplicate of Maria Delgado (name variant, shared email)",
        "gifts": [(250, "2021-06-02", "online")],
    },
    {
        "full_name": "James Carter", "first_name": "James", "last_name": "Carter",
        "donor_type": "individual", "email": "jcarter@example.com",
        "emails_all": ["jcarter@example.com"], "phone": "+13055550144",
        "city": "Coral Gables", "state": "FL", "fund_type": "Designated",
        "notes": "SAMPLE: on-track monthly donor",
        "gifts": [(50, f"2026-{m:02d}-15", "online") for m in range(1, 11)]
                 + [(50, f"2025-{m:02d}-15", "online") for m in range(1, 13)],
    },
    {
        "full_name": "Biscayne Harbor Family Foundation", "org_name": "Biscayne Harbor Family Foundation",
        "donor_type": "organization", "email": "grants@biscayneharbor.example.org",
        "emails_all": ["grants@biscayneharbor.example.org"], "phone": "+13055550199",
        "city": "Miami Beach", "state": "FL", "fund_type": "Endowment",
        "notes": "SAMPLE: Shack-level star fundholder, on track",
        "gifts": [(300000, "2023-09-12", "check"), (400000, "2024-09-10", "check"),
                  (500000, "2025-09-09", "check"), (450000, "2026-09-08", "check")],
    },
    {
        "full_name": "Robert Nguyen", "first_name": "Robert", "last_name": "Nguyen",
        "donor_type": "individual", "email": "rob.nguyen@example.com",
        "emails_all": ["rob.nguyen@example.com"], "phone": "+13055550177",
        "city": "Doral", "state": "FL", "fund_type": "Designated",
        "notes": "SAMPLE: quarterly donor, overdue",
        "gifts": [(500, "2025-01-10", "online"), (500, "2025-04-10", "online"), (500, "2025-07-10", "online"),
                  (500, "2025-10-10", "online"), (500, "2026-01-12", "online"), (500, "2026-04-09", "online")],
    },
    {
        "full_name": "Angela Brooks", "first_name": "Angela", "last_name": "Brooks",
        "donor_type": "individual", "email": "angela.brooks@example.com",
        "emails_all": ["angela.brooks@example.com"], "phone": "+13055550122",
        "city": "Homestead", "state": "FL", "fund_type": None,
        "notes": "SAMPLE: one gift long ago",
        "gifts": [(100, "2019-05-03", "event")],
    },
    {
        "full_name": "Luis Herrera", "first_name": "Luis", "last_name": "Herrera",
        "donor_type": "individual", "email": "luis.herrera@example.com",
        "emails_all": ["luis.herrera@example.com"], "phone": "+13055550155",
        "city": "Miami", "state": "FL", "fund_type": "Donor Advised",
        "notes": "SAMPLE: December giver, window next month",
        "gifts": [(1000, "2022-12-14", "online"), (1000, "2023-12-12", "online"),
                  (1200, "2024-12-16", "online"), (1200, "2025-12-15", "online")],
    },
    {
        "full_name": "Priya Shah", "first_name": "Priya", "last_name": "Shah",
        "donor_type": "individual", "email": "priya.shah@example.com",
        "emails_all": ["priya.shah@example.com"], "phone": "+13055550166",
        "city": "Aventura", "state": "FL", "fund_type": None,
        "notes": "SAMPLE: first gift this year",
        "gifts": [(200, "2026-08-20", "online")],
    },
    # Real, publicly reported Miami Foundation supporters (plan §11). Gift histories are invented
    # SAMPLE data; their names match data/research_cache.json so enrichment shows real sourced facts.
    {
        "full_name": "John S. and James L. Knight Foundation", "org_name": "John S. and James L. Knight Foundation",
        "donor_type": "organization", "city": "Miami", "state": "FL", "fund_type": "Field of Interest",
        "source_row": "SAMPLE", "notes": "SAMPLE gift history (invented); real organization",
        "gifts": [(50000, "2022-10-03", "check"), (50000, "2023-10-02", "check"),
                  (50000, "2024-10-01", "check"), (50000, "2025-10-01", "check"),
                  (50000, "2026-10-05", "check")],
    },
    {
        "full_name": "Amazon", "org_name": "Amazon", "donor_type": "organization",
        "city": "Miami", "state": "FL", "fund_type": "Designated",
        "source_row": "SAMPLE", "notes": "SAMPLE gift history (invented); real organization",
        "gifts": [(25000, "2024-09-16", "online"), (50000, "2025-09-15", "online"), (50000, "2026-09-14", "online")],
    },
    {
        "full_name": "Frederick A. DeLuca Foundation", "org_name": "Frederick A. DeLuca Foundation",
        "donor_type": "organization", "city": "Miami", "state": "FL", "fund_type": "Field of Interest",
        "source_row": "SAMPLE", "notes": "SAMPLE gift history (invented); real organization; Shack-level star",
        "gifts": [(400000, "2024-06-28", "check"), (350000, "2025-06-30", "check"), (300000, "2026-06-29", "check")],
    },
    {
        "full_name": "McDermott Will & Schulte", "org_name": "McDermott Will & Schulte",
        "donor_type": "organization", "city": "Miami", "state": "FL", "fund_type": None,
        "source_row": "SAMPLE", "notes": "SAMPLE gift history (invented); real organization; in-kind support valued in USD",
        "gifts": [(7500, "2024-03-12", "in-kind"), (7500, "2025-03-11", "in-kind")],
    },    # 5E: fictional Neighbors (met, not yet giving) and Community members (people the nonprofit serves).
    # Demographics are self-reported intake fields, each citing its source row; nothing is inferred.
    {
        "full_name": "Danielle Okafor", "first_name": "Danielle", "last_name": "Okafor", "donor_type": "individual",
        "contact_type": "neighbor", "email": "danielle.okafor@example.com", "phone": "+13055550211",
        "city": "Miami", "state": "FL", "interests": ["dogs", "volunteering"], "has_dog": True,
        "notes": "SAMPLE: met at the Give Miami 5K info table",
    },
    {
        "full_name": "Marco Bellini", "first_name": "Marco", "last_name": "Bellini", "donor_type": "individual",
        "contact_type": "neighbor", "email": "marco.bellini@example.com", "phone": "+13055550212",
        "city": "Coral Gables", "state": "FL", "interests": ["arts"], "has_dog": False,
        "notes": "SAMPLE: signed up at a community arts night",
    },
    {
        "full_name": "Keisha Grant", "first_name": "Keisha", "last_name": "Grant", "donor_type": "individual",
        "contact_type": "community", "phone": "+13055550221", "city": "Homestead", "state": "FL",
        "interests": ["youth programs"], "has_dog": True,
        "demographics": {"age_range": {"value": "25-34", "source_row": "intake_form_01.docx: Age range"},
                         "household_size": {"value": "4", "source_row": "intake_form_01.docx: Household"},
                         "zip": {"value": "33030", "source_row": "intake_form_01.docx: ZIP"},
                         "language": {"value": "English", "source_row": "intake_form_01.docx: Language"},
                         "programs": {"value": ["After-school tutoring"], "source_row": "intake_form_01.docx: Programs"}},
        "notes": "SAMPLE: intake record",
    },
    {
        "full_name": "Rosa Jimenez", "first_name": "Rosa", "last_name": "Jimenez", "donor_type": "individual",
        "contact_type": "community", "phone": "+13055550222", "city": "Miami", "state": "FL",
        "demographics": {"age_range": {"value": "45-54", "source_row": "intake_form_02.docx: Age range"},
                         "gender": {"value": "Female", "source_row": "intake_form_02.docx: Gender"},
                         "zip": {"value": "33125", "source_row": "intake_form_02.docx: ZIP"},
                         "language": {"value": "Spanish", "source_row": "intake_form_02.docx: Language"},
                         "programs": {"value": ["Food pantry", "After-school tutoring"],
                                      "source_row": "intake_form_02.docx: Programs"}},
        "notes": "SAMPLE: intake record",
    },
    {
        "full_name": "Tomas Reyes", "first_name": "Tomas", "last_name": "Reyes", "donor_type": "individual",
        "contact_type": "community", "city": "Miami", "state": "FL",
        "demographics": {"zip": {"value": "33125", "source_row": "signin_sheet_oct.xlsx: row 7"}},
        "notes": "SAMPLE: event sign-in only",
    },
    {
        "full_name": "Jordan Lee", "first_name": "Jordan", "last_name": "Lee", "donor_type": "individual",
        "contact_type": "neighbor", "email": "jordan.lee@example.com", "city": "Miami", "state": "FL",
        "tab_review": "appears on the intake list and the volunteer sign-up sheet; Community or Neighbor?",
        "notes": "SAMPLE: ambiguous tab, flagged for review",
    },
]


def seed(conn: sqlite3.Connection) -> None:
    for donor in SEED_DONORS:
        insert_donor(conn, donor)
    conn.commit()
