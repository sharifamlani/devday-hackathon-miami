"""Transaction-first import helpers and donor/person projections."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid5

from stat_mcp.schemas import DonorRecord, ImportedTransaction


def _person_key(transaction: ImportedTransaction) -> str:
    source_scope = transaction.source_name.casefold().strip()
    group_key = transaction.person_group_key or transaction.person_source_id
    if group_key:
        return f"source:{source_scope}:person:{group_key.casefold()}"
    # Similar names or shared emails are duplicate evidence, not permission to merge people.
    return f"event:{transaction.transaction_id}"


def project_people(transactions: list[ImportedTransaction]) -> list[DonorRecord]:
    """Build one person summary per identity, without inventing missing gifts."""

    grouped: dict[str, list[ImportedTransaction]] = defaultdict(list)
    for transaction in transactions:
        grouped[_person_key(transaction)].append(transaction)

    people: list[DonorRecord] = []
    for key, items in grouped.items():
        gifts = [item for item in items if item.transaction_type == "gift" and item.amount is not None]
        dated = [item for item in gifts if item.transaction_date]
        dates = sorted(
            item.transaction_date
            for item in dated
            if is_iso_date(item.transaction_date)
        )
        amount = sum((item.amount for item in gifts if item.amount is not None), Decimal("0"))
        # Keep eventless contacts in the person view; null amount/date means no gift evidence.
        first = next((item.first_name for item in items if item.first_name), "")
        last = next((item.last_name for item in items if item.last_name), "")
        email = next((item.email_address for item in items if item.email_address), "")
        phone = next((item.phone_number for item in items if item.phone_number), "")
        organization = next((item.organization for item in items if item.organization), None)
        history = [
            f"{item.transaction_date or 'date unknown'}: {item.amount}"
            for item in sorted(gifts, key=lambda gift: gift.transaction_date or "")
        ]
        people.append(
            DonorRecord(
                id=str(uuid5(NAMESPACE_URL, key)),
                first_name=first,
                last_name=last,
                email_address=email,
                phone_number=phone,
                organization=organization,
                donation_amount=amount if gifts else None,
                date_of_last_donation=dates[-1] if dates else "",
                gift_count=len(gifts) if gifts else None,
                giving_history="; ".join(history)[:4000] if history else None,
                contact_type=(
                    "donor" if gifts else items[0].contact_type.value
                ),
                source=items[0].source_name,
            )
        )
    return people


def normalize_date(value: object) -> str | None:
    """Return ISO date for unambiguous date-like values; preserve unclear strings."""

    if value is None or str(value).strip().casefold() in {"", "na", "n/a", "unknown"}:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        pass
    # Month names are unambiguous; numeric dates read as US M/D/Y unless the first part can only be a day
    cleaned = re.sub(r"\s+", " ", text.replace(",", " ")).strip()
    for fmt in ("%b %d %Y", "%B %d %Y", "%d %b %Y", "%d %B %Y", "%m/%d/%Y", "%m-%d-%Y", "%m/%d/%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(cleaned, fmt).date().isoformat()
        except ValueError:
            continue
    return text[:40]


def is_iso_date(value: str | None) -> bool:
    if not value:
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False
