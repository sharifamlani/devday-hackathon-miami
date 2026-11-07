import type { CrmEvent } from "../providers/local/crmTypes";

/**
 * The calendar's four event families and their types, from
 * docs/research/nonprofit-calendar.md (origin/docs/nonprofit-calendar-research).
 * The data layer's `event_kind` may be a family ("Fundraising") or a type
 * ("giving_day"); both are matched loosely. Missing or unknown means "events".
 */
export type Family = "fundraising" | "stewardship" | "events" | "outreach";

export const FAMILIES: Family[] = [
  "fundraising",
  "stewardship",
  "events",
  "outreach",
];

export const FAMILY_LABELS: Record<Family, string> = {
  fundraising: "Fundraising",
  stewardship: "Stewardship",
  events: "Events",
  outreach: "Community outreach",
};

/** Chip + month-grid colors (CSS values, so Christian can restyle in one place). */
export const FAMILY_COLORS: Record<Family, { bg: string; fg: string }> = {
  fundraising: { bg: "#f4d958", fg: "#242728" },
  stewardship: { bg: "#b9dcc5", fg: "#173a27" },
  events: { bg: "#c7d8f2", fg: "#17294a" },
  outreach: { bg: "#f2c9b8", fg: "#4a2312" },
};

interface KindRule {
  family: Family;
  match: RegExp;
  /** Suggested lead time from the research table. All are planning defaults. */
  lead?: string;
}

// Order matters: specific types before family words.
const RULES: KindRule[] = [
  { family: "fundraising", match: /year.?end/, lead: "series Nov 15 to Dec 31" },
  { family: "fundraising", match: /giving.?day/, lead: "pre-announce 2 to 4 weeks ahead" },
  { family: "fundraising", match: /monthly/, lead: "2 to 4 weeks" },
  { family: "fundraising", match: /match/, lead: "announce 1 to 2 weeks ahead" },
  { family: "fundraising", match: /peer/, lead: "set up about 3 months ahead" },
  { family: "fundraising", match: /sponsor/, lead: "about 6+ months ahead" },
  { family: "fundraising", match: /major|capital|fundrais|appeal/, lead: "months of cultivation" },
  { family: "stewardship", match: /thank/, lead: "within 48 hours of the gift" },
  { family: "stewardship", match: /impact/, lead: "annual and after campaigns" },
  { family: "stewardship", match: /recogni/, lead: "invite 4 to 8 weeks ahead" },
  { family: "stewardship", match: /lapsed|re.?engage/, lead: "rolling, before a giving day" },
  { family: "stewardship", match: /site.?visit/, lead: "2 to 4 weeks" },
  { family: "stewardship", match: /steward|anniversary|new.?donor/ },
  { family: "outreach", match: /enroll/, lead: "reminders at open, midpoint, 3 days before close" },
  { family: "outreach", match: /service|check.?in/, lead: "1 to 3 days before" },
  { family: "outreach", match: /clinic/, lead: "2 to 3 weeks, reminder 2 days before" },
  { family: "outreach", match: /back.?to.?school/, lead: "4 to 6 weeks" },
  { family: "outreach", match: /holiday|drive/, lead: "4 to 6 weeks" },
  { family: "outreach", match: /disaster|prep|outreach/, lead: "before Jun 1, reminders at peak" },
  { family: "events", match: /gala/, lead: "save-the-date 4 to 6 months, invite about 2 months" },
  { family: "events", match: /5k|run|walk/, lead: "registration 2 to 3 months ahead" },
  { family: "events", match: /open.?house|festival/, lead: "3 to 6 weeks" },
  { family: "events", match: /volunteer/, lead: "2 to 4 weeks" },
  { family: "events", match: /info/, lead: "1 to 3 weeks" },
  { family: "events", match: /aware/, lead: "1 to 2 weeks" },
];

export interface KindInfo {
  family: Family;
  /** "suggested, editable" lead time, or null when the type has none. */
  lead: string | null;
}

/** Read `event_kind` (not yet on CrmEvent's type) off an event. */
export const kindInfo = (event: CrmEvent): KindInfo => {
  const raw = (event as CrmEvent & { event_kind?: string | null }).event_kind;
  const key = (raw ?? "").toLowerCase().replace(/[_-]+/g, " ");
  if (!key) return { family: "events", lead: null };
  const hit = RULES.find((r) => r.match.test(key));
  if (hit) return { family: hit.family, lead: hit.lead ?? null };
  const family = FAMILIES.find((f) => key.includes(f) || key.includes(FAMILY_LABELS[f].toLowerCase()));
  return { family: family ?? "events", lead: null };
};
