/**
 * "Try the agent": four sample runs for the public build, where there is no agent service.
 *
 * Each scenario has the prompt the live agent gets on the laptop, and a script the sample build plays
 * instead: the agent's steps, then the same cards the live agent returns (call sheet, email prep, Send
 * approval), filled from snapshot.json. Only Bernard's web findings are invented (he is a sample donor);
 * they are marked illustrative and carry no links.
 */
import type { AgentApproval, AgentStep } from "../agentChat";
import type { CallSheet, EmailPrep } from "../AgentCards";
import { formatMonthDay } from "../homeData";
import { STAFF_NAME } from "../../providers/local/config";

export type ScenarioId = "lookup" | "catch_up" | "batch_email" | "call";

export interface Scenario {
  id: ScenarioId;
  /** The row on Home, and what the user "says" in the thread. */
  text: string;
  button: string;
  /** What the live agent is sent on the laptop. */
  prompt: string;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "lookup",
    text: "Look up Bernard Okoye",
    button: "Find",
    prompt: "Look up Bernard Okoye: research him on the web and show me what you find.",
  },
  {
    id: "catch_up",
    text: "Get me up to speed on Hye-jin Park",
    button: "Brief me",
    prompt: "Get me up to speed on Hye-jin Park.",
  },
  {
    id: "batch_email",
    text: "Email the givers who haven’t given yet in 2026",
    button: "Draft emails",
    prompt:
      "Draft a Give Miami Day email to the givers who haven't given yet in 2026, using our recent impact " +
      "stories. Show me the Send card; don't send until I approve it.",
  },
  {
    id: "call",
    text: "Call Rafael Quintero",
    button: "Call",
    prompt: "Call Rafael Quintero: show me his call sheet first.",
  },
];

/* ---------- The slice of snapshot.json the scripts read ---------- */

type DemoGift = { amount: number; gift_date: string; channel?: string | null; status?: string | null };
type DemoDonor = {
  id: number;
  full_name: string;
  first_name?: string | null;
  org_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  interests?: string[] | string | null;
  gifts?: DemoGift[];
  call_notes?: { created_at?: string | null; title?: string | null; summary?: string[] | string | null }[];
};
export type DemoSnapshot = {
  donor_details: Record<string, DemoDonor>;
  people_attention?: { id: number; name: string; line: string; badge: string }[];
  tasks?: { id: number; title: string; person_id: number | null; due: string | null; done: boolean }[];
  context?: { facts?: { fact: string; url: string; posted_at: string | null }[] } | null;
  home_summary?: { next_event?: { title: string; date: string } | null } | null;
};

/* ---------- What a script holds ---------- */

export type LookupData = {
  person_id: number;
  name: string;
  org: string | null;
  crm: string[];
  /** Invented for the sample donor: shown as illustrative, never with a link. */
  web: string[];
  next_step: string;
};

export type CallLine = { who: "you" | "donor"; text: string };
export type CallScript = { lines: CallLine[]; summary: string; next_steps: string[] };

export type DemoCard =
  | { kind: "lookup"; lookup: LookupData }
  | { kind: "call_sheet"; title: string; sheet: CallSheet; call?: CallScript }
  | { kind: "email_prep"; prep: EmailPrep };

export interface DemoScript {
  id: ScenarioId;
  question: string;
  /** Shown one by one, each "running" before it is "done". */
  steps: AgentStep[];
  /** Shown once every step is done. */
  cards: DemoCard[];
  approval?: { approval: AgentApproval; approved: AgentStep; declined: AgentStep };
  /** The step a card's own action adds (Lookup's Save, the call's log). */
  followUp?: AgentStep;
}

/* ---------- Helpers ---------- */

export const step = (tool: string, summary: string): AgentStep => ({
  tool,
  args: {},
  summary,
  status: "done",
  undo_token: null,
});

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });

/** "2025-11-20" → "Nov 2025", read as UTC. */
const monthYear = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const donorOf = (snap: DemoSnapshot, name: string): DemoDonor => {
  const donor = Object.values(snap.donor_details).find((d) => d.full_name === name);
  if (!donor) throw new Error(`${name} isn’t in this sample data.`);
  return donor;
};

