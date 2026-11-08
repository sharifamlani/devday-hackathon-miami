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
-- Every merge, with enough to undo it exactly (dedupe.merge / dedupe.undo_merge). The dropped
-- donor row is deleted from donors but lives here whole, so no history is lost.
CREATE TABLE IF NOT EXISTS merge_log (
    id            INTEGER PRIMARY KEY,
    suggestion_id INTEGER,
    kept_id       INTEGER NOT NULL,
    merged_id     INTEGER NOT NULL,
    merged_at     TEXT NOT NULL,   -- ISO UTC
    approved_by   TEXT,
    kept_before   TEXT NOT NULL,   -- JSON: the kept donor row before the merge
    merged_row    TEXT NOT NULL,   -- JSON: the dropped donor row
    merged_score  TEXT,            -- JSON: its donor_scores row, or null
    moved         TEXT NOT NULL,   -- JSON: {"gifts": [ids], "research_facts": [ids], "outreach_drafts": [ids]}
    superseded    TEXT NOT NULL,   -- JSON: duplicate_suggestions ids this merge superseded
    undone_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_merge_log_kept ON merge_log(kept_id);

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

-- Phase 5B: the ideal donor profile and the new organization prospects that match it ----------
CREATE TABLE IF NOT EXISTS icp_profile (
    id          INTEGER PRIMARY KEY,
    traits      TEXT NOT NULL,     -- JSON (icp_agent)
    stats       TEXT NOT NULL,     -- JSON, deterministic Python
    evidence    TEXT NOT NULL,     -- JSON list: the donor + fact + URL behind each trait
    recent_context TEXT,           -- JSON list: the org's recent work that steered the profile
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prospects (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    org_type       TEXT,           -- organizations only: company, foundation, ...
    city           TEXT,
    fit_score      INTEGER NOT NULL DEFAULT 0 CHECK (fit_score BETWEEN 0 AND 100),
    matched_traits TEXT NOT NULL DEFAULT '[]',   -- JSON list of ICP traits it matches
    facts          TEXT NOT NULL DEFAULT '[]',   -- JSON list of {fact, url}
    priority       TEXT,           -- the Foundation priority it fits
    fit_breakdown  TEXT,           -- JSON {component: points} behind fit_score (icp_agent)
    matched_context TEXT,          -- JSON list of the org's own recent facts it ties to
    status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'drafted', 'dismissed')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5C: the local context dataset (onboarding screen 2): who the Foundation is and what it posted ---
CREATE TABLE IF NOT EXISTS org_profile (
    id            INTEGER PRIMARY KEY,   -- one row (id 1), upserted by save_context
    name          TEXT,
    website       TEXT,
    x_url         TEXT,
    linkedin_url  TEXT,
    instagram_url TEXT,
    priorities    TEXT NOT NULL DEFAULT '[]',   -- JSON list
    voice         TEXT NOT NULL DEFAULT '{}',   -- JSON (tone, phrases, sign-off)
    source_status TEXT NOT NULL DEFAULT '{}',   -- JSON {source: ok|cached|blocked|skipped}: "blocked" is shown, never faked
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_context (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL CHECK (source IN ('website', 'x', 'linkedin', 'instagram', 'news')),
    url         TEXT NOT NULL CHECK (url <> ''),     -- every fact carries its URL
    posted_at   TEXT,                                -- ISO date when the source shows one
    fact        TEXT NOT NULL CHECK (fact <> ''),
    quote       TEXT,                                -- the verbatim words the fact rests on
    priority    TEXT,                                -- the Foundation priority it fits
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source, url, fact)
);
CREATE INDEX IF NOT EXISTS idx_context_posted ON org_context(posted_at);

-- A draft belongs to exactly one donor or one prospect.
CREATE TABLE IF NOT EXISTS outreach_drafts (
    id          INTEGER PRIMARY KEY,
    donor_id    INTEGER REFERENCES donors(id) ON DELETE CASCADE,
    prospect_id INTEGER REFERENCES prospects(id) ON DELETE CASCADE,
    channel     TEXT,              -- email | text
    subject     TEXT,
    body        TEXT NOT NULL,
    call_script TEXT,              -- what a staff member says on the phone (outreach_agent)
    facts_used  TEXT,              -- JSON list of {fact, url} the draft cites
    -- draft: a human must approve (big/★) · ready: small-donor path may auto-send
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'approved', 'sent')),
    approved_by TEXT,
    approved_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((donor_id IS NULL) <> (prospect_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_outreach_donor ON outreach_drafts(donor_id);
CREATE INDEX IF NOT EXISTS idx_outreach_prospect ON outreach_drafts(prospect_id);

-- Saving a first-touch draft moves the prospect from 'new' to 'drafted', whoever writes it
-- (pipeline, POST /prospects/{id}/outreach). A dismissed prospect stays dismissed.
CREATE TRIGGER IF NOT EXISTS prospect_drafted_on_draft
AFTER INSERT ON outreach_drafts
WHEN NEW.prospect_id IS NOT NULL
BEGIN
    UPDATE prospects SET status = 'drafted' WHERE id = NEW.prospect_id AND status = 'new';
END;

-- Prospect first-touch drafts are always human-sent: never 'ready', never 'sent' without an approver.
CREATE TRIGGER IF NOT EXISTS prospect_needs_human_insert
BEFORE INSERT ON outreach_drafts
WHEN NEW.prospect_id IS NOT NULL
     AND (NEW.status = 'ready' OR (NEW.status = 'sent' AND NEW.approved_by IS NULL))
BEGIN
    SELECT RAISE(ABORT, 'prospect drafts need a human approver before send');
END;

CREATE TRIGGER IF NOT EXISTS prospect_needs_human_update
BEFORE UPDATE OF status ON outreach_drafts
WHEN NEW.prospect_id IS NOT NULL
     AND (NEW.status = 'ready' OR (NEW.status = 'sent' AND NEW.approved_by IS NULL))
BEGIN
    SELECT RAISE(ABORT, 'prospect drafts need a human approver before send');
END;

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

-- A ★ draft is never 'ready' (the auto-send state): it stays 'draft' until a human approves it.
CREATE TRIGGER IF NOT EXISTS star_never_ready_insert
BEFORE INSERT ON outreach_drafts
WHEN NEW.status = 'ready' AND (SELECT is_star FROM donor_scores WHERE donor_id = NEW.donor_id) = 1
BEGIN
    SELECT RAISE(ABORT, 'star donor drafts cannot be ready; use draft until a human approves');
END;

CREATE TRIGGER IF NOT EXISTS star_never_ready_update
BEFORE UPDATE OF status ON outreach_drafts
WHEN NEW.status = 'ready' AND (SELECT is_star FROM donor_scores WHERE donor_id = NEW.donor_id) = 1
BEGIN
    SELECT RAISE(ABORT, 'star donor drafts cannot be ready; use draft until a human approves');
END;
"""

TABLES = ["merge_log", "outreach_drafts", "prospects", "icp_profile", "org_context", "org_profile", "research_facts", "duplicate_suggestions",
          "donor_scores", "gifts", "donors"]

# Campaigns (#38): bulk drafts -> human approval -> a SIMULATED outbox. Nothing leaves the laptop.
# The outbox doubles as the contact log (who, when, which channel) until plan.md §16's text_log exists.
# campaign_messages.outreach_draft_id is a plain nullable id (no FK), so outreach_drafts can be rebuilt.
CAMPAIGN_SCHEMA = """
CREATE TABLE IF NOT EXISTS campaigns (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    intent      TEXT NOT NULL CHECK (intent IN ('thank_you', 're_engage', 'check_in')),
    channel     TEXT NOT NULL CHECK (channel IN ('email', 'text')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    created_by  TEXT,
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent'))
);

CREATE TABLE IF NOT EXISTS campaign_messages (
    id                INTEGER PRIMARY KEY,
    campaign_id       INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    donor_id          INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
    outreach_draft_id INTEGER,
    channel           TEXT NOT NULL CHECK (channel IN ('email', 'text')),
    subject           TEXT,
    body              TEXT NOT NULL,
    facts_used        TEXT NOT NULL DEFAULT '[]',   -- JSON list of {fact, url, date}
    flags             TEXT NOT NULL DEFAULT '[]',   -- JSON list: output-guardrail findings; non-empty blocks approval
    drafted_by        TEXT NOT NULL DEFAULT 'template' CHECK (drafted_by IN ('model', 'template')),
    draft_note        TEXT,
    status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'skipped')),
    needs_individual_approval INTEGER NOT NULL DEFAULT 0,   -- star, big tier or organization
    approved_by       TEXT,
    approved_via      TEXT CHECK (approved_via IN ('individual', 'bulk')),
    approved_at       TEXT,
    sent_at           TEXT,
    UNIQUE (campaign_id, donor_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign ON campaign_messages(campaign_id);

CREATE TABLE IF NOT EXISTS outbox (
    id                  INTEGER PRIMARY KEY,
    campaign_message_id INTEGER REFERENCES campaign_messages(id) ON DELETE SET NULL,
    donor_id            INTEGER REFERENCES donors(id) ON DELETE SET NULL,
    channel             TEXT NOT NULL CHECK (channel IN ('email', 'text')),
    to_address          TEXT NOT NULL,     -- stored in full locally; masked in every API response
    subject             TEXT,
    body                TEXT NOT NULL,
    sent_at             TEXT NOT NULL DEFAULT (datetime('now')),
    simulated           INTEGER NOT NULL DEFAULT 1 CHECK (simulated = 1)   -- no real provider exists
);
CREATE INDEX IF NOT EXISTS idx_outbox_donor ON outbox(donor_id);

-- Nothing is sent without a named approver; flagged drafts are never approved or sent.
CREATE TRIGGER IF NOT EXISTS campaign_message_needs_approver
BEFORE UPDATE OF status ON campaign_messages
WHEN NEW.status IN ('approved', 'sent') AND (NEW.approved_by IS NULL OR trim(NEW.approved_by) = '')
BEGIN
    SELECT RAISE(ABORT, 'campaign messages need a named human approver');
END;

-- Star, big and organization donors are approved one by one, never by the bulk button.
CREATE TRIGGER IF NOT EXISTS campaign_message_no_bulk_for_big
BEFORE UPDATE OF status, approved_via ON campaign_messages
WHEN NEW.needs_individual_approval = 1 AND NEW.approved_via = 'bulk'
BEGIN
    SELECT RAISE(ABORT, 'star, big and organization donors need individual approval');
END;

CREATE TRIGGER IF NOT EXISTS campaign_message_flagged_blocked
BEFORE UPDATE OF status ON campaign_messages
WHEN NEW.status IN ('approved', 'sent') AND NEW.flags <> '[]'
BEGIN
    SELECT RAISE(ABORT, 'flagged campaign messages cannot be approved or sent');
END;
"""
SCHEMA += CAMPAIGN_SCHEMA
TABLES = ["outbox", "campaign_messages", "campaigns"] + TABLES


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    """Open the db with Row access and foreign keys on. ':memory:' works for tests.

    Each API request gets its own connection (routes_data.get_conn), but FastAPI opens it in one
    threadpool thread and runs the sync route in another, so check_same_thread is off; the
    connection is still never shared between requests. Writers wait up to 10 s for a lock
    instead of failing with "database is locked"."""
    target = str(path) if path is not None else str(db_path())
    if target != ":memory:":
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


# Nullable columns added after a table first shipped; create_schema adds any that are missing.
ADDED_COLUMNS = {
    "icp_profile": {"recent_context": "TEXT"},
    "prospects": {"fit_breakdown": "TEXT", "matched_context": "TEXT"},
}


def create_schema(conn: sqlite3.Connection) -> None:
    migrate_outreach_drafts(conn)
    conn.executescript(SCHEMA)
    for table, columns in ADDED_COLUMNS.items():
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, kind in columns.items():
            if name not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {kind}")
    # Backfill for drafts saved before the prospect_drafted_on_draft trigger existed.
    conn.execute("UPDATE prospects SET status = 'drafted' WHERE status = 'new' AND id IN "
                 "(SELECT prospect_id FROM outreach_drafts WHERE prospect_id IS NOT NULL)")
    conn.commit()


def migrate_outreach_drafts(conn: sqlite3.Connection) -> bool:
    """Upgrade an older donors.db in place: outreach_drafts gains prospect_id and donor_id becomes
    nullable (SQLite can't alter a column constraint, so the table is rebuilt and its rows copied).
    Returns True when a migration ran."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(outreach_drafts)")]
    if not cols or "prospect_id" in cols:
        return False
    for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'outreach_drafts'").fetchall():
        conn.execute(f"DROP TRIGGER {name}")
    conn.execute("DROP INDEX IF EXISTS idx_outreach_donor")
    conn.execute("ALTER TABLE outreach_drafts RENAME TO outreach_drafts_pre_5b")
    conn.executescript(SCHEMA)
    keep = ", ".join(c for c in cols if c != "prospect_id")
    conn.execute(f"INSERT INTO outreach_drafts ({keep}) SELECT {keep} FROM outreach_drafts_pre_5b")
    conn.execute("DROP TABLE outreach_drafts_pre_5b")
    conn.commit()
    return True


def drop_all(conn: sqlite3.Connection) -> None:
    for table in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.commit()



# Phase 5B writers: the only code that writes icp_profile and prospects (icp_agent stays pure).
def _name_key(name: str | None) -> str:
    """Case- and punctuation-insensitive name, for excluding current donors from prospects."""
    return "".join(ch for ch in (name or "").lower() if ch.isalnum())


def save_icp(conn: sqlite3.Connection, profile: dict) -> int:
    cur = conn.execute(
        "INSERT INTO icp_profile (traits, stats, evidence, recent_context) VALUES (?, ?, ?, ?)",
        (json.dumps(profile.get("traits") or []), json.dumps(profile.get("stats") or {}),
         json.dumps(profile.get("evidence") or []), json.dumps(profile.get("recent_context") or [])))
    conn.commit()
    return cur.lastrowid


def save_prospects(conn: sqlite3.Connection, prospects: list[dict]) -> list[int]:
    """Upsert by name. Status survives reruns (dismissed/drafted stay put); fit_score, traits,
    facts and priority come from icp_agent as given. Names matching a current donor are dropped."""
    donor_keys = {_name_key(r[0]) for r in conn.execute("SELECT full_name FROM donors")}
    donor_keys |= {_name_key(r[0]) for r in conn.execute("SELECT org_name FROM donors WHERE org_name IS NOT NULL")}
    ids = []
    for p in prospects:
        if not p.get("name") or _name_key(p["name"]) in donor_keys:
            continue
        values = (p.get("org_type"), p.get("city"), int(round(p.get("fit_score") or 0)),
                  json.dumps(p.get("matched_traits") or []), json.dumps(p.get("facts") or []), p.get("priority"),
                  json.dumps(p.get("fit_breakdown") or {}), json.dumps(p.get("matched_context") or []))
        row = conn.execute("SELECT id FROM prospects WHERE name = ?", (p["name"],)).fetchone()
        if row:
            conn.execute("UPDATE prospects SET org_type = ?, city = ?, fit_score = ?, matched_traits = ?, "
                         "facts = ?, priority = ?, fit_breakdown = ?, matched_context = ? WHERE id = ?",
                         (*values, row[0]))
            ids.append(row[0])
        else:
            ids.append(conn.execute(
                "INSERT INTO prospects (name, org_type, city, fit_score, matched_traits, facts, priority, "
                "fit_breakdown, matched_context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (p["name"], *values)).lastrowid)
    conn.commit()
    return ids


def save_icp_run(conn: sqlite3.Connection, run: dict) -> dict:
    """Write icp_agent.run_icp() output ({generated_at, icp, prospects}) in one call."""
    return {"icp_id": save_icp(conn, run.get("icp") or {}),
            "prospect_ids": save_prospects(conn, run.get("prospects") or [])}



CONTEXT_SOURCES = ("website", "x", "linkedin", "instagram", "news")
PROFILE_FIELDS = ("name", "website", "x_url", "linkedin_url", "instagram_url")


def save_context(conn: sqlite3.Connection, result: dict) -> dict:
    """Write context_agent.build_context() output ({profile, facts, sources}); the only writer of
    org_profile and org_context. Facts are replaced only for sources that read ok or from cache, so
    a blocked platform keeps the real facts captured earlier instead of being wiped."""
    profile = result.get("profile") or {}
    statuses = dict(result.get("sources") or {})
    facts = result.get("facts") or []
    for f in facts:                                     # a source with facts but no status was read
        statuses.setdefault(f.get("source"), "ok")

    current = conn.execute("SELECT * FROM org_profile WHERE id = 1").fetchone()
    merged_status = {**(json.loads(current["source_status"]) if current else {}), **statuses}
    values = {k: profile.get(k, current[k] if current else None) for k in PROFILE_FIELDS}
    values["priorities"] = json.dumps(profile.get("priorities", json.loads(current["priorities"]) if current else []))
    values["voice"] = json.dumps(profile.get("voice", json.loads(current["voice"]) if current else {}))
    values["source_status"] = json.dumps(merged_status)
    conn.execute(
        f"INSERT INTO org_profile (id, {', '.join(values)}, updated_at) VALUES (1, {', '.join('?' * len(values))}, datetime('now')) "
        f"ON CONFLICT(id) DO UPDATE SET {', '.join(f'{k} = excluded.{k}' for k in values)}, updated_at = datetime('now')",
        list(values.values()))

    replaced = sorted(s for s, st in statuses.items() if st in ("ok", "cached") and s in CONTEXT_SOURCES)
    for source in replaced:
        conn.execute("DELETE FROM org_context WHERE source = ?", (source,))
    ids, skipped = [], 0
    for f in facts:
        if f.get("source") not in replaced:
            continue
        if not (f.get("url") or "").strip() or not (f.get("fact") or "").strip():
            skipped += 1                                # no URL, no claim
            continue
        cur = conn.execute(
            "INSERT OR IGNORE INTO org_context (source, url, posted_at, fact, quote, priority) VALUES (?, ?, ?, ?, ?, ?)",
            (f["source"], f.get("url"), f.get("posted_at"), f.get("fact"), f.get("quote"), f.get("priority")))
        if cur.rowcount:
            ids.append(cur.lastrowid)
    conn.commit()
    return {"org_profile_id": 1, "context_ids": ids, "replaced_sources": replaced, "skipped_facts": skipped}


# SAMPLE seed: hand-built histories so scoring/dedupe/UI aren't blocked on ingest. They live in the active
# persona's pack (service/personas/<persona>/donors.json, picked by org_config.json "persona"; see
# service/persona.py). Every pack has the same 12 ids, tiers and planted cases; the default tidepath pack is
# fictional end to end, the miami_foundation pack keeps the original real-organization donors 9-12.
def seed_donors() -> list[dict]:
    from service import persona
    return persona.seed_donors()


def insert_donor(conn: sqlite3.Connection, donor: dict) -> int:
    """Insert one donor dict (§13 fields + optional 'gifts' as (amount, date, channel)) and return its id."""
    fields = ["full_name", "first_name", "last_name", "org_name", "donor_type", "email",
              "emails_all", "phone", "city", "state", "fund_type", "notes", "source_row"]
    values = [donor.get(f) for f in fields]
    values[fields.index("emails_all")] = json.dumps(donor.get("emails_all") or [])
    if values[fields.index("source_row")] is None:
        values[fields.index("source_row")] = "SAMPLE"   # every seed row is sample data
    cur = conn.execute(
        f"INSERT INTO donors ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})", values)
    donor_id = cur.lastrowid
    for amount, gift_date, channel in donor.get("gifts", []):
        conn.execute(
            "INSERT INTO gifts (donor_id, amount, gift_date, channel, source_row) VALUES (?, ?, ?, ?, 'SAMPLE')",
            (donor_id, amount, gift_date, channel))
    return donor_id


def seed(conn: sqlite3.Connection) -> None:
    for donor in seed_donors():
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
