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
    intent      TEXT NOT NULL CHECK (intent IN ('thank_you', 're_engage', 'check_in', 'event_invite')),
    channel     TEXT NOT NULL CHECK (channel IN ('email', 'text', 'mixed')),   -- mixed: each message has its own
    event_id    INTEGER,                    -- the event an 'event_invite' batch is for (one batch per event)
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
    simulated           INTEGER NOT NULL DEFAULT 1 CHECK (simulated IN (0, 1)),  -- 1 = dry run, nothing left
    provider            TEXT NOT NULL DEFAULT 'dryrun',             -- dryrun | gmail | twilio (outbound.deliver)
    delivery_status     TEXT NOT NULL DEFAULT 'queued (dry run)',   -- 'queued (dry run)' | 'sent'
    provider_id         TEXT                                        -- the provider's message id, when sent
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
# 5E: three tabs (Givers / Neighbors / Community) and the event calendar. Kept in its own block so
# other branches editing db.py merge cleanly. People stay in `donors`; contact_type picks the tab.
EVENTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY,
    title         TEXT NOT NULL,
    starts_at     TEXT NOT NULL,          -- YYYY-MM-DD or YYYY-MM-DDTHH:MM
    ends_at       TEXT,
    place         TEXT,
    audience_hint TEXT,                   -- giving | community | pet (events_agent)
    source_url    TEXT NOT NULL CHECK (source_url <> ''),   -- every event has a source
    source        TEXT,                   -- website | news | search
    verification  TEXT,                   -- e.g. page-verified
    quote         TEXT,                   -- the page snippet the event rests on
    captured_at   TEXT,                   -- when the agent read it
    status        TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'changed', 'past')),
    event_kind    TEXT,                   -- from suggest_audience
    rationale     TEXT,                   -- why this audience (suggest_audience)
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
-- An event is the same event when title + date + source match (save_events); a time change is 'changed'.
CREATE INDEX IF NOT EXISTS idx_events_match ON events(title, substr(starts_at, 1, 10), source);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);

-- Who an event is for, across all three tabs, and why.
CREATE TABLE IF NOT EXISTS event_audience (
    event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
    reason    TEXT,
    PRIMARY KEY (event_id, person_id)
);

-- An event invite is an ordinary outreach_drafts row (so the star/approval triggers apply), linked here.
CREATE TABLE IF NOT EXISTS event_drafts (
    event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    draft_id  INTEGER NOT NULL REFERENCES outreach_drafts(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, draft_id)
);
CREATE INDEX IF NOT EXISTS idx_event_drafts_draft ON event_drafts(draft_id);

-- One row per context refresh (onboarding step 2 and every rerun): what was read, what changed.
CREATE TABLE IF NOT EXISTS context_refresh_log (
    id             INTEGER PRIMARY KEY,
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    sources_read   TEXT NOT NULL DEFAULT '{}',   -- JSON {source: ok|cached|blocked|skipped|error}
    facts_added    INTEGER NOT NULL DEFAULT 0,
    facts_removed  INTEGER NOT NULL DEFAULT 0,
    events_added   INTEGER NOT NULL DEFAULT 0,
    events_changed INTEGER NOT NULL DEFAULT 0,
    events_removed INTEGER NOT NULL DEFAULT 0,
    errors         TEXT NOT NULL DEFAULT '[]'    -- JSON list of strings
);
"""
SCHEMA += EVENTS_SCHEMA
TABLES = ["context_refresh_log", "event_drafts", "event_audience", "events"] + TABLES

# §21 B11/B12 (service/tasks.py): tasks and the log of every agent or staff write, with undo.
TASKS_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('call', 'email', 'review', 'prep', 'other')),
    title       TEXT NOT NULL,
    why         TEXT,
    person_id   INTEGER REFERENCES donors(id) ON DELETE SET NULL,
    chips       TEXT NOT NULL DEFAULT '[]',   -- JSON list of short strings
    due         TEXT,                         -- YYYY-MM-DD; dated tasks show on the calendar
    time        TEXT,                         -- HH:MM
    done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    done_at     TEXT,
    source      TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('agent', 'staff', 'generator', 'call')),
    gen_key     TEXT UNIQUE,                  -- the generator's idempotency key; null for hand-made tasks
    members     TEXT,                         -- duplicate reviews: JSON list of the group's donor ids
    deleted_at  TEXT,                         -- soft delete, so undo restores and the generator never re-adds
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
CREATE INDEX IF NOT EXISTS idx_tasks_person ON tasks(person_id);

CREATE TABLE IF NOT EXISTS agent_actions (
    id          INTEGER PRIMARY KEY,
    token       TEXT NOT NULL UNIQUE,         -- the undo token handed back to the caller
    actor       TEXT NOT NULL,                -- agent | staff | generator | call
    action      TEXT NOT NULL,                -- create_task, update_task, complete_task, delete_task, ...
    target      TEXT NOT NULL,                -- 'task:12'
    before      TEXT,                         -- JSON row before the write; null for a create
    after       TEXT,                         -- JSON row after the write
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    undone_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_actions_target ON agent_actions(target);
"""
SCHEMA += TASKS_SCHEMA
TABLES = ["agent_actions", "tasks"] + TABLES

