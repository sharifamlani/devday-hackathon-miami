/**
 * Ask Donor Desk on the hosted (snapshot) site: the guard, schema and prompt
 * behind POST /api/ask (api/ask.ts). Pure: no network, no SDK import, so the
 * tests run it with a mocked runner. Files under api/ that start with "_" are
 * not deployed as functions.
 *
 * The model is read-only, exactly as in service/ask_agent.py: it sees the
 * question and the calendar, never a donor row, has no tools, and returns one
 * AskPlan. The browser then runs applyAskFilter over its own snapshot, so
 * every donor and amount on screen comes from the records, not the model.
 */
import { z } from "zod";

/* ---------- AskPlan (mirrors service/ask_agent.py and providers/local/ask.ts) ---------- */

// Structured outputs need every key present, so "no constraint" is null, not missing.
const isoDay = z.string().describe("YYYY-MM-DD");

const DateRangeSchema = z.object({
  start: isoDay
    .nullable()
    .describe("First day included; null = no lower bound"),
  end: isoDay.nullable().describe("Last day included; null = no upper bound"),
});

export const AskFilterSchema = z.object({
  status: z
    .array(z.enum(["lapsing", "due", "on_track", "lapsed", "no_gifts"]))
    .nullable()
    .describe("Score status, any of these"),
  tier: z
    .array(z.enum(["big", "mid", "small"]))
    .nullable()
    .describe(
      "Giving tier, any of these. big = $25k+ lifetime or a $10k+ gift",
    ),
  star: z
    .boolean()
    .nullable()
    .describe("true = only star donors ($1M+ lifetime); false = exclude them"),
  donor_type: z.enum(["individual", "organization"]).nullable(),
  gave_between: DateRangeSchema.nullable().describe(
    "At least one gift in this range. Amount and channel fields then look only at these gifts",
  ),
  last_gift_before: isoDay
    .nullable()
    .describe("Most recent gift on or before this day"),
  last_gift_after: isoDay
    .nullable()
    .describe("Most recent gift on or after this day"),
  min_gift: z
    .number()
    .nullable()
    .describe(
      "Largest single gift (in gave_between, else ever) at least this, USD",
    ),
  max_gift: z
    .number()
    .nullable()
    .describe(
      "Largest single gift (in gave_between, else ever) at most this, USD",
    ),
  min_total: z
    .number()
    .nullable()
    .describe(
      "Total given (in gave_between, else lifetime) at least this, USD",
    ),
  max_total: z
    .number()
    .nullable()
    .describe("Total given (in gave_between, else lifetime) at most this, USD"),
  channel: z
    .array(z.string())
    .nullable()
    .describe(
      "Gave through any of these channels, e.g. 'Give Miami Day', 'online', 'check', 'event'",
    ),
  cadence: z
    .enum(["monthly", "quarterly", "yearly", "one_time"])
    .nullable()
    .describe("Usual rhythm from their gift history"),
  overdue: z
    .boolean()
    .nullable()
    .describe(
      "true = past their own usual rhythm or missed their usual giving month (gone quiet)",
    ),
  has_draft: z
    .boolean()
    .nullable()
    .describe("true = has an outreach draft; false = none yet"),
  not_contacted_since: isoDay
    .nullable()
    .describe(
      "No outreach approved or sent on or after this day (there is no call log, so 'haven't called / contacted' maps here)",
    ),
  sort: z
    .enum([
      "score",
      "period_total",
      "last_gift_recent",
      "last_gift_oldest",
      "lifetime",
      "name",
    ])
    .nullable(),
  limit: z
    .number()
    .int()
    .nullable()
    .describe("At most this many donors (1-100); null = all"),
});

export const AskIntentSchema = z.object({
  kind: z
    .enum(["thank_you", "re_engage", "check_in"])
    .describe("thank_you (they gave), re_engage (they went quiet) or check_in"),
  channel_hint: z
    .enum(["email", "text"])
    .nullable()
    .describe("email or text when the question implies one"),
});

export const AskPlanSchema = z.object({
  interpretation: z
    .string()
    .describe(
      "One plain sentence: how you read the question, naming the dates used",
    ),
  filter: AskFilterSchema,
  intent: AskIntentSchema,
});

export type AskPlan = z.infer<typeof AskPlanSchema>;

/* ---------- The org's calendar (service/ask_agent.py calendar_for) ---------- */

// service/score.py GIVE_MIAMI_DAY
const GIVE_MIAMI_DAY: Record<number, string> = {
  2023: "2023-11-16",
  2024: "2024-11-21",
  2025: "2025-11-20",
  2026: "2026-11-19",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** A real calendar day written YYYY-MM-DD. */
export const isIsoDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && iso(d) === value;
};

