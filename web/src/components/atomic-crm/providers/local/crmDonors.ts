/**
 * The donor CRM's records (the Donors tab, built on Atomic CRM's contacts and
 * companies screens). Pure functions: raw GET /donors rows in, react-admin
 * records out. Every score and status still comes from score.py; this file
 * only labels, groups, masks and filters what the service already computed.
 */

import type {
  CallNote,
  NoteDestination,
  TranscriptLine,
} from "../../voice/callNotes";
import type { ApiDonorDetail, ApiDonorRow, ApiGift, ApiJson } from "./apiTypes";
import { parseDonorRow } from "./parse";
import type { DonorStatus, DonorType, Tier } from "./types";

/* ---------- Raw extras the parsed DonorSummary leaves out ---------- */

/** GET /donors rows can carry these (d.* in routes_data.py); snapshots may not. */
export type RawDonorRow = ApiDonorRow & {
  source_row?: string | null;
  interests?: ApiJson<string[]>;
  contact_type?: string | null;
};

/** GET /donors/{id} plus the optional call_notes list (routes_calls.py). */
export type RawDonorDetail = ApiDonorDetail &
  RawDonorRow & { call_notes?: unknown };

/* ---------- Status tags (the team's words, not score.py's) ---------- */

export type DonorTag = "needs_call" | "late" | "lapsed" | "new" | "thanked";

export const DONOR_TAGS: DonorTag[] = [
  "needs_call",
  "late",
  "lapsed",
  "new",
  "thanked",
];

export const DONOR_TAG_LABELS: Record<DonorTag, string> = {
  needs_call: "Needs a call",
  late: "Late",
  lapsed: "Lapsed",
  new: "New",
  thanked: "Thanked",
};

/** Kindred badge tones; the classes live in src/index.css. */
export const DONOR_TAG_CLASS: Record<DonorTag, string> = {
  needs_call: "bg-alert text-alert-foreground",
  late: "bg-warn text-warn-foreground",
  lapsed: "bg-quiet text-quiet-foreground",
  new: "bg-quiet text-quiet-foreground",
  thanked: "bg-good text-good-foreground",
};

/** A first gift this recent makes a donor "new". */
export const NEW_DONOR_DAYS = 120;
const DAY_MS = 86_400_000;

const toDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((toDay(toIso) - toDay(fromIso)) / DAY_MS);

export interface TagInput {
  status: DonorStatus;
  score: number;
  tier: Tier;
  is_star: boolean;
  gift_count: number;
  first_gift_date: string | null;
  last_gift_date: string | null;
  thanked_at: string | null;
}

/**
 * Status tags, most urgent first. "Late" and "Lapsed" are score.py's
 * lapsing and lapsed; "Needs a call" adds priority (score 70+, a star or a
 * big donor) to a late or due gift; "New" is a single gift in the last
 * NEW_DONOR_DAYS; "Thanked" means a thank-you went out after the last gift.
 */
export const donorTags = (d: TagInput, asOf: string): DonorTag[] => {
  const thanked =
    !!d.thanked_at &&
    (!d.last_gift_date || d.thanked_at.slice(0, 10) >= d.last_gift_date);
  const tags: DonorTag[] = [];
  const priority = d.score >= 70 || d.is_star || d.tier === "big";
  if (!thanked && (d.status === "lapsing" || d.status === "due") && priority) {
    tags.push("needs_call");
  }
  if (d.status === "lapsing") tags.push("late");
  if (d.status === "lapsed") tags.push("lapsed");
  if (
    d.gift_count === 1 &&
    d.first_gift_date &&
    daysBetween(d.first_gift_date, asOf) <= NEW_DONOR_DAYS
  ) {
    tags.push("new");
  }
  if (thanked) tags.push("thanked");
  return tags;
};

/* ---------- Masking (the screens never show a full address) ---------- */

const isMasked = (value: string) => /[*•]/.test(value);

