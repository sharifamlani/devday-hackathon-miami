"""Duplicate suggestions: "We found this donor twice. Merge?" Suggest only, never auto-merge.

A pair is suggested when the two donors
    share an email (any address in email / emails_all, lower-cased)        confidence 0.95
    have close names and the same phone number                             confidence 0.90
    are organizations with the same name once legal suffixes are dropped   confidence 0.80
    ("Tamarind Quay Hdwe, L.L.C." ~ "Tamarind Quay Hardware LLC")
    have exactly the same name, nothing else shared                        confidence 0.75
    have close names and the same city + state                             confidence 0.70
    have compatible names only: nickname (Bob ~ Robert), initial (D. ~      confidence 0.60
    Dana, Maria D. ~ Maria Delgado), short form (Teo ~ Teodoro)
    are a donor and a fund named for their family (Harold Whitaker ~        confidence 0.60
    Whitaker Family Charitable Fund)

Candidates are blocked on shared email, phone, city, surname, first name or organization stem,
so name-only matches (a row with no contact details) still get compared.

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


# Common English and Spanish nicknames -> the formal first name (both sides are mapped before comparing).
NICKNAMES = {
    "bob": "robert", "bobby": "robert", "rob": "robert", "robbie": "robert",
    "liz": "elizabeth", "lizzie": "elizabeth", "beth": "elizabeth", "betty": "elizabeth", "eliza": "elizabeth",
    "millie": "mildred", "teo": "teodoro", "bill": "william", "billy": "william", "will": "william",
    "jim": "james", "jimmy": "james", "rick": "richard", "dick": "richard", "maggie": "margaret",
    "peggy": "margaret", "meg": "margaret", "kate": "katherine", "katie": "katherine", "cathy": "catherine",
    "mike": "michael", "joe": "joseph", "tom": "thomas", "dan": "daniel", "danny": "daniel",
    "chris": "christopher", "tony": "anthony", "jen": "jennifer", "jenny": "jennifer", "pat": "patricia",
    "patty": "patricia", "sue": "susan", "deb": "deborah", "debbie": "deborah", "ed": "edward",
    "eddie": "edward", "ted": "edward", "alex": "alexander", "paco": "francisco", "pancho": "francisco",
    "pepe": "jose", "memo": "guillermo", "nacho": "ignacio", "lola": "dolores", "charo": "rosario",
}
# Organization names: abbreviations expanded, then legal suffixes and generic words dropped for the stem.
ORG_ABBREVIATIONS = {"hdwe": "hardware", "hdw": "hardware", "fdn": "foundation", "fndn": "foundation",
                     "assoc": "association", "assn": "association", "intl": "international", "svcs": "services",
                     "svc": "service", "mgmt": "management", "co": "company", "corp": "corporation", "bros": "brothers"}
ORG_SUFFIXES = {"inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corporation", "company", "pc", "pa",
                "pllc", "the", "foundation", "fund", "trust", "of", "and"}
FAMILY_FUND_WORDS = {"family", "fund", "foundation", "trust", "charitable"}
ORG_HINT_WORDS = {"inc", "llc", "foundation", "fund", "trust", "company", "corporation", "bank", "group",
                  "association", "hardware", "church", "university", "school", "society"}


def raw_tokens(name: str | None) -> list[str]:
    """Like name_tokens but keeps single-letter initials ("R. Nguyen" -> ["r", "nguyen"])."""
    ascii_name = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    return [t for t in re.split(r"[^a-z0-9]+", ascii_name.lower()) if t]


def is_org(d: dict) -> bool:
    if d.get("donor_type") == "organization" or d.get("org_name"):
        return True
    if d.get("donor_type") == "individual":
        return False
    return bool(set(raw_tokens(d.get("full_name"))) & ORG_HINT_WORDS)


def org_stem(d: dict) -> str:
    """"Tamarind Quay Hdwe, L.L.C." -> "tamarind quay hardware" (initials from L.L.C. drop out too)."""
    tokens = [ORG_ABBREVIATIONS.get(t, t) for t in raw_tokens(d.get("org_name") or d.get("full_name"))]
    return " ".join(t for t in tokens if len(t) > 1 and t not in ORG_SUFFIXES)


def person_parts(d: dict) -> tuple[str, list[str], list[str]]:
    """(first name with nicknames resolved, full surname/middle tokens, initials among them)."""
    tokens = raw_tokens(d.get("full_name"))
    if not tokens:
        return "", [], []
    first = NICKNAMES.get(tokens[0], tokens[0])
    rest = tokens[1:]
    return first, [t for t in rest if len(t) > 1], [t for t in rest if len(t) == 1]


def first_names_compatible(a: str, b: str) -> str | None:
    """How two first names match, or None: same, nickname, initial or short form."""
    if not a or not b:
        return None
    if a == b:
        return "same"
    if len(a) == 1 or len(b) == 1:
        return "initial" if a[0] == b[0] else None
    if min(len(a), len(b)) >= 3 and (a.startswith(b) or b.startswith(a)):
        return "short form"
    return None


def surnames_compatible(a_full: list[str], a_init: list[str], b_full: list[str], b_init: list[str]) -> str | None:
    if set(a_full) & set(b_full):
        return "same"
    if not a_full and a_init and b_full and any(i == t[0] for i in a_init for t in b_full):
        return "initial"
    if not b_full and b_init and a_full and any(i == t[0] for i in b_init for t in a_full):
        return "initial"
    return None


def person_match(a: dict, b: dict) -> str | None:
    """A reason when two individuals' names could be the same person, else None."""
    fa, la, ia = person_parts(a)
    fb, lb, ib = person_parts(b)
    tokens_a, tokens_b = raw_tokens(a.get("full_name")), raw_tokens(b.get("full_name"))
    first = first_names_compatible(fa, fb)
    last = surnames_compatible(la, ia, lb, ib)
    if not first or not last:
        return None
    if first == "same" and tokens_a[0] != tokens_b[0]:
        first = "nickname"
    if first == "same" and last == "same":
        return "same name" if tokens_a == tokens_b else "similar name"
    detail = {"nickname": f"nickname {tokens_a[0]} ~ {tokens_b[0]}",
              "initial": "initial matches first name", "short form": f"short form {tokens_a[0]} ~ {tokens_b[0]}",
              "same": None}[first]
    if last == "initial":
        detail = ", ".join(x for x in [detail, "initial matches surname"] if x)
    return f"compatible names ({detail})"


