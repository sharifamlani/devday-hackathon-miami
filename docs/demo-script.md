# Donor Desk: demo script

Challenge #2: duplicate donor records, and donors who quietly stop giving.
Judges score fit to "what solved looks like", originality, use of Codex and OpenAI, feasibility, and presentation (each /10).

**Run order:** the live app on the demo laptop is primary (service on :8000, web with `VITE_DATA_MODE=local`). The
Vercel snapshot (https://devday-donor-desk.vercel.app, sample data, read-only) is the backup if the laptop or network
fails. Org: **The Miami Foundation**.

This is a skeleton: each step names the screen and the one point to land. Timings get set at the rehearsal.

---

## The flow

1. **Empty start.** The app opens with nothing in it: no people, gifts, tasks or context. "Nothing is preloaded."
   First run opens the three-step onboarding.
2. **Onboarding step 1: "Drag in your files."** Drag in the **8 input files** from `data/sample_inputs/`: `give_miami_day_export_2022-2025.xlsx`, `online_gifts_oct_nov_2026.xlsx`, `check_deposit_log_q3_2026.docx`, `donor_intake_forms_2026.docx`, `stock_and_daf_grants.docx`, `community_intake_forms_2026.docx`, `event_signin_sheet_nov1.xlsx`, `board_retreat_notes.md`.
   Not `answer_key.json` or `_README.md`. Choose where they go: **Let the agent sort** (or Givers / Neighbors /
   Community), then **Continue**. "Spreadsheets, Word tables and meeting notes; anyone unclear is flagged for review,
   never guessed." The landing page's **Import donor data** dialog is the same upload outside onboarding.
3. **Onboarding step 2: "Tell us about your organization."** Enter the website (required):
   `https://miamifoundation.org`. Social URLs are saved, not fetched.
4. **Onboarding step 3: "Building your context."** Watch the per-source status. "It reads the site and news and keeps
   dated, sourced facts: success stories, where the money goes, how the Foundation is doing. Newest first."
5. **Dashboard.** Home: money raised by quarter, gift alerts (a declined monthly card, late recurring gifts), tasks
   for today, the next event, who to call first and why.
6. **Agent chat edits.** Ask the assistant to change something (add a task, move a calendar item); point at the tool
   steps it shows and the Undo. Anything that sends, merges or deletes waits for a click.
7. **Story-first campaign.** Say "Draft a thank-you to Give Miami Day donors." Open a draft: it cites a success
   story, a use-of-funds line and an org-health line, each with its source; the review screen lists the sources. Big
   donors and organizations need individual approval.
8. **Enrich (on a real organization).** The sample data is fictional, so add a real one on stage: tell the agent
   *"add the Knight Foundation as a contact"*. **John S. and James L. Knight Foundation** lands in **Givers** as a new
   contact with no gifts. Open it and click **Enrich profile**: a dry run (nothing is written) proposes sourced
   interest tags (**civic engagement & local news, arts & culture, community development, economic mobility**, each
   traced to a source), from cache in seconds. Tick the ones to keep and click **Save to profile**, which writes only
   the ticked items. "Nothing is saved until staff accept, and every tag shows where it came from."
9. **Call + transcript + after-call Apply.** Start a call from the voice panel; the transcript appears live. At the
   end, the agent proposes follow-ups (a task to send the card-update link, a $50/month pledge, an RSVP to the event
   on the 21st, notes), each quoting the call. Click Apply; show the task on the list, then Undo it.
10. **Duplicates review.** Exact matches (the same email, or the same name with nothing contradicting it) were
    already merged automatically on upload. Givers → Review duplicates (9–10 suggestions right after upload) holds
    the fuzzy ones: the same person written three ways. "Merge only after a person approves; the gift history moves to the kept record; Undo puts both back."
    After the suggestions are approved the counts match the answer key: 68 people (33 givers, 20 neighbors,
    15 community) and 131 gifts.

### The call (Sharif writes)

> _Sharif writes this section: who he calls, what is said, and the follow-ups it should produce._

### Close

> "Messy lists in, one clean record per person, every merge approved and undoable, every late gift caught in time,
> and every message tells the Foundation's real story, approved by a person. Built on the OpenAI Agents SDK."

---

## Questions judges may ask

**"Where's the AI?"**
- **Ask:** an OpenAI Agents SDK agent reads the question and returns a structured filter. It's read-only: no tools, and it never sees donor rows. Our own records answer the question, and the trace link shows the run.
- **Campaigns and outreach:** the agents draft one message per donor in the org's voice. Every draft cites a success story, a use-of-funds line and an org-health line from the context store, with sources; a missing kind becomes a note to staff, never an invention.
- **After a call:** an agent proposes follow-ups from the transcript (task, RSVP, pledge, note), each quoting the call; nothing is written until staff click Apply.
- **Guardrail:** blocks any amount or date that isn't in the record.

**"Is that live?"**
- **On the laptop:** yes. The Python service and the agents run live, with nothing precomputed except a cache for repeat questions.
- **On the Vercel link:** it serves a snapshot of the same data. The example questions are precomputed; free-text Ask works once `OPENAI_API_KEY` is set in Vercel.
- **Messages:** sending is a dry run unless email/SMS are switched on, and a live send reaches only allowlisted addresses.

**"How do you know it's right?"**
- **Deterministic code** does the scoring, dedupe, merge and undo, targets, and Ask filtering, with 400+ backend tests and unit tests on the parsers and merge log.
- **Answer key:** the planted cases (three "Rosa Delgado"s, the lapsed Give Miami Day donor, the failed monthly gift) are checked against `data/sample_inputs/answer_key.json`.

**"What about real donors' data?"**
- Every person in the demo is fictional.
- Merges always need a named approver and can be undone.
- Big donors and organizations need individual approval before any message is sent.

---

## Demo checklist (30 minutes before)

- [ ] **One warm-up upload first,** then reset and upload again for the demo: the duplicate cards read 9 on a cold
      first run and 10 after a warm-up.
- [ ] Web on **http://localhost:5173 or :5174** (the service's CORS allows only these). Hard refresh.
- [ ] Say **"Give Miami Day donors"**, not "gala" (the sample data has Give Miami Day gifts, no gala).
- [ ] **Laptop live-mode env vars:** web `VITE_DATA_MODE=local`, `VITE_API_URL=http://localhost:8000`; service
      `.env` has `OPENAI_API_KEY`, the `OPENAI_MODEL_*` tiers, `GEMINI_API_KEY` (voice), `SCORE_AS_OF=2026-11-08`.
      Leave `EMAIL_SEND` off and `SMS_PROVIDER` unset unless a send is part of the demo; `SEND_ALLOWLIST` only
      team numbers.
- [ ] Reset: `python -m service.db --rebuild` (empty), then the warm-up upload, then rebuild again.
- [ ] **Enrich only on the hand-added real org** (Knight Foundation). Fictional orgs correctly show "No public
      information found" (the profile panel may word it "No public facts found for this donor").
- [ ] Mic permission granted in the browser; test the voice panel once.
- [ ] Vercel backup open in a second tab.
- [ ] Browser zoom 110%, notifications off, a hotspot as Wi-Fi backup.

## Backup video
Record the same flow as a 3-minute screen capture once tonight's PRs (home, calendar, live Ask, made-up data) land, so it shows the final screens:
- **QuickTime → File → New Screen Recording** (or ⌘⇧5), at 1440×900 in the browser, with the voice-over from this script.
- Upload as an unlisted YouTube link or MP4 for the DeepStation submission (the demo video is optional but recommended).
