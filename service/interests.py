"""Donor interest areas: the 17-tag taxonomy, staff-wins storage, and the propose → Save flow (plan §21.2.6).

Taxonomy and rules: docs/research/interest-areas.md (approved by Sharif). Each tag on a person carries
confidence, evidence, source_url and source_type. Rules enforced here, in Python:
    - only the 17 slugs (and their own sub-tags) are stored
    - an agent tag needs a source_url; untagged beats guessed
    - staff tags are never overwritten, and a tag staff removed is never re-added by the agent
    - removing a tag keeps the row (status 'removed')

Service functions (add_interest, remove_interest, accept_enrichment) return an undo token; undo(conn, token)
reverses the change. The token carries the rows as they were, so it works before 3a's agent_actions lands.
"""
from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
from typing import Literal

# slug, label, definition, sub-tags, NTEE groups, Miami Foundation / Give Miami Day mapping
TAGS = [
    ("arts_culture", "Arts & Culture", "Museums, performing and visual arts, public art, history, libraries",
     ["museums", "music", "theater", "film", "public_art", "historic_preservation"], ["A"], "GMD: Arts and Culture"),
    ("education", "Education", "Schools, higher ed, literacy, scholarships, STEM learning",
     ["k12", "higher_ed", "scholarships", "literacy", "early_childhood"], ["B"],
     "MF: Empower Youth & Families; Scholarships; GMD: Education and Youth"),
    ("youth_family", "Youth & Family", "Youth development, mentoring, child welfare, family support",
     ["mentoring", "foster_care", "after_school", "parenting"], ["O", "P"],
     "MF: Empower Youth & Families; GMD: Education and Youth"),
    ("health_wellness", "Health & Wellness", "Healthcare access, mental health, disease causes, public health",
     ["mental_health", "hospitals", "cancer", "substance_use", "aging"], ["E", "F", "G", "H"], "GMD: Health and Wellness"),
    ("basic_needs", "Food & Basic Needs", "Food security, emergency aid, disaster relief, veterans and senior services",
     ["hunger", "emergency_assistance", "disaster_relief", "veterans", "seniors"], ["I", "J", "K", "L", "M", "N", "P", "S"],
     "GMD: Community Care"),
    ("housing", "Housing & Homelessness", "Affordable housing, homelessness, housing stability",
     ["affordable_housing", "homelessness", "home_repair"], ["L"],
     "MF: Eliminate Inequities / Generate Prosperity; GMD: Community Care~"),
    ("economic_mobility", "Economic Mobility", "Workforce, small business, financial health, entrepreneurship",
     ["workforce", "small_business", "financial_literacy"], ["S", "J"],
     "MF: Generate Prosperity; GMD: Economic and Community Development"),
    ("community_development", "Community Development",
     "Neighborhood revitalization, public safety, community spaces, philanthropy infrastructure",
     ["neighborhood", "parks", "public_safety", "nonprofit_capacity"], ["S", "T", "W"],
     "GMD: Economic and Community Development"),
    ("environment_conservation", "Environment & Conservation",
     "Land, water, wildlife habitat, sustainability, Everglades and Biscayne Bay",
     ["water_quality", "everglades", "ocean_coral", "sustainability"], ["C"], "GMD: Environment"),
    ("climate_resilience", "Climate & Disaster Resilience",
     "Sea-level rise, extreme heat, hurricane preparedness, resilient infrastructure",
     ["sea_level_rise", "extreme_heat", "hurricane_recovery"], ["C", "M"], "MF: Build Climate & Disaster Resilience"),
    ("animals", "Animals", "Welfare, shelters, rescue, humane education",
     ["shelters", "wildlife_rehab", "animal_welfare"], ["D"], "GMD: Animals"),
    ("civic_media", "Civic Engagement & Local News", "Voting access, civic forums, journalism, government accountability",
     ["local_news", "voter_engagement", "civic_leadership"], ["R", "W", "A"],
     "MF: Inspire Civic Involvement; Press Forward; GMD: Civic Engagement~"),
    ("equity_rights", "Equity & Civil Rights",
     "Civil and human rights, anti-discrimination, immigrant and refugee services, legal aid, LGBTQ and women's causes",
     ["immigrant_services", "legal_aid", "racial_equity", "womens_rights"], ["R", "P"], "MF: Eliminate Inequities"),
    ("disability_access", "Disability & Accessibility", "Services and advocacy for people with disabilities",
     ["developmental_disability", "accessibility", "special_needs"], ["P", "I", "G", "H"],
     "GMD: Accessibility and Disability Services~"),
    ("science_technology", "Science & Technology", "Research, STEM innovation, tech access",
     ["stem", "research", "digital_access"], ["U"], "GMD: Science and Technology~"),
    ("international", "International & Global", "Global relief, development, foreign affairs, exchange",
     ["global_health", "relief", "exchange_programs"], ["Q"], None),
    ("faith_based", "Faith-Based Giving", "Gifts or leadership roles at congregations or religious charities",
     ["congregation", "faith_charity"], ["X"], "GMD: Faith-Based"),
]
TAG_SLUGS = [t[0] for t in TAGS]
SUBTAGS = {t[0]: t[3] for t in TAGS}
ALL_SUBTAGS = sorted({s for subs in SUBTAGS.values() for s in subs})
LABELS = {t[0]: t[1] for t in TAGS}

