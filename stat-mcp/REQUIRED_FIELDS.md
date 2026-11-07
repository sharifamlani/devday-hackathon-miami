# Required donor fields

This is the canonical output schema for every imported donor record. It applies whether a user uploads unstructured text, CSV, or JSON.

| Field | Output type | If missing | Notes |
| --- | --- | --- | --- |
| `id` | string | Generate a UUID | Preserve a supplied `id`, `donor_id`, or `record_id` unless it is blank/`NA`. |
| `first_name` | string | `""` | If only a full name is supplied, split at the first space. |
| `last_name` | string | `""` | If only one name token is supplied, this remains blank. |
| `email_address` | string | `""` | Accept `email` as a source alias. |
| `donation_amount` | decimal number or `null` | `null` | A missing, `NA`, or invalid amount is unknown; do not turn it into zero. |
| `phone_number` | string | `""` | Accept `phone` as a source alias. |
| `date_of_last_donation` | string | `""` | Accept `last_gift_date`, `last_donation_date`, or `last_gift`; ISO `YYYY-MM-DD` is preferred. |

The canonical keys are always present in the output. Empty strings are used for missing text values; JSON `null` is used for a missing donation amount. The parser treats blank strings, `NA`, `N/A`, `none`, `null`, `unknown`, `not provided`, and `not available` as missing values. If an ID is missing, it generates a UUID instead of using a blank value.

## Source field mappings

Common source names map to the canonical schema:

| Source field | Canonical field |
| --- | --- |
| `donor_id`, `record_id` | `id` |
| `name`, `donor`, `donor_name`, `full_name`, `constituent_name` | Split into `first_name` and `last_name` when those fields are absent |
| `email` | `email_address` |
| `phone` | `phone_number` |
| `gift_total`, `total_giving`, `lifetime_giving` | `donation_amount` |
| `last_gift_date`, `last_donation_date`, `last_gift` | `date_of_last_donation` |

The server also preserves recognized optional fields such as `contact_preference`, `organization`, `employer`, `giving_history`, `gift_count`, `engagement_notes`, `stated_interests`, `relationship_owner`, and `source`. Unknown source columns are ignored.

## Example normalized record

Input:

```text
Jordan Lee donated $250 on August 3, 2026. Email jordan@example.org.
```

Output required fields:

```json
{
  "id": "generated-uuid",
  "first_name": "Jordan",
  "last_name": "Lee",
  "email_address": "jordan@example.org",
  "donation_amount": 250.00,
  "phone_number": "",
  "date_of_last_donation": "2026-08-03"
}
```

The actual generated UUID differs per imported row. For unstructured text, extraction is model-assisted and may need staff correction; the server does not claim that every inferred parse is certain.
