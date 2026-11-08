"""Tasks, the calendar feed and the artifacts list (plan.md §21, B11/B12). No LLM.

Every write goes through one of the service functions below, the same ones the buttons (routes_tasks.py)
and the chat agent's tools call. Each returns an undo token and is logged in `agent_actions`:

    create_task / update_task / complete_task / delete_task
    add_calendar_item / move_calendar_item / delete_calendar_item   (a calendar item is a dated task)
    undo(token)        reverts that write; only the newest open write on a task can be undone

`generate()` turns what the data already says into tasks, idempotently (each task has a `gen_key`, and a
deleted generated task stays deleted):

    failed or late regular gift (gift_alerts)  -> call    "Call Hye-jin Park"   why + lifetime / last gift / channel
    open duplicate group (duplicate_suggestions) -> review "Review possible duplicate: ..."
    first gift in the last 30 days              -> email   "Welcome ..."
    event in the next 14 days                   -> prep    "Prep list: ..."

    python -m service.tasks generate [--as-of 2026-11-08]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from service import db
from service.score import default_as_of

KINDS = ("call", "email", "review", "prep", "other")
SOURCES = ("agent", "staff", "generator", "call")
WELCOME_DAYS = 30
PREP_DAYS = 14
PREP_LEAD_DAYS = 7          # a prep task is due a week before the event (or today, if that has passed)
CALENDAR_DAYS = 60          # default /calendar window
KIND_ORDER = {k: i for i, k in enumerate(KINDS)}
TASK_FIELDS = ("kind", "title", "why", "person_id", "chips", "due", "time", "source")


class TaskError(ValueError):
    """A bad request (unknown task, bad field). Routes answer 404 / 422."""


class NotFound(TaskError):
    pass


class UndoConflict(TaskError):
    """The write was already undone, or a later write on the same task must be undone first."""


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _row(conn: sqlite3.Connection, task_id: int, include_deleted: bool = False) -> dict | None:
    r = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if r is None or (r["deleted_at"] and not include_deleted):
        return None
    return dict(r)


def public(row: dict) -> dict:
    """The §21.5 shape: {id, kind, title, why, person_id, chips[], due, time, done, source}."""
    return {"id": row["id"], "kind": row["kind"], "title": row["title"], "why": row["why"],
            "person_id": row["person_id"], "chips": json.loads(row["chips"] or "[]"), "due": row["due"],
            "time": row["time"], "done": bool(row["done"]), "source": row["source"]}


def _check(fields: dict) -> dict:
    """Validate and normalize writable fields; chips go to JSON."""
    out = {}
    for key, value in fields.items():
        if key not in TASK_FIELDS:
            raise TaskError(f"unknown field: {key}")
        if key == "kind" and value not in KINDS:
            raise TaskError(f"kind must be one of {', '.join(KINDS)}")
        if key == "source" and value not in SOURCES:
            raise TaskError(f"source must be one of {', '.join(SOURCES)}")
        if key == "title" and not (value or "").strip():
            raise TaskError("a task needs a title")
        if key == "due" and value is not None:
            try:
                value = date.fromisoformat(str(value)[:10]).isoformat()
            except ValueError:
                raise TaskError("due must be YYYY-MM-DD") from None
        if key == "time" and value is not None:
            try:
                value = datetime.strptime(str(value), "%H:%M").strftime("%H:%M")
            except ValueError:
                raise TaskError("time must be HH:MM") from None
        if key == "chips":
            value = json.dumps([str(c) for c in (value or [])])
        out[key] = value.strip() if isinstance(value, str) and key == "title" else value
    return out


def _require_person(conn: sqlite3.Connection, person_id) -> None:
    if person_id is not None and conn.execute("SELECT 1 FROM donors WHERE id = ?", (person_id,)).fetchone() is None:
        raise NotFound(f"person {person_id} not found")


def _log(conn: sqlite3.Connection, actor: str, action: str, task_id: int,
         before: dict | None, after: dict | None) -> str:
    token = uuid.uuid4().hex
    conn.execute("INSERT INTO agent_actions (token, actor, action, target, before, after, created_at) "
                 "VALUES (?, ?, ?, ?, ?, ?, ?)",
                 (token, actor, action, f"task:{task_id}",
                  json.dumps(before) if before is not None else None,
                  json.dumps(after) if after is not None else None, _now()))
    return token


def _actor(actor: str) -> str:
    if actor not in SOURCES:
        raise TaskError(f"actor must be one of {', '.join(SOURCES)}")
    return actor


# ---------- writes: each returns (task, undo_token) ----------

def create_task(conn: sqlite3.Connection, *, kind: str, title: str, actor: str = "staff",
                gen_key: str | None = None, _raw: dict | None = None, **fields) -> tuple[dict, str] | None:
    """Add a task. `source` defaults to the actor. With a gen_key that already exists, returns None.
    _raw: internal columns (members) set by the generator; never from callers."""
    actor = _actor(actor)
    values = _check({"kind": kind, "title": title, "source": fields.pop("source", actor), **fields})
    _require_person(conn, values.get("person_id"))
    values.update(_raw or {})
    now = _now()
    values = {"created_at": now, "updated_at": now, **values, "gen_key": gen_key}   # a migrated row keeps its stamps
    cols = list(values)
    cur = conn.execute(
        f"INSERT OR IGNORE INTO tasks ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
        list(values.values()))
    if cur.rowcount == 0:
        # The ignored INSERT still opened a transaction: end it, or this connection keeps the write lock and the
        # next writer on another connection gets "database is locked" (a generate rerun inside build_snapshot).
        conn.commit()
        return None
    row = _row(conn, cur.lastrowid)
    token = _log(conn, actor, "create_task", row["id"], None, row)
    conn.commit()
    return public(row), token


def update_task(conn: sqlite3.Connection, task_id: int, actor: str = "staff",
                _action: str = "update_task", _raw: dict | None = None, **fields) -> tuple[dict, str]:
    """_raw: internal columns (members, gen_key) changed in the same logged write; never from callers."""
    actor = _actor(actor)
    before = _row(conn, task_id)
    if before is None:
        raise NotFound(f"task {task_id} not found")
    done = fields.pop("done", None)
    values = _check(fields)
    if "person_id" in values:
        _require_person(conn, values["person_id"])
    if done is not None:
        values["done"] = 1 if done else 0
        values["done_at"] = _now() if done else None
    values.update(_raw or {})
    if not values:
        raise TaskError("nothing to change")
    values["updated_at"] = _now()
    conn.execute(f"UPDATE tasks SET {', '.join(f'{k} = ?' for k in values)} WHERE id = ?",
                 [*values.values(), task_id])
    after = _row(conn, task_id)
    token = _log(conn, actor, _action, task_id, before, after)
    conn.commit()
    return public(after), token


def complete_task(conn: sqlite3.Connection, task_id: int, done: bool = True,
                  actor: str = "staff") -> tuple[dict, str]:
    return update_task(conn, task_id, actor=actor, _action="complete_task", done=done)


def delete_task(conn: sqlite3.Connection, task_id: int, actor: str = "staff",
                _action: str = "delete_task", _raw: dict | None = None) -> tuple[dict, str]:
    actor = _actor(actor)
    before = _row(conn, task_id)
    if before is None:
        raise NotFound(f"task {task_id} not found")
    raw = {"deleted_at": _now(), "updated_at": _now(), **(_raw or {})}
    conn.execute(f"UPDATE tasks SET {', '.join(f'{k} = ?' for k in raw)} WHERE id = ?", [*raw.values(), task_id])
    after = _row(conn, task_id, include_deleted=True)
    token = _log(conn, actor, _action, task_id, before, after)
    conn.commit()
    return public(before), token


def _task_id(ref: str | int) -> int:
    """Calendar refs are 'task:12' (or 12). Events come from the Foundation's own pages and stay read-only."""
    if isinstance(ref, int):
        return ref
    kind, _, ident = str(ref).partition(":")
    if kind == "event":
        raise TaskError("events come from the Foundation's site and can't be changed here; add a task instead")
    if kind != "task" or not ident.isdigit():
        raise TaskError(f"unknown calendar item: {ref}")
    return int(ident)