# Enums for structured output (the agent can only return these values)
TagSlug = Literal[tuple(TAG_SLUGS)]                 # type: ignore[valid-type]
SubTagSlug = Literal[tuple(ALL_SUBTAGS)]            # type: ignore[valid-type]
Confidence = Literal["high", "medium", "low"]
SourceType = Literal["board_seat", "named_gift", "named_fund", "statement", "event_sponsor", "volunteer",
                     "event_attendance", "social", "staff_note", "other"]

SUBTAG_LABELS = {"k12": "K-12", "stem": "STEM", "higher_ed": "Higher education", "ocean_coral": "Ocean & coral"}


def subtag_label(slug: str) -> str:
    return SUBTAG_LABELS.get(slug, slug.replace("_", " ").capitalize())


def seed_sql() -> str:
    """Upserts for the 17 tags and their sub-tags (run by ensure_seeded)."""
    q = lambda s: "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"
    rows = []
    for i, (slug, label, definition, subs, ntee, gmd) in enumerate(TAGS):
        rows.append(f"INSERT INTO interest_tags (slug, label, definition, ntee_groups, gmd_area, sort_order) "
                    f"VALUES ({q(slug)}, {q(label)}, {q(definition)}, {q(json.dumps(ntee))}, {q(gmd)}, {i}) "
                    f"ON CONFLICT(slug) DO UPDATE SET label = excluded.label, definition = excluded.definition, "
                    f"ntee_groups = excluded.ntee_groups, gmd_area = excluded.gmd_area, sort_order = excluded.sort_order;")
        rows += [f"INSERT OR IGNORE INTO interest_subtags (tag_slug, sub_slug, label) "
                 f"VALUES ({q(slug)}, {q(s)}, {q(subtag_label(s))});" for s in subs]
    return "\n".join(rows) + "\n"


def ensure_seeded(conn: sqlite3.Connection) -> None:
    """Seed the 17 tags once. A read when they're already there, so it's safe on every request."""
    have = conn.execute("SELECT COUNT(*) FROM interest_subtags").fetchone()[0]
    if have < sum(len(s) for s in SUBTAGS.values()) or             conn.execute("SELECT COUNT(*) FROM interest_tags").fetchone()[0] < len(TAGS):
        conn.executescript(seed_sql())


# --- Reads -----------------------------------------------------------------------------------------

def list_tags(conn: sqlite3.Connection) -> list[dict]:
    ensure_seeded(conn)
    return [dict(r) for r in conn.execute(
        "SELECT slug, label, definition FROM interest_tags WHERE active = 1 ORDER BY sort_order")]


def list_interests(conn: sqlite3.Connection, donor_id: int, include_removed: bool = False) -> list[dict]:
    where = "" if include_removed else " AND status = 'active'"
    rows = conn.execute(
        "SELECT tag, sub_tag, confidence, evidence, source_url, source_type, set_by, status, found_at "
        f"FROM donor_interests WHERE donor_id = ?{where} ORDER BY tag, sub_tag", (donor_id,))
    return [{**dict(r), "label": LABELS.get(r["tag"])} for r in rows]


def donor_exists(conn: sqlite3.Connection, donor_id: int) -> bool:
    return conn.execute("SELECT 1 FROM donors WHERE id = ?", (donor_id,)).fetchone() is not None