# Call notes from the live transcript pane (service/routes_calls.py). Its own block so other branches
# editing db.py merge cleanly. CREATE ... IF NOT EXISTS is the migration: an older donors.db gains the
# table the next time create_schema runs. Lists are JSON text; destinations mirror the web's NoteDestination.
CALLS_SCHEMA = """
CREATE TABLE IF NOT EXISTS call_notes (
    id           TEXT PRIMARY KEY,             -- the browser's note id, so saving again updates the row
    title        TEXT NOT NULL,
    created_at   TEXT NOT NULL,                -- ISO timestamp, when the call started
    duration_sec INTEGER NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
    destinations TEXT NOT NULL DEFAULT '[]',   -- JSON [{kind: donor|group|project, id, label}]
    transcript   TEXT NOT NULL DEFAULT '[]',   -- JSON [{speaker: you|them, name, text, at}]
    notes        TEXT NOT NULL DEFAULT '',
    summary      TEXT NOT NULL DEFAULT '[]',   -- JSON list of strings
    next_steps   TEXT NOT NULL DEFAULT '[]',   -- JSON list of strings
    saved_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_notes_created ON call_notes(created_at);
"""
SCHEMA += CALLS_SCHEMA
TABLES = ["call_notes"] + TABLES

CONTACT_TYPES = ("giver", "neighbor", "community")
# Self-reported fields the nonprofit records for the Community tab; nothing is inferred or searched.
DEMOGRAPHIC_FIELDS = ("age_range", "gender", "household_size", "zip", "language", "programs")

