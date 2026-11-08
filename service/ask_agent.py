"""Ask Donor Desk: a plain-English question becomes a filter spec, and plain code runs the filter.

The model is read-only. It sees the question and the org's calendar, never a donor row, and it returns
one structured AskPlan (Pydantic output_type): how it read the question, the filter, and a suggested
campaign intent. It has no tools. apply_filter() then runs that filter over `donors`, `donor_scores`,
`gifts` and `outreach_drafts` in ordinary Python, so every donor and amount on screen comes from the
database, never from the model.

    plan = interpret(question)              # model (traced), or None
    plan = rules_plan(question, as_of)      # keyword fallback for the example questions, or None
    rows = apply_filter(conn, plan.filter, as_of)

The route (service/routes_ask.py) picks model → rules, and service/export_snapshot.py stores the
rules answers to EXAMPLE_QUESTIONS under "ask_examples" so the Vercel snapshot needs no API call.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from service import score

# Keep in step with EXAMPLE_QUESTIONS in web/src/components/atomic-crm/ask/askFilter.ts
EXAMPLE_QUESTIONS = [
    "Who helped us reach our Q4 goal? Draft a thank-you now that the November push is over.",
    "Who needs outreach because they've gone quiet?",
    "Monthly donors whose last gift is late",
    "Big donors we haven't called this quarter",
]

Status = Literal["lapsing", "due", "on_track", "lapsed", "no_gifts"]
Tier = Literal["big", "mid", "small"]
Cadence = Literal["monthly", "quarterly", "yearly", "one_time"]
Sort = Literal["score", "period_total", "last_gift_recent", "last_gift_oldest", "lifetime", "name"]
IntentKind = Literal["thank_you", "re_engage", "check_in"]
Channel = Literal["email", "text"]

# Usual gap between gifts (score.py's median interval) → the cadence words staff use
MONTHLY_MAX_DAYS = 45
QUARTERLY_MAX_DAYS = 135
# score.py reasons that mean "past their own rhythm": overdue vs cadence, or missed their usual month
OVERDUE_REASONS = {"overdue_vs_cadence", "missed_seasonal_window"}
MAX_LIMIT = 100
# An outreach draft counts as contact once a person approved or sent it; an unsent draft is not a call
CONTACT_STATUSES = ("approved", "sent")


def _iso_or_none(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    date.fromisoformat(value)  # raises ValueError → a 422 for the route, a retry for the model
    return value


class DateRange(BaseModel):
    start: str | None = Field(None, description="First day included, YYYY-MM-DD; null = no lower bound")
    end: str | None = Field(None, description="Last day included, YYYY-MM-DD; null = no upper bound")

    @field_validator("start", "end")
    @classmethod
    def iso_dates(cls, v: str | None) -> str | None:
        return _iso_or_none(v)


class AskFilter(BaseModel):
    """Every field is optional; null (or an empty list) means "no constraint". All must hold (AND)."""

    status: list[Status] | None = Field(None, description="Score status, any of these")
    tier: list[Tier] | None = Field(None, description="Giving tier, any of these. big = $25k+ lifetime or a $10k+ gift")
    star: bool | None = Field(None, description="true = only star donors ($1M+ lifetime); false = exclude them")
    donor_type: Literal["individual", "organization"] | None = None
    gave_between: DateRange | None = Field(
        None, description="At least one gift in this range. Amount and channel fields then look only at these gifts")
    last_gift_before: str | None = Field(None, description="Most recent gift on or before this day, YYYY-MM-DD")
    last_gift_after: str | None = Field(None, description="Most recent gift on or after this day, YYYY-MM-DD")
    min_gift: float | None = Field(None, description="Largest single gift (in gave_between, else ever) at least this, USD")
    max_gift: float | None = Field(None, description="Largest single gift (in gave_between, else ever) at most this, USD")
    min_total: float | None = Field(None, description="Total given (in gave_between, else lifetime) at least this, USD")
    max_total: float | None = Field(None, description="Total given (in gave_between, else lifetime) at most this, USD")
    channel: list[str] | None = Field(
        None, description="Gave through any of these channels, e.g. 'Give Miami Day', 'online', 'check', 'event'")
    cadence: Cadence | None = Field(None, description="Usual rhythm from their gift history")
    overdue: bool | None = Field(
        None, description="true = past their own usual rhythm or missed their usual giving month (gone quiet)")
    has_draft: bool | None = Field(None, description="true = has an outreach draft; false = none yet")
    not_contacted_since: str | None = Field(
        None, description="No outreach approved or sent on or after this day, YYYY-MM-DD (there is no call "
                          "log, so 'haven't called / contacted' maps here)")
    sort: Sort | None = Field(None, description="score (default), period_total, last_gift_recent, "
                                                "last_gift_oldest, lifetime or name")
    limit: int | None = Field(None, description="At most this many donors (1-100); null = all")

    @field_validator("last_gift_before", "last_gift_after", "not_contacted_since")
    @classmethod
    def iso_dates(cls, v: str | None) -> str | None:
        return _iso_or_none(v)


class AskIntent(BaseModel):
    kind: IntentKind = Field(description="thank_you (they gave), re_engage (they went quiet) or check_in")
    channel_hint: Channel | None = Field(None, description="email or text when the question implies one")


class AskPlan(BaseModel):
    """The model's whole answer: no donors, no amounts it made up, just how to filter."""

    interpretation: str = Field(description="One plain sentence: how you read the question, naming the dates used")
    filter: AskFilter
    intent: AskIntent


