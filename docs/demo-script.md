# Donor Desk: 3-minute demo script

Challenge #2: duplicate donor records, and donors who quietly stop giving.
Judges score fit to "what solved looks like", originality, use of Codex and OpenAI, feasibility, and presentation (each /10).

**Run order:** the live app on the demo laptop (`VITE_DATA_MODE=local`, Python service running) is primary. The Vercel link (devday-donor-desk.vercel.app) is the backup if the laptop or network fails.

**Persona:** read [org] as Tidepath if the made-up-data PR merges, otherwise The Miami Foundation. Change nothing else.

---

## 0:00–0:20 · The problem (talking, no clicks)
> "Denise is [org]'s part-time fundraiser. Every month she spends five hours merging four gift lists: the online page, event tickets, the gala auction and mailed checks. The same person shows up as Rosa Delgado, Rosa M. Delgado and R. Delgado, so the totals are wrong. Worse, nobody notices when a December donor skips a year or a monthly card expires. Give Miami Day is in 11 days."

Screen: the landing page ("Less time on tasks. More time for people.").

## 0:20–0:50 · Messy lists in, duplicates found
1. Click **Upload donor data** (or **Import donors** in the inbox) and drop `event_tickets_messy.csv`.
2. **Match columns:** "It guessed every column. 'Donor Name', 'E-mail', 'Gift', 'Donation Date' and 'Source' are all mapped."
3. **Review:** "4 donors, 3 gifts, 1 blank row skipped, 3 possible duplicates. *Nothing is merged until a person approves it.*"

## 0:50–1:20 · One person, no history lost
1. The banner reads "possible duplicates found". Click **Review merges →**.
2. "Same email and phone, 95% match. Keep the record with four gifts." Click **Merge ✓**.
3. Open the donor: **5 gifts · $11,250**, so "the totals just corrected themselves."
4. Scroll to **Merge history**: "Merged María Delgado-Ruiz, with her emails kept." Click **Undo merge → Confirm**, then "Back to two records, exactly as they were." (Optionally merge again.)
> "That's the challenge minimum: duplicates merged only after staff approve, with no history lost."

## 1:20–1:45 · Nobody slips through
1. Rail → **Inbox** (`#/inbox`): "Ranked by who needs a call: recency, frequency, amount and the gap since their usual gift. Maria gave every Give Miami Day since 2022 and nothing yet this year. She's #1."
2. Point to the **late monthly / failed card** alert (gift alerts, #48): "A monthly gift that failed on Oct 10 shows up within days, not months."

## 1:45–2:15 · Ask your data (OpenAI Agents SDK)
1. Rail → **Ask**. Type: *"Who gave this quarter and hasn't been thanked yet?"*, using **Tab** to autocomplete an example.
2. "The model only *reads the question*. It turns it into the filters you see here, and our own records answer it. It can't write or send anything." Remove a filter chip to widen the results.
3. Optional: click **View trace** to show the Agents SDK run.
4. Click **Draft messages for these N**.

## 2:15–2:40 · Personal outreach, human-approved
1. **New campaign:** choose Email or Text → **Draft**. "One personal message per donor, in our voice, citing real facts from the record."
2. "The guardrail blocks any amount or date that isn't in the record. Big donors and organizations always need individual approval." Click **Approve all small-donor drafts**, then approve one big donor.
3. **Send to outbox (simulated)** → **Outbox**: "Logged, addresses masked. Nothing leaves this laptop in the demo."

## 2:40–2:55 · Plan the week
1. **Home:** targets card ("Q4: $50,050 of $150,000, Give Miami Day in 11 days") and **Recommended outreach**, with who to contact on which day and why.
2. **Calendar:** click **Plan for Tuesday** to add the donor to the day, next to events.

## 2:55–3:00 · Close
> "Four messy lists become one clean donor list, with every merge approved and undoable. Every late gift is found in time, and every message is reviewed by a person. Built with Codex and the OpenAI Agents SDK."

## Landing entry in the React app

Open the bare app URL to show “Less time on tasks. More time for people.” with “Your mission deserves more of your time.” underneath. “Try sample data” opens the donor workspace at `#/`, which is the home dashboard (today at a glance, outreach calendar, goal, recommended outreach). The Outreach inbox is at `#/inbox` (rail Inbox icon). Existing workspace deep links continue to open directly.

The upload controls sit inside a thin outlined CSV drop area. In local mode, “Upload donor data” opens the file chooser; selecting or dropping a CSV opens the confirmation dialog with its filename. In the hosted snapshot build it explains that uploads need the local donor service and offers the sample workspace. With `VITE_DATA_MODE=local`, the CSV form uses the existing `uploadFiles` client and offers the workspace after a successful import. Live ingest remains dependent on the team's ingest service; this design change adds no backend ingestion behavior.

## Questions judges may ask

**"Where's the AI?"**
- **Ask:** an OpenAI Agents SDK agent reads the question and returns a structured filter. It's read-only: no tools, and it never sees donor rows. Our own records answer the question, and the trace link shows the run.
- **Campaigns and outreach:** the agents draft one message per donor in the org's voice, citing only facts from the record and the org context.
- **Guardrail:** blocks any amount or date that isn't in the record.

**"Is that live?"**
- **On the laptop:** yes. The Python service and the agents run live, with nothing precomputed except a cache for repeat questions.
- **On the Vercel link:** it serves a snapshot of the same data. The example questions are precomputed; free-text Ask works once `OPENAI_API_KEY` is set in Vercel.
- **Messages:** go to a simulated outbox, so nothing leaves the laptop.

**"How do you know it's right?"**
- **Deterministic code** does the scoring, dedupe, merge and undo, targets, and Ask filtering, with 160+ backend tests and unit tests on the parsers and merge log.
- **Answer key:** the planted cases (three "Rosa Delgado"s, the lapsed Give Miami Day donor, the failed monthly gift) are checked against `data/sample_inputs/answer_key.json`.

**"What about real donors' data?"**
- Every person in the demo is fictional.
- Merges always need a named approver and can be undone.
- Big donors and organizations need individual approval before any message is sent.

---

## Pre-flight checklist (30 minutes before)
- [ ] Laptop: `python -m service.pipeline` pre-run; the service is up; `.env` has `OPENAI_API_KEY` and the model settings.
- [ ] Ask one free-text question live, to warm the cache and confirm the trace link works.
- [ ] Reset demo state: rebuild the database so Maria shows 4 gifts and the duplicate banner is visible.
- [ ] Have `event_tickets_messy.csv` on the desktop.
- [ ] Vercel backup open in a second tab (hard refresh).
- [ ] Browser zoom 110%, notifications off, Wi-Fi backup (hotspot).
- [ ] Codex: have one Codex session (the feature built with Codex) open to show for the "use of Codex" criterion.

## Backup video
Record the same flow as a 3-minute screen capture once tonight's PRs (home, calendar, live Ask, made-up data) land, so it shows the final screens:
- **QuickTime → File → New Screen Recording** (or ⌘⇧5), at 1440×900 in the browser, with the voice-over from this script.
- Upload as an unlisted YouTube link or MP4 for the DeepStation submission (the demo video is optional but recommended).
