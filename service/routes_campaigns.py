"""Campaign routes (#38): bulk drafts, human approval, and a SIMULATED outbox. main.py mounts this router.

POST  /campaigns                          {donor_ids, intent, channel, name?, created_by?} -> one draft per donor
GET   /campaigns                          every campaign with status counts, newest first
GET   /campaigns/{id}                     the campaign and its messages (donor name, tier, why, approval rule, flags)
PATCH /campaigns/{id}/messages/{mid}      {body?, subject?, status?: approved|skipped|draft, approved_by?}
POST  /campaigns/{id}/approve-small       bulk-approve only drafts that need no individual approval and have no flags
POST  /campaigns/{id}/send                approved messages -> outbox (simulated: no provider, nothing leaves the laptop)
GET   /outbox                             the simulated outbox = the contact log (?campaign_id=, ?donor_id=)

Addresses are stored in full in the local db but always masked in responses (r***@example.com, ***-***-0101).
"""

from __future__ import annotations

import json
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from service import campaign_agent as ca
from service.routes_data import get_conn

router = APIRouter(tags=["campaigns"])

DEFAULT_APPROVER = "Philanthropy team (demo)"
MAX_DONORS = 25
DRAFT_WORKERS = 4


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ----------------------------------------------------------------------------------------------
# Masking
# ----------------------------------------------------------------------------------------------

def mask_address(address: str | None, channel: str) -> str | None:
    """'rob.nguyen@example.com' -> 'r***@example.com'; '+13055550177' -> '***-***-0177'."""
    if not address:
        return None
    if channel == "email" or "@" in address:
        local, _, domain = address.partition("@")
        return f"{local[:1]}***@{domain}" if domain else "***"
    digits = re.sub(r"\D", "", address)
    return f"***-***-{digits[-4:]}" if len(digits) >= 4 else "***"


# ----------------------------------------------------------------------------------------------
# Loading donors (from the request's connection, so export_snapshot's --db works too)
# ----------------------------------------------------------------------------------------------

def load_donor(conn: sqlite3.Connection, donor_id: int) -> tuple[dict, list[dict], dict, list[dict]] | None:
    row = conn.execute("""SELECT d.*, s.tier, s.is_star, s.status AS score_status, s.why FROM donors d
                          LEFT JOIN donor_scores s ON s.donor_id = d.id WHERE d.id = ?""", (donor_id,)).fetchone()
    if row is None:
        return None
    donor = dict(row)
    why = json.loads(donor.pop("why") or "{}")
    donor["is_star"] = bool(donor.get("is_star"))
    donor["is_sample"] = "SAMPLE" in (donor.get("source_row") or "").splitlines()
    from service.targets import _counted          # a declined or failed charge is not a gift to thank anyone for
    gifts = [dict(r) for r in conn.execute(
        "SELECT amount, gift_date, channel FROM gifts WHERE donor_id = ?" + _counted(conn) + " ORDER BY gift_date",
        (donor_id,))]
    research = [dict(r) for r in conn.execute(
        "SELECT fact, source_url FROM research_facts WHERE donor_id = ?", (donor_id,))]
    return donor, gifts, why, research


def load_org_facts() -> list[dict]:
    from service.org_context import load_org_facts as load
    return load()


def draft_rows(conn: sqlite3.Connection, donor_ids: list[int], intent: str, channel: str,
               use_model: bool | None = None, today: date | None = None) -> list[dict]:
    """One draft per donor, in order, run through the guardrail. Pure: nothing is written."""
    loaded = {i: load_donor(conn, i) for i in donor_ids}
    missing = [i for i, v in loaded.items() if v is None]
    if missing:
        raise LookupError(f"donor(s) not found: {missing}")
    org_facts = load_org_facts()

    def one(donor_id: int) -> dict:
        donor, gifts, why, research = loaded[donor_id]
        draft = ca.draft_message(donor, gifts, why, research, org_facts, intent, channel, today=today,
                                 use_model=use_model)
        return {"donor": donor, "why": why, "draft": draft}

    with ThreadPoolExecutor(max_workers=DRAFT_WORKERS) as pool:   # model calls are slow; templates aren't
        return list(pool.map(one, donor_ids))


# ----------------------------------------------------------------------------------------------
# Shapes
# ----------------------------------------------------------------------------------------------

MESSAGE_SELECT = """
SELECT m.*, d.full_name AS donor_name, d.donor_type, d.source_row, d.email, d.phone,
       s.tier, s.is_star, s.status AS score_status, s.why
FROM campaign_messages m
JOIN donors d ON d.id = m.donor_id
LEFT JOIN donor_scores s ON s.donor_id = m.donor_id
"""