def add_calendar_item(conn: sqlite3.Connection, *, title: str, date_: str, time: str | None = None,
                      kind: str = "other", why: str | None = None, person_id: int | None = None,
                      chips: list[str] | None = None, actor: str = "staff") -> tuple[dict, str]:
    """A calendar item is a dated task (e.g. "3 thank-you calls", added by the agent)."""
    if not date_:
        raise TaskError("a calendar item needs a date")
    result = create_task(conn, kind=kind, title=title, actor=actor, due=date_, time=time, why=why,
                         person_id=person_id, chips=chips or [])
    assert result is not None   # no gen_key, so never ignored
    return result


def move_calendar_item(conn: sqlite3.Connection, ref: str | int, *, date_: str,
                       time: str | None = None, actor: str = "staff") -> tuple[dict, str]:
    return update_task(conn, _task_id(ref), actor=actor, _action="move_calendar_item", due=date_, time=time)


def delete_calendar_item(conn: sqlite3.Connection, ref: str | int, actor: str = "staff") -> tuple[dict, str]:
    return delete_task(conn, _task_id(ref), actor=actor, _action="delete_calendar_item")


def undo(conn: sqlite3.Connection, token: str) -> dict:
    """Revert one logged write. A create is removed; anything else restores the row as it was before."""
    action = conn.execute("SELECT * FROM agent_actions WHERE token = ?", (token,)).fetchone()
    if action is None:
        raise NotFound("unknown undo token")
    if not action["target"].startswith("task:"):
        # Other agent writes (people, duplicates, merges, RSVPs) share agent_actions; their undo lives with them.
        raise TaskError(f"not a task change ({action['target']}); undo it through its own service")
    if action["undone_at"]:
        raise UndoConflict("already undone")
    newer = conn.execute("SELECT 1 FROM agent_actions WHERE target = ? AND id > ? AND undone_at IS NULL",
                         (action["target"], action["id"])).fetchone()
    if newer:
        raise UndoConflict("a later change to this task must be undone first")
    task_id = int(action["target"].split(":")[1])
    before = json.loads(action["before"]) if action["before"] else None
    if before is None:
        # Undoing a create. A generated task is soft-deleted so the generator doesn't add it back.
        after = json.loads(action["after"] or "{}")
        if after.get("gen_key"):
            conn.execute("UPDATE tasks SET deleted_at = ? WHERE id = ?", (_now(), task_id))
        else:
            conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    else:
        cols = [c for c in before if c != "id"]
        conn.execute(f"UPDATE tasks SET {', '.join(f'{c} = ?' for c in cols)} WHERE id = ?",
                     [before[c] for c in cols] + [task_id])
    conn.execute("UPDATE agent_actions SET undone_at = ? WHERE id = ?", (_now(), action["id"]))
    conn.commit()
    return {"undone": True, "target": action["target"], "action": action["action"]}


