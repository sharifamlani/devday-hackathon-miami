# Imported transaction and person fields

Import is transaction-first. Each explicit gift is retained as its own event row. Person summaries are derived by grouping transaction rows; they are projections for analysis and UI display, not the primary import record. A person/contact without a gift is represented as a `profile` event with no amount or date. The system never inserts a fake $0 gift.

## Source event fields

| Field | Type | Missing behavior | Purpose |
|---|---|---|---|
| `transaction_id` | string | Generate UUID | Unique imported event ID. |
| `source_transaction_id` | string or null | Null | Preserve source gift/payment identifier when provided. |
| `person_source_id` | string or null | Null | Preserve a source-supplied ID; do not fabricate one. |
| `person_group_key` | string or null | Generate a unique key per structured row; narrative extraction may reuse a local key for events clearly referring to the same person in that source | Internal, source-scoped key used to build a person projection. |
| `contact_type` | `donor`, `beneficiary`, or `contact` | `contact` unless an explicit gift establishes donor role | Person classification for the app's group tag. |
| `transaction_type` | string | `profile` | `gift` for a documented gift; `profile`, `contact`, or `benefit` for non-gift events. |
| `amount` | decimal or null | Null | The amount of this gift only, never a lifetime total. |
| `transaction_date` | ISO date or string or null | Null | The event date; unambiguous dates normalize to `YYYY-MM-DD`, ambiguous dates are preserved. |
| `channel` | string or null | Null | Event, payment channel, or source program when provided. |
| `fund_type` | string or null | Null | Fund designation when provided. |
| `source_name` | string | Uploaded filename | Trace back to the input file. |
| `source_location` | string or null | Row, sheet/row, or table/row when available | Trace back to the location inside the source. |
| `notes` | string or null | Null | Explicit supporting details from the source. |

Person identity fields repeat on each event row: `first_name`, `last_name`, `organization`, `email_address`, and `phone_number`. Blank values remain blank; the ingestion layer does not fill them from guesses.

## Derived person summary

`project_people()` groups only events sharing a source-scoped `person_group_key` or source ID. It does not group by matching email, phone, or name; those remain duplicate evidence for human review. It creates one summary per group with `contact_type`, contact details, total of explicit gift amounts, count of explicit gift events, the latest unambiguous gift date, and a concise gift-history string. If there are no explicit gifts, donation amount and gift count are null and the last-gift date is blank.

For the main SQLite adapter, map the summary to `donors` and each `transaction_type == "gift"` event to a distinct `gifts` row. Preserve `source_name` and `source_location` in `source_row`. Do not create database gift rows for `profile`, `contact`, or `benefit` events. A gift with an unknown date must be reviewed because the current SQLite `gifts.gift_date` contract requires a date.

## Supported files

`.csv`, `.json`, `.xlsx` (all worksheets), `.docx` (paragraphs and tables), `.md` / `.markdown` (prose and Markdown tables), and `.txt`. Binary files are passed to MCP as base64. Structured rows are parsed directly; narrative prose is sent to the Agents SDK for transaction extraction. Combined documents with both tables and prose may yield overlapping events, so import warnings flag them for human review before writing to SQLite.