# ----------------------------------------------------------------------------------------------
# The org's calendar (every persona's fiscal year ends in December, persona.json fiscal_year, so quarters are calendar)
# ----------------------------------------------------------------------------------------------

def quarter_of(day: date) -> tuple[int, date, date]:
    q = (day.month - 1) // 3 + 1
    start = date(day.year, 3 * q - 2, 1)
    end = date(day.year + (q == 4), (3 * q) % 12 + 1, 1) - timedelta(days=1)
    return q, start, end


def calendar_for(as_of: date) -> dict:
    """The date words a question may use, resolved against the as-of date."""
    q, q_start, q_end = quarter_of(as_of)
    _, lq_start, lq_end = quarter_of(q_start - timedelta(days=1))
    month_end = date(as_of.year + (as_of.month == 12), as_of.month % 12 + 1, 1) - timedelta(days=1)
    gmd = score.GIVE_MIAMI_DAY.get(as_of.year)
    return {
        "today": as_of.isoformat(),
        "this_quarter": {"label": f"Q{q} {as_of.year}", "start": q_start.isoformat(), "end": q_end.isoformat()},
        "last_quarter": {"start": lq_start.isoformat(), "end": lq_end.isoformat()},
        "this_month": {"start": as_of.replace(day=1).isoformat(), "end": month_end.isoformat()},
        "this_year": {"start": date(as_of.year, 1, 1).isoformat(), "end": date(as_of.year, 12, 31).isoformat()},
        "november_push": {"start": date(as_of.year, 11, 1).isoformat(), "end": date(as_of.year, 11, 30).isoformat(),
                          "give_miami_day": gmd.isoformat() if gmd else None},
    }


INSTRUCTIONS = """You turn a nonprofit staff member's question about their donors into a filter for a donor database.
You never see donor records and you never name donors, amounts or counts: plain code runs your filter.
Return one AskPlan:
- interpretation: one short sentence saying how you read the question, with the exact dates you used
  (e.g. "Donors who gave between Oct 1 and Nov 8, 2026, biggest quarter total first.").
- filter: only the fields the question asks for; leave everything else null. Dates are YYYY-MM-DD.
  "this quarter", "Q4", "last month", "the November push" etc. resolve with the calendar below; a range that
  runs into the future ends today. "Gone quiet", "stopped giving", "lapsing" → overdue=true.
  "Called / contacted / reached out" → not_contacted_since (there is no call log). "Big" or "major" → tier ["big"].
  "Monthly", "quarterly" → cadence. Thank-you questions sort by period_total.
- intent: thank_you when they gave, re_engage when they went quiet, check_in otherwise. channel_hint only if
  the question names email or text.
If the question is not about donors or can't be expressed with these fields, say so in interpretation and
return an empty filter."""


def instructions_for(as_of: date) -> str:
    return f"{INSTRUCTIONS}\n\nCalendar (fiscal year = calendar year):\n{json.dumps(calendar_for(as_of), indent=1)}"


# ----------------------------------------------------------------------------------------------
# The model: interpret only
# ----------------------------------------------------------------------------------------------