def message_out(row: sqlite3.Row | dict) -> dict:
    m = dict(row)
    donor = {"is_star": bool(m.get("is_star")), "donor_type": m.get("donor_type"), "tier": m.get("tier")}
    address = m.get("email") if m["channel"] == "email" else m.get("phone")
    return {
        "id": m["id"], "campaign_id": m["campaign_id"], "donor_id": m["donor_id"],
        "donor_name": m["donor_name"], "donor_type": m.get("donor_type"), "tier": m.get("tier"),
        "is_star": bool(m.get("is_star")), "score_status": m.get("score_status"),
        "is_sample": "SAMPLE" in (m.get("source_row") or "").splitlines(),
        "why": json.loads(m["why"]) if m.get("why") else None,
        "needs_individual_approval": bool(m["needs_individual_approval"]),
        "approval_reason": ca.approval_reason(donor) if m["needs_individual_approval"] else None,
        "channel": m["channel"], "to": mask_address(address, m["channel"]),
        "subject": m.get("subject"), "body": m["body"],
        "facts_used": json.loads(m.get("facts_used") or "[]"), "flags": json.loads(m.get("flags") or "[]"),
        "drafted_by": m["drafted_by"], "draft_note": m.get("draft_note"),
        "status": m["status"], "approved_by": m.get("approved_by"), "approved_via": m.get("approved_via"),
        "approved_at": m.get("approved_at"), "sent_at": m.get("sent_at"),
        "outreach_draft_id": m.get("outreach_draft_id"),
    }


def counts_of(messages: list[dict]) -> dict:
    return {
        "total": len(messages),
        **{s: sum(m["status"] == s for m in messages) for s in ("draft", "approved", "sent", "skipped")},
        "needs_individual_approval": sum(m["needs_individual_approval"] and m["status"] == "draft" for m in messages),
        "flagged": sum(bool(m["flags"]) and m["status"] in ("draft", "approved") for m in messages),
        "bulk_approvable": sum(m["status"] == "draft" and not m["needs_individual_approval"] and not m["flags"]
                               for m in messages),
    }


def campaign_detail(conn: sqlite3.Connection, campaign_id: int) -> dict:
    row = conn.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"campaign {campaign_id} not found")
    messages = [message_out(r) for r in conn.execute(MESSAGE_SELECT + " WHERE m.campaign_id = ? ORDER BY m.id",
                                                     (campaign_id,))]
    return {**dict(row), "counts": counts_of(messages), "messages": messages}


def outbox_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["to"] = mask_address(d.pop("to_address"), d["channel"])
    d["simulated"] = bool(d["simulated"])
    return d


# ----------------------------------------------------------------------------------------------
# Routes
# ----------------------------------------------------------------------------------------------

class CreateCampaign(BaseModel):
    donor_ids: list[int] = Field(min_length=1, max_length=MAX_DONORS)
    intent: Literal["thank_you", "re_engage", "check_in"]
    channel: Literal["email", "text"]
    name: str | None = Field(None, max_length=120)
    created_by: str | None = Field(None, max_length=120)


def default_name(intent: str, channel: str, n: int) -> str:
    return f"{ca.INTENT_LABELS[intent]} · {'Email' if channel == 'email' else 'Text'} · {n} donor{'s' if n != 1 else ''}"


def insert_campaign(conn: sqlite3.Connection, name: str, intent: str, channel: str, created_by: str,
                    rows: list[dict], event_id: int | None = None) -> int:
    """rows: {donor, draft}; a row may carry its own "channel" (a 'mixed' event batch)."""
    with conn:
        cid = conn.execute("INSERT INTO campaigns (name, intent, channel, created_by, created_at, event_id) "
                           "VALUES (?, ?, ?, ?, ?, ?)", (name, intent, channel, created_by, now(), event_id)).lastrowid
        for r in rows:
            d = r["draft"]
            conn.execute(
                "INSERT INTO campaign_messages (campaign_id, donor_id, channel, subject, body, facts_used, flags, "
                "drafted_by, draft_note, needs_individual_approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (cid, r["donor"]["id"], r.get("channel", channel), d.subject, d.body, json.dumps(d.facts_used),
                 json.dumps(d.flags), d.drafted_by, d.note, int(ca.needs_individual_approval(r["donor"]))))
    return cid


