# Assignment: Agent Phone, the agent service frame

From the lead ("Ideas" session), Sat Nov 7. Delivered as a file because cross-session messages to this
session are held (different permission mode).

**Context:** a donor fundraising tool, demoed as The Miami Foundation's philanthropy team. A Python service
on the OpenAI Agents SDK runs on Sharif's laptop with local SQLite (no Supabase). Plan: `plan.md` §2
(features), §13 (data contract), §14 (team). Keys and model tiers are in the repo-root `.env`
(`OPENAI_MODEL_DEFAULT` etc.). There's no `temperature`, and the SDK imports as `agents`; see
`docs/hackathon-kit/playbooks/openai-integration.md`. Never name a folder or file `agents`.

**Setup first:** all sessions share one folder, so make your own worktree:
`git fetch origin && git worktree add "../dd-service" -b feat/service origin/main`, then work only in
`../dd-service`.

**Owns:** `service/main.py` (FastAPI app shell that mounts routers), `service/config.py` (loads `.env`),
`service/requirements.txt`, `service/__init__.py`. Do not modify anything else.
- Data lane is done (PR #8): `from service.routes_data import router as data_router; app.include_router(data_router)`.
  PR #8 already adds `service/__init__.py` (empty). Don't recreate it; rebase on main if needed.
  `service/requirements.txt` (yours) must include: `openai-agents`, `python-dotenv`, `fastapi`, `uvicorn`,
  `httpx`, `pytest`.
- Carlos writes `service/ingest/router.py` (you mount it; **never edit `service/ingest/`**).
- Enrich is done (PR #5): `from service.enrich_agent import enrich_donor, save_facts, Fact`.
  `enrich_donor` blocks (`Runner.run_sync`), so call it via `run_in_threadpool`. Wire it to `POST /enrich/{donor_id}`.
- Outreach (devday-hackathon-86) exposes `draft_outreach(...)`. Wire it to `POST /outreach/{donor_id}`.
- Stub any import that doesn't exist yet so the app runs.

**Task:** a runnable service frame: FastAPI app, CORS for the Vite dev server, `/health`, router mounting,
Agents SDK wiring with a tiny test agent that returns structured output, and the run command documented
in `service/README.md`.

**Done when:** `uvicorn service.main:app --port 8000` starts; `curl localhost:8000/health` returns ok; a
test endpoint shows one real Agents SDK call returning structured JSON.

**Return to the lead:** run command, curl outputs, commit SHAs, PR link. Push `feat/service`, open a PR to
`main`, **do not merge, never push to `main`**.
