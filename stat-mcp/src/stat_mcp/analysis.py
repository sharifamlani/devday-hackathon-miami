"""Deterministic donor matching and score aggregation; no LLM arithmetic."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from decimal import Decimal
from statistics import median
from typing import Iterable

import pandas as pd

from stat_mcp.schemas import CriterionOutcome, DonorAssessment, DonorRecord, ImportedTransaction


def _normalize(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").casefold())


def summarize_giving(transactions: list[ImportedTransaction]) -> dict[str, object]:
    """Return gift-level statistics from explicit source transaction events."""

    gifts = [item for item in transactions if item.transaction_type == "gift"]
    amounts = [item.amount for item in gifts if item.amount is not None]
    if not amounts:
        return {
            "gift_transaction_count": len(gifts),
            "gifts_with_amount": 0,
            "reported_gift_total": None,
            "mean_gift_amount": None,
            "median_gift_amount": None,
            "min_gift_amount": None,
            "max_gift_amount": None,
        }
    # Use pandas for the distribution; Decimal keeps the aggregate currency sum exact.
    distribution = pd.Series([float(amount) for amount in amounts], dtype="float64")

    def to_money(value: object) -> str:
        return str(Decimal(str(value)).quantize(Decimal("0.01")))

    return {
        "gift_transaction_count": len(gifts),
        "gifts_with_amount": int(distribution.count()),
        "reported_gift_total": str(sum(amounts, Decimal("0.00"))),
        "mean_gift_amount": to_money(distribution.mean()),
        "median_gift_amount": to_money(median(amounts)),
        "min_gift_amount": to_money(distribution.min()),
        "max_gift_amount": to_money(distribution.max()),
    }


def duplicate_candidates(
    records: list[DonorRecord], threshold: float = 0.65
) -> list[dict[str, object]]:
    """Rank potential duplicate row pairs and explain the matching evidence."""

    if not 0 <= threshold <= 1:
        raise ValueError("threshold must be between 0 and 1")
    results: list[dict[str, object]] = []
    for left_index, left in enumerate(records):
        for right_index in range(left_index + 1, len(records)):
            right = records[right_index]
            evidence: list[str] = []
            score = 0.0
            left_email = _normalize(left.email_address)
            right_email = _normalize(right.email_address)
            left_phone = _normalize(left.phone_number)
            right_phone = _normalize(right.phone_number)
            if left_email and left_email == right_email:
                score += 0.65
                evidence.append("same normalized email")
            if left_phone and left_phone == right_phone:
                score += 0.65
                evidence.append("same normalized phone")
            name_similarity = SequenceMatcher(
                None, _normalize(left.full_name), _normalize(right.full_name)
            ).ratio()
            if name_similarity >= 0.72:
                score += 0.35 * name_similarity
                evidence.append(f"similar normalized names ({name_similarity:.2f})")
            if left.organization and _normalize(left.organization) == _normalize(right.organization):
                score += 0.1
                evidence.append("same organization")
            score = min(score, 1.0)
            if score >= threshold and evidence:
                results.append(
                    {
                        "left_index": left_index,
                        "right_index": right_index,
                        "left_id": left.id,
                        "right_id": right.id,
                        "left_name": left.full_name,
                        "right_name": right.full_name,
                        "score": round(score, 3),
                        "evidence": evidence,
                        "decision": "human_review_required",
                    }
                )
    return sorted(results, key=lambda item: float(item["score"]), reverse=True)


def aggregate_assessments(
    donor_id: str, assessments: Iterable[DonorAssessment], requested_criteria: list[str]
) -> dict[str, object]:
    """Calculate an equal-weight rubric average and separately report evidence coverage."""

    requested = list(dict.fromkeys(requested_criteria))
    if not requested:
        raise ValueError("At least one scoring criterion is required.")
    by_criterion = {}
    for donor_assessment in assessments:
        if donor_assessment.donor_id != donor_id:
            raise ValueError("Each assessment must match the requested donor_id.")
        for assessment in donor_assessment.assessments:
            if assessment.criterion_id in requested:
                if assessment.criterion_id in by_criterion:
                    raise ValueError(f"Duplicate assessment for {assessment.criterion_id!r}.")
                by_criterion[assessment.criterion_id] = assessment

    assessed = [
        by_criterion[item]
        for item in requested
        if item in by_criterion and by_criterion[item].outcome != CriterionOutcome.INSUFFICIENT_EVIDENCE
    ]
    passes = sum(item.outcome == CriterionOutcome.PASS for item in assessed)
    fails = sum(item.outcome == CriterionOutcome.FAIL for item in assessed)
    score = round(100 * passes / len(assessed), 1) if assessed else None
    return {
        "donor_id": donor_id,
        "score": score,
        "score_label": "rubric_fit_not_giving_probability",
        "passes": passes,
        "fails": fails,
        "assessed_criteria": len(assessed),
        "requested_criteria": len(requested),
        "coverage": round(len(assessed) / len(requested), 3),
        "insufficient_or_missing": [
            item
            for item in requested
            if item not in by_criterion
            or by_criterion[item].outcome == CriterionOutcome.INSUFFICIENT_EVIDENCE
        ],
        "criteria": [
            by_criterion[item].model_dump(mode="json")
            if item in by_criterion
            else {"criterion_id": item, "outcome": "insufficient_evidence", "rationale": "Not assessed", "evidence": []}
            for item in requested
        ],
        "human_decision_required": True,
    }
