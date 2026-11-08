# Donor Desk

**DevDay Exchange Community Hackathon: Miami (Nov 7–8, 2026) · Challenge #2: duplicate donor records, and donors
who quietly stop giving.**

Donor Desk is a fundraising workspace for a small nonprofit team, shown here as **The Miami Foundation**. Staff drop
in the messy files they already have (spreadsheets, Word tables, meeting notes). The app sorts people into three
tabs, finds duplicate records and late gifts, learns what the organization has been doing from its own website, and
drafts outreach that tells that story. A person approves every merge and every message.

- **Public snapshot (sample data, read-only):** https://devday-donor-desk.vercel.app
- **Full app:** runs on a laptop from an empty start (see [Run it](#run-it-on-a-laptop-from-an-empty-start)).

All people, gifts, emails and phone numbers in `data/sample_inputs/` are fictional.

---

## Problems → what Donor Desk does

From our call with a Miami Foundation staff member, plus the challenge brief.

| Problem | What the app does | Where |
|---|---|---|
| **Challenge #2: duplicates** | Exact matches (the same email, or the same name with nothing contradicting it) merge automatically on upload; a "!" marker so staff can review them (Keep / Split) is planned. Fuzzy matches are suggestions (6 of 6 planted groups found in the sample data): staff approve each merge, the gift history moves to the kept record, and every merge can be undone. | Givers → Review duplicates (`service/dedupe.py`) |
| **Challenge #2: late gifts** | Flags failed and late recurring gifts (a declined monthly card, a missed quarterly gift) before the donor lapses. A declined charge is never counted as money raised. | Home + gift alerts (`service/gift_alerts.py`) |
| **Who to contact first** | A deterministic score (recency, frequency, amount, and the gap since a donor's usual gift) ranks who to call. The model explains the score; it never computes it. | Home, Inbox (`service/score.py`) |
| **Context gets lost** | One record per person across all files. Voice capture: a mic button transcribes a call live; after the call an agent proposes follow-ups (a task, an RSVP, a pledge, a note) and **writes nothing until staff click Apply**. | Voice panel (`web/.../voice`), `service/after_call_agent.py` |
| **Staying on top of donors** | **Enrich** looks up an organization's public facts with sources and tags its interest areas from a fixed list of 17. Staff review before anything is saved. | Profile → Enrich (`service/interests.py`) |
| **The people served, not just donors** | Three tabs: **Givers** (gave), **Neighbors** (met, not yet either), **Community** (the people the nonprofit serves, analyzed only from what they reported; never sent a donation ask). | Upload sorts people into a tab or flags them for review |
| **Showing impact** | A **context store**: the agent reads the organization's website and news, keeps dated, sourced facts (success stories, how money is spent, how the organization is doing), newest first. Every campaign, thank-you and invite cites at least one of each, with sources shown. | Onboarding, `service/org_context.py` |
| **Events** | Upcoming events from the organization's own pages (each date checked on its source page), the right audience per event, and invites drafted ahead of time. | Calendar (`service/events_agent.py`) |
| **Ask your data** | Type a question ("who gave this quarter and hasn't been thanked?"); an agent turns it into the filters you see, and our own records answer it. It reads only the question, never donor rows. | Ask sidebar (`service/ask_agent.py`) |
| **Everything through one assistant** | A chat agent finds people, edits tasks and the calendar, drafts campaigns, and reports its tool steps. Sends, merges and deletes wait for a click, and writes can be undone. | `POST /chat`, `/chat/stream` (`service/chat_agent.py`); the sidebar switches from Ask to Chat once the chat panel lands |

## AI models

| Job | Model | Where |
|---|---|---|
| Agents (chat, outreach, campaigns, context, events, enrichment, after-call, Ask, ICP) | **OpenAI** via the **OpenAI Agents SDK** (`openai-agents`): `OPENAI_MODEL_DEFAULT = gpt-6.1-sol`. Tiers in `.env.example`: `gpt-6-astra` (flagship), `gpt-6.1-sol` (default), `gpt-6.1-terra` (efficient), `gpt-6-luna` (fast) | `service/*_agent.py` |
| Web research for context and events | Agents SDK hosted `WebSearchTool`; a fact is kept only if its URL is among the search's own results | `service/org_context.py`, `events_agent.py` |
| Context search | **OpenAI `text-embedding-3-small`** embeddings, ranked by cosine similarity × recency (90-day half-life) | `GET /context/search` |
| Reading uploaded files (ingest) | OpenAI via the Agents SDK: `OPENAI_MODEL_FAST`, else `OPENAI_MODEL_DEFAULT`, else `gpt-4.1-mini` when no tier is set | `service/ingest_adapter.py` |
| Call transcription | **Google `gemini-3.5-transcribe-live`** (live, while speaking) and **`gemini-3.5-transcribe`** (recorded file, with speaker labels) | `service/transcribe.py`, `routes_voice.py` |

Numbers are never computed by a model: scores, totals, quarters, duplicate matching and merge/undo are plain Python.
Model drafts pass a code check that rejects any amount or date that isn't in the record or a cited fact.

## Architecture

```text
web/        React + Vite CRM, built on Atomic CRM (MIT)
  │  VITE_DATA_MODE=local  → the Python service on :8000
  │  VITE_DATA_MODE=snapshot → web/public/snapshot.json (the read-only Vercel build)
  ▼
service/    FastAPI + SQLite (data/donors.db, gitignored)
            ingest adapter · dedupe · scoring · gift alerts · targets · tasks/calendar
            agents: chat, outreach, campaigns, context, events, enrichment, after-call, Ask, ICP
            voice: Gemini live/file transcription relayed server-side (the key never reaches the browser)
```

`stat-mcp/` is a separate FastMCP prototype (transaction import, person summaries, duplicate checks). It is **not**
connected to the main app; see `stat-mcp/AGENT_INTEGRATION.md`.

## Run it on a laptop from an empty start

Needs Python 3.12 and Node 20+. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` (and `GEMINI_API_KEY` for
voice). Never commit `.env`.

```bash
# 1. Service (from the repo root)
python -m pip install -r service/requirements.txt
python -m service.db --rebuild                         # empty database: schema only, no people, gifts or context
uvicorn service.main:app --host 127.0.0.1 --port 8000

# 2. Web (second terminal)
cd web
npm install
VITE_DATA_MODE=local VITE_API_URL=http://localhost:8000 npm run dev    # http://localhost:5173 (or 5174)
```

3. Open the app. First run is a three-step onboarding. **Step 1, "Drag in your files.":** drag in the 8 input files
   from `data/sample_inputs/` (`give_miami_day_export_2022-2025.xlsx`, `online_gifts_oct_nov_2026.xlsx`, `check_deposit_log_q3_2026.docx`, `donor_intake_forms_2026.docx`, `stock_and_daf_grants.docx`, `community_intake_forms_2026.docx`, `event_signin_sheet_nov1.xlsx`, `board_retreat_notes.md`; not `answer_key.json` or `_README.md`) and choose **Let the agent sort** (or
   a tab). Upload is the only source of data.
4. **Step 2, "Tell us about your organization.":** enter the website (`https://miamifoundation.org`). **Step 3,
   "Building your context.":** the context store fills.
5. Review the duplicate suggestions (9–10 right after upload). Once they're approved, the counts match
   `data/sample_inputs/answer_key.json`: 68 people (33 givers, 20 neighbors, 15 community) and 131 gifts.

Tests: `python -m pytest service/tests` (backend) and `cd web && npm run test:unit:app` (frontend).

Sending is a **dry run** by default: email goes out only with `EMAIL_SEND=on` and a Gmail token, texts only with
`SMS_PROVIDER` set, and a live send reaches only addresses in `SEND_ALLOWLIST`.

## Limits (named honestly)

- **Payout-change fraud hold is not built.** Flagging a change to a donor's or grantee's bank details for a second
  approval is designed but not implemented.
- **Social media is not read.** The context agent reads the website and news only. X, LinkedIn and Instagram URLs
  are saved on the profile but not fetched; official APIs need tokens we don't have.
- **Enrichment researches public organizations only.** Individuals are never looked up on the web, and the
  fictional sample organizations correctly return "no public information found"; the demo enriches a real
  organization added by hand.
- **The chat panel isn't in the web app yet.** The chat agent and its tools run in the service (`/chat`,
  `/chat/stream`); until the panel lands, the sidebar shows Ask.
- **Pending chat approvals live in memory.** Restarting the service drops a run waiting for approval (drafts already
  saved to a campaign are kept). After-call proposals are held in memory and a temp file until Apply.
- **Voice and dictation need the live service** and a `GEMINI_API_KEY`; the Vercel snapshot can't record.
- **The Vercel snapshot is read-only sample data.** Uploads, sends and live agent runs need the laptop service.
- **Live context facts are "search-cited":** their URLs come from the search's own results, but hosted search
  doesn't return page text, so the quote isn't checked against the page itself.
- **Free-tier Gemini audio may be used by Google** to improve its products; real donor calls need the paid tier.

## Credits and licenses

- **Built with Claude Code and Codex;** the OpenAI API and the OpenAI Agents SDK run throughout the product.
- **Atomic CRM** by Marmelab (MIT): the web app's base (`web/LICENSE.md`).
- **assistant-stream** from the assistant-ui project (MIT): streams the chat agent's replies (`service/chat_stream.py`).
- **Google live-api-web-console** (Apache-2.0): the browser audio recorder files in `web/.../voice/audio/` and
  `web/.../providers/local/audio/` (license kept alongside them).
- Donor Desk itself is released under the **MIT License** (`LICENSE`).

See [plan.md](plan.md) for the full build plan and [ROADMAP.md](ROADMAP.md) for status.
