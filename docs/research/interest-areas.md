# Donor interest areas: research brief and recommended taxonomy

Purpose: a standard, chip-sized tag list the enrichment agent assigns from web evidence. The tag becomes a key
field for segmenting donors and matching them to campaigns, events and grant programs. Written Sat Nov 7, 2026.

## 1. Findings in brief

- **NTEE** (IRS/NCCS) has 10 major groups and 26 letter fields: Arts/Culture/Humanities (A); Education (B);
  Environment and Animals (C, D); Health (E-H); Human Services (I-P); International (Q); Public/Societal Benefit
  (R-W); Religion Related (X); Mutual/Membership Benefit (Y); Unclassified (Z). It is the universal crosswalk.
- **Candid PCS** "Subject" facet is NTEE-derived with 800+ terms, now CC BY. Too deep for chips; use it as the
  source of sub-tag vocabulary. (Top-level browse list was not machine-readable; see sources.)
- **Giving USA** destination subsectors: religion, human services, education, public-society benefit, health,
  international affairs, arts/culture, environment/animals (plus gifts to foundations/individuals). Same shape as NTEE.
- **The Miami Foundation** priorities (verified on site): Empower Youth & Families; Generate Prosperity (economic
  mobility, workforce, small business, financial health); Inspire Civic Involvement (local news, forums, information);
  Build Climate & Disaster Resilience (hurricanes, extreme heat); Eliminate Inequities (data-driven access to
  opportunity, resources, rights). Also Press Forward South Florida (local news) and Scholarships.
- **Give Miami Day** has ten issue areas; the page bodies did not render, so only names surfaced in press
  coverage are certain: animals, arts and culture, community care, economic and community development, education
  and youth, environment, faith-based, health and wellness. Two more unverified (press also cites civic
  engagement, science and technology, accessibility and disability services). Mapping below marks these `~`.
  Action: someone confirm the ten names at givemiamiday.org before demo.
- **Other community foundations** (secondary sources only): Greater Houston CF moved to an economic-mobility
  focus (2023); Silicon Valley CF lists education, housing, economic development. Same pattern as Miami: a handful
  of broad themes, with economic mobility and housing as first-class.
- **Charity Navigator** has its own cause categories (reported as 11); not retrieved authoritatively. Treat as
  unverified; NTEE covers the same ground.
- **CRMs:** no major CRM ships a fixed "interest" taxonomy. Raiser's Edge NXT users track affinity as
  custom drop-down/category fields; Bloomerang and DonorPerfect rely on custom fields; Salesforce Nonprofit Cloud
  uses its own data model plus engagement signals. Takeaway: a controlled list with sub-values, as proposed here,
  is the recommended practice.
- **Prospect research practice:** strongest philanthropic indicators are past gifts to the org and to similar
  nonprofits; board seats and 990 Schedule I / 990-PF grant lists are the main public sources; screening matches on
  name alone produce false positives, so a human verifies.
- **Miami-local causes:** climate resilience is a Miami Foundation priority, so it is top-level (`climate_resilience`),
  separate from generic conservation. Immigrant and Haitian/Latin American communities, and affordable housing:
  housing is top-level; immigrant services is a sub-tag under `equity_rights` (it is the cause an org serves, never a
  trait of the donor). Local news is a sub-tag of `civic_media`.

## 2. Recommended taxonomy (17 top-level tags)

NTEE column uses major-group names (letters). GMD = Give Miami Day issue area (`~` = inferred, not verified).
MF = Miami Foundation priority.