# ---------- reads ----------

# The Donors tab's tasks are private staff records (routes_crm.py): a row it created, migrated or edited carries
# tasks.crm. The public Vercel snapshot (export_snapshot.py) asks for public_only and never sees them.
PUBLIC_ONLY = "crm IS NULL"


def list_tasks(conn: sqlite3.Connection, *, due: str | None = None, from_: str | None = None,
               to: str | None = None, person_id: int | None = None, as_of: date | None = None,
               public_only: bool = False) -> list[dict]:
    """due='today' → open tasks due today or overdue, plus today's done ones. from/to filter by due date.
    public_only leaves out the Donors tab's private tasks (for the public snapshot)."""
    today = (as_of or default_as_of()).isoformat()
    where, args = ["deleted_at IS NULL"] + ([PUBLIC_ONLY] if public_only else []), []
    if due == "today":
        where.append("(due = ? OR (due < ? AND done = 0) OR (due IS NULL AND done = 0))")
        args += [today, today]
    elif due is not None:
        raise TaskError("due must be 'today' (or use from/to)")
    if from_:
        where.append("due >= ?")
        args.append(date.fromisoformat(from_).isoformat())
    if to:
        where.append("due <= ?")
        args.append(date.fromisoformat(to).isoformat())
    if person_id is not None:
        where.append("person_id = ?")
        args.append(person_id)
    rows = [dict(r) for r in conn.execute(f"SELECT * FROM tasks WHERE {' AND '.join(where)}", args)]
    rows.sort(key=lambda r: (r["done"], r["due"] or "9999", r["time"] or "99:99",
                             KIND_ORDER.get(r["kind"], 9), r["id"]))
    return [public(r) for r in rows]


