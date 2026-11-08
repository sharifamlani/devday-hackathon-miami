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

Button and heading text below is what's on screen on main today, in **bold**. Counts are from the laptop run; the
Vercel preview shows slightly different numbers (10 duplicates, 19 tasks). Don't read numbers off the preview.

1. **Empty start.** The app opens on the setup dialog (**Donor Desk · Step 1 of 3**) with nothing behind it: no
   people, gifts, tasks or context. "Nothing is preloaded." **Never reload the page during setup** (steps 1–4): with
   people already uploaded, a reload skips the website and context steps (fix in progress).
2. **Step 1, "Drag in your files."** Drop the **8 input files** from `data/sample_inputs/` on **Drop your files here**
   (or click **Choose files**): `give_miami_day_export_2022-2025.xlsx`, `online_gifts_oct_nov_2026.xlsx`,
   `check_deposit_log_q3_2026.docx`, `donor_intake_forms_2026.docx`, `stock_and_daf_grants.docx`,
   `community_intake_forms_2026.docx`, `event_signin_sheet_nov1.xlsx`, `board_retreat_notes.md`. Not
   `answer_key.json` or `_README.md`. Under **Put them in** leave **Let the agent sort**, click **Import 8 files**
   (it reads **Importing…**, about 10 s on a warm cache). **Import finished: 77 people · 131 gifts (+1 declined charge
   on record) from 8 files**, then **40 Givers · 22 Neighbors · 15 Community** and **9 possible duplicates to
   review**. Click **Continue**. (**Use the example files** loads the same eight with one click.)
3. **Step 2, "Tell us about your organization."** Type `miamifoundation.org` in the **Website** field and click
   **Continue**. Social links are saved, not read.
4. **Step 3, "Building your context."** It shows **Reading your website · m:ss** (about 30 s). "It reads the site and
   news and keeps dated, sourced facts: success stories, where the money goes, how the Foundation is doing." The
   heading becomes **Your desk is set up.** with e.g. **15 facts found about your organization** (website + news).
   Click **Go to the dashboard** (if the site was slow it says so, the button reads **Continue to the dashboard**,
   and the reading finishes in the background).
5. **Dashboard (home).** A card titled **Your desk is ready.** asks "Want a one-minute tour of where things are?" (or, while the read is
   still running, "We're still reading your website. Want a one-minute tour while it finishes?"): click **Not now**. Point at:
   - the **Q4 2026 outreach** gauge (**66%**, **$98.8k** raised of $150k, **Sample goal**);
   - the week strip (**November · Nov 8 – 14**) and the agenda under it: **Today · Sunday, Nov 8** "9 reviews · 5 calls
     · 3 preps · 1 email", Thu 12 **Prep list: Give Miami Day**, Sat 14 **Give Miami Day — Early Giving opens**, Sun 15
     **The Give Miami 5K** (8:00 AM) and the Post-Race Festival (8:30 AM), Thu 19 **Give Miami Day**. "The agent found
     these on the Foundation's site during setup and made the prep tasks.";
   - **Tasks (18)**, grouped: **Donor outreach (6)** (failed cards, late gifts, a new donor), **Donor records (9)**
     (possible duplicates), **Preparation (3)**. Clicking a task opens it for the agent (step 7);
   - the **CRM** tile: **Find a donor**, **Open database**, and the donors needing attention with their badges
     (**Card failed**, **Late**, **New**);
   - **Files & drafts** (campaigns and invites the agents drafted);
   - the chat (**Ask the agent…**) with its chips (an **Enrich …** chip naming one donor, e.g. **Enrich Desmond Achebe-Wells**; it varies by
     upload), **Who's late on a usual gift?**,
     **Plan next week**).
   **Open database** and the calendar's **↗** (**Open full calendar**) open a panel beside the chat. The icon rail on
   the left holds **Live transcript** and **Open Ask sidebar**.
6. **Home chat agent.** Click the chip **Plan next week** (about 10 s; **Thinking…** shows meanwhile). The conversation
   shows the agent's tool steps (**Get events**, **Get calendar**, **Get tasks**, **Get alerts**), then **Next week:
   November 9–15** with priorities, and "This is a proposed plan; I haven't changed your calendar." A step that changes
   something can be undone (**Undo**). Anything that sends, merges or deletes waits for a click.
7. **A task, worked by the agent.** In **Tasks** click **Call Hye-jin Park**. The dialog reads e.g. **TASK 2 OF 18 ·
   CALL** with **Work on it with the agent**, **Call and transcribe**, **Draft email** and **Mark done**. Click **Work
   on it with the agent** (about 20 s): the chat shows **Work on this task: Call Hye-jin Park…**, then its steps (**Get
   task**, **Get person**, **Draft email**), a re-engagement draft about her declined October gift (pending approval),
   and ends by asking **Mark done?**
