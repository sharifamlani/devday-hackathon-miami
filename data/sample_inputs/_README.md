# Sample inputs (messy donor files)

**Everything here is fictional.** Every person, organization, email (`example.com` / `example.org` only),
phone (`305-555-01xx`), and amount is invented. Organization names were web-checked and match no real organization.

A staffer uploads these into the CRM; the ingest agent extracts donors and gifts into the CRM fields.
"As of" date for scoring: **2026-11-08**.

| File | What it is |
|---|---|
| `give_miami_day_export_2022-2025.xlsx` | Messy export, 3 sheets (`GMD gifts`, `Online`, `Major gifts 22-25`). Different headers per sheet, mixed date and amount formats, blank cells, title rows, stray totals rows. The `Online` sheet also holds 2026 rows. |
| `board_retreat_notes.md` | Prose meeting notes: pledges (not gifts), a corporate gift, a changed email, nickname Bob/Robert, "hasn't given yet this year". |
| `check_deposit_log_q3_2026.docx` | Word table of Q3 2026 checks plus handwritten-style notes. |
| `donor_intake_forms_2026.docx` | Four filled intake forms. |
| `stock_and_daf_grants.docx` | Memo table of stock gifts and DAF grants. |
| `answer_key.json` | Ground truth: canonical donors with every source row, 6 duplicate groups, every gift (donor, file, location), the one double-recorded gift, totals, planted scoring cases, expected top-3 lapsing donors. |

The answer key is for tests only. The ingest agent must never read it.

## Regenerate

```bash
.venv/Scripts/python.exe scripts/make_sample_inputs.py
```

Needs `openpyxl` and `python-docx`. Fixed seed, so the content is identical on every run (docx/xlsx
bytes differ only by zip timestamps). The script ends with a verification pass that reopens every file
and checks the answer-key totals, duplicate groups, email domains, and phone numbers.