/** "maria.delgado@example.com" → "m•••@example.com". */
export const maskEmail = (email: string | null | undefined): string | null => {
  if (!email) return null;
  const value = email.trim();
  if (isMasked(value)) return value;
  const at = value.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${value[0]}•••${value.slice(at)}`;
};

/** "+13055550101" → "•••-•••-0101". */
export const maskPhone = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  const value = phone.trim();
  if (isMasked(value)) return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `•••-•••-${digits.slice(-4)}`;
};

/* ---------- Giving ---------- */

export type LastGiftRange = "90d" | "year" | "older" | "none";

export const LAST_GIFT_RANGE_LABELS: Record<LastGiftRange, string> = {
  "90d": "Last 90 days",
  year: "3 to 12 months ago",
  older: "Over a year ago",
  none: "No gifts yet",
};

export const lastGiftRange = (
  lastGiftDate: string | null,
  asOf: string,
): LastGiftRange => {
  if (!lastGiftDate) return "none";
  const days = daysBetween(lastGiftDate, asOf);
  if (days <= 90) return "90d";
  if (days <= 365) return "year";
  return "older";
};

export interface GivingSummary {
  lifetime: number;
  largest: number;
  average: number;
  count: number;
  first_gift_date: string | null;
  last_gift_date: string | null;
  last_gift_amount: number | null;
  /** Gifts per calendar year, newest first. */
  by_year: { year: string; total: number; count: number }[];
}

/** Totals from the gifts table itself (the "why" totals can lag a merge). */
export const givingSummary = (
  gifts: Pick<ApiGift, "amount" | "gift_date">[],
): GivingSummary => {
  const sorted = [...gifts].sort((a, b) =>
    b.gift_date.localeCompare(a.gift_date),
  );
  const lifetime = sorted.reduce((sum, g) => sum + g.amount, 0);
  const years = new Map<string, { total: number; count: number }>();
  for (const g of sorted) {
    const year = g.gift_date.slice(0, 4);
    const entry = years.get(year) ?? { total: 0, count: 0 };
    entry.total += g.amount;
    entry.count += 1;
    years.set(year, entry);
  }
  return {
    lifetime,
    largest: sorted.reduce((max, g) => Math.max(max, g.amount), 0),
    average: sorted.length ? Math.round(lifetime / sorted.length) : 0,
    count: sorted.length,
    first_gift_date: sorted.at(-1)?.gift_date ?? null,
    last_gift_date: sorted[0]?.gift_date ?? null,
    last_gift_amount: sorted[0]?.amount ?? null,
    by_year: [...years.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, v]) => ({ year, ...v })),
  };
};

/** Monthly or quarterly with a real history counts as a recurring donor. */
export const isRecurring = (
  cadenceDays: number | null | undefined,
  giftCount: number,
) => !!cadenceDays && cadenceDays <= 120 && giftCount >= 3;

/* ---------- Why they're ranked ---------- */

const REASON_LABELS: Record<string, string> = {
  missed_seasonal_window: "Missed their usual season",
  seasonal_window_next_month: "Usual gift is next month",
  overdue_vs_cadence: "Overdue for their usual gift",
  gave_recently_vs_cadence: "Gave recently, on schedule",
  loyal_repeat_giver: "Loyal repeat giver",
  single_gift: "One gift so far",
  shack_society_level: "Shack Society level",
  no_gifts: "No gifts on record",
  imported_unscored: "Imported, not scored yet",
};

export const reasonLabel = (key: string) =>
  REASON_LABELS[key] ??
  (() => {
    const words = key.replace(/[_-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  })();

/* ---------- Source list ---------- */

/** source_row "donors_2024.csv#12" → "donors_2024.csv"; "SAMPLE" → "Sample data". */
export const sourceList = (sourceRow: string | null | undefined): string => {
  const raw = (sourceRow ?? "").trim();
  if (!raw) return "Not recorded";
  if (raw.toUpperCase() === "SAMPLE") return "Sample data";
  return raw.split("#")[0].trim() || "Not recorded";
};

/* ---------- Organizations (Atomic "companies") ---------- */

export type OrgKind = "foundation" | "business" | "household";

export const ORG_KIND_LABELS: Record<OrgKind, string> = {
  foundation: "Foundation",
  business: "Business",
  household: "Household",
};

export const orgKind = (name: string): OrgKind => {
  if (/\b(foundation|fund|trust|endowment|philanthrop)/i.test(name)) {
    return "foundation";
  }
  if (/\b(household|family)\b/i.test(name)) return "household";
  return "business";
};

/** Organizations without their own donor record get ids from here up. */
export const LINKED_ORG_ID_BASE = 100_000;

/* ---------- The react-admin records ---------- */

/**
 * One donor as a react-admin "contacts" record. first_name/last_name/avatar/
 * tags/nb_tasks keep Atomic CRM's components (Avatar, tags, tasks) working.
 */
export interface DonorContact {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  title: string;
  org_name: string | null;
  donor_type: DonorType;
  company_id: number | null;
  company_name: string | null;
  email: string | null; // masked
  phone: string | null; // masked
  city: string | null;
  state: string | null;
  fund_type: string | null;
  tier: Tier;
  score: number;
  is_star: boolean;
  is_sample: boolean;
  donor_status: DonorStatus;
  status_tags: DonorTag[];
  primary_tag: DonorTag | null;
  why_short: string;
  reasons: string[];
  last_gift_date: string | null;
  last_gift_amount: number | null;
  last_gift_range: LastGiftRange;
  first_gift_date: string | null;
  total_given: number;
  largest_gift: number;
  gift_count: number;
  usual_cadence: string | null;
  usual_month: string | null;
  recurring: boolean;
  give_miami_day_days_away: number | null;
  source: string;
  interests: string[];
  imported_notes: string | null;
  drafts_awaiting: number;
  thanked_at: string | null;
  /* Atomic CRM fields */
  tags: number[];
  nb_tasks: number;
  last_seen: string | null;
  first_seen: string | null;
  background: string;
  avatar: { src?: string };
  email_jsonb: [];
  phone_jsonb: [];
}

export interface DonorOrganization {
  id: number;
  name: string;
  kind: OrgKind;
  sector: OrgKind; // Atomic's field name
  donor_id: number | null; // the organization's own giving record
  contact_ids: number[]; // people linked to it (not the org record itself)
  nb_contacts: number;
  city: string | null;
  total_given: number;
  gift_count: number;
  last_gift_date: string | null;
  tier: Tier | null;
  is_sample: boolean;
  logo: { src?: string };
}

/** Local edits kept in this tab: tags, notes' "last seen", background. */
export interface ContactOverlay {
  tags?: number[];
  last_seen?: string | null;
  background?: string;
}

export interface DonorExtras {
  /** Newest approved/sent thank-you or draft after the last gift, if known. */
  thanked_at?: string | null;
  drafts_awaiting?: number;
  first_gift_date?: string | null;
  open_tasks?: number;
  newest_note?: string | null;
}

const fromJson = <T>(raw: ApiJson<T>): T | null => {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const stringList = (raw: ApiJson<string[]>): string[] => {
  const list = fromJson(raw);
  return Array.isArray(list)
    ? list.map((s) => String(s).trim()).filter(Boolean)
    : [];
};

const splitName = (row: RawDonorRow) => {
  if (row.first_name || row.last_name) {
    return { first: row.first_name ?? "", last: row.last_name ?? "" };
  }
  const parts = row.full_name.trim().split(/\s+/);
  if (row.donor_type === "organization" || parts.length < 2) {
    return { first: row.full_name, last: "" };
  }
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1) ?? "" };
};

const latest = (...dates: (string | null | undefined)[]) =>
  dates
    .filter((d): d is string => !!d)
    .sort()
    .at(-1) ?? null;

/** Drafts waiting for a person: not approved, sent or skipped yet. */
export const isAwaitingApproval = (status: string | null | undefined) =>
  !["approved", "sent", "skipped", "dismissed"].includes(
    (status ?? "draft").toLowerCase(),
  );

/** Approved or sent outreach after the last gift counts as a thank-you. */
export const thankedAt = (
  drafts: { status: string; approved_at: string | null }[],
  lastGiftDate: string | null,
): string | null =>
  latest(
    ...drafts
      .filter((d) => ["approved", "sent"].includes(d.status.toLowerCase()))
      .map((d) => d.approved_at)
      .filter(
        (at): at is string =>
          !!at && (!lastGiftDate || at.slice(0, 10) >= lastGiftDate),
      ),
  );

/** What a raw detail adds to the list row: drafts, thank-you, first gift. */
export const extrasFromDetail = (detail: RawDonorDetail): DonorExtras => {
  const gifts = detail.gifts ?? [];
  const drafts = detail.outreach_drafts ?? [];
  const last = latest(...gifts.map((g) => g.gift_date));
  return {
    thanked_at: thankedAt(drafts, last),
    drafts_awaiting: drafts.filter((d) => isAwaitingApproval(d.status)).length,
    first_gift_date: gifts.map((g) => g.gift_date).sort()[0] ?? null,
  };
};

export const toDonorContact = (
  row: RawDonorRow,
  asOf: string,
  options: {
    companyId?: number | null;
    companyName?: string | null;
    overlay?: ContactOverlay;
    extras?: DonorExtras;
  } = {},
): DonorContact => {
  const summary = parseDonorRow(row);
  const why = row.why;
  const { first, last } = splitName(row);
  const extras = options.extras ?? {};
  const overlay = options.overlay ?? {};
  const firstGift =
    extras.first_gift_date ??
    (summary.gift_count === 1 ? summary.last_gift_date : null);
  const thanked = extras.thanked_at ?? null;
  const tags = donorTags(
    {
      status: summary.status,
      score: summary.score,
      tier: summary.tier,
      is_star: summary.is_star,
      gift_count: summary.gift_count,
      first_gift_date: firstGift,
      last_gift_date: summary.last_gift_date,
      thanked_at: thanked,
    },
    asOf,
  );
  return {
    id: row.id,
    first_name: first,
    last_name: last,
    full_name: row.full_name,
    title: "",
    org_name: row.org_name,
    donor_type: summary.donor_type,
    company_id: options.companyId ?? null,
    company_name: options.companyName ?? null,
    email: maskEmail(row.email),
    phone: maskPhone(row.phone),
    city: row.city,
    state: row.state ?? null,
    fund_type: row.fund_type,
    tier: summary.tier,
    score: summary.score,
    is_star: summary.is_star,
    is_sample: summary.is_sample,
    donor_status: summary.status,
    status_tags: tags,
    primary_tag: tags[0] ?? null,
    why_short: summary.why_short,
    reasons: why?.reasons ?? [],
    last_gift_date: summary.last_gift_date,
    last_gift_amount: summary.last_gift_amount,
    last_gift_range: lastGiftRange(summary.last_gift_date, asOf),
    first_gift_date: firstGift,
    total_given: summary.total_given,
    largest_gift: why?.largest_gift ?? summary.last_gift_amount ?? 0,
    gift_count: summary.gift_count,
    usual_cadence: summary.usual_cadence,
    usual_month: why?.pattern?.month_name ?? null,
    recurring: isRecurring(why?.usual_cadence_days, summary.gift_count),
    give_miami_day_days_away: summary.give_miami_day_days_away,
    source: sourceList(row.source_row),
    interests: stringList(row.interests),
    imported_notes: row.notes?.trim() || null,
    drafts_awaiting: extras.drafts_awaiting ?? 0,
    thanked_at: thanked,
    tags: overlay.tags ?? [],
    nb_tasks: extras.open_tasks ?? 0,
    last_seen: latest(
      overlay.last_seen,
      extras.newest_note,
      summary.last_gift_date,
    ),
    first_seen: firstGift,
    background: overlay.background ?? "",
    avatar: {},
    email_jsonb: [],
    phone_jsonb: [],
  };
};

/**
 * Organizations from the donor list: every organization donor, plus any
 * org_name an individual carries that has no record of its own. Returns the
 * organizations and, per donor id, the organization it belongs to.
 */
export const deriveOrganizations = (
  rows: RawDonorRow[],
): { organizations: DonorOrganization[]; orgOf: Map<number, number> } => {
  const byName = new Map<string, DonorOrganization>();
  const orgOf = new Map<number, number>();
  const key = (name: string) => name.trim().toLowerCase();

  for (const row of rows) {
    if (row.donor_type !== "organization") continue;
    const name = (row.org_name ?? row.full_name).trim();
    const summary = parseDonorRow(row);
    const org: DonorOrganization = {
      id: row.id,
      name,
      kind: orgKind(name),
      sector: orgKind(name),
      donor_id: row.id,
      contact_ids: [],
      nb_contacts: 0,
      city: row.city,
      total_given: summary.total_given,
      gift_count: summary.gift_count,
      last_gift_date: summary.last_gift_date,
      tier: summary.tier,
      is_sample: summary.is_sample,
      logo: {},
    };
    byName.set(key(name), org);
    orgOf.set(row.id, org.id);
  }

  const linkedNames = [
    ...new Set(
      rows
        .filter((r) => r.donor_type !== "organization" && r.org_name?.trim())
        .map((r) => (r.org_name as string).trim()),
    ),
  ]
    .filter((name) => !byName.has(key(name)))
    .sort((a, b) => a.localeCompare(b));
  linkedNames.forEach((name, i) => {
    byName.set(key(name), {
      id: LINKED_ORG_ID_BASE + i,
      name,
      kind: orgKind(name),
      sector: orgKind(name),
      donor_id: null,
      contact_ids: [],
      nb_contacts: 0,
      city: null,
      total_given: 0,
      gift_count: 0,
      last_gift_date: null,
      tier: null,
      is_sample: false,
      logo: {},
    });
  });

  for (const row of rows) {
    if (row.donor_type === "organization" || !row.org_name?.trim()) continue;
    const org = byName.get(key(row.org_name));
    if (!org) continue;
    const summary = parseDonorRow(row);
    org.contact_ids.push(row.id);
    org.nb_contacts += 1;
    org.city ??= row.city;
    org.is_sample ||= summary.is_sample;
    // Linked organizations show what their people gave.
    if (org.donor_id == null) {
      org.total_given += summary.total_given;
      org.gift_count += summary.gift_count;
      org.last_gift_date = latest(org.last_gift_date, summary.last_gift_date);
    }
    orgOf.set(row.id, org.id);
  }

  return {
    organizations: [...byName.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    orgOf,
  };
};

/* ---------- Query: filters, sort and pages for react-admin ---------- */

type Filter = Record<string, unknown>;

/** Atomic CRM's PostgREST-style "{1,2}" (tags@cs) or a plain list/number. */
const idList = (raw: unknown): number[] => {
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  if (typeof raw === "number") return [raw];
  if (typeof raw === "string") {
    return raw
      .replace(/[{}()]/g, "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter(Number.isFinite);
  }
  return [];
};

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const matchesQuery = (
  record: Record<string, unknown>,
  q: string,
  fields: string[],
) => {
  const needle = norm(q.trim());
  if (!needle) return true;
  return fields.some((field) => {
    const value = record[field];
    if (Array.isArray(value))
      return value.some((v) => norm(String(v)).includes(needle));
    return value != null && norm(String(value)).includes(needle);
  });
};

const DONOR_SEARCH_FIELDS = [
  "full_name",
  "org_name",
  "company_name",
  "city",
  "fund_type",
  "source",
  "interests",
];

/** Filters the Donors list understands. Unknown keys are ignored. */
export const filterDonors = (
  records: DonorContact[],
  filter: Filter = {},
): DonorContact[] =>
  records.filter((r) => {
    for (const [rawKey, value] of Object.entries(filter)) {
      if (value === undefined || value === "") continue;
      const key = rawKey.replace(/@.*$/, "");
      switch (key) {
        case "q":
          if (
            !matchesQuery(
              r as unknown as Record<string, unknown>,
              String(value),
              DONOR_SEARCH_FIELDS,
            )
          )
            return false;
          break;
        case "status_tag":
          if (!r.status_tags.includes(value as DonorTag)) return false;
          break;
        case "donor_status":
          if (r.donor_status !== value) return false;
          break;
        case "tier":
          if (r.tier !== value) return false;
          break;
        case "last_gift_range":
          if (r.last_gift_range !== value) return false;
          break;
        case "source":
          if (r.source !== value) return false;
          break;
        case "donor_type":
          if (r.donor_type !== value) return false;
          break;
        case "interest":
          if (!r.interests.some((i) => norm(i) === norm(String(value))))
            return false;
          break;
        case "tags": {
          const wanted = idList(value);
          if (!wanted.every((id) => r.tags.includes(id))) return false;
          break;
        }
        case "company_id":
          if (r.company_id !== Number(value)) return false;
          break;
        case "is_star":
          if (r.is_star !== !!value) return false;
          break;
        case "recurring":
          if (r.recurring !== !!value) return false;
          break;
        case "has_draft":
          if (r.drafts_awaiting > 0 !== !!value) return false;
          break;
        case "id":
        case "id_eq_any": {
          const ids = idList(value);
          if (!ids.includes(r.id)) return false;
          break;
        }
        default:
          break;
      }
    }
    return true;
  });

export type SortOrder = "ASC" | "DESC";

/** Sort fields: score (priority), last_gift_date, total_given, gift_count, name. */
export const sortDonors = (
  records: DonorContact[],
  field = "score",
  order: SortOrder = "DESC",
): DonorContact[] => {
  const dir = order === "ASC" ? 1 : -1;
  const value = (r: DonorContact): number | string | null => {
    switch (field) {
      case "last_name":
      case "first_name":
      case "full_name":
        return norm(
          field === "full_name"
            ? r.full_name
            : `${r.last_name} ${r.first_name}`,
        );
      case "last_gift_date":
        return r.last_gift_date;
      case "total_given":
        return r.total_given;
      case "gift_count":
        return r.gift_count;
      case "last_seen":
        return r.last_seen;
      default:
        return r.score;
    }
  };
  return [...records].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    // Missing values always go last, whichever way the list is sorted.
    if (va == null && vb == null) return a.id - b.id;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return b.score - a.score || a.id - b.id;
  });
};

export const filterOrganizations = (
  records: DonorOrganization[],
  filter: Filter = {},
): DonorOrganization[] =>
  records.filter((r) => {
    for (const [rawKey, value] of Object.entries(filter)) {
      if (value === undefined || value === "") continue;
      const key = rawKey.replace(/@.*$/, "");
      if (
        key === "q" &&
        !matchesQuery(r as unknown as Record<string, unknown>, String(value), [
          "name",
          "city",
        ])
      )
        return false;
      if ((key === "kind" || key === "sector") && r.kind !== value)
        return false;
      if (
        (key === "id" || key === "id_eq_any") &&
        !idList(value).includes(r.id)
      )
        return false;
    }
    return true;
  });

export const sortOrganizations = (
  records: DonorOrganization[],
  field = "name",
  order: SortOrder = "ASC",
): DonorOrganization[] => {
  const dir = order === "ASC" ? 1 : -1;
  return [...records].sort((a, b) => {
    if (field === "total_given") return (a.total_given - b.total_given) * dir;
    if (field === "nb_contacts") return (a.nb_contacts - b.nb_contacts) * dir;
    if (field === "last_gift_date") {
      return (
        (a.last_gift_date ?? "").localeCompare(b.last_gift_date ?? "") * dir
      );
    }
    return a.name.localeCompare(b.name) * dir;
  });
};

export const paginate = <T>(
  records: T[],
  pagination?: { page: number; perPage: number },
): T[] => {
  if (!pagination) return records;
  const start = (pagination.page - 1) * pagination.perPage;
  return records.slice(start, start + pagination.perPage);
};

/* ---------- Call notes from GET /donors/{id} ---------- */

const asList = <T>(raw: unknown): T[] => {
  const value = typeof raw === "string" ? fromJson<T[]>(raw) : raw;
  return Array.isArray(value) ? (value as T[]) : [];
};

/**
 * The optional call_notes on GET /donors/{id} (snake_case from the service,
 * camelCase accepted) as the browser's CallNote shape. Malformed items are
 * dropped rather than shown half-empty.
 */
export const parseApiCallNotes = (raw: unknown): CallNote[] =>
  asList<Record<string, unknown>>(raw)
    .filter((n) => n && typeof n === "object" && n.id != null)
    .map((n) => ({
      id: String(n.id),
      title: String(n.title ?? "Call"),
      createdAt: String(n.created_at ?? n.createdAt ?? n.saved_at ?? ""),
      durationSec: Number(n.duration_sec ?? n.durationSec ?? 0) || 0,
      destinations: asList<NoteDestination>(n.destinations),
      transcript: asList<TranscriptLine>(n.transcript),
      notes: String(n.notes ?? ""),
      summary: asList<string>(n.summary).map(String),
      nextSteps: asList<string>(n.next_steps ?? n.nextSteps).map(String),
    }));

/**
 * Call notes for one donor: the server's and this browser's (voice pane),
 * deduplicated by id (the browser copy wins: it may be newer), newest first.
 */
export const callNotesForDonor = (
  donorId: number,
  server: CallNote[],
  browser: CallNote[],
): CallNote[] => {
  const mine = browser.filter((note) =>
    note.destinations.some(
      (d) => d.kind === "donor" && String(d.id) === String(donorId),
    ),
  );
  const byId = new Map<string, CallNote>();
  for (const note of [...server, ...mine]) byId.set(note.id, note);
  return [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
};