| slug | label | definition | example sub-tags | NTEE | Miami Foundation / Give Miami Day |
|---|---|---|---|---|---|
| arts_culture | Arts & Culture | Museums, performing and visual arts, public art, history, libraries | museums, music, theater, film, public_art, historic_preservation | Arts, Culture, Humanities (A) | GMD: Arts and Culture |
| education | Education | Schools, higher ed, literacy, scholarships, STEM learning | k12, higher_ed, scholarships, literacy, early_childhood | Education (B) | MF: Empower Youth & Families; Scholarships; GMD: Education and Youth |
| youth_family | Youth & Family | Youth development, mentoring, child welfare, family support | mentoring, foster_care, after_school, parenting | Human Services (O, P) | MF: Empower Youth & Families; GMD: Education and Youth |
| health_wellness | Health & Wellness | Healthcare access, mental health, disease causes, public health | mental_health, hospitals, cancer, substance_use, aging | Health (E-H) | GMD: Health and Wellness |
| basic_needs | Food & Basic Needs | Food security, emergency aid, disaster relief, veterans and senior services | hunger, emergency_assistance, disaster_relief, veterans, seniors | Human Services (I-N, P); Public Benefit (S) | GMD: Community Care |
| housing | Housing & Homelessness | Affordable housing, homelessness, housing stability | affordable_housing, homelessness, home_repair | Human Services (L) | MF: Eliminate Inequities / Generate Prosperity; GMD: Community Care~ |
| economic_mobility | Economic Mobility | Workforce, small business, financial health, entrepreneurship | workforce, small_business, financial_literacy | Public Benefit (S); Human Services (J) | MF: Generate Prosperity; GMD: Economic and Community Development |
| community_development | Community Development | Neighborhood revitalization, public safety, community spaces, philanthropy infrastructure | neighborhood, parks, public_safety, nonprofit_capacity | Public Benefit (S, T, W) | GMD: Economic and Community Development |
| environment_conservation | Environment & Conservation | Land, water, wildlife habitat, sustainability, Everglades and Biscayne Bay | water_quality, everglades, ocean_coral, sustainability | Environment and Animals (C) | GMD: Environment |
| climate_resilience | Climate & Disaster Resilience | Sea-level rise, extreme heat, hurricane preparedness, resilient infrastructure | sea_level_rise, extreme_heat, hurricane_recovery | Environment (C); Public Benefit (M) | MF: Build Climate & Disaster Resilience |
| animals | Animals | Welfare, shelters, rescue, humane education | shelters, wildlife_rehab, animal_welfare | Environment and Animals (D) | GMD: Animals |
| civic_media | Civic Engagement & Local News | Voting access, civic forums, journalism, government accountability | local_news, voter_engagement, civic_leadership | Public Benefit (R, W); Arts (A, media) | MF: Inspire Civic Involvement; Press Forward; GMD: Civic Engagement~ |
| equity_rights | Equity & Civil Rights | Civil and human rights, anti-discrimination, immigrant and refugee services, legal aid, LGBTQ and women's causes | immigrant_services, legal_aid, racial_equity, womens_rights | Civil Rights (R); Human Services (P); Public Benefit | MF: Eliminate Inequities |
| disability_access | Disability & Accessibility | Services and advocacy for people with disabilities | developmental_disability, accessibility, special_needs | Human Services (P, I); Health (G, H) | GMD: Accessibility and Disability Services~ |
| science_technology | Science & Technology | Research, STEM innovation, tech access | stem, research, digital_access | Science and Technology (U) | GMD: Science and Technology~ |
| international | International & Global | Global relief, development, foreign affairs, exchange | global_health, relief, exchange_programs | International, Foreign Affairs (Q) | (none; Giving USA international subsector) |
| faith_based | Faith-Based Giving | Gifts or leadership roles at congregations or religious charities | congregation, faith_charity | Religion Related (X) | GMD: Faith-Based |

Crosswalk: every NTEE major group maps except Mutual/Membership Benefit (Y) and Unclassified (Z), which are not
causes. Every row maps to at least one NTEE group and one Giving USA subsector. Candid PCS terms are used to
name sub-tags; a sub-tag may later carry a `pcs_code` if we fetch the PCS list.

## 3. Evidence signals and confidence

Ranked strongest first. Each tag the agent returns needs at least one signal and a source URL.

| rank | signal | notes |
|---|---|---|
| 1 | Board or trustee seat, or founder/officer role, at an org in the cause | Public org page, 990 officer list, proxy statement |
| 2 | Named gift or grant by the person or their foundation to an org in the cause | Donor wall, annual report, 990 Schedule I / 990-PF, press release |
| 3 | Named endowment, scholarship or fund in the person's name | University or foundation page |
| 4 | Public statement: op-ed, interview, speech, bio stating the cause | Person-authored or quoted |
| 5 | Event: sponsor, host committee, honoree, speaker at a cause event | Event page or press |
| 6 | Volunteer or advisory role | Org page |
| 7 | Event attendance (guest list), or professional focus matching a cause (e.g. environmental lawyer) | Weak; corroborate |
| 8 | Social follow, like, repost | Never sufficient alone; skip unless public and explicit |

| confidence | rule |
|---|---|
| high | Signal rank 1-3, or two independent signals of rank 4-6, with identity matched on two or more attributes (name plus employer or city) |
| medium | One signal of rank 4-6 with identity matched on two attributes |
| low | Rank 7-8 alone, or identity matched on name only. Show as "suggested", excluded from segments by default |

Rules the prompt must enforce:
1. Every tag cites a `source_url` and a short evidence quote. No URL, no tag.
2. Untagged beats guessed. Return an empty list when evidence is thin.
3. Never infer interests from protected traits: race, ethnicity or national origin (including from a name),
   religion, sexual orientation, disability, health status, age, or political affiliation. Do not tag
   `equity_rights/immigrant_services` or `faith_based` because of who the donor appears to be; only because of
   a documented gift, role or statement about that cause. `faith_based` is never set above `medium`
   without a named gift or role.
4. If two people could match, return `identity_match: "ambiguous"` and no tags.
5. Public professional information only; no home address, family, or personal social accounts.
6. Staff-set tags are never overwritten by the agent.

