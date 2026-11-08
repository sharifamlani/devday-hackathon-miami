"""Walk the main (home) agent in a real browser: type each prompt, read the agent's steps and reply, approve
cards when the case says so, then check the local database through the API that the write really landed.

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
    approve: bool = False                                # click every Approve card, then wait for the resume
    ui: str | None = None                                # role=button name regex that must be on screen
    probe: Callable[[str], tuple[bool, str]] | None = None
    setup: Callable[[str], None] | None = None
    start: Callable[[Page], None] | None = None          # how the conversation starts (default: type prompt)


def crm_probe(base):
    d = api(base, f"/donors/{person_id(base, 'Carmen Ibarra')}")
    return d.get("city") == "Coral Gables", f"city = {d.get('city')!r}"


def task_probe(base):
    rows = api(base, "/tasks", **{"from": TUESDAY.isoformat(), "to": TUESDAY.isoformat()})
    hit = [t for t in rows if "priya" in (t["title"] or "").lower()]
    return bool(hit), f"{len(hit)} Priya task(s) due {TUESDAY}"


def calendar_probe(base):
    rows = api(base, "/calendar", **{"from": FRIDAY.isoformat(), "to": FRIDAY.isoformat()})
    hit = [i for i in rows if "lunch" in json.dumps(i).lower()]
    return bool(hit), f"{len(hit)} lunch item(s) on {FRIDAY}"


def outbox_probe(base):
    rows = [o for name in ("Carmen Ibarra", "Priya Raman") for o in api(base, "/outbox", donor_id=person_id(base, name))]
    return bool(rows), f"{len(rows)} outbox row(s) for Carmen/Priya"


def today_task(base):
    """A call task due today, so the home task card has something to send to the agent."""
    r = httpx.post(base + "/tasks", json={"kind": "call", "title": "Call Carmen Ibarra about her October gift",
                                          "person_id": person_id(base, "Carmen Ibarra"),
                                          "due": TODAY.isoformat()}, timeout=30)
    r.raise_for_status()


def click_work_on_task(page: Page):
    """A click on a sidebar task hands it to the home agent (WorkspaceSidebar.workOn)."""
    page.get_by_role("button", name=re.compile("^Work on with the agent: Call Carmen Ibarra", re.I)).first.click()


CASES = [
    Case("call a donor", "Call Carmen Ibarra", tools_any={"get_person", "find_people", "call_person"},
         ui=r"^Call\b"),
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
         tools_any={"add_calendar_item", "create_task"}, probe=calendar_probe),
    Case("context read", "What has the Foundation been doing lately?",
         tools_any={"get_context", "search_context"}, reply=r"\w{20,}|\."),
    Case("task -> agent", "(home task card: Work on it with the agent)", tools_all={"get_task"},
         setup=today_task, start=click_work_on_task),
]


def run_case(page: Page, web: str, base: str, case: Case, shots: Path, n: int) -> tuple[bool, str]:
    if case.setup:
        case.setup(base)
    page.goto(web + "/", wait_until="networkidle")
    tools, replies, notes = [], [], []
    started = time.time()
    with page.expect_response(lambda r: r.url.endswith("/chat") and r.request.method == "POST",
                              timeout=CHAT_TIMEOUT_MS) as resp:
        if case.start:
            case.start(page)
        else:
            box = page.get_by_placeholder(re.compile("Ask the agent", re.I))
            box.fill(case.prompt)
            box.press("Enter")
    r = resp.value
    if r.status != 200:
        return False, f"/chat {r.status}: {r.text()[:160]}"
    data = r.json()
    tools += [s["tool"] for s in data.get("steps", [])]
    replies.append(data.get("reply") or "")
    if case.approve:
        for _ in range(3):                                   # a resumed run can pause again (e.g. a second send)
            if not data.get("approvals"):
                break
            with page.expect_response(lambda r: r.url.endswith("/chat/approve"), timeout=CHAT_TIMEOUT_MS) as resp:
                for b in page.locator("[data-testid=agent-approval]").get_by_role(
                        "button", name=re.compile(r"^(Approve|Send|Call)$")).all():
                    if b.is_enabled():
                        b.click()
            data = resp.value.json()
            tools += [s["tool"] for s in data.get("steps", [])]
            replies.append(data.get("reply") or "")
    page.wait_for_timeout(800)
    secs = time.time() - started
    page.screenshot(path=str(shots / f"{n:02d}-{re.sub(r'[^a-z0-9]+', '-', case.name)}.png"), full_page=True)

    ok = True
    if case.tools_any and not (case.tools_any & set(tools)):
        ok, _ = False, notes.append(f"none of {sorted(case.tools_any)} ran")
    if case.tools_all - set(tools):
        ok, _ = False, notes.append(f"missing {sorted(case.tools_all - set(tools))}")
    text = " ".join(replies)
    if case.reply and not re.search(case.reply, text, re.I):
        ok, _ = False, notes.append(f"reply doesn't match /{case.reply}/")
    if case.ui and page.locator("[role=log]").get_by_role("button", name=re.compile(case.ui, re.I)).count() == 0:
        ok, _ = False, notes.append(f"no /{case.ui}/ button in the conversation")
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