def is_fund_name(d: dict) -> bool:
    return bool(set(raw_tokens(d.get("org_name") or d.get("full_name"))) & FAMILY_FUND_WORDS)


def family_fund_match(a: dict, b: dict) -> str | None:
    """A donor and a fund/foundation named for their family (donor-advised funds are recorded that way).
    The fund is told apart by its name, since ingest may type a DAF row either way."""
    if is_fund_name(a) == is_fund_name(b):
        return None
    person, org = (b, a) if is_fund_name(a) else (a, b)
    if is_org(person):
        return None
    _, surnames, _ = person_parts(person)
    org_tokens = set(raw_tokens(org.get("org_name") or org.get("full_name")))
    if surnames and surnames[-1] in org_tokens and org_tokens & FAMILY_FUND_WORDS:
        return f"fund named for this donor's family: {org.get('full_name')}"
    return None


def names_close(a: dict, b: dict) -> bool:
    if is_org(a) or is_org(b):
        if not (is_org(a) and is_org(b)):
            return False
        sa, sb = org_stem(a), org_stem(b)
        return bool(sa) and (sa == sb or SequenceMatcher(None, sa, sb).ratio() >= 0.9)
    ta, tb = name_tokens(a.get("full_name")), name_tokens(b.get("full_name"))
    if ta and tb and SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio() >= 0.85:
        return True
    # Same first name and an overlapping surname token ("Maria Delgado" ~ "María Delgado-Ruiz"),
    # or a nickname / initial / short form of the first name with a matching surname.
    return person_match(a, b) is not None


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
    # Name-only evidence: rows that share no contact details (mentions, sign-in sheets, renamed emails).
    fund = family_fund_match(a, b)
    if fund:
        reasons.append(fund)
        confidence = max(confidence, 0.60)
    elif is_org(a) and is_org(b):
        sa, sb = org_stem(a).split(), org_stem(b).split()
        if sa and sa == sb:
            reasons.append(f"same organization name without legal suffix: {' '.join(sa)}")
            confidence = max(confidence, 0.80)
        elif min(len(sa), len(sb)) >= 2 and (sa[:len(sb)] == sb or sb[:len(sa)] == sa):
            reasons.append(f"shortened organization name: {' '.join(min(sa, sb, key=len))} ~ {' '.join(max(sa, sb, key=len))}")
            confidence = max(confidence, 0.60)
    elif not is_org(a) and not is_org(b):
        match = person_match(a, b)
        if match == "same name":
            reasons.append(f"same name: {a.get('full_name')}")
            confidence = max(confidence, 0.75)
        elif match:
            reasons.append(f"{match}: {a.get('full_name')} ~ {b.get('full_name')}")
            confidence = max(confidence, 0.60)
    return reasons, confidence


def find_pairs(donors: list[dict]) -> list[dict]:
    """Candidate pairs share an email, phone, city, surname, first name or org stem (blocking);
    each candidate pair is then checked by pair_reasons."""
    buckets: dict[str, list[int]] = {}
    for i, d in enumerate(donors):
        keys = [f"e:{e}" for e in donor_emails(d)]
        if normalize_phone(d.get("phone")):
            keys.append(f"p:{normalize_phone(d.get('phone'))}")
        if (d.get("city") or "").strip():
            keys.append(f"c:{d['city'].strip().lower()}|{(d.get('state') or '').strip().lower()}")
        if is_org(d) or is_fund_name(d):
            if org_stem(d):
                keys.append(f"o:{org_stem(d)}")
            keys += [f"s:{t}" for t in raw_tokens(d.get("org_name") or d.get("full_name")) if len(t) > 2]
        else:
            first, surnames, _ = person_parts(d)
            keys += [f"s:{t}" for t in surnames]
            if first:
                keys.append(f"f:{first}")
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
