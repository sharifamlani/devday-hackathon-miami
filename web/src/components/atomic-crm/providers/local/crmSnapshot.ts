import type { ApiSnapshot } from "./apiTypes";
import { requireApprover } from "./crmHttp";
import {
  parseChatResponse,
  parseContextStatus,
  parseCommunityStats,
  parseEvent,
  parseEventDetail,
  parsePeople,
  parseSendBatch,
  toTab,
} from "./crmParse";
import type {
  ApiChatResponse,
  ApiCommunityStats,
  ApiContextStatus,
  ApiEventDetail,
  ApiPerson,
  ApiSendItem,
  CrmMethods,
  SendBatch,
  Tab,
} from "./crmTypes";
import { loadSnapshot } from "./snapshotClient";

/** Phase 5E keys, added to snapshot.json alongside the donor keys. */
type CrmSnapshot = ApiSnapshot & {
  // PR #60: {counts, giver: [...], neighbor: [...], community: [...]}; or one list
  people?: Record<string, ApiPerson[] | Record<string, number>> | ApiPerson[];
  events?: ApiEventDetail[]; // GET /events (PR #60: without recipients/drafts)
  event_details?: Record<string, ApiEventDetail>; // GET /events/{id}
  community_stats?: ApiCommunityStats | null;
  chat_demo?: ApiChatResponse | null; // a recorded run, if exported
  context_status?: ApiContextStatus | null;
};

const READ_ONLY =
  "This is a read-only snapshot. Running the agents needs the local API.";

/** Givers fall back to the snapshot's donors until the people key exists. */
const peopleOf = (snapshot: CrmSnapshot, tab: Tab): ApiPerson[] => {
  const people = snapshot.people;
  if (Array.isArray(people)) return people.filter((p) => toTab(p.contact_type) === tab);
  if (people) {
    return Object.entries(people)
      .filter(([key, list]) => toTab(key) === tab && Array.isArray(list))
      .flatMap(([, list]) => list as ApiPerson[]);
  }
  if (tab !== "giver") return [];
  return snapshot.donors.map((d) => ({
    id: d.id,
    full_name: d.full_name,
    org_name: d.org_name,
    contact_type: "giver",
    email: d.email,
    city: d.city,
    score: d.score,
    tier: d.tier,
    is_star: d.is_star,
    status: d.status,
    last_touch: d.why?.last_gift?.date ?? null,
  }));
};

const countsOf = (snapshot: CrmSnapshot): Record<string, number> => {
  const reported =
    snapshot.people && !Array.isArray(snapshot.people) ? snapshot.people.counts : undefined;
  if (reported && !Array.isArray(reported)) return reported as Record<string, number>;
  return Object.fromEntries(
    (["giver", "neighbor", "community"] as Tab[]).map((t) => [t, peopleOf(snapshot, t).length]),
  );
};

/**
 * The canned chat run: a recorded chat_demo if the snapshot has one,
 * otherwise a run assembled from the snapshot's real drafts. Always labeled.
 */
const cannedRun = (snapshot: CrmSnapshot): ApiChatResponse => {
  if (snapshot.chat_demo) return { ...snapshot.chat_demo, demo: true };
  const drafted = Object.values(snapshot.donor_details)
    .filter((d) => d.outreach_drafts?.length)
    .slice(0, 5);
  const items: ApiSendItem[] = drafted.map((d) => {
    const draft = d.outreach_drafts[0];
    const big = !!d.is_star || d.tier === "big" || d.donor_type === "organization";
    return {
      id: draft.id,
      person_id: d.id,
      full_name: d.full_name,
      contact_type: "giver",
      channel: draft.channel ?? "email",
      subject: draft.subject,
      body: draft.body,
      facts_used: draft.facts_used ?? null,
      needs_individual_approval: big,
      approval_reason: big ? "Star, big-tier or organization donor" : null,
      flags: [],
      status: "draft",
    };
  });
  const lapsing = snapshot.donors.filter((d) => d.status === "lapsing").length;
  return {
    demo: true,
    reply:
      `Demo run (cached sample): I found ${lapsing} lapsing givers and drafted ${items.length} ` +
      "emails that lead with the Foundation's recent work. Review them below. Nothing is sent " +
      "until you approve.",
    steps: [
      { tool: "find_people", summary: `${lapsing} givers whose usual gift is late` },
      { tool: "get_context", summary: "Newest Foundation news and Give Miami Day dates" },
      { tool: "draft_email", summary: `${items.length} drafts, each citing its sources` },
    ],
    pending_batch: items.length ? { id: "demo-batch", title: "Lapsing givers", items } : null,
  };
};

