# Sample inputs (messy files for all three CRM tabs)

**Everything here is fictional.** Every person, organization, email (`example.com` / `example.org` only),
phone (`305-555-01xx`), and amount is invented. Organization names were web-checked and match no real organization.

A staffer uploads these into the CRM; the ingest agent extracts people into the three tabs: **Givers** (donors and their gifts), **Neighbors** (people met, not yet either), and **Community** (people the nonprofit helps).
"As of" date for scoring: **2026-11-08**.

| File | What it is |
|---|---|
| `give_miami_day_export_2022-2025.xlsx` | Messy export, 3 sheets (`GMD gifts`, `Online`, `Major gifts 22-25`). Different headers per sheet, mixed date and amount formats, blank cells, title rows, stray totals rows. The `Online` sheet also holds 2026 rows. |
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
- **Cross-file duplicates:** `cross_file_duplicates` lists who reappears on the sign-in sheet under a different spelling.

The answer key is for tests only. The ingest agent must never read it.

## Regenerate

```bash
.venv/Scripts/python.exe scripts/make_sample_inputs.py
```

Needs `openpyxl` and `python-docx`. Fixed seed, so the content is identical on every run (docx/xlsx
bytes differ only by zip timestamps). The script ends with a verification pass that reopens every file
and checks the answer-key totals, duplicate groups, email domains, and phone numbers.