const okGifts = (d: DemoDonor) =>
  (d.gifts ?? []).filter((g) => !g.status || g.status === "ok").sort((a, b) => a.gift_date.localeCompare(b.gift_date));

const interestsOf = (d: DemoDonor): string[] =>
  Array.isArray(d.interests) ? d.interests : d.interests ? d.interests.split(/,\s*/).filter(Boolean) : [];

const openTasks = (snap: DemoSnapshot, id: number) =>
  (snap.tasks ?? []).filter((t) => t.person_id === id && !t.done);

const attentionLine = (snap: DemoSnapshot, id: number) =>
  snap.people_attention?.find((a) => a.id === id)?.line ?? null;

const nextEvent = (snap: DemoSnapshot) => snap.home_summary?.next_event ?? null;

/** "Give Miami Day — Early Giving opens" → "Give Miami Day". */
const eventTopic = (title: string) => title.split(/\s+[—–-]\s+/)[0];

/** The call sheet the live agent builds (service: call_sheet), from the snapshot's record. */
export const callSheetFor = (snap: DemoSnapshot, d: DemoDonor): CallSheet => {
  const gifts = okGifts(d);
  const total = gifts.reduce((sum, g) => sum + g.amount, 0);
  const first = gifts[0] ?? null;
  const last = gifts[gifts.length - 1] ?? null;
  const declined = (d.gifts ?? [])
    .filter((g) => g.status && g.status !== "ok")
    .map((g) => ({ date: formatMonthDay(g.gift_date), amount: g.amount, status: g.status as string }));
  const event = nextEvent(snap);
  const name = d.first_name ?? d.full_name;
  const issue = attentionLine(snap, d.id);
  const talking: string[] = [];
  if (gifts.length) talking.push(`Thank ${name} for ${plural(gifts.length, "gift")} (${usd(total)} in all).`);
  for (const c of declined)
    talking.push(`The ${usd(c.amount)} charge on ${c.date} was ${c.status}: offer a secure link to update the card.`);
  if (!declined.length && issue) talking.push(`Ask about this: ${issue.charAt(0).toLowerCase()}${issue.slice(1)}.`);
  if (event) talking.push(`Mention ${event.title} (${formatMonthDay(event.date)}).`);
  return {
    kind: "call_sheet",
    person_id: d.id,
    name: d.full_name,
    org_name: d.org_name ?? null,
    location: [d.city, d.state].filter(Boolean).join(", ") || null,
    has_phone: Boolean(d.phone),
    phone: d.phone ?? null,
    relationship: {
      gift_count: gifts.length,
      total,
      // A first gift is often years back: "Nov 16, 2023", so it can't read as this month.
      first_gift: first && { date: `${formatMonthDay(first.gift_date)}, ${first.gift_date.slice(0, 4)}`, amount: first.amount },
      last_gift: last && { date: formatMonthDay(last.gift_date), amount: last.amount },
      usual_channel: last?.channel ?? null,
    },
    declined_charges: declined,
    interests: interestsOf(d),
    recent_calls: (d.call_notes ?? []).slice(0, 2).map((c) => ({
      date: formatMonthDay(c.created_at),
      title: c.title ?? "Call",
      summary: Array.isArray(c.summary) ? c.summary : c.summary ? [c.summary] : [],
      next_steps: [],
    })),
    open_tasks: openTasks(snap, d.id).map((t) => ({ id: t.id, title: t.title, due: t.due && formatMonthDay(t.due) })),
    facts: [],
    talking_points: talking,
  };
};

/* ---------- 1. Look up a person ---------- */