8. **Story-first campaign.** In **Ask the agent…** type *"Draft a thank-you to donors who gave in the last 90 days."*
   (about 25 s): **25 thank-you email drafts are ready for review … Nothing has been sent**, with the organizations that
   need individual approval listed by name. Each draft cites a Foundation fact with its source (e.g. Give Miami Day's
   2025 record, linked to the Foundation's year in review). The campaign appears in **Files & drafts** as **Campaign:
   Thank you · Email · 25 donors**. (Use *"Give Miami Day donors"* again once the fix for uploaded Give Miami Day gifts
   merges: today that wording finds 0 donors. A campaign row doesn't open from Files & drafts yet: show a draft's
   citation on the calendar's sample invite in step 10.)
9. **Enrich on a real organization.** The sample data is fictional, so add a real one: in **Ask the agent…** type
   *"Add the Knight Foundation as a contact."* (about 5 s): **added organization John S. and James L. Knight Foundation**,
   with **Undo**. In the **CRM** tile click **Find a donor**, search *Knight* (placeholder **Name, email or
   organization**), open **John S. and James L. Knight Foundation** (Giver · No gifts yet) and click **Enrich profile**
   (it reads **Enriching…**): a dry run (nothing written) shows **Enrichment agent found (public web, review before
   saving):** with **Interest areas** (**Civic Engagement & Local News, Arts & Culture, Community Development,
   Economic Mobility**) and **Facts**, each with its **[src]** link, plus a public contact that's shown, not saved.
   Click **Save to profile** (or **Close**). "Nothing is saved until staff accept, and every tag shows where it came
   from."
10. **Calendar.** On the dashboard click **Open full calendar** (or the **↗** on the week strip). Under **Calendar** ("The
    Foundation's events and your tasks, side by side.") sit the chip **Context updated today …** and **Refresh now**
    (re-reads the site, news and events; it shows **Refreshing…** until the pass is done). Filter pills
    **Fundraising**, **Stewardship**, **Events**, **Community outreach**, **Tasks**; **Today** / **Back** / **Next**
    over **November 2026**. The events the agent found at setup: Sat 14 **Give Miami Day — Early Giving opens**,
    Sun 15 **The Give Miami 5K** (8:00) and **The Give Miami 5K Post-Race Festival, a Party with a Purpose!** (8:30),
    Thu 19 **Give Miami Day**, plus the prep task Thu 12 **Prep list: Give Miami Day**. Click an event: its panel
    shows the audience counts, a **Sample invite (N drafts ready)** citing a Foundation fact with its source, and the
    event's **Source** link (invites are written in the background about a minute after setup; drafts only). Don't
    click **Review** yet: it re-plans for up to a minute (**Planning…**) before showing the batch (fix in progress).
11. **A call, transcribed.** On a task click **Call and transcribe**, or click **Live transcript** in the rail: the panel
    opens on **Listening** with **Demo call**, **Generate summary** and **Pause**. **Demo call** plays a scripted call
    with Rosa (about 10 s). Click **Generate summary** (about 4 s): the summary and **Suggested next steps** (text her a
    card-update link, sign her up for the beach cleanup), or ask a question in **Ask about this call**.
12. **Dictation.** **Open Ask sidebar** and use **Dictate** to speak a question instead of typing it (**Stop
    dictation** to finish; it needs the live service and a microphone: test it before going on stage).
13. **Duplicates review.** Click **Open database**: on **Givers** the banner reads **9 possible duplicates found**;
    click **Review merges →**. Exact matches were already merged on upload; these are the close calls, one pair at a
    time in **We found this donor twice** with its reason badges (e.g. **similar name + same phone**, **90% match**,
    **8 more after this one**). Pick the record to keep (**✓ Keep** / **Merge in**), then **Merge ✓** (**Merging…**) or
    **Keep separate**. "Merge only after a person approves; the gift history moves to the kept record." On the donor,
    **Merge history** → **Undo merge** → **Confirm undo** puts both back. After the suggestions are approved the
    counts match the answer key: 68 people (33 givers, 20 neighbors, 15 community) and 131 gifts.

> Not on screen yet (don't demo): the after-call **Apply** card (the backend proposes follow-ups from a call and
> writes them on Apply, but no screen shows it yet). Out of scope: the Neighbors / Community tabs.

### If it's slow (what to say)

Timings are from the Nov 8 dress rehearsal on the laptop (warm cache). Every agent step shows **Thinking…** while it works.

| Step | Can vary because | If it's slow or off, say |
|---|---|---|
| 4 Building your context (~30 s) | the site read runs close to its 30 s limit; the event search sometimes finds 3 of the 4 events at first | "It keeps reading in the background; the rest lands in a minute." Click **Continue to the dashboard**. |
| 6 / 7 agent replies (10–20 s) | live model calls | "It's pulling the task, the donor's record and drafting; every step it takes shows here." |
| 8 campaign (~25 s) | 25 live drafts | "Twenty-five personal drafts, each citing a real Foundation story. Nothing is sent without approval." |
| 9 Enrich | fast while the research cache holds Knight; otherwise a live web search | "It's reading the public web; every tag will carry its source." |
| 10 Review | re-plans for up to a minute (fix in progress) | Skip it: "The invites for this audience are already drafted, pending approval." |
| 12 Dictation | needs a mic and the live service | Type the question instead. |
| 13 duplicates | fixed by the warm cache | "Nine close calls" (not ten). |

If the laptop or network fails, switch to the Vercel preview tab (read-only sample data) and say so.

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
      **9 possible duplicates**.
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
