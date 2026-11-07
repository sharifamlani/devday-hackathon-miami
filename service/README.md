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
| `POST /agent/ping` | one Agents SDK call with structured output (`{ok, echo}`) | `OPENAI_MODEL_FAST` |
| `/ingest...` | Carlos's `service/ingest/router.py`, mounted only when present | — |

## Smoke

```bash
curl localhost:8000/health
curl localhost:8000/donors/1
curl -X POST localhost:8000/enrich/11
curl -X POST localhost:8000/outreach/1
curl -X POST localhost:8000/drafts/1/approve -H 'Content-Type: application/json' -d '{"approved_by":"Sharif"}'
```

## Files

| File | Owner | Role |
|---|---|---|
| `main.py`, `config.py`, `requirements.txt` | service frame | app shell, `.env` loading, deps |
| `routes_data.py`, `db.py`, `score.py`, `dedupe.py` | data lane | SQLite schema, scoring, data routes |
| `enrich_agent.py` | enrich lane | research agent |
| `outreach_agent.py`, `org_context.py` | outreach lane | drafting agent |
| `ingest/` | Carlos | CSV ingest (never edited by other lanes) |
