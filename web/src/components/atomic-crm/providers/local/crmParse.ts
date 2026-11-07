import type { ApiJson } from "./apiTypes";
import type {
  ApiChatResponse,
  ApiChatStep,
  ApiCommunityStats,
  ApiEvent,
  ApiEventDetail,
  ApiEventRecipient,
  ApiPeopleResponse,
  ApiPerson,
  ApiSendBatch,
  ApiSendItem,
  ApiSendResult,
  ApiStatBucket,
  ChatMessage,
  ChatStep,
  CommunityStats,
  CrmEvent,
  CrmEventDetail,
  EventRecipient,
  PeoplePage,
  Person,
  SendBatch,
  SendItem,
  SendResult,
  StatBucket,
  Tab,
} from "./crmTypes";
import { TABS } from "./crmTypes";

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

export const parsePerson = (raw: ApiPerson, fallbackTab: Tab): Person => {
  const demographics = fromJson(raw.demographics);
  return {
    id: raw.id,
    name: raw.full_name,
    org_name: raw.org_name ?? null,
    tab: toTab(raw.contact_type) ?? fallbackTab,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    city: raw.city ?? null,
    tags: stringList(raw.tags),
    demographics:
      demographics && typeof demographics === "object"
        ? Object.entries(demographics).map(([key, value]) => ({
            label: humanize(key),
            value: isBlank(value) ? NOT_RECORDED : String(value),
          }))
        : [],
    score: raw.score ?? null,
    tier: raw.tier ?? null,
    is_star: !!raw.is_star,
    status: raw.status ?? null,
    last_touch: raw.last_touch ?? null,
    next_step: raw.next_step ?? null,
    needs_review: !!raw.needs_review,
    review_reason: raw.review_reason ?? null,
  };
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
  return { people, counts, needs_review: people.filter((p) => p.needs_review).length };
};

export const parseEvent = (raw: ApiEvent): CrmEvent => ({
  id: raw.id,
  title: raw.title,
  starts_at: raw.starts_at,
  ends_at: raw.ends_at ?? null,
  place: raw.place ?? null,
  audience: raw.audience_label ?? raw.audience ?? null,
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

export const parseSendItem = (raw: ApiSendItem): SendItem => {
  const facts = fromJson(raw.facts_used);
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
    needs_individual_approval: !!raw.needs_individual_approval,
    approval_reason: raw.approval_reason ?? null,
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
  return {
    id: String(raw.batch_id ?? raw.id),
    title: raw.title ?? null,
    items,
    bulk_approvable: open.filter((i) => !i.needs_individual_approval && !i.flags.length).length,
    needs_individual_approval: open.filter((i) => i.needs_individual_approval).length,
    flagged: open.filter((i) => i.flags.length).length,
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
