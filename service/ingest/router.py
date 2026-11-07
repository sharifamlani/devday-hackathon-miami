"""POST /ingest: uploaded files -> stat-mcp's readers -> donors + gifts, in one SQLite transaction.

Follows stat-mcp/AGENT_INTEGRATION.md: the stat_mcp library is called directly (no MCP hop, no second
database). Each explicit gift event becomes one gifts row; people are stat-mcp's source-scoped projections.

    upload -> extract_file_transactions (per file) -> group events by person -> validate -> one commit
           -> score.run + dedupe.run

A gift with no amount or no ISO date is returned in review_required and never inserted (gifts.gift_date is
required; no date is invented). Non-gift events (profile/contact/benefit) never become gifts. If any file
fails to read, nothing is written.
"""
import asyncio
import json
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import PurePosixPath

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from service import config, db, dedupe, score

sys.path.insert(0, str(config.REPO_ROOT / "stat-mcp" / "src"))
if config.MODEL_FAST:  # stat_mcp.agent reads OPENAI_MODEL at call time; one model setting for the service
    os.environ.setdefault("OPENAI_MODEL", config.MODEL_FAST)

from stat_mcp.file_ingest import MAX_FILE_BYTES, extract_file_transactions  # noqa: E402
from stat_mcp.schemas import ImportedTransaction  # noqa: E402
from stat_mcp.transactions import _person_key, is_iso_date, project_people  # noqa: E402

router = APIRouter(tags=["ingest"])

MAX_FILES = 20
MAX_BATCH_BYTES = 50_000_000
EXTENSIONS = {".csv", ".json", ".xlsx", ".docx", ".md", ".markdown", ".txt"}


def source_ref(event: ImportedTransaction) -> str:
    return f"{event.source_name}#{event.source_location or 'unknown'}"


def plan_rows(events: list[ImportedTransaction]) -> tuple[list[dict], list[dict]]:
    """Events -> (donor dicts with 'gifts', review_required rows). Pure: no db access.

    People are grouped exactly as stat-mcp's project_people groups them; matching names or emails across
    groups stay separate donors so dedupe can suggest them for staff review.
    """
    grouped: dict[str, list[ImportedTransaction]] = defaultdict(list)
    for event in events:
        grouped[_person_key(event)].append(event)

    donors, review = [], []
    for items in grouped.values():
        person = project_people(items)[0]
        name = person.full_name or person.organization or person.email_address
        refs = list(dict.fromkeys(source_ref(e) for e in items))
        if not name:
            review.extend({"source_row": source_ref(e), "reason": "no name, organization or email"} for e in items)
            continue

        gifts = []
        for e in items:
            if e.transaction_type != "gift":
                continue
            if e.amount is None or not is_iso_date(e.transaction_date):
                review.append({"source_row": source_ref(e), "name": name,
                               "amount": float(e.amount) if e.amount is not None else None,
                               "gift_date": e.transaction_date,
                               "reason": "gift amount missing" if e.amount is None else "gift date is not YYYY-MM-DD"})
                continue
            gifts.append({"amount": float(e.amount), "gift_date": e.transaction_date, "channel": e.channel,
                          "fund_type": e.fund_type, "source_row": source_ref(e)})

        emails = list(dict.fromkeys(e.email_address.lower() for e in items if e.email_address))
        notes = [e.notes for e in items if e.notes and e.transaction_type != "gift"]
        donors.append({
            "full_name": name,
            "first_name": person.first_name or None,
            "last_name": person.last_name or None,
            "org_name": person.organization,
            "donor_type": "individual" if person.full_name else "organization",
            "email": emails[0] if emails else None,
            "emails_all": emails,
            "phone": person.phone_number or None,
            "fund_type": next((g["fund_type"] for g in gifts if g["fund_type"]), None),
            "notes": "\n".join(dict.fromkeys(notes)) or None,
            "source_row": "; ".join(refs)[:2000],
            "contact_type": person.contact_type,
            "gifts": gifts,
        })
    return donors, review