const buildLookup = (snap: DemoSnapshot, text: string): DemoScript => {
  const d = donorOf(snap, "Bernard Okoye");
  const gifts = okGifts(d);
  const first = gifts[0];
  const name = d.first_name ?? d.full_name;
  const org = d.org_name ?? null;
  const tasks = openTasks(snap, d.id);
  const crm = [
    first
      ? `First gift ${usd(first.amount)} on ${formatMonthDay(first.gift_date)}${first.channel ? ` (by ${first.channel})` : ""}`
      : "No gifts on record yet",
    ...(interestsOf(d).length ? [`Interests: ${interestsOf(d).join(", ")}`] : []),
    (d.call_notes ?? []).length ? `${plural((d.call_notes ?? []).length, "call")} logged` : "No calls logged yet",
    ...tasks.map((t) => `Open task: ${t.title}`),
  ];
  return {
    id: "lookup",
    question: text,
    steps: [
      step("search_your_records", first ? `1 match · first gift ${usd(first.amount)}` : "1 match"),
      step("search_the_web", "3 public mentions found"),
      step("read_sources", org ? `${org}, Miami` : "Miami"),
    ],
    cards: [
      {
        kind: "lookup",
        lookup: {
          person_id: d.id,
          name: d.full_name,
          org,
          crm,
          web: [
            `Owns ${org ?? "a local business"}, which prints programs for nonprofit events in Miami.`,
            "Serves on the board of a Miami small-business association.",
            "Spoke at a Wynwood arts fundraiser this fall.",
          ],
          next_step: `Call ${name} this week to say welcome, and ask what drew them to the endowment.`,
        },
      },
    ],
    followUp: step("save_to_profile", `Saved 3 findings to ${name}’s profile (sample, this browser only)`),
  };
};

/* ---------- 2. Get me up to speed ---------- */

const buildCatchUp = (snap: DemoSnapshot, text: string): DemoScript => {
  const d = donorOf(snap, "Hye-jin Park");
  const sheet = callSheetFor(snap, d);
  const r = sheet.relationship;
  return {
    id: "catch_up",
    question: text,
    steps: [
      step("read_profile", d.full_name),
      step(
        "read_giving",
        `${usd(r.total)} across ${plural(r.gift_count, "gift")}` +
          (sheet.declined_charges.length ? ` · ${sheet.declined_charges[0].date} charge ${sheet.declined_charges[0].status}` : ""),
      ),
      step("read_tasks_and_notes", `${plural(sheet.open_tasks.length, "open task")} · ${plural(sheet.recent_calls.length, "call note")}`),
    ],
    cards: [{ kind: "call_sheet", title: "Catch-up", sheet }],
  };
};

/* ---------- 3. Batch email from impact stories ---------- */

/** The impact stories the email leans on, in this order when present; any others fill in. */
const STORY_PATTERNS = [/SET Summits/i, /scholarship/i, /largest single-city giving day/i];

const pickStories = (snap: DemoSnapshot) => {
  const facts = snap.context?.facts ?? [];
  const picked: typeof facts = [];
  for (const re of STORY_PATTERNS) {
    const f = facts.find((x) => re.test(x.fact) && !picked.includes(x));
    if (f) picked.push(f);
  }
  for (const f of facts) if (picked.length < 3 && !picked.includes(f)) picked.push(f);
  return picked.slice(0, 3);
};

