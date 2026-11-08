import type {
  AskFilter,
  AskIntent,
} from "../src/components/atomic-crm/providers/local/ask";
import {
  AnswerCache,
  RateLimiter,
  calendarFor,
  checkPlan,
  handleAsk,
  instructionsFor,
  isAllowedOrigin,
  type AskPlan,
  type PlanRunner,
} from "./_askCore";

const NULL_FILTER: AskPlan["filter"] = {
  status: null,
  tier: null,
  star: null,
  donor_type: null,
  gave_between: null,
  last_gift_before: null,
  last_gift_after: null,
  min_gift: null,
  max_gift: null,
  min_total: null,
  max_total: null,
  channel: null,
  cadence: null,
  overdue: null,
  has_draft: null,
  not_contacted_since: null,
  sort: null,
  limit: null,
};

const PLAN: AskPlan = {
  interpretation: "Donors who gave on Give Miami Day 2025 (Nov 20, 2025).",
  filter: {
    ...NULL_FILTER,
    gave_between: { start: "2025-11-20", end: "2025-11-20" },
    channel: ["Give Miami Day"],
    sort: "period_total",
  },
  intent: { kind: "thank_you", channel_hint: null },
};

// The zod output must be usable as the browser's AskFilter / AskIntent unchanged.
const _filterFits: AskFilter = PLAN.filter;
const _intentFits: AskIntent = PLAN.intent;
void _filterFits;
void _intentFits;

const ORIGIN = "https://devday-donor-desk.vercel.app";

