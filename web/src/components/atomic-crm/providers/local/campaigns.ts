/**
 * Campaigns (#38) for both data modes. httpClient.ts and snapshotClient.ts
 * spread these in, passing their own request/loader, so this file never
 * imports them (no import cycle).
 *
 * Every send is SIMULATED: the API writes an outbox row and calls no
 * provider; the snapshot keeps the outbox in this tab's memory.
 */
import type { ApiWhy } from "./apiTypes";
import type {
  CampaignDetail,
  CampaignFact,
  CampaignMessage,
  CampaignMethods,
  CampaignSummary,
  OutboxEntry,
} from "./campaignTypes";
import { whyShort } from "./parse";

/* ---------- Raw API shapes (service/routes_campaigns.py) ---------- */

export interface ApiCampaignMessage extends Omit<
  CampaignMessage,
  "why_short" | "facts_used"
> {
  why: ApiWhy | null;
  facts_used: {
    fact: string;
    url?: string;
    source_url?: string;
    date?: string | null;
  }[];
  score_status?: string | null;
  outreach_draft_id?: number | null;
}

export interface ApiCampaign extends CampaignSummary {
  messages?: ApiCampaignMessage[];
}

/** snapshot.json "campaigns_demo" (service/routes_campaigns.campaigns_demo). */
export interface ApiCampaignsDemo {
  label: string;
  campaigns: ApiCampaign[];
  outbox: OutboxEntry[];
  /** drafts[donorId]["intent:channel"]: a precomputed template message. */
  drafts: Record<string, Record<string, ApiCampaignMessage>>;
}

/* ---------- Parse ---------- */

const parseFact = (
  raw: ApiCampaignMessage["facts_used"][number],
): CampaignFact => ({
  fact: raw.fact,
  source_url: raw.source_url ?? raw.url ?? "",
  date: raw.date ?? null,
});

export const parseCampaignMessage = (
  raw: ApiCampaignMessage,
): CampaignMessage => {
  const { why, facts_used, ...rest } = raw;
  return {
    ...rest,
    why_short: whyShort(why ?? null),
    facts_used: (facts_used ?? []).map(parseFact).filter((f) => f.source_url),
    flags: raw.flags ?? [],
  };
};

const parseSummary = ({
  messages: _messages,
  ...rest
}: ApiCampaign): CampaignSummary => rest;

export const parseCampaign = (raw: ApiCampaign): CampaignDetail => ({
  ...parseSummary(raw),
  messages: (raw.messages ?? []).map(parseCampaignMessage),
});

/* ---------- Local API ---------- */

type Request = <T>(
  path: string,
  init?: { method?: "GET" | "POST" | "PATCH"; body?: unknown },
) => Promise<T>;

export const campaignHttpMethods = (request: Request): CampaignMethods => ({
  createCampaign: async (input) =>
    parseCampaign(
      await request<ApiCampaign>("/campaigns", { method: "POST", body: input }),
    ),
  getCampaigns: async () =>
    (await request<ApiCampaign[]>("/campaigns")).map(parseSummary),
  getCampaign: async (id) =>
    parseCampaign(await request<ApiCampaign>(`/campaigns/${id}`)),
  updateCampaignMessage: async (campaignId, messageId, input) =>
    parseCampaignMessage(
      await request<ApiCampaignMessage>(
        `/campaigns/${campaignId}/messages/${messageId}`,
        { method: "PATCH", body: input },
      ),
    ),
  approveSmallDrafts: async (campaignId) =>
    await request(`/campaigns/${campaignId}/approve-small`, {
      method: "POST",
      body: {},
    }),
  sendCampaign: async (campaignId) =>
    await request(`/campaigns/${campaignId}/send`, { method: "POST" }),
  getOutbox: async () => await request<OutboxEntry[]>("/outbox"),
});

/* ---------- Snapshot: same rules, in this tab's memory ---------- */

const INTENT_LABEL = {
  thank_you: "Thank you",
  re_engage: "Re-engage",
  check_in: "Check in",
};
const SMS_MAX = 320;
const MONEY =
  /\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|[MBK])\b)?/gi;

