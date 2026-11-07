"""Regenerate the deterministic, fictional multi-source donor workload."""

import csv
import json
from pathlib import Path


ROOT = Path(__file__).parent / "sample-data"
FIRST = ["Avery", "Blake", "Cameron", "Dakota", "Emerson", "Finley", "Gray", "Harper", "Indigo", "Jules", "Kai", "Logan"]
LAST = ["Adams", "Bennett", "Carter", "Diaz", "Ellis", "Foster", "Garcia", "Hayes", "Ibrahim", "Jones"]
INTERESTS = ["after-school tutoring", "adult literacy", "neighborhood library", "youth arts", "career mentoring", "family learning"]
CHANNELS = ["online", "gala", "mail", "monthly giving", "workplace match"]


def donor(i: int) -> dict[str, object]:
    first, last = FIRST[i % len(FIRST)], LAST[(i * 7) % len(LAST)]
    name = f"{first} {last}"
    gifts = [35 + ((i * 37 + n * 29) % 466) for n in range(1, 2 + (i % 5))]
    return {
        "donor_id": f"SYN-{i + 1:04d}",
        "name": name,
        "email": f"{first.lower()}.{last.lower()}{i + 1}@example.org",
        "phone": f"+1-305-555-{1000 + i:04d}",
        "gift_total": sum(gifts),
        "gift_count": len(gifts),
        "last_gift_date": f"202{3 + i % 4}-{1 + (i * 3) % 12:02d}-{1 + (i * 11) % 27:02d}",
        "giving_history": "; ".join(f"${amount} via {CHANNELS[(i + n) % len(CHANNELS)]}" for n, amount in enumerate(gifts)),
        "stated_interests": INTERESTS[i % len(INTERESTS)] if i % 7 != 0 else None,
        "engagement_notes": None,
        "relationship_owner": f"{FIRST[(i + 3) % len(FIRST)]} {LAST[(i + 2) % len(LAST)]}" if i % 4 != 0 else None,
    }


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    people = [donor(i) for i in range(120)]

    # Primary CRM: 120 profiles with systematic gaps in optional fields.
    crm = []
    for i, p in enumerate(people):
        row = dict(p)
        if i % 13 == 0:
            row["email"] = None
        if i % 9 == 0:
            row["phone"] = None
        if i % 11 == 0:
            row["gift_total"] = None
            row["gift_count"] = None
            row["giving_history"] = None
        if i % 8 == 0:
            row["last_gift_date"] = None
        if i % 10 == 0:
            row["relationship_owner"] = None
        row["source"] = "NorthstarCRM"
        crm.append(row)
    (ROOT / "community-center.json").write_text(json.dumps(crm, indent=2) + "\n")

    # Event export: 90 rows from the same population, with export aliases,
    # inconsistent formatting, occasional stale contact info, and blank gifts.
    event_fields = ["donor_id", "donor_name", "email_address", "phone_number", "total_giving", "gift_count", "last_gift", "interests", "event_name", "source"]
    with (ROOT / "event-signups.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=event_fields)
        writer.writeheader()
        for i in range(90):
            p = people[(i * 17) % 120]
            name = p["name"]
            if i % 12 == 0:
                name = str(name).replace(" ", "  ")
            writer.writerow({
                "donor_id": f"EVT-{i + 1:04d}",
                "donor_name": name,
                "email_address": "" if i % 8 == 0 else p["email"],
                "phone_number": "" if i % 6 == 0 else p["phone"],
                "total_giving": "" if i % 5 == 0 else p["gift_total"],
                "gift_count": "" if i % 7 == 0 else p["gift_count"],
                "last_gift": "" if i % 4 == 0 else p["last_gift_date"],
                "interests": "" if i % 3 == 0 else p["stated_interests"],
                "event_name": ["Spring Learning Breakfast", "Read-a-thon", "Community Gala"][i % 3],
                "source": "Eventbrite-export",
            })

    # Staff notes: 72 narrative-only records. Some lack identifiers, several
    # conflict gently with system dates/amounts, and the notes require evidence
    # extraction plus rubric interpretation rather than simple field mapping.
    blocks = []
    for j in range(72):
        p = people[(j * 13 + 5) % 120]
        parts = [f"Record reference: NOTE-{j + 1:04d}"]
        if j % 9 != 0:
            parts.append(f"Name: {p['name']}")
        if j % 4 != 0:
            parts.append(f"Email: {p['email']}")
        if j % 5 == 0:
            parts.append(f"Phone: {p['phone']}")
        if j % 6 != 0:
            parts.append(f"Staff observation: {p['name']} asked about {INTERESTS[(j + 2) % len(INTERESTS)]} at the "
                         f"{['October open house', 'spring breakfast', 'reading-room tour'][j % 3]}; follow-up preference was "
                         f"{['email', 'a mailed impact report', 'contact after the school term'][j % 3]}.")
        if j % 10 == 0:
            parts.append("Giving amount: not recorded in these notes; check the CRM before discussing a gift.")
        elif j % 8 == 0:
            parts.append(f"Gift recollection: staff remembers a contribution around ${p['gift_total']}, but this is not verified.")
        if j % 7 == 0:
            parts.append("Last contact date is missing from this note.")
        parts.append(f"Source: {['Volunteer coordinator', 'Gala follow-up log', 'Program director'][j % 3]} notes")
        blocks.append("\n".join(parts))
    (ROOT / "staff-notes.txt").write_text("\n\n".join(blocks) + "\n")

    print("Created 120 CRM JSON rows, 90 event CSV rows, and 72 staff-note text blocks (282 source records total).")


if __name__ == "__main__":
    main()