ADDED_COLUMNS = {
    "icp_profile": {"recent_context": "TEXT"},
    "prospects": {"fit_breakdown": "TEXT", "matched_context": "TEXT"},
    "donors": {
        "contact_type": "TEXT NOT NULL DEFAULT 'giver' CHECK (contact_type IN ('giver', 'neighbor', 'community'))",
        "interests": "TEXT",            # JSON list of tags, e.g. ["dogs", "arts"]
        "has_dog": "INTEGER CHECK (has_dog IN (0, 1))",   # null = not recorded
        "demographics": "TEXT",         # JSON {field: {value, source_row}}, DEMOGRAPHIC_FIELDS only
        "tab_review": "TEXT",           # null, or why the agent couldn't place this person
    },
    "outreach_drafts": {"sms": "TEXT"},  # text-message version of an invite (events_agent)
    "org_profile": {"last_refreshed_at": "TEXT"},   # set by every successful save_context
    # A declined or failed charge is kept on record but never counted in totals or scoring.
    "gifts": {"status": "TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'declined', 'failed'))"},
    # §21.2.3 context store (86): what each fact is, a short title, its embedding, and whether it came from cache
    "org_context": {
        "kind": "TEXT CHECK (kind IN ('success_story', 'program_update', 'use_of_funds', 'org_health', 'event', 'news', 'other'))",
        "title": "TEXT",
        "embedding": "BLOB",            # float32 vector, OpenAI text-embedding-3-small
        "cached": "INTEGER NOT NULL DEFAULT 0",
    },
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
    before = {(r[0], r[1], r[2]) for r in conn.execute(
        f"SELECT source, url, fact FROM org_context WHERE source IN ({', '.join('?' * len(replaced))})", replaced)}
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
    after = {(r[0], r[1], r[2]) for r in conn.execute(
        f"SELECT source, url, fact FROM org_context WHERE source IN ({', '.join('?' * len(replaced))})", replaced)}
    if replaced:
        conn.execute("UPDATE org_profile SET last_refreshed_at = datetime('now') WHERE id = 1")
    conn.commit()
    return {"org_profile_id": 1, "context_ids": ids, "replaced_sources": replaced, "skipped_facts": skipped,
            "facts_added": len(after - before), "facts_removed": len(before - after)}



# 5E writers: events_agent (86) stays pure; these are the only writers of events, event_audience,
# event_drafts and context_refresh_log.
EVENT_FIELDS = ("starts_at", "ends_at", "place", "audience_hint", "source_url", "verification", "quote", "captured_at")


def _today() -> str:
    from service.score import default_as_of             # the pinned demo date, like scoring
    return default_as_of().isoformat()


def save_events(conn: sqlite3.Connection, events: list[dict], complete: bool = False) -> dict:
    """Upsert events. The same event = same title + date + source; if any field (e.g. the time or place)
    differs, it's 'changed'. Events without a source URL are dropped. complete=True means this was a full,
    successful refresh: only then are future events missing from it removed (cancelled). A partial or
    failed run never deletes. Past events are marked 'past'. Returns {ids, added, changed, removed};
    ids lines up with the input list by position (None where an event was dropped)."""
    today = _today()
    ids, added, changed = [], 0, 0
    for e in events:
        if not e.get("title") or not e.get("starts_at") or not (e.get("source_url") or "").strip():
            ids.append(None)
            continue
        row = conn.execute(
            "SELECT * FROM events WHERE title = ? AND substr(starts_at, 1, 10) = ? AND IFNULL(source, '') = ?",
            (e["title"], e["starts_at"][:10], e.get("source") or "")).fetchone()
        new = {k: e.get(k) for k in EVENT_FIELDS}
        status = "past" if e["starts_at"][:10] < today else "upcoming"
        if row is None:
            ids.append(conn.execute(
                f"INSERT INTO events (title, source, status, {', '.join(EVENT_FIELDS)}) "
                f"VALUES (?, ?, ?, {', '.join('?' * len(EVENT_FIELDS))})",
                (e["title"], e.get("source"), status, *new.values())).lastrowid)
            added += 1
            continue
        differs = any((row[k] or None) != (new[k] or None) for k in EVENT_FIELDS
                      if k not in ("captured_at", "verification", "quote"))   # a re-read snippet isn't a change
        if differs and status != "past":
            status = "changed"
            changed += 1
        elif status != "past" and row["status"] == "changed":
            status = "changed"                           # stays flagged until someone looks
        conn.execute(
            f"UPDATE events SET {', '.join(f'{k} = ?' for k in EVENT_FIELDS)}, status = ?, "
            f"updated_at = CASE WHEN ? THEN datetime('now') ELSE updated_at END WHERE id = ?",
            (*new.values(), status, int(differs), row["id"]))
        ids.append(row["id"])

    removed = 0
    kept = [i for i in ids if i is not None]
    if complete:
        stale = [r[0] for r in conn.execute(
            f"SELECT id FROM events WHERE substr(starts_at, 1, 10) >= ? AND id NOT IN ({', '.join('?' * len(kept)) or 'NULL'})",
            (today, *kept))]
        for event_id in stale:                            # cancelled: drop it and its invites
            conn.execute("DELETE FROM outreach_drafts WHERE id IN (SELECT draft_id FROM event_drafts WHERE event_id = ?)",
                         (event_id,))
            conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
        removed = len(stale)
    conn.execute("UPDATE events SET status = 'past' WHERE substr(starts_at, 1, 10) < ? AND status != 'past'", (today,))
    conn.commit()
    return {"ids": ids, "added": added, "changed": changed, "removed": removed}


def save_event_audience(conn: sqlite3.Connection, event_id: int, audience: dict) -> int:
    """Store suggest_audience output ({event_kind, person_ids, why, rationale}): one event_audience row per
    person (with the reason), event_kind and rationale on the event. Replaces the earlier audience."""
    audience = audience or {}
    if conn.execute("UPDATE events SET event_kind = ?, rationale = ? WHERE id = ?",
                    (audience.get("event_kind"), audience.get("rationale"), event_id)).rowcount == 0:
        raise LookupError(f"no event {event_id}")
    conn.execute("DELETE FROM event_audience WHERE event_id = ?", (event_id,))
    why = audience.get("why") or {}
    n = 0
    for pid in dict.fromkeys(audience.get("person_ids") or []):
        if conn.execute("SELECT 1 FROM donors WHERE id = ?", (pid,)).fetchone():
            conn.execute("INSERT INTO event_audience (event_id, person_id, reason) VALUES (?, ?, ?)",
                         (event_id, pid, why.get(str(pid)) or why.get(pid)))
            n += 1
    conn.commit()
    return n


def log_context_refresh(conn: sqlite3.Connection, started_at: str, sources_read: dict | None = None,
                        context: dict | None = None, events: dict | None = None,
                        errors: list[str] | None = None) -> int:
    """One context_refresh_log row. context = save_context's return, events = save_events' return."""
    context, events = context or {}, events or {}
    cur = conn.execute(
        "INSERT INTO context_refresh_log (started_at, finished_at, sources_read, facts_added, facts_removed, "
        "events_added, events_changed, events_removed, errors) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)",
        (started_at, json.dumps(sources_read or {}), context.get("facts_added", 0), context.get("facts_removed", 0),
         events.get("added", 0), events.get("changed", 0), events.get("removed", 0), json.dumps(errors or [])))
    conn.commit()
    return cur.lastrowid


def save_event_draft(conn: sqlite3.Connection, event_id: int, person_id: int, draft: dict) -> int:
    """Save one invite (draft_event_invite output) as an outreach_drafts row linked to the event. A rerun
    replaces that person's earlier invite for the event. The star/approval triggers apply as usual."""
    for (old,) in conn.execute(
            "SELECT d.id FROM outreach_drafts d JOIN event_drafts ed ON ed.draft_id = d.id "
            "WHERE ed.event_id = ? AND d.donor_id = ?", (event_id, person_id)).fetchall():
        conn.execute("DELETE FROM outreach_drafts WHERE id = ?", (old,))
    draft_id = conn.execute(
        "INSERT INTO outreach_drafts (donor_id, channel, subject, body, sms, facts_used, status) "
        "VALUES (?, 'email', ?, ?, ?, ?, ?)",
        (person_id, draft.get("subject"), draft.get("email_body") or draft.get("body") or "", draft.get("sms"),
         json.dumps(draft.get("facts_used") or []), draft.get("status") or "draft")).lastrowid
    conn.execute("INSERT INTO event_drafts (event_id, draft_id) VALUES (?, ?)", (event_id, draft_id))
    conn.commit()
    return draft_id


# Call notes (service/routes_calls.py): the only code that writes call_notes.
CALL_NOTE_JSON = ("destinations", "transcript", "summary", "next_steps")


def call_note_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    for key in CALL_NOTE_JSON:
        d[key] = json.loads(d[key] or "[]")
    return d


def save_call_note(conn: sqlite3.Connection, note: dict) -> dict:
    """Insert or replace one call note by id (saving the same note again updates it). Returns the saved row."""
    values = {k: json.dumps(note.get(k) or [], ensure_ascii=False) if k in CALL_NOTE_JSON else note.get(k)
              for k in ("id", "title", "created_at", "duration_sec", "notes") + CALL_NOTE_JSON}
    values["notes"] = values["notes"] or ""
    values["duration_sec"] = int(values["duration_sec"] or 0)
    cols = ", ".join(values)
    conn.execute(
        f"INSERT INTO call_notes ({cols}, saved_at) VALUES ({', '.join('?' for _ in values)}, datetime('now')) "
        f"ON CONFLICT(id) DO UPDATE SET {', '.join(f'{c} = excluded.{c}' for c in values if c != 'id')}, "
        "saved_at = datetime('now')", tuple(values.values()))
    conn.commit()
    return call_note_out(conn.execute("SELECT * FROM call_notes WHERE id = ?", (note["id"],)).fetchone())


def list_call_notes(conn: sqlite3.Connection, donor_id: int | None = None, project_id: str | None = None,
                    limit: int | None = None) -> list[dict]:
    """Newest call first. donor_id / project_id keep notes with that destination (both = both must match)."""
    where, params = [], []
    for kind, ref in (("donor", donor_id), ("project", project_id)):
        if ref is not None:
            where.append("EXISTS (SELECT 1 FROM json_each(c.destinations) j "
                         "WHERE json_extract(j.value, '$.kind') = ? AND CAST(json_extract(j.value, '$.id') AS TEXT) = ?)")
            params += [kind, str(ref)]
    sql = "SELECT c.* FROM call_notes c" + (f" WHERE {' AND '.join(where)}" if where else "")
    sql += " ORDER BY c.created_at DESC, c.saved_at DESC, c.id"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(int(limit))
    return [call_note_out(r) for r in conn.execute(sql, params)]


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


def insert_donor(conn: sqlite3.Connection, donor: dict) -> int:
    """Insert one donor dict (§13 fields + optional 'gifts' as (amount, date, channel)) and return its id."""
    fields = ["full_name", "first_name", "last_name", "org_name", "donor_type", "email",
              "emails_all", "phone", "city", "state", "fund_type", "notes", "source_row",
              "contact_type", "interests", "has_dog", "demographics", "tab_review"]
    values = [donor.get(f) for f in fields]
    values[fields.index("emails_all")] = json.dumps(donor.get("emails_all") or [])
    values[fields.index("contact_type")] = donor.get("contact_type") or "giver"
    values[fields.index("interests")] = json.dumps(donor.get("interests") or [])
    values[fields.index("demographics")] = json.dumps(donor.get("demographics") or {})
    if donor.get("has_dog") is not None:
        values[fields.index("has_dog")] = int(bool(donor["has_dog"]))
    if values[fields.index("source_row")] is None:
        values[fields.index("source_row")] = "SAMPLE"   # every seed row is sample data
    cur = conn.execute(
        f"INSERT INTO donors ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})", values)
    donor_id = cur.lastrowid
    for amount, gift_date, channel, *rest in donor.get("gifts", []):     # optional 4th item: status
        conn.execute(
            "INSERT INTO gifts (donor_id, amount, gift_date, channel, source_row, status) VALUES (?, ?, ?, ?, 'SAMPLE', ?)",
            (donor_id, amount, gift_date, channel, rest[0] if rest else "ok"))
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