// The canned batch, kept so approve can apply the same rules as the server.
let demoBatch: SendBatch | null = null;

export const crmSnapshotMethods: CrmMethods = {
  getPeople: async (tab) => {
    const snapshot = (await loadSnapshot()) as CrmSnapshot;
    return parsePeople({ items: peopleOf(snapshot, tab), counts: countsOf(snapshot) }, tab);
  },
  setTab: async () => {
    throw new Error(READ_ONLY);
  },
  // Kept in the exported order (upcoming soonest first, then past).
  getEvents: async () => (((await loadSnapshot()) as CrmSnapshot).events ?? []).map(parseEvent),
  getEvent: async (id) => {
    const snapshot = (await loadSnapshot()) as CrmSnapshot;
    const event =
      snapshot.event_details?.[String(id)] ?? (snapshot.events ?? []).find((e) => e.id === id);
    if (!event) throw new Error(`Event ${id} is not in the snapshot`);
    return parseEventDetail(structuredClone(event));
  },
  // A demo batch from the event's pre-drafted invites; nothing is sent.
  planEventOutreach: async (eventId) => {
    const snapshot = (await loadSnapshot()) as CrmSnapshot;
    const event = snapshot.event_details?.[String(eventId)];
    const drafts = (event?.drafts ?? []).filter((d) => (d.status ?? "draft") !== "sent");
    if (!drafts.length) throw new Error("This event has no drafts in the snapshot.");
    demoBatch = parseSendBatch({
      id: `demo-event-${eventId}`,
      title: event?.title ?? "Event invites",
      items: drafts.map((d) => ({ ...d, status: "draft" })),
    });
    return {
      batch_id: demoBatch.id,
      bulk_approvable: demoBatch.bulk_approvable,
      needs_individual_approval: demoBatch.needs_individual_approval,
      flagged: demoBatch.flagged,
      total: demoBatch.items.length,
    };
  },
  getSendBatch: async (batchId) => {
    if (demoBatch?.id === batchId) return demoBatch;
    throw new Error(`Batch ${batchId} is not in this demo session`);
  },
  getCommunityStats: async () => {
    const stats = ((await loadSnapshot()) as CrmSnapshot).community_stats;
    return parseCommunityStats(stats ?? { total: 0, breakdowns: [], note: "No community data in this snapshot." });
  },
  chat: async () => {
    const message = parseChatResponse(cannedRun((await loadSnapshot()) as CrmSnapshot));
    demoBatch = message.batch;
    return message;
  },
  // The snapshot's own status, or its export time; never claims a live refresh.
  getContextStatus: async () => {
    const snapshot = (await loadSnapshot()) as CrmSnapshot;
    return parseContextStatus(
      snapshot.context_status ?? {
        last_refreshed_at: snapshot.meta.generated_at,
        summary: snapshot.meta.label, // "Cached sample"
      },
    );
  },
  refreshContext: async () => {
    throw new Error(READ_ONLY);
  },
  // Same rules as live: a named approver; star/big/org items and flagged
  // items only go when approved one by one. Nothing leaves the browser.
  approveSendBatch: async (batchId, approvedBy, perItem) => {
    requireApprover(approvedBy);
    if (!demoBatch || demoBatch.id !== batchId) {
      throw new Error(`Batch ${batchId} is not in this demo session`);
    }
    const decisions = new Map((perItem ?? []).map((d) => [d.id, d.approve]));
    let sent = 0;
    let skipped = 0;
    const blocked: { id: number; reason: string }[] = [];
    for (const item of demoBatch.items.filter((i) => i.status === "draft")) {
      const decision = decisions.get(item.id);
      if (decision === false) skipped++;
      // A flagged draft can't be approved until a person edits it, even one by one.
      else if (item.flags.length) blocked.push({ id: item.id, reason: "flagged: edit first" });
      else if (item.needs_individual_approval && decision !== true)
        blocked.push({ id: item.id, reason: "needs individual approval" });
      else sent++;
    }
    return { sent, skipped, blocked, simulated: true };
  },
};