# --- Validation ------------------------------------------------------------------------------------

def check_tag(tag: str, sub_tag: str | None = None) -> None:
    if tag not in SUBTAGS:
        raise ValueError(f"unknown interest tag {tag!r}; expected one of {', '.join(TAG_SLUGS)}")
    if sub_tag is not None and sub_tag not in SUBTAGS[tag]:
        raise ValueError(f"sub-tag {sub_tag!r} doesn't belong to {tag!r}; expected one of {', '.join(SUBTAGS[tag])}")


# --- Undo ------------------------------------------------------------------------------------------

ROW_FIELDS = ["donor_id", "tag", "sub_tag", "confidence", "evidence", "source_url", "source_type", "found_at",
              "set_by", "status", "removed_by"]


def _snapshot(conn: sqlite3.Connection, donor_id: int, tags: list[str]) -> list[dict]:
    if not tags:
        return []
    marks = ",".join("?" * len(tags))
    return [dict(r) for r in conn.execute(
        f"SELECT {', '.join(ROW_FIELDS)} FROM donor_interests WHERE donor_id = ? AND tag IN ({marks})",
        (donor_id, *tags))]


def _token(op: str, donor_id: int, tags: list[str], before: list[dict], fact_ids: list[int] | None = None) -> str:
    payload = {"op": op, "donor_id": donor_id, "tags": tags, "before": before, "fact_ids": fact_ids or []}
    return "int_" + base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")


def undo(conn: sqlite3.Connection, token: str) -> dict:
    """Put the person's tags (and any research facts the change saved) back as they were."""
    if not token.startswith("int_"):
        raise ValueError("not an interest undo token")
    raw = token[4:]
    payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    donor_id, tags = payload["donor_id"], payload["tags"]
    with conn:
        if tags:
            marks = ",".join("?" * len(tags))
            conn.execute(f"DELETE FROM donor_interests WHERE donor_id = ? AND tag IN ({marks})", (donor_id, *tags))
        for row in payload["before"]:
            conn.execute(f"INSERT INTO donor_interests ({', '.join(ROW_FIELDS)}) VALUES ({', '.join('?' * len(ROW_FIELDS))})",
                         [row[f] for f in ROW_FIELDS])
        if payload["fact_ids"]:
            marks = ",".join("?" * len(payload["fact_ids"]))
            conn.execute(f"DELETE FROM research_facts WHERE id IN ({marks})", payload["fact_ids"])
    return {"undone": True, "op": payload["op"], "donor_id": donor_id}


# --- Staff writes ----------------------------------------------------------------------------------

def add_interest(conn: sqlite3.Connection, donor_id: int, tag: str, sub_tag: str | None = None,
                 staff: str = "staff", evidence: str | None = None) -> dict:
    """Staff adds a tag: set_by 'staff', confidence 'high', no URL needed. Returns {interests, undo}."""
    check_tag(tag, sub_tag)
    ensure_seeded(conn)
    before = _snapshot(conn, donor_id, [tag])
    note = (evidence or f"Added by {staff}")[:300]
    with conn:
        existing = conn.execute("SELECT id FROM donor_interests WHERE donor_id = ? AND tag = ? "
                                "AND COALESCE(sub_tag, '') = COALESCE(?, '')", (donor_id, tag, sub_tag)).fetchone()
        if existing:
            conn.execute("UPDATE donor_interests SET set_by = 'staff', status = 'active', removed_by = NULL, "
                         "confidence = 'high', evidence = ?, source_type = 'staff_note' WHERE id = ?",
                         (note, existing["id"]))
        else:
            conn.execute("INSERT INTO donor_interests (donor_id, tag, sub_tag, confidence, evidence, source_type, set_by) "
                         "VALUES (?, ?, ?, 'high', ?, 'staff_note', 'staff')", (donor_id, tag, sub_tag, note))
    return {"interests": list_interests(conn, donor_id), "undo": _token("add_interest", donor_id, [tag], before)}