const countsOf = (messages: ApiCampaignMessage[]) => ({
  total: messages.length,
  draft: messages.filter((m) => m.status === "draft").length,
  approved: messages.filter((m) => m.status === "approved").length,
  sent: messages.filter((m) => m.status === "sent").length,
  skipped: messages.filter((m) => m.status === "skipped").length,
  needs_individual_approval: messages.filter(
    (m) => m.needs_individual_approval && m.status === "draft",
  ).length,
  flagged: messages.filter(
    (m) =>
      m.flags.length > 0 && (m.status === "draft" || m.status === "approved"),
  ).length,
  bulk_approvable: messages.filter(
    (m) =>
      m.status === "draft" && !m.needs_individual_approval && !m.flags.length,
  ).length,
});

/**
 * The snapshot can't run the Python guardrail on an edit, so it keeps the
 * amounts the precomputed draft already had (they passed the guardrail) and
 * flags any new dollar amount, plus the 320-character text limit.
 */
const recheckEdit = (original: string, text: string, channel: string) => {
  const allowed = new Set(
    (original.match(MONEY) ?? []).map((m) => m.replace(/\s/g, "")),
  );
  const flags = (text.match(MONEY) ?? [])
    .filter((m) => !allowed.has(m.replace(/\s/g, "")))
    .map((m) => `${m.trim()} is not in this donor's record or the org facts`);
  if (channel === "text" && text.length > SMS_MAX) {
    flags.push(
      `this text is ${text.length} characters; the limit is ${SMS_MAX}`,
    );
  }
  return [...new Set(flags)];
};

interface DemoState {
  demo: ApiCampaignsDemo;
  originals: Map<string, string>; // "campaignId:messageId" -> drafted text
}

