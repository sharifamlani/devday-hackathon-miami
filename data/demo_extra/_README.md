# demo_extra

Fictional demo data for the live "Add data" moment. Every name, email (`@example.org`) and phone (`305-555-01xx`)
is made up. Not part of `data/sample_inputs/`, so the onboarding sample load never picks it up.

## nov15_5k_signin.csv

Sign-in sheet from "The Give Miami 5K" on 2026-11-15. Six rows, each with a 5K registration gift:

- Five new people (Valentina Ospina, Andre Boudreaux, Mei-Lin Zhao, Tomas Quintero, Hannah Goldfarb) who match nobody
  in the 8 sample files.
- One near-match for the duplicates story: **Walt Brandt** (new email, same phone as the existing **Walter Brandt**).
  Ingest keeps him as a separate account and adds one pending duplicate suggestion.

Measured on a scratch db loaded with the 8 sample files: donors 77 to 83, gifts 132 to 138, pending duplicates 9 to 10.
The results tile reads "6 Accounts recognized" (the five plus Walt).

Upload it once per demo database; a second upload would add the same people again.
