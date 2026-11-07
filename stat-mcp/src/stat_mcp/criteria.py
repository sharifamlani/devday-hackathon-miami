"""Suggested, organization-editable donor scoring guide."""

SUGGESTED_CRITERIA = [
    {
        "id": "mission_affinity",
        "label": "Mission affinity",
        "question": "Is there recorded evidence that the donor cares about this mission or ask?",
        "evidence_fields": ["stated_interests", "giving_history", "engagement_notes"],
    },
    {
        "id": "capacity_evidence",
        "label": "Giving capacity evidence",
        "question": "Does documented giving or an organization-supplied indicator support this ask size?",
        "evidence_fields": ["donation_amount", "gift_count", "giving_history"],
    },
    {
        "id": "relationship_access",
        "label": "Relationship and access",
        "question": "Is there a documented relationship owner and a contact path consistent with recorded preferences?",
        "evidence_fields": ["relationship_owner", "engagement_notes", "contact_preference", "contact_channel_available"],
    },
    {
        "id": "timing_readiness",
        "label": "Timing and readiness",
        "question": "Does recent engagement, a relevant date, or a donor-stated intention support outreach now?",
        "evidence_fields": ["date_of_last_donation", "engagement_notes", "giving_history"],
    },
    {
        "id": "stewardship_fit",
        "label": "Stewardship fit",
        "question": "Can staff make a relevant ask and provide a credible, personalized follow-up?",
        "evidence_fields": ["stated_interests", "engagement_notes", "relationship_owner"],
    },
]

SUGGESTED_FIELDS = [
    {"name": "id", "label": "Donor ID", "sensitivity": "internal identifier; auto-generated when absent"},
    {"name": "first_name", "label": "First name", "sensitivity": "personal data"},
    {"name": "last_name", "label": "Last name", "sensitivity": "personal data"},
    {"name": "email_address", "label": "Email address", "sensitivity": "personal data; minimize model exposure"},
    {"name": "donation_amount", "label": "Donation amount", "sensitivity": "financial data"},
    {"name": "phone_number", "label": "Phone number", "sensitivity": "personal data; minimize model exposure"},
    {"name": "contact_preference", "label": "Contact preference", "sensitivity": "honor donor restrictions and channel requests"},
    {"name": "date_of_last_donation", "label": "Date of last donation", "sensitivity": "financial data"},
    {"name": "organization", "label": "Organization", "sensitivity": "context; verify source"},
    {"name": "employer", "label": "Employer", "sensitivity": "context; never infer wealth from it"},
    {"name": "giving_history", "label": "Giving history", "sensitivity": "financial data"},
    {"name": "gift_count", "label": "Recorded gift count", "sensitivity": "financial data"},
    {"name": "engagement_notes", "label": "Staff-recorded engagement", "sensitivity": "review notes for relevance"},
    {"name": "stated_interests", "label": "Donor-stated interests", "sensitivity": "use only relevant, sourced statements"},
    {"name": "relationship_owner", "label": "Relationship owner", "sensitivity": "staff data"},
    {"name": "source", "label": "Source system / import", "sensitivity": "provenance"},
]