def build_agent(as_of: date, model: str | None):
    from agents import Agent

    # No tools and no handoffs: the agent can only answer with an AskPlan.
    return Agent(name="AskDonorDesk", instructions=instructions_for(as_of), model=model, output_type=AskPlan)


async def interpret(question: str, as_of: date, model: str | None) -> tuple[AskPlan, str]:
    """One traced Agents SDK run. Returns (plan, trace_id). Raises on model errors; the route falls back."""
    from agents import Runner, trace

    with trace("Ask Donor Desk", metadata={"as_of": as_of.isoformat()}) as t:
        result = await Runner.run(build_agent(as_of, model), question)
    return result.final_output_as(AskPlan, raise_if_incorrect_type=True), t.trace_id


# ----------------------------------------------------------------------------------------------
# Rules fallback: the example questions without a model (no key, timeout, snapshot export)
# ----------------------------------------------------------------------------------------------

def _human(day: str) -> str:
    d = date.fromisoformat(day)
    return f"{d:%b} {d.day}, {d.year}"


def _human_range(start: str, end: str) -> str:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return f"{a:%b} {a.day} to {_human(end)}" if a.year == b.year else f"{_human(start)} to {_human(end)}"


def rules_plan(question: str, as_of: date) -> AskPlan | None:
    """Keyword match for the four example questions (and close wordings). None when nothing matches."""
    text = re.sub(r"\s+", " ", question.lower().replace("’", "'"))
    cal = calendar_for(as_of)
    q_start, q_label = cal["this_quarter"]["start"], cal["this_quarter"]["label"]

    if "thank" in text or re.search(r"\bq[1-4] goal\b|helped us reach", text):
        end = as_of.isoformat()
        return AskPlan(
            interpretation=f"Donors who gave in {q_label} so far ({_human_range(q_start, end)}), "
                           f"biggest quarter total first, for a thank-you.",
            filter=AskFilter(gave_between=DateRange(start=q_start, end=end), sort="period_total"),
            intent=AskIntent(kind="thank_you", channel_hint="email"))

    if "monthly" in text and re.search(r"\blate\b|overdue|behind|missed", text):
        return AskPlan(
            interpretation="Monthly donors whose last gift is later than their usual monthly rhythm.",
            filter=AskFilter(cadence="monthly", overdue=True, sort="last_gift_oldest"),
            intent=AskIntent(kind="check_in", channel_hint="text"))

    if re.search(r"gone quiet|went quiet|stopped giving|lapsing|lapsed|quiet", text):
        return AskPlan(
            interpretation="Donors who are past their usual giving rhythm or missed their usual giving month, "
                           "highest priority first.",
            filter=AskFilter(overdue=True, sort="score"),
            intent=AskIntent(kind="re_engage"))

    if re.search(r"\b(big|major|large)\b", text) and re.search(r"call|contact|reach", text):
        return AskPlan(
            interpretation=f"Big donors with no outreach approved or sent since {q_label} began "
                           f"({_human(q_start)}). There is no call log yet, so approved outreach stands in for a call.",
            filter=AskFilter(tier=["big"], not_contacted_since=q_start, sort="score"),
            intent=AskIntent(kind="check_in"))

    return None


# ----------------------------------------------------------------------------------------------
# apply_filter: plain code over the database
# ----------------------------------------------------------------------------------------------

def cadence_of(why: dict | None) -> str | None:
    if not why or not why.get("gift_count"):
        return None
    if why["gift_count"] == 1:
        return "one_time"
    days = why.get("usual_cadence_days") or 0
    if days <= MONTHLY_MAX_DAYS:
        return "monthly"
    if days <= QUARTERLY_MAX_DAYS:
        return "quarterly"
    return "yearly"


def is_overdue(why: dict | None) -> bool:
    return bool(why) and bool(OVERDUE_REASONS & set(why.get("reasons") or []))


def _in_range(day: str, rng: DateRange | None) -> bool:
    return rng is None or ((rng.start is None or day >= rng.start) and (rng.end is None or day <= rng.end))