const buildBatchEmail = (snap: DemoSnapshot, text: string): DemoScript => {
  // The CRM's own list: people who gave before but nothing yet in 2026 (one per name: duplicates aren't merged here).
  const seen = new Set<string>();
  const audience = (snap.people_attention ?? [])
    .filter((a) => a.badge === "not_yet" && !seen.has(a.name) && seen.add(a.name))
    .map((a) => snap.donor_details[String(a.id)])
    .filter(Boolean);
  const stories = pickStories(snap);
  const event = nextEvent(snap);
  const topic = event ? eventTopic(event.title) : "Year-end giving";
  const when = event ? formatMonthDay(event.date) : null;
  const n = audience.length;

  const preview = audience.map((d) => {
    const last = okGifts(d).at(-1);
    const greet = d.first_name ? d.first_name : `friends at ${d.full_name}`;
    return {
      to: `${d.full_name} <${d.email ?? "no email on file"}>`,
      subject: `${d.first_name ? `${d.first_name}, ` : ""}Miami’s biggest giving day${when ? ` starts ${when}` : " is coming"}`,
      body:
        `Dear ${greet},\n\n` +
        `Thank you for ${last ? `your ${usd(last.amount)} gift in ${monthYear(last.gift_date)}` : "your past support"}. ` +
        `Here is some of what giving like yours made possible this year:\n\n` +
        stories.map((s) => `• ${s.fact}`).join("\n") +
        `\n\n${event ? `${event.title} on ${when}.` : "Year-end giving is open."} ` +
        `If you’d like to give again, this is when your gift goes furthest.\n\n` +
        `With gratitude,\n${STAFF_NAME}\nThe Miami Foundation`,
    };
  });

  return {
    id: "batch_email",
    question: text,
    steps: [
      step("find_audience", `${plural(n, "person", "people")} who gave before, nothing yet in 2026`),
      step("read_impact_stories", `${plural(stories.length, "sourced story", "sourced stories")} from the Foundation’s news`),
      step("write_drafts", `${plural(n, "personal email")}, one per giver`),
    ],
    cards: [
      {
        kind: "email_prep",
        prep: {
          kind: "email_prep",
          topic,
          person_ids: audience.map((d) => d.id),
          audience: { count: n, names: audience.slice(0, 2).map((d) => d.full_name) },
          last_time: null,
          since: stories.map((s) => ({ fact: s.fact, url: s.url, date: s.posted_at && formatMonthDay(s.posted_at) })),
          coming_up: event ? [{ title: event.title, date: formatMonthDay(event.date) }] : [],
          angle:
            `Each of them has given before but not yet in 2026. Thank them, show what their giving built this year, ` +
            `and invite them back for ${topic}${when ? ` (${when})` : ""}.`,
        },
      },
    ],
    approval: {
      approval: {
        call_id: "demo-send",
        tool: "send",
        args: {},
        summary: `Send the ${topic} email to ${plural(n, "person", "people")}`,
        preview,
      },
      approved: step("queue_emails", `Queued ${plural(n, "email")} (sample: nothing was sent)`),
      declined: step("keep_drafts", `Kept ${plural(n, "draft")}; nothing was sent`),
    },
  };
};

/* ---------- 4. Call a person ---------- */

const buildCall = (snap: DemoSnapshot, text: string): DemoScript => {
  const d = donorOf(snap, "Rafael Quintero");
  const sheet = callSheetFor(snap, d);
  const name = d.first_name ?? d.full_name;
  const event = nextEvent(snap);
  const topic = event ? eventTopic(event.title) : "year-end giving";
  return {
    id: "call",
    question: text,
    steps: [
      step("read_profile", d.full_name),
      step("build_call_sheet", "Giving, open tasks and talking points"),
    ],
    cards: [
      {
        kind: "call_sheet",
        title: "Call sheet",
        sheet,
        call: {
          lines: [
            { who: "you", text: `Hi ${name}, it’s ${STAFF_NAME} from The Miami Foundation. Do you have a minute?` },
            { who: "donor", text: `Sure, hi ${STAFF_NAME}.` },
            { who: "you", text: "I wanted to say thank you. You’ve given almost every month this year, and it adds up." },
            { who: "donor", text: "Happy to. I think one of them didn’t go through in September, though." },
            { who: "you", text: "That’s partly why I’m calling, no pressure at all. Did something change?" },
            { who: "donor", text: "I switched banks and never updated the card." },
            { who: "you", text: "Easy fix. I can text you a secure link to update it." },
            { who: "donor", text: `Perfect, send it over. And count me in for ${topic}.` },
          ],
          summary:
            `${name} switched banks, so the September gift didn’t go through; it wasn’t a choice to stop. ` +
            `Wants a secure link to update the card, and plans to give on ${topic}.`,
          next_steps: [
            "Text a secure card-update link today",
            `Add ${name} to the ${topic} list${event ? ` (${formatMonthDay(event.date)})` : ""}`,
          ],
        },
      },
    ],
    followUp: step("log_call", `Logged the call and 2 next steps to ${name}’s profile (sample, this browser only)`),
  };
};

const BUILDERS: Record<ScenarioId, (snap: DemoSnapshot, text: string) => DemoScript> = {
  lookup: buildLookup,
  catch_up: buildCatchUp,
  batch_email: buildBatchEmail,
  call: buildCall,
};

/** The sample run for one scenario, from the snapshot the build already serves. */
export const buildScript = (id: ScenarioId, snap: DemoSnapshot): DemoScript => {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`Unknown scenario ${id}`);
  return BUILDERS[id](snap, scenario.text);
};
