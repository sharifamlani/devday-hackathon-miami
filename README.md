# Donor Desk

**DevDay Exchange Community Hackathon: Miami (Nov 7–8, 2026) · Challenge #2: duplicate donor records, and donors
who quietly stop giving.**

Donor Desk is a fundraising workspace for a small nonprofit team, shown here as **The Miami Foundation**. Staff drop
in the messy files they already have (spreadsheets, Word tables, meeting notes). The app builds one record per
donor, finds duplicates and late gifts, learns what the organization has been doing from its own website, and an
agent on the home screen does the follow-up work. A person approves every merge, send and call.

- **Public preview (sample data, read-only):** https://devday-donor-desk.vercel.app
- **Full app:** runs on a laptop from an empty start (see [Run it](#run-it-on-a-laptop-from-an-empty-start)).

The records in `data/sample_inputs/` are fictional. The current `demo-data/` fixtures use public technology-philanthropy names with fabricated gift and contact details for demonstration.

**Scope: givers.** The demo, the checks and the answer key are about donors. Uploads also sort people into
**Neighbors** and **Community** tabs, and the agent never sends a Community member a donation ask, but we built no
features for those two tabs beyond that.

## Challenge #2, answered

- **Duplicate donor records.** Fuzzy matches are only *suggestions*: a person approves each merge (**Merge ✓** or
  **Keep separate**), the gift history moves to the kept record, and **Undo merge** reverses it. Exact matches (the
  same email, or the same name with nothing contradicting it) merge on upload, and each gets a **"!"** marker so
  staff can **Keep merged** or **Split back**.
- **Donors who quietly stop giving.** Plain-Python gift alerts flag a failed charge (a declined card) or a regular
  giver past their usual date; each becomes a call task on Home ("Call Hye-jin Park"), and Home's attention list
  orders them failed → late → new. A declined charge is never counted as money raised.

---

## What's in the app (on-screen names)

| Feature | What it does | Where |
|---|---|---|
| **Demo journey** | The bare app URL opens the landing page. **Get started** opens onboarding: upload/structure files → confirm the organization → research context → populated dashboard. Landing upload/sample shortcuts are removed; direct workspace hash routes remain available. | `web/.../landing/KindredLanding.tsx`, `web/.../onboarding/`, `service/main.py` |
| **Onboarding** (3 steps) | **"Drag in your files."** → **"Tell us about your organization."** → **"Building your context."** → the dashboard. Step 1 has **Import demo files** for the current three-file set in one action, then shows the ingest receipt and a preview of structured records. The organization name and website are editable and prefilled for The Miami Foundation. | `web/.../onboarding/`, `service/ingest_adapter.py`, `service/main.py` |
| **Duplicates, with approval** | Fuzzy matches are suggestions: **Review merges →** opens "We found this donor twice", with **Merge ✓** or **Keep separate**. The gift history moves to the kept record; **Merge history → Undo merge** reverses it. | `web/.../contacts/DuplicateMerge.tsx`, `service/dedupe.py` |
| **Automatic merges, reviewable** | Exact matches (same email, or the same name with nothing contradicting it) merge on upload and get a **"!"** marker: "Merged automatically, review", then **Keep merged** or **Split back**. | `web/.../contacts/AutoMergeFlag.tsx` |
| **Home chat agent** | **"Ask the agent…"**: finds people, edits tasks and the calendar, drafts email and texts, plans event outreach, applies after-call actions, and shows each tool step. Writes have **Undo**. Sends, calls, merges and deletes wait on an approval card (**Send / Don't send**, **Call / Not now**, **Approve / Decline**). Sends are a **dry run** unless keys are set (below). "Who should I call today?" answers in the order of Home's attention list (failed → late → new, then lapsing) with each giver's saved next step. | `web/.../home/HomeChat.tsx`, `service/chat_agent.py` (`get_call_list`) |
| **Click a task → the agent works it** | Clicking a task on Home hands it to the agent ("Handed to the agent: …"). Late and failed gifts become tasks such as "Call Hye-jin Park". | `web/.../home/HomePage.tsx`, `service/tasks.py`, `service/gift_alerts.py` |
| **Enrich → Save to profile** | **Enrich profile** looks up an organization's public facts with sources and tags its interest areas; staff choose **Save to profile** or **Discard**. Identity rule: the name plus one more fact (city, state or website) must match, otherwise "More than one organization matched this name, so nothing was suggested." | `web/.../contacts/ResearchPanel.tsx`, `service/enrich_agent.py` |
| **Calendar events, with invites** | **Calendar** shows the Foundation's events (read from its own website, each date checked on its source page) next to your tasks. Each event has an **Audience** and a **Sample invite**; **Review** drafts the batch, and nothing goes out without approval. | `web/.../calendar/`, `service/events_agent.py`, `service/event_outreach.py` |
| **After-call card** | After a call, "Agent · from your call with {name}" proposes a task, an RSVP, a pledge, a context note or an interest tag. Nothing is written until **Apply selected**. | `web/.../voice/AfterCallCard.tsx`, `service/after_call_agent.py` |
| **Dictation and live transcript** | **Dictate** in the home composer and the Ask prompt turns speech into the message ("Listening… speak, then pause."; a blocked mic says so at once); the **Live transcript** button in the header transcribes a conversation as it happens. | `web/.../voice/`, `service/transcribe.py` |
| **Phone calls** (off by default) | **Call from my phone** rings your cell first, then the donor, who hears a recording notice before the call connects ("Hello. This call is recorded for our notes."). Florida requires every party's consent to record. Needs `PHONE_CALLS=on` and reaches only numbers on `SEND_ALLOWLIST`. | `web/.../contacts/CallNotesPanel.tsx`, `service/phone.py` |
| **Ask** | The Ask sidebar turns a question into the filters you see; our own records answer it. "Read-only: the AI never writes records, sends messages, or sees donor details." | `web/.../ask/`, `service/ask_agent.py` |
| **Keyboard shortcuts** (Home) | **Alt+C** Calendar, **Alt+T** Tasks, **Alt+M** CRM, **Ctrl+I** Impact, **Alt+V** dictation; **Esc** closes the open panel. | `web/.../home/useWorkspaceHotkeys.ts` |
| **Who to contact first** | A deterministic score (recency, frequency, amount, and the gap since a donor's usual gift) ranks who to call. The model explains the score; it never computes it. | `service/score.py` |

### Public preview vs the laptop demo

- **Vercel preview** (`VITE_DATA_MODE=snapshot`): a read-only export of sample data with a **Sample data** badge.
  Uploads, the agent, sends, calls, dictation, Enrich and merge review are off there ("Cached sample: nothing is
  ever sent."). Its hosted Ask answers the example questions from the export.
- **Laptop demo** (`VITE_DATA_MODE=local`): the full app against the Python service, starting empty.

## AI models

| Job | Model | Where |
|---|---|---|
| Agents: home chat, outreach, campaigns, context, events and invites, enrichment, after-call, ICP | **OpenAI** via the **OpenAI Agents SDK** (`openai-agents`): `OPENAI_MODEL_DEFAULT`, **`gpt-6.1-sol`** in `.env.example` | `service/chat_agent.py`, `outreach_agent.py`, `campaign_agent.py`, `org_context.py`, `events_agent.py`, `enrich_agent.py`, `after_call_agent.py`, `icp_agent.py` |
| Reading uploaded files (ingest), Ask, call summaries | OpenAI via the Agents SDK: `OPENAI_MODEL_FAST`, **`gpt-6-luna`** in `.env.example` (ingest falls back to `OPENAI_MODEL_DEFAULT`, then `gpt-4.1-mini`) | `service/ingest_adapter.py`, `routes_ask.py`, `routes_calls.py` |
| Hosted Ask on the Vercel preview (opt-in, off by default) | OpenAI Agents SDK in a Vercel Function: `OPENAI_MODEL_FAST`, else `OPENAI_MODEL_DEFAULT` | `web/api/ask.ts` |
| Web research for context, events and enrichment | Agents SDK hosted `WebSearchTool`; a fact is kept only if its URL is among the search's own results | `service/org_context.py`, `events_agent.py`, `enrich_agent.py` |
| Context search | **OpenAI `text-embedding-3-small`** embeddings, ranked by cosine similarity × recency (90-day half-life) | `service/org_context.py` (`GET /context/search`) |
| Voice (live transcript, dictation, call notes) | **Google `gemini-3.5-transcribe-live`** (live) and **`gemini-3.5-transcribe`** (recorded file, with speaker labels) | `service/transcribe.py`, `routes_voice.py` |

Numbers are never computed by a model: scores, totals, quarters, duplicate matching and merge/undo are plain Python.
Model drafts pass a code check that rejects any amount or date that isn't in the record or a cited fact.

## Architecture

```text
web/        React + Vite CRM, built on Atomic CRM (MIT)
  │  VITE_DATA_MODE=local    → the Python service on :8000
  │  VITE_DATA_MODE=snapshot → web/public/snapshot.json (the read-only Vercel preview)
  ▼
service/    FastAPI + SQLite (data/donors.db, gitignored), bound to 127.0.0.1
            ingest adapter · dedupe + automatic merges · scoring · gift alerts · tasks/calendar
            agents: chat, outreach, campaigns, context, events, enrichment, after-call, Ask, ICP
            voice: Gemini live/file transcription relayed server-side (the key never reaches the browser)
```

`stat-mcp/` is a separate FastMCP prototype (transaction import, person summaries, duplicate checks). It is **not**
connected to the main app; see `stat-mcp/AGENT_INTEGRATION.md`.

## Run it on a laptop from an empty start

Tested with Python 3.12.13 and Node 22.23 on Windows 10 (the run-from-empty below). Copy `.env.example` to `.env` and set `OPENAI_API_KEY` (and `GEMINI_API_KEY` for
voice). Never commit `.env`.

```bash
# 1. Empty database + warm upload cache (service stopped; ends with an EMPTY db)
python -m pip install -r service/requirements.txt
python -m playwright install chromium
python scripts/demo_reset.py --warm

# 2. Service (from the repo root)
uvicorn service.main:app --host 127.0.0.1 --port 8000

# 3. Web (second terminal)
cd web
npm ci
VITE_DATA_MODE=local VITE_API_URL=http://localhost:8000 npm run dev    # http://localhost:5173
```

On Windows (PowerShell or cmd), put the two `VITE_` lines in `web/.env.local` instead (copy `web/.env.example` and
set `VITE_DATA_MODE=local`), then run `npm run dev`. The service accepts the browser from `localhost:5173`/`5174`;
add others with `CORS_ORIGINS` in `.env`.

4. Open the app at `http://localhost:5173`. The landing page is the entry point; choose **Get started**. In **Step 1, "Drag in your files.":** click **Import demo files** to load the current three-file set from `web/public/demo-data/` (`team-call-list.csv`, `tech-philanthropist-gifts.csv`, `tech-philanthropist-profiles.txt`) and submit it in one action. You can also select or drop compatible files into the onboarding step. The receipt shows tab counts and possible duplicates; expand **Preview structured records** to inspect normalized people and giving history.
5. **Step 2:** confirm or edit the organization name and website (prefilled as The Miami Foundation and `miamifoundation.org`) and **Continue**. **Step 3** researches the selected organization and fills the context store; use the receipt and dashboard values from the current run.
6. The separate original fixture set in `data/sample_inputs/` can still be checked against its answer key with `python scripts/demo_reset.py --check`. That command applies to the original 8-file fixture set, not the current `demo-data/` onboarding set. It approves every suggested
   duplicate on a copy of the database and compares people, gifts and alerts with
   `data/sample_inputs/answer_key.json`: 68 people (33 givers, 20 neighbors, 15 community) and 131 gifts. Exit 0 =
   all PASS (5 gift alerts expected). The files are read by a model, so a fresh upload can land one person off
   (see Limits).

`demo_reset.py` with no flag backs up `data/donors.db` and resets it to empty; it refuses while the service answers
on `--port` (default 8000).

Tests: `python -m pytest service/tests` (backend) and `cd web && npm run test:unit:app` (frontend).

Sending is a **dry run** by default: email goes out only with `EMAIL_SEND=on` and a Gmail token, texts only with
`SMS_PROVIDER` set, and a live send reaches only addresses in `SEND_ALLOWLIST`.

## Limits (named honestly)

- **Nothing is really sent by default.** Email, texts and campaign sends are dry runs unless `EMAIL_SEND=on` (with a
  Gmail token) or `SMS_PROVIDER` is set, and even then only addresses on `SEND_ALLOWLIST` are reached.
- **No real calls by default.** `PHONE_CALLS` is off in `.env.example`; with it off, the agent says so instead of
  showing a Call card.
- **Reading the files is a model step, so counts can vary by one.** Sorting and matching people from the messy
  sample files is done by an LLM; a fresh, uncached upload can come out one person over or under the answer key
  (gift totals and duplicate matching are plain Python). `scripts/demo_reset.py --warm` caches the reading so the
  stage upload is repeatable.
- **Payout-change fraud hold is not built.** Flagging a change to a donor's or grantee's bank details for a second
  approval is designed but not implemented.
- **Social media is not read.** Social links are "Saved for later; the agent doesn't read them yet." Official X,
  LinkedIn and Instagram APIs need tokens we don't have; the reader in `service/social_context.py` isn't wired in.
- **The public tunnel is off by default.** The service listens on 127.0.0.1 and phone calls need no webhooks.
  `python scripts/public_tunnel.py on --port 8000` (the service's port; the script defaults to 8001) with
  `PUBLIC_MODE=1` lets the Vercel app reach the laptop
  (`docs/public-tunnel.md`): then only an allow-list of read routes plus chat and Ask are served, contact details
  are masked, the agent is read-only, every send stays simulated, and model routes are rate-limited.
- **Enrichment researches public organizations only.** Individuals are never looked up on the web, and the
  fictional sample organizations correctly return "no public information found"; the demo enriches a real
  organization added by hand.
- **Pending agent approvals live in memory.** Restarting the service drops a run waiting for approval (drafts already
  saved to a campaign are kept). After-call proposals are held in memory and a temp file until applied.
- **Voice and dictation need the live service** and a `GEMINI_API_KEY`; the Vercel preview can't record.
- **Live context facts are "search-cited":** their URLs come from the search's own results, but hosted search
  doesn't return page text, so the quote isn't checked against the page itself.
- **Free-tier Gemini audio may be used by Google** to improve its products; real donor calls need the paid tier.
- **Phone calls (Twilio) run from the laptop only.** Our Twilio account is a **trial**: it reaches only verified
  numbers and plays a trial message on each call. A donor calling back reaches your cell directly, outside the CRM.
  Calls shown with a personal number as caller ID can get a lower carrier rating ("Spam Likely" on some phones).
  Restarting the service mid-call loses that call's transcript (the call itself still completes).

## Credits and licenses

- **Built with Claude Code and Codex;** the OpenAI API and the OpenAI Agents SDK run throughout the product.
- **Atomic CRM** by Marmelab (MIT): the web app's base (`web/LICENSE.md`).
- **assistant-stream** from the assistant-ui project (MIT): streams the chat agent's replies (`service/chat_stream.py`).
- **Google live-api-web-console** (Apache-2.0): the browser audio recorder files in `web/.../voice/audio/` and
  `web/.../providers/local/audio/` (license kept alongside them).
- Donor Desk itself is released under the **MIT License** (`LICENSE`).

See [plan.md](plan.md) for the full build plan and [ROADMAP.md](ROADMAP.md) for status.