/** The date words a question may use, resolved against the as-of day (fiscal year = calendar year). */
export const calendarFor = (asOf: string) => {
  const day = new Date(`${asOf}T00:00:00Z`);
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth(); // 0-11
  const q = Math.floor(month / 3) + 1;
  const qStart = utc(year, 3 * (q - 1), 1);
  const qEnd = utc(year, 3 * q, 0);
  const lqStart = utc(year, 3 * (q - 2), 1);
  const lqEnd = utc(year, 3 * (q - 1), 0);
  return {
    today: asOf,
    this_quarter: {
      label: `Q${q} ${year}`,
      start: iso(qStart),
      end: iso(qEnd),
    },
    last_quarter: { start: iso(lqStart), end: iso(lqEnd) },
    this_month: {
      start: iso(utc(year, month, 1)),
      end: iso(utc(year, month + 1, 0)),
    },
    this_year: { start: `${year}-01-01`, end: `${year}-12-31` },
    november_push: {
      start: `${year}-11-01`,
      end: `${year}-11-30`,
      give_miami_day: GIVE_MIAMI_DAY[year] ?? null,
    },
  };
};

// Keep in step with INSTRUCTIONS in service/ask_agent.py
const INSTRUCTIONS = `You turn a nonprofit staff member's question about their donors into a filter for a donor database.
You never see donor records and you never name donors, amounts or counts: plain code runs your filter.
Return one AskPlan:
- interpretation: one short sentence saying how you read the question, with the exact dates you used
  (e.g. "Donors who gave between Oct 1 and Nov 8, 2026, biggest quarter total first.").
- filter: only the fields the question asks for; set everything else to null. Dates are YYYY-MM-DD.
  "this quarter", "Q4", "last month", "the November push" etc. resolve with the calendar below; a range that
  runs into the future ends today. "Gone quiet", "stopped giving", "lapsing" → overdue=true.
  "Called / contacted / reached out" → not_contacted_since (there is no call log). "Big" or "major" → tier ["big"].
  "Monthly", "quarterly" → cadence. Thank-you questions sort by period_total.
- intent: thank_you when they gave, re_engage when they went quiet, check_in otherwise. channel_hint only if
  the question names email or text.
If the question is not about donors or can't be expressed with these fields, say so in interpretation and
return an empty filter (every field null).`;

export const instructionsFor = (asOf: string) =>
  `${INSTRUCTIONS}\n\nCalendar (fiscal year = calendar year):\n${JSON.stringify(calendarFor(asOf), null, 1)}`;

/* ---------- Checking the model's answer ---------- */

const DATE_FIELDS = [
  "last_gift_before",
  "last_gift_after",
  "not_contacted_since",
] as const;

/**
 * Parse and sanity-check what the model returned. A malformed date is a
 * model error (Python raises and retries); limit is clamped like apply_filter.
 */
export const checkPlan = (raw: unknown): AskPlan | null => {
  const parsed = AskPlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const plan = parsed.data;
  const f = plan.filter;
  for (const key of DATE_FIELDS) {
    if (f[key] != null && !isIsoDay(f[key])) return null;
  }
  if (f.gave_between) {
    const { start, end } = f.gave_between;
    if ((start != null && !isIsoDay(start)) || (end != null && !isIsoDay(end)))
      return null;
    if (start == null && end == null) f.gave_between = null;
  }
  if (f.limit != null) f.limit = Math.max(1, Math.min(f.limit, 100));
  // An empty list means "no constraint" in apply_filter; say so plainly.
  if (f.status?.length === 0) f.status = null;
  if (f.tier?.length === 0) f.tier = null;
  if (f.channel?.length === 0) f.channel = null;
  plan.interpretation = plan.interpretation.trim().slice(0, 400);
  return plan;
};

/* ---------- Guards ---------- */

export const QUESTION_MIN = 3;
export const QUESTION_MAX = 300;
const BODY_MAX_BYTES = 2048;
export const MODEL_TIMEOUT_MS = 15_000;
export const MAX_OUTPUT_TOKENS = 1200;

export const PRODUCTION_HOST = "devday-donor-desk.vercel.app";
// Vercel preview hosts for this project: devday-donor-desk-<hash>-<team>.vercel.app,
// devday-donor-desk-git-<branch>-<team>.vercel.app
const PREVIEW_HOST = /^devday-donor-desk-[a-z0-9-]+\.vercel\.app$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Same-origin check. Browsers send Origin on every POST; a request without
 * one (curl, a server) is refused too. This keeps other websites from using
 * the endpoint; the rate limits below are what bound a determined caller.
 */
export const isAllowedOrigin = (
  origin: string | null,
  host: string | null,
): boolean => {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (LOCAL_HOST.test(url.host))
    return url.protocol === "http:" || url.protocol === "https:";
  if (url.protocol !== "https:") return false;
  return (
    url.host === PRODUCTION_HOST ||
    PREVIEW_HOST.test(url.host) ||
    (!!host && url.host === host.toLowerCase())
  );
};

/** Sliding window: at most `max` hits per key in `windowMs`. In-memory, per function instance. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  constructor(max: number, windowMs: number, maxKeys = 5000) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** null = allowed (and counted); otherwise seconds until the next slot. */
  take(key: string, now: number): number | null {
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    return null;
  }
}