def persist(conn: sqlite3.Connection, donors: list[dict]) -> dict:
    """Insert donors + gifts in one transaction (all or nothing), then rescore and refresh duplicates."""
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(donors)")}
    fields = ["full_name", "first_name", "last_name", "org_name", "donor_type", "email", "emails_all",
              "phone", "fund_type", "notes", "source_row"]
    if "contact_type" in columns:  # plan §16 person class, once the column lands
        fields.append("contact_type")

    gift_count = 0
    with conn:
        for donor in donors:
            values = [json.dumps(donor[f]) if f == "emails_all" else donor[f] for f in fields]
            cur = conn.execute(
                f"INSERT INTO donors ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})", values)
            for g in donor["gifts"]:
                conn.execute(
                    "INSERT INTO gifts (donor_id, amount, gift_date, channel, fund_type, source_row) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (cur.lastrowid, g["amount"], g["gift_date"], g["channel"], g["fund_type"], g["source_row"]))
                gift_count += 1
    score.run(conn)
    duplicates = dedupe.run(conn)
    return {"donors": len(donors), "gifts": gift_count, "duplicates": duplicates}


async def read_uploads(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    if not 1 <= len(files) <= MAX_FILES:
        raise HTTPException(422, f"send 1 to {MAX_FILES} files")
    out, total = [], 0
    for upload in files:
        name = upload.filename or "upload"
        if PurePosixPath(name).suffix.lower() not in EXTENSIONS:
            raise HTTPException(422, f"{name}: unsupported file type (allowed: {', '.join(sorted(EXTENSIONS))})")
        payload = await upload.read()
        if len(payload) > MAX_FILE_BYTES:
            raise HTTPException(413, f"{name}: larger than {MAX_FILE_BYTES // 1_000_000} MB")
        total += len(payload)
        out.append((name, payload))
    if total > MAX_BATCH_BYTES:
        raise HTTPException(413, f"batch larger than {MAX_BATCH_BYTES // 1_000_000} MB")
    return out


@router.post("/ingest")
async def ingest(files: list[UploadFile] = File(...),
                 mapping: str | None = Form(None),  # sent by the import dialog; stat-mcp maps columns itself
                 dry_run: bool = Query(False)) -> dict:
    """Read every file, then write donors + gifts in one commit. dry_run=true previews without writing."""
    uploads = await read_uploads(files)

    async def extract(name: str, payload: bytes):
        try:
            return await extract_file_transactions(name, payload)
        except Exception as e:  # unreadable file, empty file, model error: the whole batch is refused
            raise HTTPException(422, {"error": "unreadable_file", "filename": name,
                                      "detail": f"{type(e).__name__}: {e}"})

    try:
        results = await asyncio.wait_for(asyncio.gather(*(extract(n, p) for n, p in uploads)),
                                         config.AGENT_DEADLINE_S)
    except asyncio.TimeoutError:
        raise HTTPException(504, f"reading the files took longer than {config.AGENT_DEADLINE_S:.0f} s")

    events, warnings, per_file = [], [], []
    for (name, _), (file_format, file_events, file_warnings) in zip(uploads, results):
        events.extend(file_events)
        warnings.extend({"filename": name, "message": w} for w in file_warnings)
        per_file.append({"filename": name, "format": file_format, "events": len(file_events),
                         "gift_events": sum(e.transaction_type == "gift" for e in file_events)})

    donors, review = plan_rows(events)
    if dry_run:
        counts = {"donors": len(donors), "gifts": sum(len(d["gifts"]) for d in donors), "duplicates": None}
    else:
        conn = db.connect()
        try:
            db.create_schema(conn)
            counts = persist(conn, donors)
        finally:
            conn.close()

    verb = "Would import" if dry_run else "Imported"
    message = f"{verb} {counts['donors']} people and {counts['gifts']} gifts from {len(uploads)} file(s)."
    if review:
        message += f" {len(review)} row(s) need review and were not imported."
    return {**counts, "dry_run": dry_run, "message": message, "files": per_file,
            "review_required": review, "warnings": warnings,
            "preview": [{k: v for k, v in d.items() if k != "gifts"} | {"gifts": len(d["gifts"])}
                        for d in donors[:20]] if dry_run else None}
