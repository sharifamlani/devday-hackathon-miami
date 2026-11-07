"""Validated data contracts shared by ingestion, analysis, and the MCP tools."""

from __future__ import annotations

from decimal import Decimal
from enum import StrEnum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class DonorRecord(BaseModel):
    """Canonical donor row returned by every supported ingestion path."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    first_name: str = Field(default="", max_length=100)
    last_name: str = Field(default="", max_length=100)
    email_address: str = Field(default="", max_length=320)
    donation_amount: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    phone_number: str = Field(default="", max_length=40)
    date_of_last_donation: str = Field(default="", max_length=40)
    contact_preference: str | None = Field(default=None, max_length=200)
    organization: str | None = Field(default=None, max_length=200)
    employer: str | None = Field(default=None, max_length=200)
    giving_history: str | None = Field(default=None, max_length=4000)
    gift_count: int | None = Field(default=None, ge=0)
    engagement_notes: str | None = Field(default=None, max_length=4000)
    stated_interests: str | None = Field(default=None, max_length=2000)
    relationship_owner: str | None = Field(default=None, max_length=200)
    source: str | None = Field(default=None, max_length=200)

    @property
    def full_name(self) -> str:
        return " ".join(part for part in (self.first_name, self.last_name) if part)


class ExtractedDonor(BaseModel):
    """LLM extraction shape; optional blanks are normalized before storage."""

    id: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    name: str | None = None
    email_address: str | None = None
    donation_amount: Decimal | None = None
    phone_number: str | None = None
    date_of_last_donation: str | None = None
    contact_preference: str | None = None
    organization: str | None = None
    giving_history: str | None = None
    gift_count: int | None = None
    engagement_notes: str | None = None
    stated_interests: str | None = None
    relationship_owner: str | None = None
    source: str | None = None


class DonorExtraction(BaseModel):
    donors: list[ExtractedDonor]


class CriterionDefinition(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=160)
    question: str = Field(min_length=1, max_length=800)
    evidence_fields: list[str] = Field(default_factory=list, max_length=12)


class CriterionOutcome(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class CriterionAssessment(BaseModel):
    criterion_id: str = Field(min_length=1)
    outcome: CriterionOutcome
    rationale: str = Field(min_length=1, max_length=1200)
    evidence: list[str] = Field(default_factory=list, max_length=8)
    confidence: float | None = Field(default=None, ge=0, le=1)


class DonorAssessment(BaseModel):
    donor_id: str
    assessments: list[CriterionAssessment]


class AgentEvaluation(BaseModel):
    """Structured agent result; evidence must come only from the provided donor profile."""

    donor_id: str
    assessments: list[CriterionAssessment]


class UploadedDataset(BaseModel):
    dataset_id: str
    source_name: str
    source_format: str
    records: list[DonorRecord]
    warnings: list[str] = Field(default_factory=list)


def safe_profile(record: DonorRecord) -> dict[str, Any]:
    """Return the complete canonical schema with nulls preserved; ignore arbitrary columns."""

    return record.model_dump(exclude_none=False)