/** Earlier model answers by normalized question + as-of day. Bounded, oldest out first. */
export class AnswerCache {
  private map = new Map<string, { plan: AskPlan; traceId: string | null }>();
  private readonly maxEntries: number;
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: { plan: AskPlan; traceId: string | null }) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

// Same as providers/local/ask.ts normalizeQuestion and service/routes_ask.py normalized
export const normalizeQuestion = (question: string) =>
  question.trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");

/* ---------- The handler ---------- */

export type PlanRunner = (args: {
  question: string;
  asOf: string;
  model: string | undefined;
  instructions: string;
  signal: AbortSignal;
}) => Promise<{ output: unknown; traceId: string | null }>;

export interface AskDeps {
  env: Record<string, string | undefined>;
  runPlan: PlanRunner;
  now?: () => number;
  perIp?: RateLimiter;
  global?: RateLimiter;
  cache?: AnswerCache;
  timeoutMs?: number;
  log?: (message: string) => void;
}

export interface AskSuccess {
  question: string;
  interpretation: string;
  filter: AskPlan["filter"];
  intent: AskPlan["intent"];
  served_from: "model" | "cache";
  trace_id: string | null;
  as_of: string;
}

export type AskErrorCode =
  | "method_not_allowed"
  | "forbidden_origin"
  | "unsupported_media_type"
  | "bad_request"
  | "not_configured"
  | "rate_limited"
  | "timeout"
  | "model_error";

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

const fail = (
  status: number,
  error: AskErrorCode,
  headers?: Record<string, string>,
) => json(status, { error }, headers);

const clientIp = (request: Request) =>
  request.headers.get("x-real-ip") ??
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown";

const todayUtc = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Read the body as JSON with a size cap. */
const readBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > BODY_MAX_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * POST {question, as_of} → {interpretation, filter, intent, served_from, trace_id}.
 * Never logs the key or the question text, only its length.
 */
export const handleAsk = async (
  request: Request,
  deps: AskDeps,
): Promise<Response> => {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});

  if (request.method !== "POST")
    return fail(405, "method_not_allowed", { allow: "POST" });
  if (
    !isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"))
  )
    return fail(403, "forbidden_origin");
  if (
    !(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json")
  )
    return fail(415, "unsupported_media_type");

  const body = await readBody(request);
  if (!body || typeof body !== "object") return fail(400, "bad_request");
  const { question: rawQuestion, as_of: rawAsOf } = body as Record<
    string,
    unknown
  >;
  if (typeof rawQuestion !== "string") return fail(400, "bad_request");
  const question = rawQuestion.trim().replace(/\s+/g, " ");
  if (question.length < QUESTION_MIN || question.length > QUESTION_MAX)
    return fail(400, "bad_request");
  if (rawAsOf != null && !isIsoDay(rawAsOf)) return fail(400, "bad_request");
  const asOf = (rawAsOf as string | null | undefined) ?? todayUtc(now());

  const apiKey = deps.env.OPENAI_API_KEY;
  if (!apiKey) return fail(503, "not_configured");

  const key = `${asOf}|${normalizeQuestion(question)}`;
  const cached = deps.cache?.get(key);
  if (cached) {
    const answer: AskSuccess = {
      question,
      interpretation: cached.plan.interpretation,
      filter: cached.plan.filter,
      intent: cached.plan.intent,
      served_from: "cache",
      trace_id: cached.traceId,
      as_of: asOf,
    };
    return json(200, answer);
  }

  const retryIp = deps.perIp?.take(clientIp(request), now());
  if (retryIp != null)
    return fail(429, "rate_limited", { "retry-after": String(retryIp) });
  const retryAll = deps.global?.take("*", now());
  if (retryAll != null)
    return fail(429, "rate_limited", { "retry-after": String(retryAll) });

  const model =
    deps.env.OPENAI_MODEL_FAST || deps.env.OPENAI_MODEL_DEFAULT || undefined;
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? MODEL_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      deps.runPlan({
        question,
        asOf,
        model,
        instructions: instructionsFor(asOf),
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (result === "timeout") {
      log(
        `ask: timeout after ${timeoutMs} ms (question length ${question.length})`,
      );
      return fail(504, "timeout");
    }
    const plan = checkPlan(result.output);
    if (!plan) {
      log(
        `ask: model output failed the schema (question length ${question.length})`,
      );
      return fail(502, "model_error");
    }
    deps.cache?.set(key, { plan, traceId: result.traceId });
    const answer: AskSuccess = {
      question,
      interpretation: plan.interpretation,
      filter: plan.filter,
      intent: plan.intent,
      served_from: "model",
      trace_id: result.traceId,
      as_of: asOf,
    };
    return json(200, answer);
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    log(`ask: model error ${name} (question length ${question.length})`);
    return fail(502, "model_error");
  } finally {
    clearTimeout(timer);
  }
};