def remove_interest(conn: sqlite3.Connection, donor_id: int, tag: str, staff: str = "staff") -> dict:
    """Staff removes a tag: every row for it goes to status 'removed' (kept, so the agent won't re-add it)."""
    check_tag(tag)
    ensure_seeded(conn)
    before = _snapshot(conn, donor_id, [tag])
    with conn:
        if before:
            changed = conn.execute("UPDATE donor_interests SET status = 'removed', removed_by = ? "
                                   "WHERE donor_id = ? AND tag = ?", (staff, donor_id, tag)).rowcount
        else:  # nothing to remove: record the removal so a later enrichment can't add it either
            conn.execute("INSERT INTO donor_interests (donor_id, tag, confidence, evidence, source_type, set_by, "
                         "status, removed_by) VALUES (?, ?, 'high', ?, 'staff_note', 'staff', 'removed', ?)",
                         (donor_id, tag, f"Removed by {staff}", staff))
            changed = 0
    return {"removed": changed > 0, "undo": _token("remove_interest", donor_id, [tag], before)}


# --- Agent proposals → Save to profile -------------------------------------------------------------

def fact_id(fact: str, url: str) -> str:
    return hashlib.sha1(f"{fact}|{url}".encode()).hexdigest()[:12]


def staff_owned(conn: sqlite3.Connection, donor_id: int, tag: str) -> bool:
    """True when staff set or removed this tag: the agent never touches it."""
    return conn.execute("SELECT 1 FROM donor_interests WHERE donor_id = ? AND tag = ? "
                        "AND (set_by = 'staff' OR removed_by IS NOT NULL)", (donor_id, tag)).fetchone() is not None


def upsert_agent_interest(conn: sqlite3.Connection, donor_id: int, i: dict) -> bool:
    """Write one agent tag unless staff owns it. Returns True when written."""
    check_tag(i["tag"], i.get("sub_tag"))
    if not i.get("source_url") or staff_owned(conn, donor_id, i["tag"]):
        return False
    values = (i["confidence"], i["evidence"][:300], i["source_url"], i.get("source_type"))
    existing = conn.execute("SELECT id FROM donor_interests WHERE donor_id = ? AND tag = ? "
                            "AND COALESCE(sub_tag, '') = COALESCE(?, '')", (donor_id, i["tag"], i.get("sub_tag"))).fetchone()
    if existing:
        conn.execute("UPDATE donor_interests SET confidence = ?, evidence = ?, source_url = ?, source_type = ?, "
                     "found_at = datetime('now'), status = 'active' WHERE id = ?", (*values, existing["id"]))
    else:
        conn.execute("INSERT INTO donor_interests (donor_id, tag, sub_tag, confidence, evidence, source_url, "
                     "source_type, set_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent')",
                     (donor_id, i["tag"], i.get("sub_tag"), *values))
    return True


def accept_enrichment(conn: sqlite3.Connection, donor_id: int, proposal: dict, fact_ids: list[str],
                      tags: list[str], agent_run_id: str) -> dict:
    """Save the facts and tags staff picked from a proposal ({facts, interests}). Staff-owned tags are skipped.

    Returns {saved: {facts, interests, contact, skipped_staff_tags}, undo}. contact echoes the proposal's
    public contact for the UI and is never persisted (contact_persisted: False): donors is Carlos's table.
    """
    for t in tags:
        check_tag(t)
    ensure_seeded(conn)
    facts = [f for f in proposal.get("facts", []) if f["id"] in set(fact_ids)]
    picked = [i for i in proposal.get("interests", []) if i["tag"] in set(tags)]
    touched = sorted({i["tag"] for i in picked})
    before = _snapshot(conn, donor_id, touched)
    new_fact_ids, written, skipped = [], 0, []
    with conn:
        for f in facts:
            cur = conn.execute(
                "INSERT INTO research_facts (donor_id, fact, source_url, retrieved_at, agent_run_id) "
                "SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM research_facts "
                "WHERE donor_id = ? AND source_url = ? AND fact = ?)",
                (donor_id, f["fact"], f["source_url"], f["retrieved_at"], agent_run_id, donor_id, f["source_url"], f["fact"]))
            if cur.rowcount:
                new_fact_ids.append(cur.lastrowid)
        for i in picked:
            if upsert_agent_interest(conn, donor_id, i):
                written += 1
            else:
                skipped.append(i["tag"])
    return {"saved": {"facts": len(new_fact_ids), "interests": written, "contact": proposal.get("contact") or {},
                      "contact_persisted": False, "skipped_staff_tags": sorted(set(skipped))},
            "undo": _token("accept_enrichment", donor_id, touched, before, new_fact_ids)}