def apply_filter(conn: sqlite3.Connection, spec: AskFilter, as_of: date | None = None) -> list[dict]:
    """The donors that match, as GET /donors rows, in the requested order. Deterministic; reads only.

    Gifts after as_of are ignored, like score.py. Each row gains "ask": {period_total, period_gifts,
    last_gift_date} for the UI to show why it matched.
    """
    from service.routes_data import list_donors

    as_of_iso = (as_of or score.default_as_of()).isoformat()
    gifts: dict[int, list[tuple[str, float, str | None]]] = {}
    for g in conn.execute("SELECT donor_id, amount, gift_date, channel FROM gifts WHERE gift_date <= ?",
                          (as_of_iso,)):
        gifts.setdefault(g["donor_id"], []).append((g["gift_date"][:10], float(g["amount"]), g["channel"]))
    drafts: dict[int, int] = {}
    contacted: dict[int, list[str]] = {}    # approved or sent: a person acted on it, so it counts as contact
    for d in conn.execute("SELECT donor_id, status, created_at, approved_at FROM outreach_drafts "
                          "WHERE donor_id IS NOT NULL"):
        drafts[d["donor_id"]] = drafts.get(d["donor_id"], 0) + 1
        if d["status"] in CONTACT_STATUSES:
            contacted.setdefault(d["donor_id"], []).append((d["approved_at"] or d["created_at"] or "")[:10])

    channels = {c.strip().lower() for c in spec.channel or [] if c.strip()}
    out = []
    for row in list_donors(conn):
        why = row.get("why")
        mine = gifts.get(row["id"], [])
        window = [g for g in mine if _in_range(g[0], spec.gave_between)]
        last = max((g[0] for g in mine), default=None)
        amounts = [a for _, a, _ in window]
        total = sum(amounts)

        checks = [
            not spec.status or row.get("status") in spec.status,
            not spec.tier or row.get("tier") in spec.tier,
            spec.star is None or bool(row.get("is_star")) == spec.star,
            spec.donor_type is None or row.get("donor_type") == spec.donor_type,
            spec.gave_between is None or bool(window),
            spec.last_gift_before is None or (last is not None and last <= spec.last_gift_before),
            spec.last_gift_after is None or (last is not None and last >= spec.last_gift_after),
            spec.min_gift is None or (bool(amounts) and max(amounts) >= spec.min_gift),
            spec.max_gift is None or (bool(amounts) and max(amounts) <= spec.max_gift),
            spec.min_total is None or total >= spec.min_total,
            spec.max_total is None or total <= spec.max_total,
            not channels or any((c or "").lower() in channels for _, _, c in window),
            spec.cadence is None or cadence_of(why) == spec.cadence,
            spec.overdue is None or is_overdue(why) == spec.overdue,
            spec.has_draft is None or bool(drafts.get(row["id"])) == spec.has_draft,
            spec.not_contacted_since is None or not any(d >= spec.not_contacted_since
                                                        for d in contacted.get(row["id"], [])),
        ]
        if all(checks):
            out.append({**row, "ask": {"period_total": round(total, 2), "period_gifts": len(window),
                                       "last_gift_date": last}})

    sort = spec.sort or "score"
    keys = {
        "score": lambda r: (-(r.get("score") or 0), r["id"]),
        "period_total": lambda r: (-r["ask"]["period_total"], -(r.get("score") or 0), r["id"]),
        "last_gift_recent": lambda r: (-_ordinal(r["ask"]["last_gift_date"]), r["id"]),
        "last_gift_oldest": lambda r: (_ordinal(r["ask"]["last_gift_date"]), r["id"]),
        "lifetime": lambda r: (-((r.get("why") or {}).get("lifetime_total") or 0), r["id"]),
        "name": lambda r: (r["full_name"].lower(), r["id"]),
    }
    out.sort(key=keys[sort])
    if spec.limit is not None:
        out = out[:max(1, min(spec.limit, MAX_LIMIT))]
    return out


def _ordinal(day: str | None) -> int:
    return date.fromisoformat(day).toordinal() if day else 0


def snapshot_examples(conn: sqlite3.Connection, as_of: str | date | None) -> list[dict]:
    """export_snapshot's "ask_examples": the rules answer to every example question (no API call)."""
    day = date.fromisoformat(as_of) if isinstance(as_of, str) else (as_of or score.default_as_of())
    out = []
    for question in EXAMPLE_QUESTIONS:
        plan = rules_plan(question, day)
        assert plan is not None, f"rules_plan must answer the example {question!r}"
        out.append({"question": question, "interpretation": plan.interpretation,
                    "filter": plan.filter.model_dump(), "intent": plan.intent.model_dump(),
                    "donor_ids": [r["id"] for r in apply_filter(conn, plan.filter, day)],
                    "served_from": "rules"})
    return out
