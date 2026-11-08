# service/

The donor service: one FastAPI app (`service/main.py`) on the OpenAI Agents SDK, reading local SQLite
(`data/donors.db`, gitignored). The web UI calls it on port 8000.

## Run

From the repo root, with the repo-root `.env` in place (key + model tiers, see `.env.example`):

```bash
uv pip install --python .venv/Scripts/python.exe -r service/requirements.txt
.venv/Scripts/python.exe -m service.db --rebuild          # empty database (schema only); load data by uploading data/sample_inputs/
.venv/Scripts/python.exe -m uvicorn service.main:app --port 8000
```

`SCORE_AS_OF` defaults to `2026-11-08` (set in `service/config.py`); override it in `.env`.
CORS allows the Vite dev servers on `localhost:5173` and `localhost:5174`.

## Routes

| Route | What it does | Model call |
|---|---|---|
| `GET /health` | ok, model tier, key loaded, as-of date, db path, whether ingest is mounted | no |
| `GET /donors`, `GET /donors/{id}` | donors by score; one donor with gifts, score why, facts, drafts, and its 5 newest `call_notes` | no |
| `GET /duplicates`, `POST /duplicates/{id}/merge`, `/dismiss` | duplicate review | no |
| `POST /score/run` | rescore everyone (`?as_of=YYYY-MM-DD`) | no |
| `POST /enrich/{id}` | research agent: sourced public facts, saved to `research_facts`. Cached orgs return instantly; individuals return `[]` by policy. `?refresh=true` researches live | `OPENAI_MODEL_DEFAULT` + web search |
| `POST /outreach/{id}` | outreach agent: email + call script, saved to `outreach_drafts`; returns `draft_id` | `OPENAI_MODEL_DEFAULT` |
| `POST /drafts/{id}/approve` | body `{"approved_by": "Name", "body": "optional edit"}` → status `approved` | no |
| `POST /icp/run` | ideal donor profile + matching organization prospects, saved via `db.save_icp_run`. Cached unless `?refresh=true` | `OPENAI_MODEL_DEFAULT` + web search |
| `GET /icp`, `GET /prospects`, `GET /prospects/{id}`, `POST /prospects/{id}/dismiss` | ICP + prospect reads (`routes_data.py`) | no |
| `POST /prospects/{id}/outreach` | first-touch draft for a prospect, always status `draft` | `OPENAI_MODEL_DEFAULT` |
| `POST /context/run` | context agent reads the org's website + social profiles, saved via `db.save_context`. Cached unless `"refresh": true` | `OPENAI_MODEL_DEFAULT` |
| `GET /org-profile`, `GET /context` | the saved local context dataset (`routes_data.py`; `?source=`) | no |
| `POST /calls/summarize` | live transcript summary, see [Call notes](#call-notes) | `OPENAI_MODEL_FAST`, else rules |
| `POST /calls`, `GET /calls` | save a call note (upsert by id); list them newest first | no |
| `POST /agent/ping` | one Agents SDK call with structured output (`{ok, echo}`) | `OPENAI_MODEL_FAST` |
| `POST /ingest` | Carlos's `service/ingest/router.py`, mounted only when present | Carlos's agent |

Agent routes are capped at 90 s per model call with 2 retries, and 120 s per route. On a timeout they return
`504 {"error": "agent_timeout", "detail", ...}` with the cached result (`cached_draft`, `cached_icp` or
`cached_context`). A route whose lane hasn't landed yet returns `503 "... has not landed on this build yet"`.

## Call notes

`service/routes_calls.py`, for the live transcript pane (`web/.../voice/callNotes.ts` has the same shapes in camelCase):

| Route | Body / query | Returns |
|---|---|---|
| `POST /calls/summarize` | `{title, transcript: [{speaker: "you" \| "them", name, text, at}], notes, donor_id?}` | `{summary: [str], next_steps: [str], source: "model" \| "rules", detail}` |
| `POST /calls` | `{id?, title, created_at?, duration_sec, destinations: [{kind: "donor" \| "group" \| "project", id, label}], transcript, notes, summary, next_steps}` | the saved row (`id` is generated when omitted; `created_at` is stored as UTC ISO) |
| `GET /calls` | `?donor_id=&project_id=&limit=` (default 50) | saved rows, newest call first |

With a key, the summary is one Agents SDK run on `OPENAI_MODEL_FAST` with a strict `CallSummary` output, no
tools, capped at `CALLS_DEADLINE_S` (20 s). It sees only the transcript, the notes and the donor's own record, and
plain code rejects any dollar amount or date it wrote that those don't hold. Without a key, on a timeout, a model
error or a rejected answer, a deterministic rules summary answers (who spoke, how long, their key lines quoted, the
lines where someone committed to a follow-up), with the reason in `detail`. Tracing omits the transcript text, and
the service never logs it. A donor destination must be an existing donor (else 422). Notes live in the `call_notes`
table; the Vercel snapshot never includes them (`donor_details[*].call_notes` is always `[]`).

## Onboarding screens (plan.md §15)

| Screen | Calls | Request | Response |
|---|---|---|---|
| **1. Upload your data** | `POST /ingest` | `multipart/form-data`, one or more files (`.xlsx`, `.md`, `.docx`) | Carlos's ingest summary; donors land in `donors.db`, then scoring + duplicate suggestions run |
| **2. Tell us where you are online** | `POST /context/run` (synchronous, ≤ 30 s) | JSON `{"website", "x_url", "linkedin_url", "instagram_url", "refresh": false}`; any URL may be null | see below |
| after either | `GET /donors`, `GET /org-profile`, `GET /context` | — | the data the next screens show |

`POST /context/run` reads the **website only**; social URLs are stored in `org_profile` and never fetched.
It returns:

```json
{"state": "done" | "failed", "cached": false, "detail": null, "started_at": "...", "finished_at": "...",
 "sources": {"website":   {"status": "done" | "blocked" | "failed" | "not provided", "facts": 3, "detail": null},
             "news":      {"status": "...", "facts": 0, "detail": null},
             "x":         {"status": "saved, not connected" | "not provided", "facts": 0, "detail": "<url>"},
             "linkedin":  {...}, "instagram": {...}},
 "profile": {...}, "facts": [{"source", "url", "posted_at", "fact", "quote", "priority", "captured_at"}],
 "saved": {"org_profile_id", "context_ids", "replaced_sources"}}
```

If the read takes longer than `CONTEXT_DEADLINE_S` (30 s) or fails, it still answers 200 with `state: "failed"`,
`cached: true`, the reason in `detail`, and the saved (or committed `service/context_cache.json`) context, so the
screen can move on. A blocked site shows as `blocked`; it is never faked. Uploads need `python-multipart`
(in `requirements.txt`).

## Chat and sending (plan.md §17)

`POST /chat {message, history, context: {screen, person_id?, event_id?}}` returns
`{reply, steps: [{tool, args, summary, status}], pending_batch: {id, title, items} | null}`. The agent can look
things up and **draft** batches; it has no tool that sends. A batch is a campaign (`routes_campaigns.py`).

`POST /send {batch_id, approved_by, items: [{id, approve}] | null}` is the only way anything goes out. With
`items: null` it sends only items that need no individual approval and have no flags; organizations, star and big
donors go only when listed with `approve: true`. Delivery goes through `outbound.deliver`:

| Setting (`.env`) | Effect |
|---|---|
| nothing set (default) | dry run: outbox rows say `queued (dry run)`, nothing leaves the laptop |
| `SMS_PROVIDER=twilio` + `TWILIO_*` | texts go through Twilio (missing credentials → dry run) |
| `EMAIL_SEND=on` + `GMAIL_TOKEN_PATH` | email goes through the Gmail API (token file with client_id, client_secret, refresh_token; never committed) |

`GET /outbox` is the single send log.

## Daily refresh

`POST /context/refresh` ("Refresh now") starts one context + calendar pass (`service.refresh`) on the saved
organization's URLs in the background and returns at once with `status: "refreshing"`; a second click while it runs
returns the same job. `GET /context/refresh` reports `{status: idle | refreshing | done | failed, started_at,
finished_at, detail, changes}`; a pass still running after `REFRESH_DEADLINE_S` (150 s) says so in `detail`. A failed
source never wipes saved data. The same pass runs inside the service every day at `REFRESH_DAILY_AT` (e.g. `07:00`) when that is set.
If the laptop isn't always serving, schedule it with Windows Task Scheduler instead (from the repo root path):

```bat
schtasks /Create /SC DAILY /ST 07:00 /TN "DonorDesk context refresh" /TR "cmd /c cd /d \"C:\path\to\repo\" && .venv\Scripts\python.exe -m service.refresh --daily"
```

## Smoke

```bash
curl localhost:8000/health
curl localhost:8000/donors/1
curl -X POST localhost:8000/enrich/11
curl -X POST localhost:8000/outreach/1
curl -X POST localhost:8000/drafts/1/approve -H 'Content-Type: application/json' -d '{"approved_by":"Sharif"}'
curl -X POST localhost:8000/context/run -H 'Content-Type: application/json' -d '{"website":"https://miamifoundation.org"}'
```

## Files

| File | Owner | Role |
|---|---|---|
| `main.py`, `config.py`, `requirements.txt` | service frame | app shell, `.env` loading, deps |
| `routes_data.py`, `db.py`, `score.py`, `dedupe.py` | data lane | SQLite schema, scoring, data routes |
| `enrich_agent.py` | enrich lane | research agent |
| `outreach_agent.py`, `org_context.py` | outreach lane | drafting agent, context agent |
| `icp_agent.py` | ICP lane | ideal donor profile + prospect finder |
| `ingest/` | Carlos | file ingest (never edited by other lanes) |