const post = (
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
) =>
  new Request("https://devday-donor-desk.vercel.app/api/ask", {
    method,
    headers: {
      origin: ORIGIN,
      host: "devday-donor-desk.vercel.app",
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });

const ok: PlanRunner = async () => ({ output: PLAN, traceId: "trace_abc" });
const env = {
  OPENAI_API_KEY: "sk-test-not-real",
  OPENAI_MODEL_FAST: "fast-model",
};

describe("POST /api/ask guard", () => {
  it("answers a question with the model's filter, never donor rows", async () => {
    const runPlan = vi.fn(ok);
    const res = await handleAsk(
      post({
        question: "Who gave on Give Miami Day 2025?",
        as_of: "2026-11-08",
      }),
      { env, runPlan },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      question: "Who gave on Give Miami Day 2025?",
      interpretation: PLAN.interpretation,
      filter: PLAN.filter,
      intent: PLAN.intent,
      served_from: "model",
      trace_id: "trace_abc",
      as_of: "2026-11-08",
    });
    const call = runPlan.mock.calls[0][0];
    expect(call.model).toBe("fast-model");
    expect(call.asOf).toBe("2026-11-08");
    expect(call.instructions).toContain('"give_miami_day": "2026-11-19"');
    expect(call.question).toBe("Who gave on Give Miami Day 2025?");
  });

  it("falls back to OPENAI_MODEL_DEFAULT, then to the SDK default", async () => {
    const runPlan = vi.fn(ok);
    await handleAsk(post({ question: "Who gave?", as_of: "2026-11-08" }), {
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL_DEFAULT: "default-model" },
      runPlan,
    });
    await handleAsk(post({ question: "Who gave?", as_of: "2026-11-08" }), {
      env: { OPENAI_API_KEY: "k" },
      runPlan,
    });
    expect(runPlan.mock.calls.map((c) => c[0].model)).toEqual([
      "default-model",
      undefined,
    ]);
  });

  it("is 503 not_configured without a key, before any model call", async () => {
    const runPlan = vi.fn(ok);
    const res = await handleAsk(post({ question: "Who gave?" }), {
      env: {},
      runPlan,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
    expect(runPlan).not.toHaveBeenCalled();
  });

  it("accepts POST only", async () => {
    const res = await handleAsk(post(null, {}, "GET"), { env, runPlan: ok });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("refuses other origins and requests without one", async () => {
    for (const origin of [
      "https://evil.example",
      "http://devday-donor-desk.vercel.app",
    ]) {
      const res = await handleAsk(post({ question: "Who gave?" }, { origin }), {
        env,
        runPlan: ok,
      });
      expect(res.status, origin).toBe(403);
    }
    const req = post({ question: "Who gave?" });
    req.headers.delete("origin");
    expect((await handleAsk(req, { env, runPlan: ok })).status).toBe(403);
  });

  it("requires a JSON body with a 3–300 character question and a real as_of", async () => {
    const runPlan = vi.fn(ok);
    const bad = [
      { question: "hi" },
      { question: "x".repeat(301) },
      { question: 42 },
      { question: "Who gave?", as_of: "2026-02-30" },
      { question: "Who gave?", as_of: "tomorrow" },
    ];
    for (const body of bad) {
      const res = await handleAsk(post(body), { env, runPlan });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const text = await handleAsk(
      post({ question: "Who gave?" }, { "content-type": "text/plain" }),
      { env, runPlan },
    );
    expect(text.status).toBe(415);
    expect(runPlan).not.toHaveBeenCalled();
  });

  it("rate-limits per IP and serves repeat questions from the cache", async () => {
    const runPlan = vi.fn(ok);
    const perIp = new RateLimiter(2, 60_000);
    const cache = new AnswerCache();
    const deps = { env, runPlan, perIp, cache, now: () => 1_000 };
    const ask = (question: string, ip = "203.0.113.7") =>
      handleAsk(
        post({ question, as_of: "2026-11-08" }, { "x-forwarded-for": ip }),
        deps,
      );

    expect((await ask("Who gave in October?")).status).toBe(200);
    // Same question, other spacing and case: cached, no model call, no quota used.
    const again = await ask("  who GAVE in october? ");
    expect((await again.json()).served_from).toBe("cache");
    expect((await ask("Who gave in September?")).status).toBe(200);
    const limited = await ask("Who gave in August?");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another visitor still gets through.
    expect((await ask("Who gave in August?", "198.51.100.2")).status).toBe(200);
    expect(runPlan).toHaveBeenCalledTimes(3);
  });

  it("times out slow model runs and aborts them", async () => {
    let signal: AbortSignal | undefined;
    const slow: PlanRunner = (args) => {
      signal = args.signal;
      return new Promise(() => {});
    };
    const res = await handleAsk(post({ question: "Who gave?" }), {
      env,
      runPlan: slow,
      timeoutMs: 10,
    });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("is 502 when the model throws or returns a bad plan, and logs no question text", async () => {
    const log = vi.fn();
    const question = "Who are our secret major donors in Coral Gables?";
    const thrown = await handleAsk(post({ question }), {
      env,
      log,
      runPlan: async () => {
        throw new TypeError("boom");
      },
    });
    expect(thrown.status).toBe(502);
    const badDate = await handleAsk(post({ question }), {
      env,
      log,
      runPlan: async () => ({
        output: {
          ...PLAN,
          filter: { ...PLAN.filter, last_gift_before: "last week" },
        },
        traceId: null,
      }),
    });
    expect(badDate.status).toBe(502);
    expect(await badDate.json()).toEqual({ error: "model_error" });
    for (const [message] of log.mock.calls) {
      expect(message).not.toContain("Coral Gables");
      expect(message).not.toContain("sk-");
    }
  });
});

describe("isAllowedOrigin", () => {
  it.each([
    ["https://devday-donor-desk.vercel.app", null, true],
    ["https://devday-donor-desk-git-feat-ask-sharif.vercel.app", null, true],
    ["https://devday-donor-desk-abc123-team.vercel.app", null, true],
    ["http://localhost:5174", null, true],
    ["http://127.0.0.1:4173", null, true],
    ["https://donors.example.org", "donors.example.org", true],
    ["https://other-project.vercel.app", null, false],
    ["https://devday-donor-desk.vercel.app.evil.example", null, false],
    ["null", null, false],
  ])("%s (host %s) → %s", (origin, host, expected) => {
    expect(isAllowedOrigin(origin, host)).toBe(expected);
  });
});

describe("calendar + plan checks", () => {
  it("resolves quarters, months and Give Miami Day like service/ask_agent.py", () => {
    expect(calendarFor("2026-11-08")).toEqual({
      today: "2026-11-08",
      this_quarter: {
        label: "Q4 2026",
        start: "2026-10-01",
        end: "2026-12-31",
      },
      last_quarter: { start: "2026-07-01", end: "2026-09-30" },
      this_month: { start: "2026-11-01", end: "2026-11-30" },
      this_year: { start: "2026-01-01", end: "2026-12-31" },
      november_push: {
        start: "2026-11-01",
        end: "2026-11-30",
        give_miami_day: "2026-11-19",
      },
    });
    const q1 = calendarFor("2027-02-15");
    expect(q1.last_quarter).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(q1.this_month.end).toBe("2027-02-28");
    expect(q1.november_push.give_miami_day).toBeNull();
    expect(instructionsFor("2026-11-08")).toContain("never see donor records");
  });

  it("clamps limit, drops empty lists and an empty range", () => {
    const plan = checkPlan({
      ...PLAN,
      filter: {
        ...NULL_FILTER,
        limit: 500,
        tier: [],
        gave_between: { start: null, end: null },
      },
    });
    expect(plan?.filter.limit).toBe(100);
    expect(plan?.filter.tier).toBeNull();
    expect(plan?.filter.gave_between).toBeNull();
    expect(checkPlan({ interpretation: "x" })).toBeNull();
    expect(
      checkPlan({ ...PLAN, intent: { kind: "sell", channel_hint: null } }),
    ).toBeNull();
  });
});
