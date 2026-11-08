import type { ApiJson } from "./apiTypes";
import type {
  ApiChatResponse,
  ApiCampaign,
  ApiChatStep,
  ApiCommunityStats,
  ApiContextStatus,
  ApiEvent,
  ApiEventDetail,
  ApiEventRecipient,
  ApiPeopleResponse,
  ApiPlanResult,
  ApiPerson,
  ApiSendBatch,
  ApiSendItem,
  ApiSendResult,
  ApiStatBucket,
  ChatMessage,
  ChatStep,
  CommunityStats,
  ContextStatus,
  CrmEvent,
  CrmEventDetail,
  EventRecipient,
  PeoplePage,
  Person,
  PlanResult,
  SendBatch,
  SendItem,
  SendResult,
  StatBucket,
  Tab,
} from "./crmTypes";
import { TABS } from "./crmTypes";
import { parseWhen } from "./parseWhen";

/** Shown wherever the nonprofit didn't record a value. Never guess one. */
export const NOT_RECORDED = "not recorded";

const fromJson = <T>(raw: ApiJson<T>): T | null => {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const humanize = (key: string) => {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const isBlank = (v: unknown) =>
  v == null || (typeof v === "string" && (!v.trim() || v.trim().toLowerCase() === "unknown"));

/** contact_type → tab. Accepts §16's older words too. */
export const toTab = (raw: string | null | undefined): Tab | null => {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "giver" || v === "givers" || v === "donor") return "giver";
  if (v === "neighbor" || v === "neighbors" || v === "prospect" || v === "contact") return "neighbor";
  if (v === "community" || v === "beneficiary" || v === "client") return "community";
  return null;
};

const stringList = (raw: ApiJson<string[]>): string[] => {
  const list = fromJson(raw);
  return Array.isArray(list) ? list.map(String).filter((s) => s.trim()) : [];
};

/** service/db.py DEMOGRAPHIC_FIELDS: every Community person shows all of them. */
export const COMMUNITY_FIELDS = ["age_range", "gender", "household_size", "zip", "language", "programs"];

/** {value, source_row}, a list, or a plain value → display text ("not recorded" if empty). */
const demographicText = (entry: unknown): string => {
  const value =
    entry && typeof entry === "object" && !Array.isArray(entry) && "value" in entry
      ? (entry as { value: unknown }).value
      : entry;
  const values = (Array.isArray(value) ? value : [value]).filter((v) => !isBlank(v));
  return values.length ? values.map(String).join(", ") : NOT_RECORDED;
};

export const parsePerson = (raw: ApiPerson, fallbackTab: Tab): Person => {
  const recorded = (fromJson(raw.demographics) ?? {}) as Record<string, unknown>;
  const tab = toTab(raw.contact_type) ?? fallbackTab;
  // Community shows every field; other tabs show only what was recorded.
  const keys =
    tab === "community"
      ? [...COMMUNITY_FIELDS, ...Object.keys(recorded).filter((k) => !COMMUNITY_FIELDS.includes(k))]
      : Object.keys(recorded);
  return {
    id: raw.id,
    name: raw.full_name,
    org_name: raw.org_name ?? null,
    tab,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    city: raw.city ?? null,
    tags: stringList(raw.interests ?? raw.tags),
    has_dog: raw.has_dog ?? null,
    demographics: keys.map((key) => ({ label: humanize(key), value: demographicText(recorded[key]) })),
    is_sample: !!raw.is_sample,
    score: raw.score ?? null,
    tier: raw.tier ?? null,
    is_star: !!raw.is_star,
    status: raw.status ?? null,
    last_touch: raw.last_touch ?? null,
    next_step: raw.next_step ?? null,
    needs_review: !!(raw.tab_review ?? raw.needs_review),
    review_reason: raw.tab_review ?? raw.review_reason ?? null,
    notes: isBlank(raw.notes) ? null : (raw.notes as string).trim(),
    source: sourceFile(raw.source_row),
  };
};

/** "file.xlsx: sheet:Nov 1 Open House:row 4" → "file.xlsx" (the file part of an ingest source_row). */
export const sourceFile = (row: string | null | undefined): string | null => {
  const file = (row ?? "").split(":")[0].trim();
  return file || null;
};

export const parsePeople = (raw: ApiPeopleResponse, tab: Tab): PeoplePage => {
  const list = Array.isArray(raw) ? raw : (raw.items ?? raw.people ?? []);
  const people = list.map((p) => parsePerson(p, tab));
  const reported = Array.isArray(raw) ? {} : (raw.counts ?? {});
  const counts = Object.fromEntries(
    TABS.map((t) => {
      // Accept counts keyed by tab or by an older contact_type word.
      const entry = Object.entries(reported).find(([k]) => toTab(k) === t);
      if (entry && typeof entry[1] === "number") return [t, entry[1]];
      return [t, t === tab ? people.length : null];
    }),
  ) as Record<Tab, number | null>;
  const reportedReview = (reported as Record<string, number | undefined>).needs_review;
  return {
    people,
    counts,
    needs_review: reportedReview ?? people.filter((p) => p.needs_review).length,
  };
};

export const parseEvent = (raw: ApiEvent): CrmEvent => ({
  id: raw.id,
  title: raw.title,
  starts_at: raw.starts_at,
  ends_at: raw.ends_at ?? null,
  place: raw.place ?? null,
  audience: raw.audience_hint ?? raw.audience_label ?? raw.audience ?? null,
  status: raw.status ?? null,
  kind: raw.event_kind ?? null,
  rationale: raw.rationale ?? null,
  batch_id: raw.batch_id != null ? String(raw.batch_id) : null,
  source: raw.source ?? null,
  source_url: raw.source_url ?? raw.url ?? null,
  audience_count: raw.audience_count ?? null,
  drafts_ready: raw.drafts_ready ?? null,
});

const parseRecipient = (raw: ApiEventRecipient): EventRecipient => ({
  person_id: raw.person_id,
  name: raw.full_name ?? raw.name ?? `Person ${raw.person_id}`,
  tab: toTab(raw.contact_type),
  reason: raw.reason ?? null,
});

/** Prospects are organizations we've never worked with: always one by one. */
const isProspect = (raw: ApiSendItem) =>
  raw.prospect_id != null || (raw.contact_type ?? "").toLowerCase() === "prospect";

export const parseSendItem = (raw: ApiSendItem): SendItem => {
  const facts = fromJson(raw.facts_used);
  // The client enforces the rule even if the server leaves the flag off.
  const individual = !!raw.needs_individual_approval || isProspect(raw);
  return {
    id: raw.id,
    person_id: raw.person_id ?? null,
    name: raw.full_name ?? raw.name ?? null,
    tab: toTab(raw.contact_type),
    channel: (raw.channel ?? "").toLowerCase() === "text" ? "text" : "email",
    to: raw.to ?? null,
    subject: raw.subject ?? null,
    body: raw.body,
    facts_used: Array.isArray(facts)
      ? facts
          .map((f) => ({ fact: String(f?.fact ?? ""), source_url: String(f?.source_url ?? f?.url ?? "") }))
          .filter((f) => f.fact && f.source_url)
      : [],
    needs_individual_approval: individual,
    approval_reason:
      raw.approval_reason ?? (isProspect(raw) ? "Prospect organization" : null),
    flags: stringList(raw.flags),
    status: raw.status ?? "draft",
  };
};

export const parseEventDetail = (raw: ApiEventDetail): CrmEventDetail => {
  const drafts = (raw.drafts ?? []).map(parseSendItem);
  return {
    ...parseEvent(raw),
    recipients: (raw.recipients ?? raw.audience_people ?? []).map(parseRecipient),
    drafts,
    drafts_ready: raw.drafts_ready ?? drafts.filter((d) => d.status === "draft").length,
  };
};

const bucketsFrom = (raw: Record<string, number> | ApiStatBucket[]): StatBucket[] => {
  const list: StatBucket[] = Array.isArray(raw)
    ? raw.map((b) => ({
        label: isBlank(b.label ?? b.value ?? b.key) ? NOT_RECORDED : String(b.label ?? b.value ?? b.key),
        count: Number(b.count) || 0,
      }))
    : Object.entries(raw).map(([k, count]) => ({
        label: isBlank(k) || k === "null" ? NOT_RECORDED : k,
        count: Number(count) || 0,
      }));
  // Merge duplicate "not recorded" buckets (null, "", "unknown") and keep it last.
  const merged = new Map<string, number>();
  for (const b of list) merged.set(b.label, (merged.get(b.label) ?? 0) + b.count);
  return [...merged.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) =>
      a.label === NOT_RECORDED ? 1 : b.label === NOT_RECORDED ? -1 : b.count - a.count,
    );
};