@router.post("/campaigns")
def create_campaign(req: CreateCampaign, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    donor_ids = list(dict.fromkeys(req.donor_ids))
    try:
        rows = draft_rows(conn, donor_ids, req.intent, req.channel)
    except LookupError as e:
        raise HTTPException(404, str(e))
    name = (req.name or "").strip() or default_name(req.intent, req.channel, len(donor_ids))
    cid = insert_campaign(conn, name, req.intent, req.channel, (req.created_by or "").strip() or DEFAULT_APPROVER, rows)
    return campaign_detail(conn, cid)


@router.get("/campaigns")
def list_campaigns(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    out = []
    for row in conn.execute("SELECT * FROM campaigns ORDER BY id DESC"):
        messages = [message_out(r) for r in conn.execute(MESSAGE_SELECT + " WHERE m.campaign_id = ?", (row["id"],))]
        out.append({**dict(row), "counts": counts_of(messages)})
    return out


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return campaign_detail(conn, campaign_id)


class PatchMessage(BaseModel):
    body: str | None = Field(None, min_length=1)
    subject: str | None = None
    status: Literal["approved", "skipped", "draft"] | None = None
    approved_by: str | None = Field(None, max_length=120)


def message_row(conn: sqlite3.Connection, campaign_id: int, message_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM campaign_messages WHERE id = ? AND campaign_id = ?",
                       (message_id, campaign_id)).fetchone()
    if row is None:
        raise HTTPException(404, f"message {message_id} not found in campaign {campaign_id}")
    return row


def recheck(conn: sqlite3.Connection, donor_id: int, channel: str, subject: str | None, body: str) -> list[str]:
    """Run the guardrail again on a person's edit, against the same record and facts."""
    donor, gifts, _, research = load_donor(conn, donor_id)
    facts = ca.allowed_facts(research, load_org_facts())
    return ca.check_message(f"{subject or ''} {body}", donor, gifts, facts, channel)


@router.patch("/campaigns/{campaign_id}/messages/{message_id}")
def patch_message(campaign_id: int, message_id: int, req: PatchMessage,
                  conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    row = message_row(conn, campaign_id, message_id)
    if row["status"] == "sent":
        raise HTTPException(409, f"message {message_id} was already sent to the outbox")
    subject = req.subject if req.subject is not None else row["subject"]
    body = req.body if req.body is not None else row["body"]
    flags = json.loads(row["flags"])
    if req.body is not None or req.subject is not None:
        if not body.strip():
            raise HTTPException(422, "body must not be empty")
        flags = recheck(conn, row["donor_id"], row["channel"], subject, body)

    status, approved_by, via, approved_at = row["status"], row["approved_by"], row["approved_via"], row["approved_at"]
    edited = (body, subject) != (row["body"], row["subject"])
    if edited and status == "approved":
        status, approved_by, via, approved_at = "draft", None, None, None   # an edit needs a fresh approval
    if req.status == "approved":
        if flags:
            raise HTTPException(409, "fix the flagged figures or dates before approving: " + "; ".join(flags))
        approved_by = (req.approved_by or "").strip() or DEFAULT_APPROVER
        status, via, approved_at = "approved", "individual", now()
    elif req.status in ("skipped", "draft"):
        status, approved_by, via, approved_at = req.status, None, None, None

    with conn:
        conn.execute("UPDATE campaign_messages SET subject = ?, body = ?, flags = ? WHERE id = ?",
                     (subject, body, json.dumps(flags), message_id))
        conn.execute("UPDATE campaign_messages SET status = ?, approved_by = ?, approved_via = ?, approved_at = ? "
                     "WHERE id = ?", (status, approved_by, via, approved_at, message_id))
    return message_out(conn.execute(MESSAGE_SELECT + " WHERE m.id = ?", (message_id,)).fetchone())


@router.post("/campaigns/{campaign_id}/approve-small")
def approve_small(campaign_id: int, approved_by: str | None = Body(None, embed=True),
                  conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """The bulk button: only drafts that need no individual approval and carry no guardrail flag."""
    campaign_detail(conn, campaign_id)    # 404 for an unknown campaign
    who = (approved_by or "").strip() or DEFAULT_APPROVER
    with conn:
        n = conn.execute(
            "UPDATE campaign_messages SET status = 'approved', approved_by = ?, approved_via = 'bulk', approved_at = ? "
            "WHERE campaign_id = ? AND status = 'draft' AND needs_individual_approval = 0 AND flags = '[]'",
            (who, now(), campaign_id)).rowcount
    detail = campaign_detail(conn, campaign_id)
    return {"approved": n, "left_for_individual_approval": detail["counts"]["needs_individual_approval"],
            "flagged": detail["counts"]["flagged"], "campaign": detail}


# ----------------------------------------------------------------------------------------------
# Delivery: ONE place where a provider plugs in (deliver). outbound.deliver is a dry run by default:
# nothing leaves the laptop unless EMAIL_SEND=on / SMS_PROVIDER is set (service/README.md).
# ----------------------------------------------------------------------------------------------

def simulated_adapter(channel: str, to_address: str, subject: str | None, body: str) -> dict:
    """Delivers nothing. Same arguments and shape as any adapter; the outbox row is written either way."""
    return {"delivered": False, "simulated": True, "provider": None}


def outbound_adapter(channel: str, to_address: str, subject: str | None, body: str) -> dict:
    """service.outbound.deliver (dry run unless configured) in this hook's shape, plus its status fields."""
    from service import outbound

    r = outbound.deliver(channel, to_address, subject, body)
    return {**r, "delivered": not r["simulated"] and r["status"] == "sent"}


# >>> DELIVERY ADAPTER HOOK: every approved message goes through this, once. <<<
deliver = outbound_adapter


def send_message(conn: sqlite3.Connection, m: sqlite3.Row, sent_at: str) -> dict:
    """One approved message -> (delivery adapter) -> one outbox row; the message becomes 'sent'.

    Returns {"sent": True, "outbox_id", "simulated"} or {"sent": False, "reason", ...}. A failed delivery
    leaves the message 'approved' and writes no outbox row. The caller commits."""
    if m["status"] != "approved" or m["flags"] != "[]" or not (m["approved_by"] or "").strip():
        return {"sent": False, "reason": "not approved"}        # the db triggers block these too
    address = m["email"] if m["channel"] == "email" else m["phone"]
    if not address:
        return {"sent": False, "reason": f"no {'email' if m['channel'] == 'email' else 'phone'} on file"}
    r = deliver(m["channel"], address, m["subject"], m["body"])
    simulated = bool(r.get("simulated", not r.get("delivered")))
    status = r.get("status") or ("sent" if r.get("delivered") else "queued (dry run)")
    if status.startswith("failed"):
        return {"sent": False, "reason": status, "failed": True, "detail": r.get("detail")}
    if "provider" in {c[1] for c in conn.execute("PRAGMA table_info(outbox)")}:
        outbox_id = conn.execute(
            "INSERT INTO outbox (campaign_message_id, donor_id, channel, to_address, subject, body, sent_at, "
            "simulated, provider, delivery_status, provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (m["id"], m["donor_id"], m["channel"], address, m["subject"], m["body"], sent_at, int(simulated),
             r.get("provider") or "dryrun", status, r.get("provider_id"))).lastrowid
    elif not simulated:     # an outbox from before the provider columns can't log a real send honestly
        return {"sent": False, "reason": "failed: outbox has no provider columns", "failed": True, "detail": None}
    else:
        outbox_id = conn.execute(
            "INSERT INTO outbox (campaign_message_id, donor_id, channel, to_address, subject, body, sent_at, simulated) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
            (m["id"], m["donor_id"], m["channel"], address, m["subject"], m["body"], sent_at)).lastrowid
    conn.execute("UPDATE campaign_messages SET status = 'sent', sent_at = ? WHERE id = ?", (sent_at, m["id"]))
    return {"sent": True, "outbox_id": outbox_id, "simulated": simulated}


@router.post("/campaigns/{campaign_id}/send")
def send_campaign(campaign_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Approved messages go out through send_message (the deliver hook: a dry run unless configured).
    A failed delivery stays 'approved' and is reported under "failed"."""
    campaign_detail(conn, campaign_id)
    sent, no_address, failed, any_real = 0, [], [], False
    sent_at = now()
    rows = conn.execute("""SELECT m.*, d.email, d.phone, d.full_name FROM campaign_messages m
                           JOIN donors d ON d.id = m.donor_id
                           WHERE m.campaign_id = ? AND m.status = 'approved' ORDER BY m.id""", (campaign_id,)).fetchall()
    with conn:
        for m in rows:
            result = send_message(conn, m, sent_at)
            if result["sent"]:
                sent += 1
                any_real = any_real or not result["simulated"]
            elif result.get("failed"):
                failed.append({"message_id": m["id"], "donor_name": m["full_name"], "reason": result["reason"],
                               "detail": result.get("detail")})
            elif result["reason"].startswith("no "):
                no_address.append({"message_id": m["id"], "donor_name": m["full_name"], "reason": result["reason"]})
        left = conn.execute("SELECT COUNT(*) FROM campaign_messages WHERE campaign_id = ? AND status IN ('draft', 'approved')",
                            (campaign_id,)).fetchone()[0]
        if sent and not left:
            conn.execute("UPDATE campaigns SET status = 'sent' WHERE id = ?", (campaign_id,))
    detail = campaign_detail(conn, campaign_id)
    return {"simulated": not any_real, "sent": sent, "no_address": no_address, "failed": failed,
            "not_approved": detail["counts"]["draft"], "campaign": detail}


@router.get("/outbox")
def list_outbox(campaign_id: int | None = Query(None), donor_id: int | None = Query(None),
                conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    where, args = [], []
    if campaign_id is not None:
        where.append("m.campaign_id = ?")
        args.append(campaign_id)
    if donor_id is not None:
        where.append("o.donor_id = ?")
        args.append(donor_id)
    sql = ("SELECT o.*, d.full_name AS donor_name, m.campaign_id, c.name AS campaign_name FROM outbox o "
           "LEFT JOIN donors d ON d.id = o.donor_id LEFT JOIN campaign_messages m ON m.id = o.campaign_message_id "
           "LEFT JOIN campaigns c ON c.id = m.campaign_id"
           + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY o.sent_at DESC, o.id DESC")
    return [outbox_out(r) for r in conn.execute(sql, args)]


# ----------------------------------------------------------------------------------------------
# Snapshot (export_snapshot.py): a precomputed sample campaign + template drafts, no API, no writes
# ----------------------------------------------------------------------------------------------

SNAPSHOT_DRAFT_DONORS = 60


def demo_message(donor: dict, why: dict, draft: ca.CampaignDraft, channel: str, mid: int, cid: int) -> dict:
    return message_out({
        "id": mid, "campaign_id": cid, "donor_id": donor["id"], "donor_name": donor["full_name"],
        "donor_type": donor.get("donor_type"), "source_row": donor.get("source_row"), "email": donor.get("email"),
        "phone": donor.get("phone"), "tier": donor.get("tier"), "is_star": donor.get("is_star"),
        "score_status": donor.get("score_status"), "why": json.dumps(why) if why else None,
        "needs_individual_approval": int(ca.needs_individual_approval(donor)), "channel": channel,
        "subject": draft.subject, "body": draft.body, "facts_used": json.dumps(draft.facts_used),
        "flags": json.dumps(draft.flags), "drafted_by": draft.drafted_by, "draft_note": draft.note,
        "status": "draft", "approved_by": None, "approved_via": None, "approved_at": None, "sent_at": None,
        "outreach_draft_id": None})


def campaigns_demo(conn: sqlite3.Connection) -> dict:
    """{label, campaigns: [sample campaign detail], outbox: [], drafts: {donor_id: {"intent:channel": message}}}.

    Template path only (no model, no writes), so the Vercel build can show create -> approve -> send in the tab.
    Addresses are masked already; the browser never sees a full email or phone number."""
    ids = [r[0] for r in conn.execute("SELECT d.id FROM donors d LEFT JOIN donor_scores s ON s.donor_id = d.id "
                                      "ORDER BY s.score IS NULL, s.score DESC, d.id LIMIT ?", (SNAPSHOT_DRAFT_DONORS,))]
    drafts: dict[str, dict] = {}
    if ids:
        for intent in ca.INTENTS:
            for channel in ca.CHANNELS:
                for r in draft_rows(conn, ids, intent, channel, use_model=False):
                    msg = demo_message(r["donor"], r["why"], r["draft"], channel, 0, 0)
                    msg["draft_note"] = "Cached sample: template draft precomputed for this snapshot (no AI)."
                    drafts.setdefault(str(r["donor"]["id"]), {})[f"{intent}:{channel}"] = msg

    sample_ids = ids[:5]
    messages = []
    for i, donor_id in enumerate(sample_ids, 1):
        msg = dict(drafts[str(donor_id)]["thank_you:email"])
        messages.append(msg | {"id": i, "campaign_id": 1})
    campaign = {"id": 1, "name": default_name("thank_you", "email", len(messages)) + " (sample)",
                "intent": "thank_you", "channel": "email", "created_at": now(), "created_by": DEFAULT_APPROVER,
                "status": "draft", "counts": counts_of(messages), "messages": messages}
    return {"label": "Cached sample · template drafts, simulated outbox",
            "campaigns": [campaign] if messages else [], "outbox": [], "drafts": drafts}
