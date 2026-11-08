# Sample inputs (messy files for all three CRM tabs)

**Everything here is fictional.** Every person, organization, email (`example.com` / `example.org` only),
phone (`305-555-01xx`), and amount is invented. Organization names were web-checked and match no real organization.

These synthetic files are fixtures for the planned CRM ingest workflow and parser experiments. The upload flow is intended to classify people into **Givers** (donors and their gifts), **Neighbors** (people met, not yet either), and **Community** (people the nonprofit helps). **The app starts empty.** Nothing is preloaded: every record comes from uploading these files (the landing page's "Try sample data", or drag them in). The files in this folder are the only source of example data. The separate `stat-mcp` prototype reads the same formats; see `../../stat-mcp/AGENT_INTEGRATION.md` for its contract.
"As of" date for scoring: **2026-11-08**.

| File | What it is |
|---|---|
| `give_miami_day_export_2022-2025.xlsx` | Messy export, 3 sheets (`GMD gifts`, `Online`, `Major gifts 22-25`). Different headers per sheet, mixed date and amount formats, blank cells, title rows, stray totals rows. The `Online` sheet also holds 2026 rows. |
| `online_gifts_oct_nov_2026.xlsx` | The Q4 money: 18 online / wire / DAF-portal gifts dated Oct 9 to Nov 7, 2026, $98,065 in all, so the Q4 gauge reads about 66% of the $150k sample goal instead of 0.5%. Two sheets (`October`, `Nov 1-7`) with different headers, a title block, mixed date and amount formats, an inconsistent Phone column and Subtotal rows that are not gifts. Donors are existing ones, written the way the other files write them (`Liz F.`, `S. Achterberg`, `Whitaker Family Charitable Fund`, `Bellweather Pines Family Fdn.`) so dedupe links them. |
| `board_retreat_notes.md` | Prose meeting notes: pledges (not gifts), a corporate gift, a changed email, nickname Bob/Robert, "hasn't given yet this year". |
| `check_deposit_log_q3_2026.docx` | Word table of Q3 2026 checks plus handwritten-style notes. |
| `donor_intake_forms_2026.docx` | Four filled intake forms. |
| `stock_and_daf_grants.docx` | Memo table of stock gifts and DAF grants. |
| `community_intake_forms_2026.docx` | 14 self-reported intake forms for people the nonprofit serves (contact preference, household size, age range or birth year, gender, ZIP/neighborhood, language, programs, dog/pet). Some fields are blank or "prefer not to say" on purpose; 2 people have no email or phone. |
| `event_signin_sheet_nov1.xlsx` | Messy 27-row sign-in sheet from the Nov 1 open house: mixed name spellings and contact formats, an "Interested in" column (volunteering, giving, pet adoption, newsletter) and a "Brought a dog?" column. 19 new Neighbors, 2 who signed twice, plus 3 existing donors and 3 existing community members (cross-file duplicates). |
| `answer_key.json` | Ground truth: canonical donors with every source row, 6 duplicate groups, every gift (donor, file, location), the one double-recorded gift, totals, planted scoring cases, expected top-3 lapsing donors. Also, per person, `tab` (giver / neighbor / community), `ambiguous` + `candidate_tabs` + `reason`, `has_dog` where stated; `tab_counts`, `community_members`, `neighbors`, `cross_file_duplicates`, and `puppy_outreach` (target set). |

## Three tabs: what the key expects

- **Counts:** giver 33, neighbor 20, community 15 (68 people). Each canonical person is counted once, under the tab in `tab`.
- **Ambiguous (flag for review), planted in `board_retreat_notes.md`:** Dolores Quinones (pantry client who put $25 in the donation jar: community or giver?), Marcus Bell (pantry client who says he will give $10 a month from December: community or giver?), Gabriela Rincon (met at a mixer, "probably will give", mother is a client: neighbor or giver?). The $25 is not in the donor gift totals.
- **Puppy outreach:** target = anyone whose dog is stated in any file and who has an email or phone (15 people across all three tabs). A blank or "no" in "Brought a dog?" is not evidence of no dog. `puppy_outreach` also lists people with a dog but no contact info and people interested in pet adoption.
- **Gift alerts (`gift_alerts_expected`):** Hye-jin Park (failed: monthly $40, the 2026-10-10 charge is a row in the Online sheet marked "card declined" (status declined), no later good gift), Teodoro Salinas (late: quarterly, missed Jul and Oct), Walter Brandt (late: yearly, due 2026-03-18), Veloria Bay Foundation (late: yearly, due 2026-04-15), Rafael Quintero (failed = missed payment: monthly $50, missed Sep 2026, resumed Oct). A declined charge is NOT a gift: it is excluded from gifts, totals and lifetime giving (`failed_gifts_not_counted`). Totals now: 131 unique gifts, $1,367,535 (the 113 gifts and $1,269,470 of the other files, plus the 18 gifts and $98,065 in `online_gifts_oct_nov_2026.xlsx`). None of the new gifts touch a planted case: Maria Delgado, Teodoro Salinas, Walter Brandt, Veloria Bay, Hye-jin Park, Rafael Quintero and the top-3 lapsing list are unchanged.
- **Quarters (`gifts_by_quarter`, `totals.q4_2026_total` / `q4_2026_gifts`):** calendar quarters, summed from `gifts`. 2026-Q4 is 23 gifts, $98,815 ($750 from the older files plus $98,065 from the new sheet).
- **Cross-file duplicates:** `cross_file_duplicates` lists who reappears on the sign-in sheet under a different spelling.

The answer key is for tests and fixture verification only. Do not pass it to an importer or extraction agent as source material.

## Regenerate

```bash
.venv/Scripts/python.exe scripts/make_sample_inputs.py
```

Needs `openpyxl` and `python-docx`. Fixed seed, so the content is identical on every run (docx/xlsx
bytes differ only by zip timestamps; `online_gifts_oct_nov_2026.xlsx` has its own random stream, so adding it moved nothing in the other files). The script ends with a verification pass that reopens every file
and checks the answer-key totals, duplicate groups, email domains, and phone numbers.
