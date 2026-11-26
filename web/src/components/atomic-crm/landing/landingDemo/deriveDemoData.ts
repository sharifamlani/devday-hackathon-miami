/**
 * snapshot.json -> the data the landing page's working demo plays with.
 *
 * Lifted from the approved mockup's extract scripts. The four "Try the agent" runs follow the same rules as
 * home/demo/scenarios.ts, so the landing demo shows the same names and numbers as the app. Nothing here is
 * invented except what scenarios.ts already invents (Bernard's illustrative web findings, the call script).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Snapshot = Record<string, any>;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STAFF = "Sharif";

/** "2026-11-14" -> "Nov 14", read as a calendar date (no time zone shift). */
export const md = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${MON[Number(m) - 1]} ${Number(d)}`;
};
const my = (iso: string) => {
  const [y, m] = iso.slice(0, 10).split("-");
  return `${MON[Number(m) - 1]} ${y}`;
};
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const initials = (name: string) => {
  const words = name.replace(/,/g, "").split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ]/.test(w));
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
};

export type DemoStep = { tool: string; summary: string };
export type DemoData = ReturnType<typeof deriveDemoData>;

export const deriveDemoData = (snap: Snapshot) => {
  const details: Record<string, any> = snap.donor_details ?? {};
  if (!Array.isArray(snap.donors) || !snap.donors.length) throw new Error("This snapshot has no donors.");

  const donors = snap.donors.map((x: any) => {
    const dd = details[String(x.id)] ?? {};
    const w = x.why ?? {};
    const lg = w.last_gift ?? null;
    const gifts = [...(dd.gifts ?? [])]
      .map((g: any) => ({ date: g.gift_date as string, amount: g.amount as number, ok: g.status === "ok" }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-8);
    return {
      id: x.id as number,
      name: x.full_name as string,
      ini: initials(x.full_name),
      org: x.donor_type === "organization",
      status: (x.status ?? null) as string | null,
      score: (x.score ?? null) as number | null,
      email: (x.email ?? null) as string | null,
      lifetime: (w.lifetime_total ?? null) as number | null,
      last: lg ? { date: lg.date as string, amount: lg.amount as number } : null,
      days: (w.days_since_last_gift ?? null) as number | null,
      cadence: (w.usual_cadence_days ?? null) as number | null,
      next: (x.next_step ?? null) as string | null,
      gifts,
    };
  });

  const person = (x: any) => ({
    id: x.id as number,
    name: x.full_name as string,
    email: (x.email ?? null) as string | null,
    phone: (x.phone ?? null) as string | null,
    src: String(x.source_row ?? "").split(":")[0].split("|")[0].trim(),
  });
  const dups = (snap.duplicates ?? []).map((u: any) => ({
    id: u.id as number,
    a: person(u.donor_a),
    b: person(u.donor_b),
    ag: (u.donor_a_gift_count ?? null) as number | null,
    bg: (u.donor_b_gift_count ?? null) as number | null,
    reasons: (u.reasons ?? []) as string[],
    conf: (u.confidence ?? 0) as number,
  }));
  const tasks = (snap.tasks_today ?? []).map((t: any) => ({
    id: t.id as number,
    title: t.title as string,
    why: (t.why ?? null) as string | null,
    chips: (t.chips ?? []) as string[],
    person: (t.person_id ?? null) as number | null,
  }));
  const events = (snap.events ?? []).map((e: any) => ({
    id: e.id as number,
    title: e.title as string,
    date: String(e.starts_at).slice(0, 10),
    time: String(e.starts_at).slice(11, 16) || null,
  }));
  const ask = (snap.ask_examples ?? []).map((a: any) => ({
    q: a.question as string,
    interp: a.interpretation as string,
    ids: (a.donor_ids ?? []) as number[],
  }));
  const calendar = (snap.calendar ?? []).map((c: any) => ({ date: c.date as string, kind: c.kind as string }));
  const quarter = snap.targets?.quarter ?? {};
  const home = snap.home_summary ?? {};
  const event = home.next_event ?? null;
  const attention: any[] = snap.people_attention ?? [];

  /* ---------- "Try the agent": the rules of home/demo/scenarios.ts ---------- */
  const donorNamed = (name: string) => {
    const d = Object.values(details).find((x: any) => x.full_name === name);
    if (!d) throw new Error(`${name} isn’t in this sample data.`);
    return d as any;
  };
  const okGifts = (d: any) =>
    [...(d.gifts ?? [])].filter((g: any) => !g.status || g.status === "ok").sort((a: any, b: any) => a.gift_date.localeCompare(b.gift_date));
  const interestsOf = (d: any): string[] =>
    Array.isArray(d.interests) ? d.interests : d.interests ? String(d.interests).split(/,\s*/).filter(Boolean) : [];
  const openTasks = (id: number) => (snap.tasks ?? []).filter((t: any) => t.person_id === id && !t.done);
  const topicOf = (title: string) => title.split(/\s+[—–-]\s+/)[0];

  const callSheet = (d: any) => {
    const gifts = okGifts(d);
    const total = gifts.reduce((sum: number, g: any) => sum + g.amount, 0);
    const first = gifts[0] ?? null;
    const last = gifts[gifts.length - 1] ?? null;
    const declined = (d.gifts ?? [])
      .filter((g: any) => g.status && g.status !== "ok")
      .map((g: any) => ({ date: md(g.gift_date), amount: g.amount as number, status: g.status as string }));
    const name = d.first_name ?? d.full_name;
    const issue = attention.find((a) => a.id === d.id)?.line ?? null;
    const talking: string[] = [];
    if (gifts.length) talking.push(`Thank ${name} for ${plural(gifts.length, "gift")} (${usd(total)} in all).`);
    for (const c of declined) talking.push(`The ${usd(c.amount)} charge on ${c.date} was ${c.status}: offer a secure link to update the card.`);
    if (!declined.length && issue) talking.push(`Ask about this: ${issue.charAt(0).toLowerCase()}${issue.slice(1)}.`);
    if (event) talking.push(`Mention ${event.title} (${md(event.date)}).`);
    return {
      person: d.id as number,
      name: d.full_name as string,
      gifts: gifts.length,
      total,
      first: first && { date: `${md(first.gift_date)}, ${first.gift_date.slice(0, 4)}`, amount: first.amount as number },
      last: last && { date: md(last.gift_date), amount: last.amount as number },
      declined,
      tasks: openTasks(d.id).map((t: any) => t.title + (t.due ? ` (due ${md(t.due)})` : "")) as string[],
      calls: (d.call_notes ?? []).slice(0, 2).length as number,
      talking,
    };
  };
  const step = (tool: string, summary: string): DemoStep => ({ tool: tool.replace(/_/g, " "), summary });

  // 1. Look up Bernard Okoye
  const b = donorNamed("Bernard Okoye");
  const bf = okGifts(b)[0];
  const bname = b.first_name ?? b.full_name;
  const borg = b.org_name ?? null;
  const crm = [
    bf ? `First gift ${usd(bf.amount)} on ${md(bf.gift_date)}${bf.channel ? ` (by ${bf.channel})` : ""}` : "No gifts on record yet",
    ...(interestsOf(b).length ? [`Interests: ${interestsOf(b).join(", ")}`] : []),
    (b.call_notes ?? []).length ? `${plural(b.call_notes.length, "call")} logged` : "No calls logged yet",
    ...openTasks(b.id).map((t: any) => `Open task: ${t.title}`),
  ];

  // 2. Catch up on Hye-jin Park
  const h = donorNamed("Hye-jin Park");
  const hs = callSheet(h);

  // 3. Batch email to givers who haven't given yet this year
  const facts: any[] = snap.context?.facts ?? [];
  const stories: any[] = [];
  for (const re of [/SET Summits/i, /scholarship/i, /largest single-city giving day/i]) {
    const f = facts.find((x) => re.test(x.fact) && !stories.includes(x));
    if (f) stories.push(f);
  }
  for (const f of facts) if (stories.length < 3 && !stories.includes(f)) stories.push(f);
  stories.splice(3);
  const seen = new Set<string>();
  const audience = attention
    .filter((a) => a.badge === "not_yet" && !seen.has(a.name) && seen.add(a.name))
    .map((a) => details[String(a.id)])
    .filter(Boolean);
  const topic = event ? topicOf(event.title) : "Year-end giving";
  const when = event ? md(event.date) : null;
  const n = audience.length;
  const previews = audience.map((d: any) => {
    const lg = okGifts(d).at(-1);
    const greet = d.first_name ? d.first_name : `friends at ${d.full_name}`;
    return {
      to: `${d.full_name} <${d.email ?? "no email on file"}>`,
      subject: `${d.first_name ? `${d.first_name}, ` : ""}Miami’s biggest giving day${when ? ` starts ${when}` : " is coming"}`,
      body:
        `Dear ${greet},\n\nThank you for ${lg ? `your ${usd(lg.amount)} gift in ${my(lg.gift_date)}` : "your past support"}. ` +
        `Here is some of what giving like yours made possible this year:\n\n` +
        stories.map((s) => `• ${s.fact}`).join("\n") +
        `\n\n${event ? `${event.title} on ${when}.` : "Year-end giving is open."} ` +
        `If you’d like to give again, this is when your gift goes furthest.\n\nWith gratitude,\n${STAFF}\nThe Miami Foundation`,
    };
  });

  // 4. Call Rafael Quintero
  const r = donorNamed("Rafael Quintero");
  const rs = callSheet(r);
  const rname = r.first_name ?? r.full_name;
  const ctopic = event ? topicOf(event.title) : "year-end giving";

  const scripts = [
    {
      id: "lookup",
      text: "Look up Bernard Okoye",
      button: "Find",
      steps: [
        step("search_your_records", bf ? `1 match · first gift ${usd(bf.amount)}` : "1 match"),
        step("search_the_web", "3 public mentions found"),
        step("read_sources", borg ? `${borg}, Miami` : "Miami"),
      ],
      card: {
        kind: "lookup",
        person: b.id as number,
        name: b.full_name as string,
        org: borg as string | null,
        crm,
        web: [
          `Owns ${borg ?? "a local business"}, which prints programs for nonprofit events in Miami.`,
          "Serves on the board of a Miami small-business association.",
          "Spoke at a Wynwood arts fundraiser this fall.",
        ],
        next: `Call ${bname} this week to say welcome, and ask what drew them to the endowment.`,
      },
      followUp: step("save_to_profile", `Saved 3 findings to ${bname}’s profile (sample, this browser only)`),
    },
    {
      id: "catch_up",
      text: "Get me up to speed on Hye-jin Park",
      button: "Brief me",
      steps: [
        step("read_profile", h.full_name),
        step(
          "read_giving",
          `${usd(hs.total)} across ${plural(hs.gifts, "gift")}` +
            (hs.declined.length ? ` · ${hs.declined[0].date} charge ${hs.declined[0].status}` : ""),
        ),
        step("read_tasks_and_notes", `${plural(hs.tasks.length, "open task")} · ${plural(hs.calls, "call note")}`),
      ],
      card: { kind: "call_sheet", title: "Catch-up", ...hs },
    },
    {
      id: "batch_email",
      text: "Email the givers who haven’t given yet in 2026",
      button: "Draft emails",
      steps: [
        step("find_audience", `${plural(n, "person", "people")} who gave before, nothing yet in 2026`),
        step("read_impact_stories", `${plural(stories.length, "sourced story", "sourced stories")} from the Foundation’s news`),
        step("write_drafts", `${plural(n, "personal email")}, one per giver`),
      ],
      card: {
        kind: "email_prep",
        topic,
        count: n,
        names: audience.slice(0, 2).map((d: any) => d.full_name as string),
        since: stories.map((s) => ({ fact: s.fact as string, date: s.posted_at ? md(s.posted_at) : null })),
        coming: event ? [`${event.title} (${md(event.date)})`] : [],
        angle:
          `Each of them has given before but not yet in 2026. Thank them, show what their giving built this year, ` +
          `and invite them back for ${topic}${when ? ` (${when})` : ""}.`,
      },
      approval: {
        summary: `Send the ${topic} email to ${plural(n, "person", "people")}`,
        preview: previews,
        approved: step("queue_emails", `Queued ${plural(n, "email")} (sample: nothing was sent)`),
        declined: step("keep_drafts", `Kept ${plural(n, "draft")}; nothing was sent`),
      },
    },
    {
      id: "call",
      text: "Call Rafael Quintero",
      button: "Call",
      steps: [step("read_profile", r.full_name), step("build_call_sheet", "Giving, open tasks and talking points")],
      card: { kind: "call_sheet", title: "Call sheet", ...rs },
      call: {
        lines: [
          ["you", `Hi ${rname}, it’s ${STAFF} from The Miami Foundation. Do you have a minute?`],
          ["donor", `Sure, hi ${STAFF}.`],
          ["you", "I wanted to say thank you. You’ve given almost every month this year, and it adds up."],
          ["donor", "Happy to. I think one of them didn’t go through in September, though."],
          ["you", "That’s partly why I’m calling, no pressure at all. Did something change?"],
          ["donor", "I switched banks and never updated the card."],
          ["you", "Easy fix. I can text you a secure link to update it."],
          ["donor", `Perfect, send it over. And count me in for ${ctopic}.`],
        ] as [string, string][],
        summary:
          `${rname} switched banks, so the September gift didn’t go through; it wasn’t a choice to stop. ` +
          `Wants a secure link to update the card, and plans to give on ${ctopic}.`,
        next: ["Text a secure card-update link today", `Add ${rname} to the ${ctopic} list${event ? ` (${md(event.date)})` : ""}`],
      },
      followUp: step("log_call", `Logged the call and 2 next steps to ${rname}’s profile (sample, this browser only)`),
    },
  ];

  // "Show me" answers in the Home chat: who's late on a usual gift, failed first.
  const lateAnswer = attention
    .filter((a) => ["failed", "skipped", "late"].includes(a.badge))
    .slice(0, home.gifts_at_risk ?? 5)
    .map((a) => ({ id: a.id as number, name: a.name as string, line: a.line as string }));

  return {
    asOf: (snap.meta?.as_of ?? "") as string,
    goal: { label: quarter.label as string, goal: quarter.goal as number, raised: quarter.raised as number, pct: quarter.percent as number },
    reachedToday: (home.reached_today ?? 0) as number,
    nextEvent: event as { title: string; date: string; days: number } | null,
    // Givers + Neighbors + Community: the people the import sorted (needs_review is a flag on some of them).
    peopleTotal: ["giver", "neighbor", "community"].reduce((a, k) => a + Number(snap.people?.counts?.[k] ?? 0), 0),
    donors,
    dups,
    tasks,
    events,
    ask,
    calendar,
    scripts,
    lateAnswer,
  };
};
