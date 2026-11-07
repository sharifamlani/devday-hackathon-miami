"""Duplicate suggestions: "We found this donor twice. Merge?" Suggest only, never auto-merge.

A pair is suggested when the two donors
    share an email (any address in email / emails_all, lower-cased)        confidence 0.95
    have close names and the same phone number                             confidence 0.90
    have close names and the same city + state                             confidence 0.70

Merging happens only when a person clicks Merge (routes_data.py → merge()).

    python -m service.dedupe
"""

from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from difflib import SequenceMatcher
from itertools import combinations


def normalize_email(email: str | None) -> str | None:
    email = (email or "").strip().lower()
    return email or None


def donor_emails(donor: dict) -> set[str]:
    emails = set()
    try:
        emails.update(json.loads(donor.get("emails_all") or "[]"))
    except (TypeError, json.JSONDecodeError):
        pass
    emails.add(donor.get("email"))
    return {e for e in (normalize_email(x) for x in emails) if e}


def normalize_phone(phone: str | None) -> str | None:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 10 else None


def name_tokens(name: str | None) -> list[str]:
    """Lower-case, accents stripped, punctuation split, single-letter initials dropped."""
    ascii_name = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    return [t for t in re.split(r"[^a-z0-9]+", ascii_name.lower()) if len(t) > 1]


def names_close(a: dict, b: dict) -> bool:
    ta, tb = name_tokens(a.get("full_name")), name_tokens(b.get("full_name"))
    if not ta or not tb:
        return False
    if SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio() >= 0.85:
        return True
    if a.get("donor_type") == "organization" or b.get("donor_type") == "organization":
        return False
    # Same first name and an overlapping surname token: "Maria Delgado" ~ "María Delgado-Ruiz".
    return ta[0] == tb[0] and bool(set(ta[1:]) & set(tb[1:]))


def pair_reasons(a: dict, b: dict) -> tuple[list[str], float]:
    reasons, confidence = [], 0.0
    shared = sorted(donor_emails(a) & donor_emails(b))
    if shared:
        reasons.append(f"same email: {shared[0]}")
        confidence = max(confidence, 0.95)
    if names_close(a, b):
        phone_a, phone_b = normalize_phone(a.get("phone")), normalize_phone(b.get("phone"))
        if phone_a and phone_a == phone_b:
            reasons.append(f"similar name + same phone: {a.get('phone')}")
            confidence = max(confidence, 0.90)
        city_a = ((a.get("city") or "").strip().lower(), (a.get("state") or "").strip().lower())
        city_b = ((b.get("city") or "").strip().lower(), (b.get("state") or "").strip().lower())
        if city_a[0] and city_a == city_b:
            reasons.append(f"similar name + same city: {a.get('city')}")
            confidence = max(confidence, 0.70)
    return reasons, confidence


def find_pairs(donors: list[dict]) -> list[dict]:
    """Candidate pairs share an email, phone or city (blocking), then each pair is checked."""
    buckets: dict[str, list[int]] = {}
    for i, d in enumerate(donors):
        keys = [f"e:{e}" for e in donor_emails(d)]
        if normalize_phone(d.get("phone")):
            keys.append(f"p:{normalize_phone(d.get('phone'))}")
        if (d.get("city") or "").strip():
            keys.append(f"c:{d['city'].strip().lower()}|{(d.get('state') or '').strip().lower()}")
        for key in keys:
            buckets.setdefault(key, []).append(i)

    candidates = set()
    for members in buckets.values():
        candidates.update(combinations(sorted(set(members)), 2))

    pairs = []
    for i, j in sorted(candidates):
        reasons, confidence = pair_reasons(donors[i], donors[j])
        if reasons:
            a_id, b_id = sorted((donors[i]["id"], donors[j]["id"]))
            pairs.append({"donor_a_id": a_id, "donor_b_id": b_id, "reasons": reasons, "confidence": confidence})
    return sorted(pairs, key=lambda p: (-p["confidence"], p["donor_a_id"], p["donor_b_id"]))


def run(conn: sqlite3.Connection) -> int:
    """Refresh pending suggestions. Merged/dismissed decisions are kept. Returns pending count."""
    donors = [dict(r) for r in conn.execute("SELECT * FROM donors")]
    pairs = find_pairs(donors)
    conn.execute("DELETE FROM duplicate_suggestions WHERE status = 'pending'")
    for p in pairs:
        conn.execute(
            "INSERT OR IGNORE INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence) "
            "VALUES (?, ?, ?, ?)",
            (p["donor_a_id"], p["donor_b_id"], json.dumps(p["reasons"]), p["confidence"]))
    conn.commit()
    return conn.execute("SELECT COUNT(*) FROM duplicate_suggestions WHERE status = 'pending'").fetchone()[0]


