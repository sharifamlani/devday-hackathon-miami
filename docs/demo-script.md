# Donor Desk: demo script

Challenge #2: duplicate donor records, and donors who quietly stop giving.
Judges score fit to "what solved looks like", originality, use of Codex and OpenAI, feasibility, and presentation (each /10).

**Run order:** the laptop is the demo surface (http://localhost:5173: service on :8000, web with
`VITE_DATA_MODE=local`). The Vercel link (https://devday-donor-desk.vercel.app) is a read-only preview of sample data,
and the backup if the laptop or network fails. Org: **The Miami Foundation**. Scope: **Givers only**.

This is a skeleton: each step names the screen and the one point to land. Timings get set at the rehearsal.

---

## The flow

Demo surface: **the laptop**, http://localhost:5173 (service on :8000, web with `VITE_DATA_MODE=local`). The Vercel
link is a read-only **preview** of sample data, not the demo. Scope: **Givers only**. Upload still sorts everyone into
Givers / Neighbors / Community, and the people page shows all three tabs (e.g. **Givers 40 · Neighbors 22 ·
Community 15**), but the demo stays on **Givers**.

Button and heading text below is what's on screen on main today, in **bold**.

1. **Empty start.** The app opens on the **Set up Donor Desk** dialog (**Step 1 of 3**) with nothing behind it: no
   people, gifts, tasks or context. "Nothing is preloaded."
2. **Step 1, "Drag in your files."** Drop the **8 input files** from `data/sample_inputs/` on **Drop your files here**
   (or click **Choose files**): `give_miami_day_export_2022-2025.xlsx`, `online_gifts_oct_nov_2026.xlsx`,
   `check_deposit_log_q3_2026.docx`, `donor_intake_forms_2026.docx`, `stock_and_daf_grants.docx`,
   `community_intake_forms_2026.docx`, `event_signin_sheet_nov1.xlsx`, `board_retreat_notes.md`. Not
   `answer_key.json` or `_README.md`. Under **Put them in** leave **Let the agent sort**, click **Import 8 files**
   (it reads **Importing…**), then **Continue**. (**Use the example files** loads the same eight with one click.)
3. **Step 2, "Tell us about your organization."** Type `miamifoundation.org` in the **Website** field (placeholder
   **yourorg.org**) and click **Continue**. Social URLs are saved, not fetched.
4. **Step 3, "Building your context."** It shows **Reading your website · m:ss**. "It reads the site and news and
   keeps dated, sourced facts: success stories, where the money goes, how the Foundation is doing." The heading
   becomes **Your desk is set up.** Click **Go to the dashboard** (if the site was slow or unreachable it says so and
   the button reads **Continue to the dashboard**).
5. **Dashboard (Overview).** Point at the glance links (**N gifts at risk**, **N possible duplicates**), **Plan
   today**, **Coming up** (the next events) and today's tasks in the sidebar. The rail: **Overview**, **Calendar**,
   **Tasks**, **CRM**, **Projects**, **Files & drafts**, **Live transcript**, **Open Ask sidebar**.
6. **Home chat agent.** In **Ask the agent…** type a request and click **Send**, or use a suggestion chip
   (**Who should I thank this week?**, **Plan next week**). The conversation shows the agent's tool steps. A step
   that changes something can be undone (**Undone**). Anything that sends, merges or deletes waits for a click.
7. **A task, worked by the agent.** Click a task in the sidebar. The dialog reads e.g. **TASK 1 OF 15 · CALL** with
   **Work on it with the agent**, **Call and transcribe**, **Draft email** and **Mark done**. Click **Work on it
   with the agent**: the chat shows e.g. **Work on this task: Call Hye-jin Park…**, then its steps (**Get task**, **Get
   person**, **Draft email**), and ends by asking **Mark done?**
8. **Story-first campaign.** In **Ask the agent…** type *"Draft a thank-you to Give Miami Day donors."* Open a
   draft: it cites a success story, a use-of-funds line and an org-health line, each with its source. Big donors
   and organizations need individual approval; nothing is sent from here.
9. **Enrich on a real organization.** The sample data is fictional, so add a real one: in **Ask the agent…** type
   *"Add the Knight Foundation as a contact."* It lands in **Givers**. Open **CRM** → **Find a donor**, search
   *Knight* (placeholder **Name, email or organization**), and click **Enrich profile** (it reads **Enriching…**):
   a dry run (nothing written) shows **Enrichment agent found (public web, review before saving):** with **Interest
   areas** (**civic engagement & local news, arts & culture, community development, economic mobility**) and
   **Facts**, each with its source link. Tick the ones to keep and click **Save to profile** (or **Discard**). The
   same panel is on the donor's profile under **ENRICHMENT**. "Nothing is saved until staff accept, and every tag shows where it came from."
10. **Calendar.** Rail → **Calendar**: the Foundation's upcoming events (Give Miami Day early giving Nov 14, the
    Give Miami 5K Nov 15, Give Miami Day Nov 19), each with **N drafts ready** for its audience. Click **Review** to
    open that event's drafts (pending approval; nothing sent).
