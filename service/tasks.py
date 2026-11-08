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
                gen_key: str | None = None, **fields) -> tuple[dict, str] | None:
    """Add a task. `source` defaults to the actor. With a gen_key that already exists, returns None."""
    actor = _actor(actor)
    values = _check({"kind": kind, "title": title, "source": fields.pop("source", actor), **fields})
    _require_person(conn, values.get("person_id"))
    cols = list(values) + ["gen_key", "created_at", "updated_at"]
    now = _now()
    cur = conn.execute(
        f"INSERT OR IGNORE INTO tasks ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
        [*values.values(), gen_key, now, now])
    if cur.rowcount == 0:
        return None
    row = _row(conn, cur.lastrowid)
    token = _log(conn, actor, "create_task", row["id"], None, row)
    conn.commit()
    return public(row), token


def update_task(conn: sqlite3.Connection, task_id: int, actor: str = "staff",
                _action: str = "update_task", **fields) -> tuple[dict, str]:
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
                _action: str = "delete_task") -> tuple[dict, str]:
    actor = _actor(actor)
    before = _row(conn, task_id)
    if before is None:
        raise NotFound(f"task {task_id} not found")
    conn.execute("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?", (_now(), _now(), task_id))
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

def list_tasks(conn: sqlite3.Connection, *, due: str | None = None, from_: str | None = None,
               to: str | None = None, person_id: int | None = None, as_of: date | None = None) -> list[dict]:
    """due='today' → open tasks due today or overdue, plus today's done ones. from/to filter by due date."""
    today = (as_of or default_as_of()).isoformat()
    where, args = ["deleted_at IS NULL"], []
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
             as_of: date | None = None) -> list[dict]:
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
    for r in conn.execute("SELECT * FROM tasks WHERE deleted_at IS NULL AND due BETWEEN ? AND ?", (lo, hi)):
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
    if _has_table(conn, "call_notes"):   # Agent Phone's table (B3); guarded until it lands
        cols = _cols(conn, "call_notes")
        title_col = "title" if "title" in cols else None
        date_col = "created_at" if "created_at" in cols else None
        person_col = "person_id" if "person_id" in cols else None
        select = ", ".join(c for c in ("id", title_col, date_col, person_col) if c)
        for r in conn.execute(f"SELECT {select} FROM call_notes"):
            who = names.get(r[person_col]) if person_col else None
            title = (r[title_col] if title_col else None) or (f"Call note: {who}" if who else "Call note")
            items.append({"kind": "call_note", "title": title, "date": r[date_col] if date_col else None,
                          "ref": f"call_note:{r['id']}"})
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


def _call_chips(f: dict | None) -> list[str]:
    if not f:
        return []
    chips = [f"Lifetime {_money(f['lifetime'])}"]
    if f["last"]:
        chips.append(f"Last gift {_money(f['last'][1])} · {f['last'][0]}")
    if f["channels"]:
        chips.append(f"Gives by {f['channels'].most_common(1)[0][0]}")
    return chips


def _alert_why(alert: dict) -> str:
    cadence = (alert.get("cadence") or "regular").replace("_gmd", " (Give Miami Day)")
    if alert["kind"] == "failed":
        return f"{cadence.capitalize()} gift on {alert['expected_date']} failed, with no gift since."
    return f"{cadence.capitalize()} giver; the gift due {alert['expected_date']} is {alert['days_late']} days late."


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


def generate(conn: sqlite3.Connection, as_of: date | None = None) -> dict:
    """Create the tasks the data calls for. Idempotent: a rerun creates 0. Returns {created, tasks}."""
    from service.gift_alerts import alerts

    today = as_of or default_as_of()
    names = {r["id"]: r["full_name"] for r in conn.execute("SELECT id, full_name FROM donors")}
    facts = _gift_facts(conn)
    created: list[dict] = []

    def add(gen_key: str, **fields) -> None:
        result = create_task(conn, actor="generator", gen_key=gen_key, due=fields.pop("due", today.isoformat()),
                             **fields)
        if result:
            created.append(result[0])

    # 1. failed / late regular gifts -> one call per donor (failed first, then most days late)
    seen: set[int] = set()
    for a in alerts(conn, today):
        if a["donor_id"] in seen:
            continue
        seen.add(a["donor_id"])
        add(f"alert:{a['donor_id']}:{a['expected_date']}", kind="call",
            title=f"Call {names.get(a['donor_id'], 'donor')}", why=_alert_why(a),
            person_id=a["donor_id"], chips=_call_chips(facts.get(a["donor_id"])))

    # 2. open duplicate groups -> one review each
    for ids, reasons in _duplicate_groups(conn):
        people = [names.get(i, f"#{i}") for i in ids]
        add("duplicates:" + ",".join(map(str, ids)), kind="review",
            title=f"Review possible duplicate: {', '.join(people)}",
            why="; ".join(reasons) or "These records look like the same person.",
            person_id=ids[0], chips=[f"{len(ids)} records"] + reasons[:2])

    # 3. first gift in the last 30 days -> welcome
    for donor_id, f in facts.items():
        first_date = date.fromisoformat(f["first"][0]) if f["first"] else None
        if first_date and 0 <= (today - first_date).days <= WELCOME_DAYS:
            add(f"welcome:{donor_id}", kind="email", title=f"Welcome {names.get(donor_id, 'new donor')}",
                why=f"First gift of {_money(f['first'][1])} on {first_date.isoformat()}.",
                person_id=donor_id, chips=_call_chips(f))

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
                    why=f"{e['title']} is on {when.isoformat()}.", chips=chips,
                    due=max(today, when - timedelta(days=PREP_LEAD_DAYS)).isoformat())

    return {"created": len(created), "tasks": created}


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