## 4. Proposed data model (SQLite)

```sql
CREATE TABLE interest_tags (            -- reference table, seeded from section 2
  slug        TEXT PRIMARY KEY,         -- 'arts_culture'
  label       TEXT NOT NULL,            -- 'Arts & Culture'
  definition  TEXT NOT NULL,
  ntee_groups TEXT NOT NULL,            -- JSON array, e.g. ["A"]
  gmd_area    TEXT,                     -- Give Miami Day / Miami Foundation mapping
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE interest_subtags (
  tag_slug    TEXT NOT NULL REFERENCES interest_tags(slug),
  sub_slug    TEXT NOT NULL,            -- 'museums'
  label       TEXT NOT NULL,
  PRIMARY KEY (tag_slug, sub_slug)
);

CREATE TABLE donor_interests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id    INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL REFERENCES interest_tags(slug),
  sub_tag     TEXT,                     -- optional, validated against interest_subtags
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  evidence    TEXT NOT NULL,            -- short quote or paraphrase, <= 300 chars
  source_url  TEXT,                     -- required when set_by = 'agent'
  source_type TEXT CHECK (source_type IN ('board_seat','named_gift','named_fund','statement',
                'event_sponsor','volunteer','event_attendance','social','staff_note','other')),
  found_at    TEXT NOT NULL DEFAULT (datetime('now')),
  set_by      TEXT NOT NULL CHECK (set_by IN ('agent','staff')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  removed_by  TEXT,                     -- staff name or id; keeps agent from re-adding
  CHECK (set_by = 'staff' OR source_url IS NOT NULL),
  UNIQUE (donor_id, tag, sub_tag)
);
CREATE INDEX idx_donor_interests_tag ON donor_interests(tag, status);
```

Behavior: staff add (set_by 'staff', confidence 'high', no URL needed) and remove (status 'removed', row kept).
Re-enrichment upserts agent rows but skips any `(donor, tag)` with a staff row or a staff removal. Segments and
campaign matching query `status='active' AND confidence IN ('high','medium')`. Note: the `donors` schema is Carlos's
contract (plan.md section 13); adding these tables does not alter `donors`.

## 5. Agent output schema (JSON)

```json
{
  "donor_id": 123,
  "identity_match": "confirmed | probable | ambiguous | not_found",
  "identity_basis": ["name", "employer", "city"],
  "interests": [
    {
      "tag": "arts_culture",
      "sub_tag": "museums",
      "confidence": "high",
      "evidence": "Serves on the board of trustees of <Museum>.",
      "source_url": "https://example.org/board",
      "source_type": "board_seat"
    }
  ],
  "contact": {
    "employer": "string | null",
    "title": "string | null",
    "linkedin_url": "string | null",
    "public_email": "string | null",
    "public_phone": "string | null",
    "website": "string | null",
    "location": { "city": "string | null", "region": "string | null", "country": "string | null" },
    "source_urls": ["https://..."]
  },
  "notes": "string | null",
  "searched_at": "ISO-8601"
}
```

Constraints for structured output: `tag` is an enum of the 17 slugs; `sub_tag` an enum of known sub-slugs or
null; `confidence` and `source_type` are enums; `interests` may be empty; contact fields default to null, never
guessed; each contact value must appear in a listed `source_urls` page.

## 6. Sources

- NTEE major groups: https://urbaninstitute.github.io/nccs-legacy/ntee/ntee-history.html
- Candid PCS: https://data.candid.org/reference/philanthropy-classification-system ; https://developer.candid.org/docs/candids-taxonomy ; https://taxonomy.candid.org/subjects
- Giving USA 2026 summaries (secondary): https://ministrywatch.com/2025-giving-topped-600b-but-religion-saw-slowest-growth/ ; https://candid.org/blogs/philanthropy-trends-giving-usa/
- Charity Navigator: https://www.charitynavigator.org/discover-charities (categories not verified)
- Miami Foundation: https://miamifoundation.org/miamis-priorities/ ; https://miamifoundation.org/what-we-do/
- Give Miami Day: https://www.givemiamiday.org/p/categorydescriptions ; https://www.givemiamiday.org/p/subcategories ; https://www.givemiamiday.org/p/causes (names partly from press: https://www.miaminewtimes.com/arts/give-miami-day-aims-to-raise-millions-in-24-hours-for-600-plus-nonprofits-8040238)
- Other community foundations: https://ghcf.org/community-impact/community-impact-fund/ ; https://www.cct.org/?p=1655
- CRM practice: https://community.blackbaud.com/discussion/comment/211500/ ; https://guides.techimpact.org/donor-management-systems/feature-comparison-chart/
- Prospect research: https://philanthropy.org/13kd ; https://doublethedonation.com/prospect-research-guide/ ; https://www.iwave.com/2016/05/26/wealth-data-5-ways-to-learn-more-about-your-prospects-capacity-to-give/