export const parseCommunityStats = (raw: ApiCommunityStats): CommunityStats => {
  const b = raw.breakdowns;
  const breakdowns = Array.isArray(b)
    ? b.map((d, i) => ({
        dimension: d.dimension ? humanize(d.dimension) : (d.label ?? `Breakdown ${i + 1}`),
        buckets: bucketsFrom(d.buckets),
      }))
    : Object.entries(b ?? {}).map(([dimension, buckets]) => ({
        dimension: humanize(dimension),
        buckets: bucketsFrom(buckets),
      }));
  return {
    total: raw.total ?? null,
    breakdowns,
    trends: (raw.trends ?? []).map((t, i) => ({
      label: t.label ?? (t.metric ? humanize(t.metric) : `Trend ${i + 1}`),
      points: t.points ?? [],
    })),
    as_of: raw.as_of ?? null,
    note: raw.note ?? null,
  };
};

const TOOL_LABELS: Record<string, string> = {
  find_people: "Found people",
  segment: "Built a segment",
  get_context: "Read the Foundation's context",
  get_events: "Checked the calendar",
  draft_email: "Drafted emails",
  draft_sms: "Drafted texts",
  analyze: "Analyzed the data",
  build_brief: "Built a donor brief",
};

const parseStep = (raw: ApiChatStep): ChatStep => {
  const tool = raw.tool ?? raw.name ?? "tool";
  const status = (raw.status ?? "done").toLowerCase();
  return {
    tool,
    label: raw.label ?? TOOL_LABELS[tool] ?? humanize(tool),
    summary: raw.summary ?? (typeof raw.output === "string" ? raw.output : null),
    status: status === "error" ? "error" : status === "running" ? "running" : "done",
  };
};