def merge(conn: sqlite3.Connection, suggestion_id: int, keep_id: int | None = None) -> dict:
    """Merge a suggested pair into one donor. The kept donor takes the other's gifts, research facts,
    drafts and emails, and fills any blank fields from it; the other donor row is then deleted.
    Default keeper: the donor with more gifts (ties → lower id). Raises ValueError on a bad request."""
    s = conn.execute("SELECT * FROM duplicate_suggestions WHERE id = ?", (suggestion_id,)).fetchone()
    if s is None:
        raise LookupError(f"no duplicate suggestion {suggestion_id}")
    if s["status"] != "pending":
        raise ValueError(f"suggestion {suggestion_id} is already {s['status']}")
    pair = (s["donor_a_id"], s["donor_b_id"])

    if keep_id is None:
        counts = {d: conn.execute("SELECT COUNT(*) FROM gifts WHERE donor_id = ?", (d,)).fetchone()[0] for d in pair}
        keep_id = sorted(pair, key=lambda d: (-counts[d], d))[0]
    if keep_id not in pair:
        raise ValueError(f"keep_id {keep_id} is not in suggestion {suggestion_id}")
    drop_id = pair[1] if keep_id == pair[0] else pair[0]

    keep = dict(conn.execute("SELECT * FROM donors WHERE id = ?", (keep_id,)).fetchone())
    drop = dict(conn.execute("SELECT * FROM donors WHERE id = ?", (drop_id,)).fetchone())

    emails = sorted(donor_emails(keep) | donor_emails(drop))
    updates = {"emails_all": json.dumps(emails)}
    for field in ["first_name", "last_name", "org_name", "email", "phone", "city", "state", "fund_type"]:
        if not keep.get(field) and drop.get(field):
            updates[field] = drop[field]
    updates["notes"] = "\n".join(x for x in [keep.get("notes"), drop.get("notes")] if x) or None
    updates["source_row"] = "\n".join(x for x in [keep.get("source_row"), drop.get("source_row")] if x) or None

    conn.execute(f"UPDATE donors SET {', '.join(f'{k} = ?' for k in updates)} WHERE id = ?",
                 [*updates.values(), keep_id])
    moved = {}
    for table in ["gifts", "research_facts", "outreach_drafts"]:
        moved[table] = conn.execute(f"UPDATE {table} SET donor_id = ? WHERE donor_id = ?", (keep_id, drop_id)).rowcount
    conn.execute("DELETE FROM donor_scores WHERE donor_id = ?", (drop_id,))
    conn.execute("DELETE FROM donors WHERE id = ?", (drop_id,))

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    conn.execute("UPDATE duplicate_suggestions SET status = 'merged', resolved_at = ? WHERE id = ?", (now, suggestion_id))
    conn.execute(
        "UPDATE duplicate_suggestions SET status = 'superseded', resolved_at = ? "
        "WHERE status = 'pending' AND (donor_a_id = ? OR donor_b_id = ?)", (now, drop_id, drop_id))
    conn.commit()
    return {"suggestion_id": suggestion_id, "kept_donor_id": keep_id, "removed_donor_id": drop_id, "moved": moved}


def dismiss(conn: sqlite3.Connection, suggestion_id: int) -> None:
    cur = conn.execute(
        "UPDATE duplicate_suggestions SET status = 'dismissed', resolved_at = ? WHERE id = ? AND status = 'pending'",
        (datetime.now(timezone.utc).isoformat(timespec="seconds"), suggestion_id))
    if cur.rowcount == 0:
        raise LookupError(f"no pending duplicate suggestion {suggestion_id}")
    conn.commit()


def main() -> None:
    from service.db import connect

    conn = connect()
    n = run(conn)
    for row in conn.execute(
            "SELECT s.id, a.full_name AS a, b.full_name AS b, s.confidence, s.reasons FROM duplicate_suggestions s "
            "JOIN donors a ON a.id = s.donor_a_id JOIN donors b ON b.id = s.donor_b_id WHERE s.status = 'pending'"):
        print(f"#{row['id']} {row['a']} ~ {row['b']} ({row['confidence']:.2f}) {json.loads(row['reasons'])}")
    print(f"{n} pending suggestions")


if __name__ == "__main__":
    main()
