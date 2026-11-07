# service/

The donor service: one FastAPI app (`service/main.py`) on the OpenAI Agents SDK, reading local SQLite
(`data/donors.db`, gitignored). The web UI calls it on port 8000.

## Run

From the repo root, with the repo-root `.env` in place (key + model tiers, see `.env.example`):

```bash
uv pip install --python .venv/Scripts/python.exe -r service/requirements.txt
.venv/Scripts/python.exe -m service.db --rebuild          # seed 12 SAMPLE donors, score, dedupe
.venv/Scripts/python.exe -m uvicorn service.main:app --port 8000
```

`SCORE_AS_OF` defaults to `2026-11-08` (set in `service/config.py`); override it in `.env`.
CORS allows the Vite dev servers on `localhost:5173` and `localhost:5174`.

## Routes

| Route | What it does | Model call |
|---|---|---|
| `GET /health` | ok, model tier, key loaded, as-of date, db path, whether ingest is mounted | no |
| `GET /donors`, `GET /donors/{id}` | donors by score; one donor with gifts, score why, facts, drafts | no |
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
| `POST /agent/ping` | one Agents SDK call with structured output (`{ok, echo}`) | `OPENAI_MODEL_FAST` |
| `POST /ingest` | Carlos's `service/ingest/router.py`, mounted only when present | Carlos's agent |

Agent routes are capped at 90 s per model call with 2 retries, and 120 s per route. On a timeout they return
`504 {"error": "agent_timeout", "detail", ...}` with the cached result (`cached_draft`, `cached_icp` or
`cached_context`). A route whose lane hasn't landed yet returns `503 "... has not landed on this build yet"`.

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

`POST /context/refresh` ("Refresh now") runs one context + calendar pass (`service.refresh`) on the saved
organization's URLs and returns the change summary; a failure answers 200 with `state: "failed"` and keeps the
saved data. The same pass runs inside the service every day at `REFRESH_DAILY_AT` (e.g. `07:00`) when that is set.
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