export const parseSendBatch = (raw: ApiSendBatch): SendBatch => {
  const items = raw.items.map(parseSendItem);
  const open = items.filter((i) => i.status === "draft");
  const counts = raw.counts ?? {};
  // The server's counts apply its own rules; count the items only as a fallback.
  return {
    id: String(raw.batch_id ?? raw.id),
    title: raw.title ?? null,
    items,
    bulk_approvable:
      counts.bulk_approvable ??
      open.filter((i) => !i.needs_individual_approval && !i.flags.length).length,
    needs_individual_approval:
      counts.needs_individual_approval ?? open.filter((i) => i.needs_individual_approval).length,
    flagged: counts.flagged ?? open.filter((i) => i.flags.length).length,
  };
};

export const parseChatResponse = (raw: ApiChatResponse): ChatMessage => {
  const batch = raw.pending_batch ?? raw.batch ?? null;
  return {
    role: "assistant",
    text: raw.reply ?? raw.message ?? "",
    steps: (raw.steps ?? raw.tool_calls ?? []).map(parseStep),
    batch: batch && batch.items?.length ? parseSendBatch(batch) : null,
    demo: !!raw.demo,
  };
};

export const parseSendResult = (raw: ApiSendResult): SendResult => ({
  sent: raw.sent ?? 0,
  skipped: raw.skipped ?? 0,
  blocked: Array.isArray(raw.blocked)
    ? raw.blocked
    : Array.from({ length: raw.blocked ?? 0 }, (_, i) => ({ id: -1 - i, reason: "blocked" })),
  simulated: raw.simulated ?? true,
});

