"""Walk the main (home) agent in a real browser: type each prompt, read the agent's steps and reply, approve
cards when the case says so (all at once, or one at a time to check the others stay pending), then check the
local database through the API that the write really landed.

    python scripts/verify-agent.py http://127.0.0.1:5733 http://127.0.0.1:8733 --shots <dir> [--only 1,4]

Point it at a web UI running with VITE_DATA_MODE=local against a service on a COPY of the demo db: the write
cases change people, tasks, the calendar and the outbox. Each case gets a fresh page (a new conversation).
Prints one PASS/FAIL line per case and exits 1 if any case fails.
"""
import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Callable

import httpx
from playwright.sync_api import Page, sync_playwright

TODAY = date(2026, 11, 8)              # SCORE_AS_OF: the agent turns "Tuesday" into a date from this
TUESDAY, FRIDAY = TODAY + timedelta(days=2), TODAY + timedelta(days=5)
CHAT_TIMEOUT_MS = 130_000              # the route's own cap is 90 s; anything later is a failure anyway


def api(base: str, path: str, **params):
    r = httpx.get(base + path, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def chat_data(r) -> dict:
    """{steps, reply, approvals} from POST /chat (JSON) or POST /chat/stream (assistant-stream lines: b: a tool
    starts, a: its result, 0: text, 2: data such as approvals)."""
    if "application/json" in (r.headers.get("content-type") or ""):
        return r.json()
    steps, text, approvals = [], [], []
    for line in r.text().splitlines():
        kind, _, raw = line.partition(":")
        try:
            value = json.loads(raw)
        except ValueError:
            continue
        if kind == "b":
            steps.append({"tool": value.get("toolName")})
        elif kind == "0":
            text.append(str(value))
        elif kind == "2":
            approvals += [a for d in value if d.get("type") == "approvals" for a in d.get("approvals", [])]
        elif kind == "3":
            text.append(f"[stream error: {value}]")
    return {"steps": steps, "reply": "".join(text), "approvals": approvals}


def is_chat(r) -> bool:
    return r.request.method == "POST" and (r.url.endswith("/chat") or r.url.endswith("/chat/stream"))


def person_id(base: str, name: str) -> int:
    for p in api(base, "/people")["people"]:
        if p["full_name"] == name:
            return p["id"]
    raise LookupError(f"{name} is not in the database")


@dataclass
class Case:
    name: str
    prompt: str
    tools_any: set[str] = field(default_factory=set)     # at least one of these tools ran
    tools_all: set[str] = field(default_factory=set)     # every one of these ran (across approve too)
    reply: str | None = None                             # regex the reply must match (case-insensitive)
    approve: bool | str = False                          # True: approve every card; "each": one card per resume
    ui: str | None = None                                # role=button name regex that must be on screen
    ui_count: int | None = None                          # with ui: exactly this many such buttons
    tools_none: set[str] = field(default_factory=set)    # none of these may run (e.g. nothing that dials)
    probe: Callable[[str], tuple[bool, str]] | None = None
    setup: Callable[[str], None] | None = None
    start: Callable[[Page], None] | None = None          # how the conversation starts (default: type prompt)
    live: bool = False                                   # the first step card must show before the reply ends
    after: Callable[[Page], str | None] | None = None     # a UI check once the reply is in; returns a failure note


def crm_probe(base):
    d = api(base, f"/donors/{person_id(base, 'Carmen Ibarra')}")
    return d.get("city") == "Coral Gables", f"city = {d.get('city')!r}"


def task_probe(base):
    rows = api(base, "/tasks", **{"from": TUESDAY.isoformat(), "to": TUESDAY.isoformat()})
    hit = [t for t in rows if "priya" in (t["title"] or "").lower()]
    return bool(hit), f"{len(hit)} Priya task(s) due {TUESDAY}"


def calendar_probe(base):
    """A dated task (GET /calendar) or, since #211, an event (GET /events) for the lunch on Friday."""
    rows = api(base, "/calendar", **{"from": FRIDAY.isoformat(), "to": FRIDAY.isoformat()})
    events = [e for e in api(base, "/events") if str(e.get("starts_at") or "").startswith(FRIDAY.isoformat())]
    hit = [i for i in rows + events if "lunch" in json.dumps(i).lower()]
    return bool(hit), f"{len(hit)} lunch item(s) on {FRIDAY} (calendar + events)"


SEEN: dict[str, int] = {}


def note_last_batch(base):
    SEEN["batch"] = max((c["id"] for c in api(base, "/campaigns")), default=0)


def gmd_probe(base):
    """This case's batch drafts Give Miami Day givers (e6: after a real upload GMD lives only in source_row,
    ~30 givers). Batches from earlier cases don't count."""
    new = [c for c in api(base, "/campaigns") if c["id"] > SEEN.get("batch", 0)]
    n = sum(c["counts"]["total"] for c in new)
    return n >= 10, f"{n} draft(s) in {len(new)} new batch(es)"


WALK_TASKS = ("Walk test task A", "Walk test task B")


def two_tasks(base):
    """Two tasks due today for the two-pending-cards case (each delete waits on its own approval card).
    Leftovers from an earlier run are deleted first, so the agent sees exactly one of each."""
    for t in api(base, "/tasks", due="today"):
        if t["title"] in WALK_TASKS:
            httpx.delete(f"{base}/tasks/{t['id']}", timeout=30).raise_for_status()
    for title in WALK_TASKS:
        r = httpx.post(base + "/tasks", json={"kind": "other", "title": title, "due": TODAY.isoformat()}, timeout=30)
        r.raise_for_status()


def both_deleted_probe(base):
    left = [t["title"] for t in api(base, "/tasks", due="today") if t["title"] in WALK_TASKS]
    return not left, f"still open after approving both cards: {left or 'none'}"


def outbox_probe(base):
    rows = [o for name in ("Carmen Ibarra", "Priya Raman") for o in api(base, "/outbox", donor_id=person_id(base, name))]
    return bool(rows), f"{len(rows)} outbox row(s) for Carmen/Priya"


def today_task(base):
    """A call task due today, so the home task card has something to send to the agent."""
    r = httpx.post(base + "/tasks", json={"kind": "call", "title": "Call Carmen Ibarra about her October gift",
                                          "person_id": person_id(base, "Carmen Ibarra"),
                                          "due": TODAY.isoformat()}, timeout=30)
    r.raise_for_status()


def call_opens_in_the_card(page: Page) -> str | None:
    """The call sheet's Call opens the call inside the card (Sharif): no dialog over the page. The inner Call is
    never clicked here (and stays disabled with PHONE_CALLS off)."""
    sheet = page.locator("[role=log] [data-testid=call-sheet]").last
    sheet.get_by_role("button", name=re.compile(r"^Call$")).click()
    try:
        sheet.locator("[data-testid=inline-call]").wait_for(timeout=10000)
    except Exception:
        return "no inline call panel after clicking Call"
    page.wait_for_timeout(1500)                          # let the setup check answer
    if page.locator("[role=dialog]").count():
        return "a dialog opened over the page"
    return None


def click_work_on_task(page: Page):
    """A click on a sidebar task hands it to the home agent (WorkspaceSidebar.workOn)."""
    page.get_by_role("button", name=re.compile("^Work on with the agent: Call Carmen Ibarra", re.I)).first.click()


CASES = [
    # Call protocol (#219): "call <person>" shows the call sheet with one Call button; nothing dials (the button
    # is never clicked here, and every test stack runs PHONE_CALLS=off).
    Case("call a donor", "Call Elizabeth Fontaine", tools_all={"prep_call"}, tools_none={"call_person"},
         ui=r"^Call$", ui_count=1, after=call_opens_in_the_card),
    Case("CRM write", "Update Carmen Ibarra's city to Coral Gables", tools_all={"update_person"},
         probe=crm_probe),
    Case("events read", "What are the next events coming up?", tools_any={"get_events", "get_calendar"},
         reply=r"\b(nov|dec|jan|202\d)"),
    Case("events + best donors", "What are the next events coming up, and which donors would be best to invite?",
         tools_any={"plan_event_outreach", "find_people"}, reply=r"invite|donor"),
    Case("email blast", "Send a thank-you email to Carmen Ibarra and Priya Raman",
         tools_all={"draft_email", "send"}, approve=True, probe=outbox_probe),
    Case("task write", "Add a task to call Priya Raman on Tuesday", tools_all={"create_task"}, probe=task_probe),
    Case("calendar write", "Put a donor lunch on the calendar for Friday at noon",
         tools_any={"add_calendar_item", "create_task", "add_event"}, probe=calendar_probe),
    Case("context read", "What has the Foundation been doing lately?",
         tools_any={"get_context", "search_context"}, reply=r"\w{20,}|\."),
    Case("task -> agent", "(home task card: Work on it with the agent)", tools_all={"get_task"},
         setup=today_task, start=click_work_on_task),
    Case("GMD thank-you", "Draft a thank-you to Give Miami Day donors", tools_all={"draft_email"},
         setup=note_last_batch, probe=gmd_probe),
    Case("streams live", "Which donors are lapsing, and what should I do about each one?",
         tools_any={"find_people", "get_alerts"}, live=True),
    Case("two pending cards", "Delete both of today's tasks 'Walk test task A' and 'Walk test task B'.",
         tools_all={"delete_task"}, approve="each", setup=two_tasks, probe=both_deleted_probe),
]


def run_case(page: Page, web: str, base: str, case: Case, shots: Path, n: int) -> tuple[bool, str]:
    if case.setup:
        case.setup(base)
    page.goto(web + "/", wait_until="networkidle")
    tools, replies, notes = [], [], []
    started = time.time()
    with page.expect_response(is_chat, timeout=CHAT_TIMEOUT_MS) as resp:
        if case.start:
            case.start(page)
        else:
            box = page.get_by_placeholder(re.compile("Ask the agent", re.I))
            box.fill(case.prompt)
            box.press("Enter")
    r = resp.value
    if r.status != 200:
        return False, f"/chat {r.status}: {r.text()[:160]}"
    if case.live:                                        # a step card shows while the reply is still streaming
        page.locator("[role=log] [data-testid=agent-step]").first.wait_for(timeout=CHAT_TIMEOUT_MS)
        card_at = time.time()
        r.finished()
        lead = time.time() - card_at
        notes.append(f"first step card {lead:.1f}s before the reply finished")
        if lead < 1.0:
            notes.append("not live: the card came with the finished reply")
    data = chat_data(r)
    tools += [s["tool"] for s in data.get("steps", [])]
    replies.append(data.get("reply") or "")
    if case.approve == "each":
        notes.append(f"{len(data.get('approvals') or [])} card(s) pending at once")
        yes = re.compile(r"^Approve$")                       # delete cards; never Send or Call here
        for _ in range(4):                                   # one card per round trip; the others must stay pending
            pending = page.locator("[data-testid=agent-approval][data-decision=pending]")
            if pending.count() == 0:
                break
            with page.expect_response(lambda r: r.url.endswith("/chat/approve"), timeout=CHAT_TIMEOUT_MS) as resp:
                pending.first.get_by_role("button", name=yes).click()
            data = chat_data(resp.value)
            tools += [s["tool"] for s in data.get("steps", [])]
            replies.append(data.get("reply") or "")
            page.wait_for_timeout(500)
        declined = page.locator("[data-testid=agent-approval][data-decision=declined]").count()
        if declined:
            notes.append(f"{declined} card(s) declined without a click")
    elif case.approve:
        for _ in range(3):                                   # a resumed run can pause again (e.g. a second send)
            if not data.get("approvals"):
                break
            with page.expect_response(lambda r: r.url.endswith("/chat/approve"), timeout=CHAT_TIMEOUT_MS) as resp:
                for b in page.locator("[data-testid=agent-approval]").get_by_role(
                        "button", name=re.compile(r"^(Approve|Send|Call)$")).all():
                    if b.is_enabled():
                        b.click()
            data = chat_data(resp.value)
            tools += [s["tool"] for s in data.get("steps", [])]
            replies.append(data.get("reply") or "")
    page.wait_for_timeout(800)
    secs = time.time() - started
    page.screenshot(path=str(shots / f"{n:02d}-{re.sub(r'[^a-z0-9]+', '-', case.name)}.png"), full_page=True)

    ok = not any("without a click" in n or n.startswith("not live") for n in notes)
    if case.tools_any and not (case.tools_any & set(tools)):
        ok, _ = False, notes.append(f"none of {sorted(case.tools_any)} ran")
    if case.tools_all - set(tools):
        ok, _ = False, notes.append(f"missing {sorted(case.tools_all - set(tools))}")
    text = " ".join(replies)
    if case.reply and not re.search(case.reply, text, re.I):
        ok, _ = False, notes.append(f"reply doesn't match /{case.reply}/")
    if case.ui:
        n = page.locator("[role=log]").get_by_role("button", name=re.compile(case.ui, re.I)).count()
        if (n != case.ui_count) if case.ui_count is not None else n == 0:
            ok, _ = False, notes.append(f"{n} /{case.ui}/ button(s) in the conversation"
                                        + (f", want {case.ui_count}" if case.ui_count is not None else ""))
    if case.tools_none & set(tools):
        ok, _ = False, notes.append(f"must not run {sorted(case.tools_none & set(tools))}")
    if case.after and ok:
        problem = case.after(page)
        if problem:
            ok, _ = False, notes.append(problem)
        else:
            notes.append("call opened inside the card, no dialog")
            page.screenshot(path=str(shots / f"{n:02d}-inline-call.png"), full_page=True)
    if case.probe:
        good, detail = case.probe(base)
        notes.append(f"db: {detail}")
        ok = ok and good
    return ok, f"{secs:5.1f}s tools={tools} | {'; '.join(notes)} | reply: {text[:140]!r}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("web")
    ap.add_argument("api")
    ap.add_argument("--shots", default="agent-shots")
    ap.add_argument("--only", default="", help="comma-separated case numbers (1-based)")
    args = ap.parse_args()
    shots = Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    pick = {int(x) for x in args.only.split(",") if x.strip()}
    web, base = args.web.rstrip("/"), args.api.rstrip("/")
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for n, case in enumerate(CASES, 1):
            if pick and n not in pick:
                continue
            page = browser.new_page(viewport={"width": 1366, "height": 900})
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            try:
                ok, detail = run_case(page, web, base, case, shots, n)
            except Exception as e:                           # a timeout or a missing element is a FAIL, not a crash
                ok, detail = False, f"{type(e).__name__}: {str(e)[:200]}"
            if errors:
                detail += f" | console errors: {errors[:2]}"
            results.append(ok)
            print(f"{'PASS' if ok else 'FAIL'} {n}. {case.name}: {detail}", flush=True)
            page.close()
        browser.close()
    print(f"{sum(results)}/{len(results)} passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