11. **A call, transcribed.** On a task click **Call and transcribe**, or click the mic **Start live transcript**.
    The panel shows **Listening** and the words as they're spoken (**Pause** / **Resume**); **Try the demo call**
    plays a scripted call. Click **Generate summary**, or ask a question in **Ask about this call…**.
12. **Dictation.** **Open Ask sidebar** and use **Dictate** to speak a question instead of typing it (**Stop
    dictation** to finish; it needs the live service).
13. **Duplicates review.** On **Givers**, the yellow banner reads e.g. **9 possible duplicates found**; click
    **Review merges →** (or the home glance link **N possible duplicates**). Exact matches were already merged on
    upload; these are the close calls, one pair at a time in **We found this donor twice** with its reason badges.
    Pick the **Record to keep**, then **Merge ✓** (**Merging…**) or **Keep separate**. "Merge only
    after a person approves; the gift history moves to the kept record." On the donor, **Merge history** → **Undo
    merge** → **Confirm undo** puts both back. After the suggestions are approved the counts match the answer key:
    68 people (33 givers, 20 neighbors, 15 community) and 131 gifts.

> Not on screen yet (don't demo): the after-call **Apply** card (the backend proposes follow-ups from a call and
> writes them on Apply, but no screen shows it yet). Out of scope: the Neighbors / Community tabs.

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

- [ ] **Reset and warm up:** `python scripts/demo_reset.py --warm` (service stopped). It empties the db, uploads the 8
      files once to warm the cache, and empties the db again; the on-stage upload then replays fast and shows
      **10 possible duplicates**.
- [ ] Web on **http://localhost:5173 or :5174** (the service's CORS allows only these). Hard refresh.
- [ ] Say **"Give Miami Day donors"**, not "gala" (the sample data has Give Miami Day gifts, no gala).
- [ ] **Laptop live-mode env vars:** web `VITE_DATA_MODE=local`, `VITE_API_URL=http://localhost:8000`; service
      `.env` has `OPENAI_API_KEY`, the `OPENAI_MODEL_*` tiers, `GEMINI_API_KEY` (voice), `SCORE_AS_OF=2026-11-08`.
      Leave `EMAIL_SEND` off and `SMS_PROVIDER` unset unless a send is part of the demo; `SEND_ALLOWLIST` only
      team numbers.
- [ ] **Enrich only on the hand-added real org** (Knight Foundation). Fictional orgs correctly show "No public
      information found: this looks like a private or fictional organization."
- [ ] **Stay on the Givers tab** (scope); don't open Neighbors or Community.
- [ ] Mic permission granted in the browser; test the voice panel once.
- [ ] The Vercel preview open in a second tab (read-only sample data; the backup only).
- [ ] Browser zoom 110%, notifications off, a hotspot as Wi-Fi backup.

## Backup video
Record the same flow as a 3-minute screen capture once tonight's PRs (home, calendar, live Ask, made-up data) land, so it shows the final screens:
- **QuickTime → File → New Screen Recording** (or ⌘⇧5), at 1440×900 in the browser, with the voice-over from this script.
- Upload as an unlisted YouTube link or MP4 for the DeepStation submission (the demo video is optional but recommended).