const plural = (n: number, word: string) => `${n} new ${word}${n === 1 ? "" : "s"}`;

/** "today 7:00 AM", "yesterday 6:30 PM", "Nov 5 7:00 AM", in the viewer's timezone. */
export const relativeDay = (iso: string, now: Date = new Date()): string => {
  const when = parseWhen(iso);
  if (Number.isNaN(when.getTime())) return iso;
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayKey = (d: Date) => d.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(when) === dayKey(now)) return `today ${time}`;
  if (dayKey(when) === dayKey(yesterday)) return `yesterday ${time}`;
  return `${when.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
};

export const parseContextStatus = (raw: ApiContextStatus, now: Date = new Date()): ContextStatus => {
  const last = raw.last_refreshed_at ?? raw.refreshed_at ?? null;
  const change = raw.last_change ?? {};
  const run = raw.last_run ?? {};
  const newEvents = change.new_events ?? raw.new_events ?? run.events_added ?? null;
  const changedEvents = run.events_changed ?? null;
  const newFacts = change.new_facts ?? raw.new_facts ?? run.facts_added ?? null;
  const counts = [
    newEvents ? plural(newEvents, "event") : null,
    changedEvents ? `${changedEvents} changed event${changedEvents === 1 ? "" : "s"}` : null,
    newFacts ? plural(newFacts, "fact") : null,
  ].filter(Boolean) as string[];
  const summary =
    change.summary ??
    raw.summary ??
    (counts.length
      ? counts.join(", ")
      : newEvents === 0 || newFacts === 0 || changedEvents === 0
        ? "no changes"
        : null);
  const refreshing = !!raw.refreshing;
  const label = refreshing
    ? "Updating context…"
    : last
      ? [`Context updated ${relativeDay(last, now)}`, summary].filter(Boolean).join(" · ")
      : "Context not updated yet";
  return {
    last_refreshed_at: last,
    new_events: newEvents,
    changed_events: changedEvents,
    new_facts: newFacts,
    errors: run.errors ?? [],
    change_summary: summary,
    refreshing,
    label,
  };
};

/** GET /campaigns/{id} → a SendBatch (routes_campaigns names its people donor_*). */
export const parseCampaignBatch = (raw: ApiCampaign): SendBatch =>
  parseSendBatch({
    id: raw.id,
    title: raw.name ?? null,
    channel: raw.channel ?? null,
    counts: raw.counts ?? null,
    items: raw.messages.map(({ donor_id, donor_name, ...m }) => ({
      ...m,
      person_id: donor_id ?? null,
      full_name: donor_name ?? null,
      contact_type: m.contact_type ?? "giver",
    })),
  });

export const parsePlanResult = (raw: ApiPlanResult): PlanResult => ({
  batch_id: String(raw.batch_id),
  bulk_approvable: raw.counts?.bulk_approvable ?? null,
  needs_individual_approval: raw.counts?.needs_individual_approval ?? null,
  flagged: raw.counts?.flagged ?? null,
  total: raw.counts?.total ?? null,
});

/**
 * The per-item list for approveSendBatch, built from the plan.md §17 rule:
 * - ordinary drafts are approved in bulk;
 * - org / star / big-donor / prospect drafts go only if named in
 *   `individuallyApproved` (a person ticked each one);
 * - flagged drafts are never selected, and naming one is refused.
 * Items left out stay drafts; the server reports them as blocked.
 */
export const buildApproval = (
  batch: SendBatch,
  individuallyApproved: number[] = [],
): { id: number; approve: boolean }[] => {
  const byId = new Map(batch.items.map((i) => [i.id, i]));
  const flagged = individuallyApproved.filter((id) => byId.get(id)?.flags.length);
  if (flagged.length) {
    throw new Error(
      `Flagged drafts can't be approved until a person edits them (${flagged.join(", ")}).`,
    );
  }
  return batch.items
    .filter((item) => item.status === "draft" && !item.flags.length)
    .filter((item) => !item.needs_individual_approval || individuallyApproved.includes(item.id))
    .map((item) => ({ id: item.id, approve: true }));
};