export const campaignSnapshotMethods = (
  loadSnapshot: () => Promise<unknown>,
  approverName: string,
): CampaignMethods => {
  let state: DemoState | null = null;
  const load = async (): Promise<DemoState> => {
    if (state) return state;
    const snapshot = (await loadSnapshot()) as {
      campaigns_demo?: ApiCampaignsDemo;
    };
    const demo = structuredClone(
      snapshot.campaigns_demo ?? {
        label: "",
        campaigns: [],
        outbox: [],
        drafts: {},
      },
    );
    const originals = new Map<string, string>();
    for (const c of demo.campaigns) {
      for (const m of c.messages ?? []) {
        originals.set(`${c.id}:${m.id}`, `${m.subject ?? ""} ${m.body}`);
      }
    }
    state = { demo, originals };
    return state;
  };
  const campaignOf = (demo: ApiCampaignsDemo, id: number) => {
    const campaign = demo.campaigns.find((c) => c.id === id);
    if (!campaign) throw new Error(`Campaign ${id} is not in this tab`);
    campaign.messages ??= [];
    return campaign as ApiCampaign & { messages: ApiCampaignMessage[] };
  };
  const refresh = (c: ApiCampaign & { messages: ApiCampaignMessage[] }) => {
    c.counts = countsOf(c.messages);
    return c;
  };
  const now = () => new Date().toISOString().slice(0, 19) + "+00:00";

  return {
    createCampaign: async ({ donor_ids, intent, channel, name }) => {
      const { demo, originals } = await load();
      const ids = [...new Set(donor_ids)];
      const missing = ids.filter(
        (id) => !demo.drafts[String(id)]?.[`${intent}:${channel}`],
      );
      if (missing.length) {
        throw new Error(
          `Donor(s) ${missing.join(", ")} have no cached draft in this sample. Drafting new messages needs the local API.`,
        );
      }
      const id = Math.max(0, ...demo.campaigns.map((c) => c.id)) + 1;
      const nextMessageId = Math.max(
        0,
        ...demo.campaigns.flatMap((c) => (c.messages ?? []).map((m) => m.id)),
      );
      const messages = ids.map((donorId, i) => ({
        ...structuredClone(
          demo.drafts[String(donorId)][`${intent}:${channel}`],
        ),
        id: nextMessageId + i + 1,
        campaign_id: id,
      }));
      messages.forEach((m) =>
        originals.set(`${id}:${m.id}`, `${m.subject ?? ""} ${m.body}`),
      );
      const campaign = refresh({
        id,
        name:
          name?.trim() ||
          `${INTENT_LABEL[intent]} · ${channel === "email" ? "Email" : "Text"} · ${ids.length} donor${ids.length === 1 ? "" : "s"}`,
        intent,
        channel,
        created_at: now(),
        created_by: approverName,
        status: "draft",
        counts: countsOf([]),
        messages,
      });
      demo.campaigns.unshift(campaign);
      return parseCampaign(structuredClone(campaign));
    },
    getCampaigns: async () =>
      [...(await load()).demo.campaigns]
        .sort((a, b) => b.id - a.id)
        .map((c) => parseSummary(structuredClone(c))),
    getCampaign: async (id) =>
      parseCampaign(structuredClone(campaignOf((await load()).demo, id))),
    updateCampaignMessage: async (campaignId, messageId, input) => {
      const { demo, originals } = await load();
      const campaign = campaignOf(demo, campaignId);
      const m = campaign.messages.find((x) => x.id === messageId);
      if (!m)
        throw new Error(
          `Message ${messageId} is not in campaign ${campaignId}`,
        );
      if (m.status === "sent")
        throw new Error("This message was already sent to the outbox.");
      const subject = input.subject !== undefined ? input.subject : m.subject;
      const body = input.body ?? m.body;
      if (input.body !== undefined || input.subject !== undefined) {
        if (!body.trim()) throw new Error("The message can't be empty.");
        const edited = body !== m.body || subject !== m.subject;
        m.flags = recheckEdit(
          originals.get(`${campaignId}:${messageId}`) ?? "",
          `${subject ?? ""} ${body}`,
          m.channel,
        );
        Object.assign(m, { subject, body });
        if (edited && m.status === "approved") {
          Object.assign(m, {
            status: "draft",
            approved_by: null,
            approved_via: null,
            approved_at: null,
          });
        }
      }
      if (input.status === "approved") {
        if (m.flags.length) {
          throw new Error(
            `Fix the flagged figures or dates before approving: ${m.flags.join("; ")}`,
          );
        }
        Object.assign(m, {
          status: "approved",
          approved_by: approverName,
          approved_via: "individual",
          approved_at: now(),
        });
      } else if (input.status) {
        Object.assign(m, {
          status: input.status,
          approved_by: null,
          approved_via: null,
          approved_at: null,
        });
      }
      refresh(campaign);
      return parseCampaignMessage(structuredClone(m));
    },
    approveSmallDrafts: async (campaignId) => {
      const campaign = campaignOf((await load()).demo, campaignId);
      let approved = 0;
      for (const m of campaign.messages) {
        if (
          m.status === "draft" &&
          !m.needs_individual_approval &&
          !m.flags.length
        ) {
          Object.assign(m, {
            status: "approved",
            approved_by: approverName,
            approved_via: "bulk",
            approved_at: now(),
          });
          approved += 1;
        }
      }
      const counts = refresh(campaign).counts;
      return {
        approved,
        left_for_individual_approval: counts.needs_individual_approval,
        flagged: counts.flagged,
      };
    },
    sendCampaign: async (campaignId) => {
      const { demo } = await load();
      const campaign = campaignOf(demo, campaignId);
      const sentAt = now();
      const noAddress: {
        message_id: number;
        donor_name: string;
        reason: string;
      }[] = [];
      let sent = 0;
      for (const m of campaign.messages) {
        if (m.status !== "approved" || m.flags.length || !m.approved_by)
          continue;
        if (!m.to) {
          noAddress.push({
            message_id: m.id,
            donor_name: m.donor_name,
            reason: `no ${m.channel === "email" ? "email" : "phone"} on file`,
          });
          continue;
        }
        demo.outbox.unshift({
          id: demo.outbox.length + 1,
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          campaign_message_id: m.id,
          donor_id: m.donor_id,
          donor_name: m.donor_name,
          channel: m.channel,
          to: m.to,
          subject: m.subject,
          body: m.body,
          sent_at: sentAt,
          simulated: true,
        });
        Object.assign(m, { status: "sent", sent_at: sentAt });
        sent += 1;
      }
      const counts = refresh(campaign).counts;
      if (sent && counts.draft + counts.approved === 0)
        campaign.status = "sent";
      return {
        simulated: true,
        sent,
        no_address: noAddress,
        not_approved: counts.draft,
      };
    },
    getOutbox: async () => structuredClone((await load()).demo.outbox),
  };
};