def get_task(conn: sqlite3.Connection, task_id: int) -> dict:
    row = _row(conn, task_id)
    if row is None:
        raise NotFound(f"task {task_id} not found")
    return public(row)


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _cols(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def calendar(conn: sqlite3.Connection, from_: str | None = None, to: str | None = None,
             as_of: date | None = None, public_only: bool = False) -> list[dict]:
    """Events merged with dated tasks: [{date, time, title, kind: event|task, source, ref}], by date then time."""
    start = date.fromisoformat(from_) if from_ else (as_of or default_as_of())
    end = date.fromisoformat(to) if to else start + timedelta(days=CALENDAR_DAYS)
    lo, hi = start.isoformat(), end.isoformat()
    items = []
    if _has_table(conn, "events"):
        for r in conn.execute("SELECT id, title, starts_at, source, source_url, status FROM events "
                              "WHERE substr(starts_at, 1, 10) BETWEEN ? AND ?", (lo, hi)):
            time = r["starts_at"][11:16] or None
            items.append({"date": r["starts_at"][:10], "time": time, "title": r["title"], "kind": "event",
                          "source": r["source"] or "website", "ref": f"event:{r['id']}",
                          "source_url": r["source_url"], "status": r["status"]})
    private = f" AND {PUBLIC_ONLY}" if public_only else ""
    for r in conn.execute(f"SELECT * FROM tasks WHERE deleted_at IS NULL{private} AND due BETWEEN ? AND ?", (lo, hi)):
        items.append({"date": r["due"], "time": r["time"], "title": r["title"], "kind": "task",
                      "source": r["source"], "ref": f"task:{r['id']}", "task_kind": r["kind"],
                      "done": bool(r["done"])})
    items.sort(key=lambda i: (i["date"], i["time"] or "", i["kind"] != "event", i["ref"]))
    return items


def artifacts(conn: sqlite3.Connection, limit: int = 50) -> list[dict]:
    """What the agents have produced: [{kind: call_note|draft|report, title, date, ref}], newest first."""
    names = {r["id"]: r["full_name"] for r in conn.execute("SELECT id, full_name FROM donors")}
    items = []
    for r in conn.execute("SELECT id, donor_id, prospect_id, channel, subject, status, created_at FROM outreach_drafts"):
        who = names.get(r["donor_id"]) if r["donor_id"] else None
        title = r["subject"] or (f"{(r['channel'] or 'email').capitalize()} draft for {who}" if who else "Outreach draft")
        items.append({"kind": "draft", "title": title, "date": r["created_at"], "ref": f"draft:{r['id']}",
                      "status": r["status"]})
    if _has_table(conn, "campaigns"):
        counts = dict(conn.execute("SELECT campaign_id, COUNT(*) FROM campaign_messages GROUP BY campaign_id").fetchall())
        for r in conn.execute("SELECT id, name, status, created_at FROM campaigns"):
            n = counts.get(r["id"], 0)
            items.append({"kind": "draft", "title": f"Campaign: {r['name']} · {n} message{'s' if n != 1 else ''}",
                          "date": r["created_at"], "ref": f"campaign:{r['id']}", "status": r["status"]})
    if _has_table(conn, "call_notes"):   # routes_calls.py (#78): one row per saved call
        for r in conn.execute("SELECT id, title, created_at, saved_at, destinations FROM call_notes"):
            labels = [d.get("label") for d in json.loads(r["destinations"] or "[]") if d.get("label")]
            items.append({"kind": "call_note", "title": r["title"] or "Call note", "date": r["created_at"] or r["saved_at"],
                          "ref": f"call_note:{r['id']}", "destinations": labels})
    items.sort(key=lambda i: i["date"] or "", reverse=True)
    return items[:limit]


# ---------- the generator ----------

def _money(x: float) -> str:
    return f"${x:,.0f}"


def _gift_facts(conn: sqlite3.Connection) -> dict[int, dict]:
    """Per donor: lifetime (good gifts), last good gift, first good gift, most used channel."""
    status = "status" in _cols(conn, "gifts")
    good = "WHERE status = 'ok'" if status else ""
    facts: dict[int, dict] = {}
    for r in conn.execute(f"SELECT donor_id, amount, gift_date, channel FROM gifts {good} ORDER BY gift_date"):
        f = facts.setdefault(r["donor_id"], {"lifetime": 0.0, "first": None, "last": None, "channels": Counter()})
        f["lifetime"] += r["amount"] or 0
        f["first"] = f["first"] or (r["gift_date"], r["amount"])
        f["last"] = (r["gift_date"], r["amount"])
        if r["channel"]:
            f["channels"][r["channel"].strip().lower()] += 1
    return facts


def nice_date(d: date | str | None, today: date) -> str:
    """'Mar 11', or 'Mar 11, 2025' when it isn't today's year: how the rest of the app writes dates."""
    if d is None:
        return ""
    d = date.fromisoformat(str(d)[:10]) if not isinstance(d, date) else d
    return f"{d.strftime('%b')} {d.day}" + ("" if d.year == today.year else f", {d.year}")


def _call_chips(f: dict | None, today: date) -> list[str]:
    if not f:
        return []
    chips = [f"Lifetime {_money(f['lifetime'])}"]
    if f["last"]:
        chips.append(f"Last gift {_money(f['last'][1])} · {nice_date(f['last'][0], today)}")
    if f["channels"]:
        chips.append(f"Gives by {f['channels'].most_common(1)[0][0]}")
    return chips


def _alert_why(alert: dict, today: date) -> str:
    cadence = (alert.get("cadence") or "regular").replace("_gmd", " (Give Miami Day)")
    if alert["kind"] == "failed":
        return f"{cadence[:1].upper() + cadence[1:]} gift on {nice_date(alert['expected_date'], today)} failed, with no gift since."
    return (f"{cadence[:1].upper() + cadence[1:]} giver; the gift due {nice_date(alert['expected_date'], today)} "
            f"is {alert['days_late']} days late.")


def _duplicate_groups(conn: sqlite3.Connection) -> list[tuple[list[int], list[str]]]:
    """Pending duplicate pairs joined into groups (A~B and B~C are one group). [(donor ids, reasons)]."""
    parent: dict[int, int] = {}

    def find(x: int) -> int:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    pairs = conn.execute("SELECT donor_a_id, donor_b_id, reasons FROM duplicate_suggestions "
                         "WHERE status = 'pending' ORDER BY id").fetchall()
    for r in pairs:
        parent[find(r["donor_a_id"])] = find(r["donor_b_id"])
    groups: dict[int, tuple[set[int], list[str]]] = {}
    for r in pairs:
        ids, reasons = groups.setdefault(find(r["donor_a_id"]), (set(), []))
        ids.update((r["donor_a_id"], r["donor_b_id"]))
        reasons.extend(x for x in json.loads(r["reasons"] or "[]") if x not in reasons)
    return sorted(((sorted(ids), reasons) for ids, reasons in groups.values()), key=lambda g: g[0])


def _touched_by_people(conn: sqlite3.Connection, task_id: int) -> bool:
    """Has anyone but the generator changed this task (an edit, a move, a completion) that still stands?"""
    return conn.execute("SELECT 1 FROM agent_actions WHERE target = ? AND actor != 'generator' "
                        "AND action != 'create_task' AND undone_at IS NULL", (f"task:{task_id}",)).fetchone() is not None


def _revive_retired(conn: sqlite3.Connection, gen_key: str) -> dict | None:
    """If the generator retired this alert's task and nothing changed it since, undo the retire."""
    row = conn.execute("SELECT id, deleted_at FROM tasks WHERE gen_key = ?", (gen_key,)).fetchone()
    if row is None or row["deleted_at"] is None:
        return None
    last = conn.execute("SELECT token, action FROM agent_actions WHERE target = ? AND undone_at IS NULL "
                        "ORDER BY id DESC LIMIT 1", (f"task:{row['id']}",)).fetchone()
    if last is None or last["action"] != "retire_stale_alert":
        return None                                    # staff deleted it: stays deleted
    undo(conn, last["token"])
    return get_task(conn, row["id"])


def generate_safely(conn: sqlite3.Connection, after: str) -> dict | None:
    """generate() for the hooks (upload, refresh, merge, merge undo): an error is logged and rolled back,
    never raised, so the write that already happened still answers normally."""
    import logging
    try:
        return generate(conn)
    except Exception:
        conn.rollback()
        logging.getLogger("service").exception("task generator failed after %s", after)
        return None


def generate(conn: sqlite3.Connection, as_of: date | None = None) -> dict:
    """Create the tasks the data calls for. Idempotent: a rerun creates 0. Returns {created, tasks, updated,
    retired} (updated: open duplicate reviews rewritten because their group changed; retired: open alert calls
    whose alert is gone, soft-deleted and undoable)."""
    from service.gift_alerts import alerts

    today = as_of or default_as_of()
    names = {r["id"]: r["full_name"] for r in conn.execute("SELECT id, full_name FROM donors")}
    facts = _gift_facts(conn)
    created: list[dict] = []
    updated: list[dict] = []

    def add(gen_key: str, **fields) -> None:
        result = create_task(conn, actor="generator", gen_key=gen_key, due=fields.pop("due", today.isoformat()),
                             **fields)
        if result:
            created.append(result[0])

    # 1. failed / late regular gifts -> one call per donor (failed first, then most days late). An alert that
    # comes back after the generator retired its task (a merge undone) revives that task by undoing the retire.
    seen: set[int] = set()
    live_alerts: set[str] = set()
    for a in alerts(conn, today):
        if a["donor_id"] in seen:
            continue
        seen.add(a["donor_id"])
        key = f"alert:{a['donor_id']}:{a['expected_date']}"
        live_alerts.add(key)
        if (revived := _revive_retired(conn, key)) is not None:
            created.append(revived)
            continue
        add(key, kind="call", title=f"Call {names.get(a['donor_id'], 'donor')}", why=_alert_why(a, today),
            person_id=a["donor_id"], chips=_call_chips(facts.get(a["donor_id"]), today))

    # 1b. retire open alert calls whose alert is gone (e.g. two records merged: the alert now belongs to the
    # kept donor, or the joined history is on track). Done tasks and tasks staff or the agent touched stay.
    retired = 0
    for r in conn.execute("SELECT id, gen_key FROM tasks WHERE gen_key LIKE 'alert:%' AND deleted_at IS NULL "
                          "AND done = 0").fetchall():
        if r["gen_key"] not in live_alerts and not _touched_by_people(conn, r["id"]):
            delete_task(conn, r["id"], actor="generator", _action="retire_stale_alert")
            retired += 1

    # 2. open duplicate groups -> one review each. Groups grow, join and split, so a review task has a stable
    # gen_key ("duplicates:<random>") and keeps its group in `members`. Each pass, a group takes the unclaimed
    # task sharing the most members with it, open tasks first; a task serves at most one group. Extra open tasks
    # on a joined group are retired (members and gen_key cleared, so they never match again). A done or
    # staff-deleted review means that group was handled; only a new member brings a fresh review task.
    reviews = [dict(r) for r in conn.execute(
        "SELECT * FROM tasks WHERE kind = 'review' AND gen_key LIKE 'duplicates:%' AND members IS NOT NULL ORDER BY id")]
    for r in reviews:
        r["member_set"] = set(json.loads(r["members"]))
    claimed: set[int] = set()
    for ids, reasons in _duplicate_groups(conn):
        group = set(ids)
        people = [names.get(i, f"#{i}") for i in ids]
        fields = {"title": f"Review possible duplicate: {', '.join(people)}",
                  "why": "; ".join(reasons) or "These records look like the same person.",
                  "person_id": ids[0], "chips": [f"{len(ids)} records"] + reasons[:2]}
        candidates = sorted((r for r in reviews if r["id"] not in claimed and r["member_set"] & group),
                            key=lambda r: (bool(r["deleted_at"] or r["done"]), -len(r["member_set"] & group), r["id"]))
        if not candidates:
            add(f"duplicates:{uuid.uuid4().hex}", kind="review", _raw={"members": json.dumps(ids)}, **fields)
            continue
        keep = candidates[0]
        claimed.add(keep["id"])
        if keep["deleted_at"] or keep["done"]:
            # Handled before. A member that wasn't in that review needs a look: a fresh task for the whole group.
            if group - keep["member_set"]:
                add(f"duplicates:{uuid.uuid4().hex}", kind="review", _raw={"members": json.dumps(ids)}, **fields)
            continue
        for r in candidates[1:]:
            if not (r["deleted_at"] or r["done"]):
                claimed.add(r["id"])
                delete_task(conn, r["id"], actor="generator", _action="retire_duplicate_review",
                            _raw={"members": None, "gen_key": None})
        if keep["member_set"] != group or keep["title"] != fields["title"]:
            task, _ = update_task(conn, keep["id"], actor="generator", _action="update_duplicate_review",
                                  _raw={"members": json.dumps(ids)}, **fields)
            updated.append(task)

    # 3. first gift in the last 30 days -> welcome
    for donor_id, f in facts.items():
        first_date = date.fromisoformat(f["first"][0]) if f["first"] else None
        if first_date and 0 <= (today - first_date).days <= WELCOME_DAYS:
            add(f"welcome:{donor_id}", kind="email", title=f"Welcome {names.get(donor_id, 'new donor')}",
                why=f"First gift of {_money(f['first'][1])} on {nice_date(first_date, today)}.",
                person_id=donor_id, chips=_call_chips(f, today))

    # 4. events in the next 14 days -> prep list
    if _has_table(conn, "events"):
        audience = dict(conn.execute("SELECT event_id, COUNT(*) FROM event_audience GROUP BY event_id").fetchall())
        for e in conn.execute("SELECT id, title, starts_at, place FROM events WHERE status != 'past'"):
            when = date.fromisoformat(e["starts_at"][:10])
            days = (when - today).days
            if 0 <= days <= PREP_DAYS:
                chips = [f"In {days} day{'s' if days != 1 else ''}" if days else "Today"]
                if e["place"]:
                    chips.append(e["place"])
                if audience.get(e["id"]):
                    chips.append(f"{audience[e['id']]} invited")
                add(f"prep:{e['id']}", kind="prep", title=f"Prep list: {e['title']}",
                    why=f"{e['title']} is on {nice_date(when, today)}.", chips=chips,
                    due=max(today, when - timedelta(days=PREP_LEAD_DAYS)).isoformat())

    return {"created": len(created), "tasks": created, "updated": len(updated), "retired": retired}


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate tasks from gift alerts, duplicates, new donors, events.")
    parser.add_argument("command", choices=["generate", "list"])
    parser.add_argument("--as-of", type=date.fromisoformat, default=None)
    args = parser.parse_args()
    conn = db.connect()
    db.create_schema(conn)
    if args.command == "generate":
        result = generate(conn, args.as_of)
        print(f"created {result['created']}")
        for t in result["tasks"]:
            print(f"  [{t['kind']}] {t['title']} · {t['why']}")
    else:
        for t in list_tasks(conn, as_of=args.as_of):
            print(f"  {'x' if t['done'] else ' '} {t['due']} [{t['kind']}] {t['title']}")


if __name__ == "__main__":
    main()


# ---------- the Donors tab's tasks (routes_crm /crm/tasks): one store ----------
# react-admin's task record {id, contact_id, type, text, due_date, done_date, sales_id, created_at, updated_at}
# is a view of a tasks row with person_id = contact_id. The fields as the browser sent them live in tasks.crm
# (JSON) so they round-trip exactly; whenever a row was changed elsewhere (the agent, /tasks, the generator),
# the view is rebuilt from the row instead.

CRM_KINDS = {"call": "call", "email": "email"}        # any other react-admin type is kind 'other'
CRM_SORTS = {"id", "due_date", "done_date", "contact_id", "type", "created_at", "updated_at"}


def _crm_kind(crm_type: str | None) -> str:
    return CRM_KINDS.get((crm_type or "").lower(), "other")


def _crm_title(text: str | None) -> str:
    return (text or "").strip() or "Task"


def to_crm(row: dict) -> dict:
    crm = json.loads(row.get("crm") or "{}")
    sent_type = crm.get("type")
    type_ = sent_type if sent_type and _crm_kind(sent_type) == row["kind"] else (
        row["kind"] if row["kind"] in CRM_KINDS else "none")
    text = crm["text"] if "text" in crm and _crm_title(crm["text"]) == row["title"] else row["title"]
    sent_due = crm.get("due_date")
    due = sent_due if sent_due and row["due"] and sent_due[:10] == row["due"] else row["due"]
    done = (crm.get("done_date") or row["done_at"]) if row["done"] else None
    return {"id": row["id"], "contact_id": row["person_id"], "type": type_, "text": text, "due_date": due,
            "done_date": done, "sales_id": crm.get("sales_id"), "created_at": row["created_at"],
            "updated_at": row["updated_at"]}


def migrate_crm_tasks(conn: sqlite3.Connection) -> int:
    """Copy crm_tasks rows (written before the stores were joined) into tasks, once each. Returns how many."""
    if not _has_table(conn, "crm_tasks"):
        return 0
    copied = 0
    for r in conn.execute("SELECT * FROM crm_tasks WHERE 'crm:' || id NOT IN "
                          "(SELECT gen_key FROM tasks WHERE gen_key LIKE 'crm:%') ORDER BY id").fetchall():
        person = r["contact_id"] if conn.execute("SELECT 1 FROM donors WHERE id = ?", (r["contact_id"],)).fetchone() else None
        crm = {k: r[k] for k in ("type", "text", "due_date", "done_date", "sales_id")}
        raw = {"crm": json.dumps(crm), "created_at": r["created_at"], "updated_at": r["updated_at"]}
        if r["done_date"]:
            raw.update(done=1, done_at=r["done_date"])
        if create_task(conn, kind=_crm_kind(r["type"]), title=_crm_title(r["text"]), actor="staff",
                       gen_key=f"crm:{r['id']}", person_id=person, due=r["due_date"][:10], _raw=raw):
            copied += 1
    return copied


def _crm_rows(conn: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM tasks WHERE deleted_at IS NULL AND person_id IS NOT NULL")]


def crm_list(conn: sqlite3.Connection, *, contact_id: int | None = None, sales_id: str | None = None,
             ids: list[int] | None = None, sort: str = "due_date", order: str = "ASC",
             page: int = 1, per_page: int = 25) -> tuple[list[dict], int]:
    if sort not in CRM_SORTS:
        raise TaskError(f"can't sort tasks by {sort}")
    records = [to_crm(r) for r in _crm_rows(conn)]
    if contact_id is not None:
        records = [r for r in records if r["contact_id"] == contact_id]
    if sales_id is not None:
        records = [r for r in records if r["sales_id"] is not None and str(r["sales_id"]) == str(sales_id)]
    if ids is not None:
        wanted = set(ids)
        records = [r for r in records if r["id"] in wanted]
    desc = order.upper() == "DESC"
    present = sorted((r for r in records if r[sort] is not None), key=lambda r: (str(r[sort]) if sort not in
                     ("id", "contact_id") else r[sort], r["id"]), reverse=desc)
    ordered = present + sorted((r for r in records if r[sort] is None), key=lambda r: r["id"], reverse=desc)
    start = (page - 1) * per_page
    return ordered[start:start + per_page], len(ordered)


def crm_get(conn: sqlite3.Connection, task_id: int) -> dict | None:
    row = _row(conn, task_id)
    return to_crm(row) if row and row["person_id"] is not None else None


def crm_create(conn: sqlite3.Connection, record: dict) -> dict:
    """POST /crm/tasks: a staff task for the donor, in the one tasks table."""
    crm = {k: record.get(k) for k in ("type", "text", "due_date", "done_date", "sales_id")}
    raw = {"crm": json.dumps(crm)}
    if record.get("done_date"):
        raw.update(done=1, done_at=record["done_date"])
    task, _ = create_task(conn, kind=_crm_kind(record.get("type")), title=_crm_title(record.get("text")),
                          actor="staff", person_id=record["contact_id"], due=record["due_date"][:10], _raw=raw)
    return to_crm(_row(conn, task["id"]))


def crm_update(conn: sqlite3.Connection, task_id: int, sent: dict) -> dict | None:
    """PATCH /crm/tasks/{id}: only the fields sent change. None when there is no such task."""
    row = _row(conn, task_id)
    if row is None or row["person_id"] is None:
        return None
    current = to_crm(row)
    crm = {**{k: current[k] for k in ("type", "text", "due_date", "done_date", "sales_id")}, **{
        k: v for k, v in sent.items() if k in ("type", "text", "due_date", "done_date", "sales_id")}}
    fields: dict = {}
    raw: dict = {"crm": json.dumps(crm)}
    if "type" in sent:
        fields["kind"] = _crm_kind(sent["type"])
    if "text" in sent:
        fields["title"] = _crm_title(sent["text"])
    if "due_date" in sent:
        fields["due"] = sent["due_date"][:10]
    if "contact_id" in sent:
        fields["person_id"] = sent["contact_id"]
    if "done_date" in sent:
        raw.update(done=1 if sent["done_date"] else 0, done_at=sent["done_date"] or None)
    action = "complete_task" if set(sent) == {"done_date"} else "update_task"
    update_task(conn, task_id, actor="staff", _action=action, _raw=raw, **fields)
    return to_crm(_row(conn, task_id))


def crm_delete(conn: sqlite3.Connection, task_id: int) -> dict | None:
    row = _row(conn, task_id)
    if row is None or row["person_id"] is None:
        return None
    delete_task(conn, task_id, actor="staff")
    return to_crm(row)


# ---------- a giver's next step (GET /people: the "Next step" column) ----------
# One task store, so a giver's next step is their next open task. Givers only (Sharif): neighbors and community
# members get null.


def with_next_steps(conn: sqlite3.Connection, people: list[dict], as_of: date | None = None,
                    public_only: bool = False) -> list[dict]:
    """Set person["next_step"] on each row (in place): a giver's next open task, else null. Returns the list.
    public_only skips the Donors tab's private tasks (the public snapshot recomputes with it)."""
    today = as_of or default_as_of()
    givers = [p for p in people if (p.get("contact_type") or "giver") == "giver"]
    ids = [p["id"] for p in givers if p.get("id") is not None]
    nxt: dict[int, dict] = {}
    if ids and _has_table(conn, "tasks"):
        for chunk in range(0, len(ids), 500):
            part = ids[chunk:chunk + 500]
            private = f" AND {PUBLIC_ONLY}" if public_only else ""
            for r in conn.execute(f"SELECT * FROM tasks WHERE deleted_at IS NULL AND done = 0{private} AND person_id IN "
                                  f"({', '.join('?' * len(part))})", part):
                r = dict(r)
                key = (r["due"] or "9999", r["time"] or "99:99", KIND_ORDER.get(r["kind"], 9), r["id"])
                best = nxt.get(r["person_id"])
                if best is None or key < best["_key"]:
                    nxt[r["person_id"]] = {**r, "_key": key}
    for p in people:
        p["next_step"] = None
    for p in givers:
        t = nxt.get(p.get("id"))
        if t:
            due = t["due"]
            when = (" · overdue" if due < today.isoformat() else "" if due == today.isoformat()
                    else f" · {nice_date(due, today)}") if due else ""
            p["next_step"] = f"{t['title']}{when}"
    return people
