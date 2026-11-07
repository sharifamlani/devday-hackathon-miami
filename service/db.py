"""SQLite schema for the donor tool: the plan.md §13 contract plus the tables other lanes write.

Ingest (Carlos) writes `donors` and `gifts`. score.py writes `donor_scores`, dedupe.py writes
`duplicate_suggestions`, the enrich agent writes `research_facts`, the outreach agent writes
`outreach_drafts`.

Rebuild from scratch (schema + SAMPLE seed + scores + duplicate suggestions):
    python -m service.db --rebuild            # data/donors.db
    python -m service.db --rebuild --no-seed  # empty tables, for Carlos's ingest
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = REPO_ROOT / "data" / "donors.db"


def db_path() -> Path:
    """DONORS_DB overrides the default data/donors.db (tests point it at a temp file)."""
    return Path(os.environ.get("DONORS_DB", DEFAULT_DB_PATH))


SCHEMA = """
-- §13 contract: written by ingest only --------------------------------------------------
CREATE TABLE IF NOT EXISTS donors (
    id          INTEGER PRIMARY KEY,
    full_name   TEXT NOT NULL,
    first_name  TEXT,
    last_name   TEXT,
    org_name    TEXT,
    donor_type  TEXT CHECK (donor_type IN ('individual', 'organization')),
    email       TEXT,
    emails_all  TEXT,              -- JSON list of every email seen
    phone       TEXT,
    city        TEXT,
    state       TEXT,
    fund_type   TEXT,
    notes       TEXT,
    source_row  TEXT
);

CREATE TABLE IF NOT EXISTS gifts (
    id          INTEGER PRIMARY KEY,
    donor_id    INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
    amount      REAL NOT NULL,
    gift_date   TEXT NOT NULL,     -- ISO YYYY-MM-DD
    channel     TEXT,
    fund_type   TEXT,
    source_row  TEXT
);
CREATE INDEX IF NOT EXISTS idx_gifts_donor ON gifts(donor_id);

-- Written by others, never by ingest ----------------------------------------------------
CREATE TABLE IF NOT EXISTS donor_scores (
    donor_id    INTEGER PRIMARY KEY REFERENCES donors(id) ON DELETE CASCADE,
    score       INTEGER NOT NULL,  -- 0-100
    tier        TEXT NOT NULL CHECK (tier IN ('big', 'mid', 'small')),
    is_star     INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL,     -- lapsing | due | on_track | lapsed | no_gifts
    why         TEXT NOT NULL,     -- JSON, see score.py
    as_of       TEXT NOT NULL,
    computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS duplicate_suggestions (
    id          INTEGER PRIMARY KEY,
    donor_a_id  INTEGER NOT NULL,
    donor_b_id  INTEGER NOT NULL,
    reasons     TEXT NOT NULL,     -- JSON list, e.g. ["same email: x@y.org"]
    confidence  REAL NOT NULL,     -- 0-1
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'merged', 'dismissed', 'superseded')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    UNIQUE (donor_a_id, donor_b_id)
);

CREATE TABLE IF NOT EXISTS research_facts (
    id           INTEGER PRIMARY KEY,
    donor_id     INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
    fact         TEXT NOT NULL,
    source_url   TEXT NOT NULL,    -- every enriched fact shows its source (plan §3)
    retrieved_at TEXT NOT NULL DEFAULT (datetime('now')),
    agent_run_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_research_donor ON research_facts(donor_id);

CREATE TABLE IF NOT EXISTS outreach_drafts (
    id          INTEGER PRIMARY KEY,
    donor_id    INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
    channel     TEXT,              -- email | text
    subject     TEXT,
    body        TEXT NOT NULL,
    call_script TEXT,              -- what a staff member says on the phone (outreach_agent)
    facts_used  TEXT,              -- JSON list of {fact, url} the draft cites
    -- draft: a human must approve (big/★) · ready: small-donor path may auto-send
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'approved', 'sent')),
    approved_by TEXT,
    approved_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outreach_donor ON outreach_drafts(donor_id);

-- Guardrail (plan §3): a ★ donor never gets an automated message. Enforced in the DB, not just the UI.
CREATE TRIGGER IF NOT EXISTS star_needs_human_insert
BEFORE INSERT ON outreach_drafts
WHEN NEW.status = 'sent' AND NEW.approved_by IS NULL
     AND (SELECT is_star FROM donor_scores WHERE donor_id = NEW.donor_id) = 1
BEGIN
    SELECT RAISE(ABORT, 'star donors need a human approver before send');
END;

CREATE TRIGGER IF NOT EXISTS star_needs_human_update
BEFORE UPDATE OF status ON outreach_drafts
WHEN NEW.status = 'sent' AND NEW.approved_by IS NULL
     AND (SELECT is_star FROM donor_scores WHERE donor_id = NEW.donor_id) = 1
BEGIN
    SELECT RAISE(ABORT, 'star donors need a human approver before send');
END;
"""

TABLES = ["outreach_drafts", "research_facts", "duplicate_suggestions", "donor_scores", "gifts", "donors"]


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    """Open the db with Row access and foreign keys on. ':memory:' works for tests."""
    target = str(path) if path is not None else str(db_path())
    if target != ":memory:":
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def drop_all(conn: sqlite3.Connection) -> None:
    for table in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.commit()


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
]


def insert_donor(conn: sqlite3.Connection, donor: dict) -> int:
    """Insert one donor dict (§13 fields + optional 'gifts' as (amount, date, channel)) and return its id."""
    fields = ["full_name", "first_name", "last_name", "org_name", "donor_type", "email",
              "emails_all", "phone", "city", "state", "fund_type", "notes", "source_row"]
    values = [donor.get(f) for f in fields]
    values[fields.index("emails_all")] = json.dumps(donor.get("emails_all") or [])
    if values[fields.index("source_row")] is None:
        values[fields.index("source_row")] = "seed"
    cur = conn.execute(
        f"INSERT INTO donors ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})", values)
    donor_id = cur.lastrowid
    for amount, gift_date, channel in donor.get("gifts", []):
        conn.execute(
            "INSERT INTO gifts (donor_id, amount, gift_date, channel, source_row) VALUES (?, ?, ?, ?, 'seed')",
            (donor_id, amount, gift_date, channel))
    return donor_id


def seed(conn: sqlite3.Connection) -> None:
    for donor in SEED_DONORS:
        insert_donor(conn, donor)
    conn.commit()


def rebuild(path: str | Path | None = None, with_seed: bool = True, as_of=None) -> Path:
    """Drop everything, recreate the schema, optionally seed, then score + dedupe."""
    from service import dedupe, score

    target = Path(path) if path is not None else db_path()
    conn = connect(target)
    try:
        drop_all(conn)
        create_schema(conn)
        if with_seed:
            seed(conn)
            score.run(conn, as_of=as_of)
            dedupe.run(conn)
    finally:
        conn.close()
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or rebuild data/donors.db")
    parser.add_argument("--rebuild", action="store_true", help="drop and recreate every table")
    parser.add_argument("--no-seed", action="store_true", help="skip the SAMPLE seed donors")
    parser.add_argument("--db", default=None, help="db path (default: data/donors.db or $DONORS_DB)")
    args = parser.parse_args()

    if args.rebuild:
        target = rebuild(args.db, with_seed=not args.no_seed)
    else:
        target = Path(args.db) if args.db else db_path()
        conn = connect(target)
        create_schema(conn)
        conn.close()

    conn = connect(target)
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in reversed(TABLES)}
    conn.close()
    print(f"{target}: " + ", ".join(f"{t}={n}" for t, n in counts.items()))


if __name__ == "__main__":
    main()
