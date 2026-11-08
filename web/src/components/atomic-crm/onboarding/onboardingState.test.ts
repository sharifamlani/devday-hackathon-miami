import {
  LAST_STEP,
  ONBOARDING_STORAGE_KEY,
  initialOnboarding,
  normalizeSocialUrl,
  normalizeUrl,
  onboardingReducer,
  onboardingStore,
  parseAmount,
  parseStored,
  quarterEnd,
  readOnboardingParam,
  shouldAutoShow,
  validateGoal,
  validateLinks,
  EMPTY_LINKS,
  type OnboardingData,
} from "./onboardingState";

const NOW = "2026-11-07T20:00:00.000Z";
const reduce = (
  state: OnboardingData,
  ...actions: Parameters<typeof onboardingReducer>[1][]
) => actions.reduce((s, a) => onboardingReducer(s, a, () => NOW), state);

describe("onboardingReducer", () => {
  it("starts at Welcome and walks forward and back within the five steps", () => {
    let state = reduce(initialOnboarding(), { type: "start" });
    expect(state).toMatchObject({
      status: "in_progress",
      step: 0,
      updatedAt: NOW,
    });
    state = reduce(state, { type: "back" });
    expect(state.step).toBe(0); // never below Welcome
    state = reduce(
      state,
      { type: "next" },
      { type: "next" },
      { type: "next" },
      { type: "next" },
      { type: "next" },
    );
    expect(state.step).toBe(LAST_STEP); // never past the tour
    state = reduce(state, { type: "back" });
    expect(state.step).toBe(LAST_STEP - 1);
    expect(reduce(state, { type: "goTo", step: 99 }).step).toBe(LAST_STEP);
    expect(reduce(state, { type: "goTo", step: -3 }).step).toBe(0);
  });

  it("Finish later pauses and keeps progress and answers", () => {
    const state = reduce(
      initialOnboarding(),
      { type: "start" },
      { type: "update", patch: { orgName: "Bayside Youth Fund" } },
      { type: "next" },
      { type: "finishLater" },
    );
    expect(state).toMatchObject({
      status: "paused",
      step: 1,
      orgName: "Bayside Youth Fund",
    });
  });

  it("finish completes; reopening and leaving again keeps it completed", () => {
    let state = reduce(
      initialOnboarding(),
      { type: "start" },
      { type: "finish" },
    );
    expect(state).toMatchObject({ status: "completed", completedAt: NOW });
    state = reduce(state, { type: "start" });
    expect(state.status).toBe("in_progress");
    state = reduce(state, { type: "finishLater" });
    expect(state.status).toBe("completed");
  });

  it("restart keeps what was typed; reset forgets everything", () => {
    const typed = reduce(
      initialOnboarding(),
      { type: "update", patch: { personName: "Dana Sample" } },
      { type: "goTo", step: 3 },
      { type: "finish" },
    );
    expect(reduce(typed, { type: "start" })).toMatchObject({
      step: 0,
      personName: "Dana Sample",
    });
    expect(reduce(typed, { type: "reset" })).toEqual(initialOnboarding());
  });
});

describe("parseStored", () => {
  it("round-trips saved progress", () => {
    const state = reduce(
      initialOnboarding(),
      { type: "goTo", step: 2 },
      {
        type: "update",
        patch: {
          links: { ...EMPTY_LINKS, website: "https://example.org/" },
          goal: { amount: 5000, endDate: "2026-12-31" },
        },
      },
    );
    expect(parseStored(JSON.stringify(state))).toEqual(state);
  });

  it("starts fresh on missing, broken or other-version data", () => {
    expect(parseStored(null)).toEqual(initialOnboarding());
    expect(parseStored("{not json")).toEqual(initialOnboarding());
    expect(
      parseStored(JSON.stringify({ version: 0, status: "completed" })),
    ).toEqual(initialOnboarding());
    expect(parseStored("null")).toEqual(initialOnboarding());
  });

  it("repairs bad fields instead of trusting them", () => {
    const parsed = parseStored(
      JSON.stringify({
        version: 1,
        status: "weird",
        step: 42,
        links: { x: "@a" },
      }),
    );
    expect(parsed.status).toBe("new");
    expect(parsed.step).toBe(LAST_STEP);
    expect(parsed.links).toEqual({ ...EMPTY_LINKS, x: "@a" });
  });
});

describe("onboardingStore persistence", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    onboardingStore.forget();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("writes every change under the versioned key and reads it back after a reload", () => {
    onboardingStore.dispatch({ type: "start" }, true);
    onboardingStore.dispatch({ type: "next" });
    expect(onboardingStore.get().open).toBe(true);
    expect(JSON.parse(storage.get(ONBOARDING_STORAGE_KEY)!)).toMatchObject({
      version: 1,
      step: 1,
    });

    onboardingStore.forget(); // a page reload
    expect(onboardingStore.get()).toMatchObject({
      open: false,
      data: { status: "in_progress", step: 1 },
    });
  });

  it("notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = onboardingStore.subscribe(listener);
    onboardingStore.dispatch({ type: "finishLater" }, false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe("when the flow opens", () => {
  it("reads ?onboarding from the query string or the hash route", () => {
    expect(readOnboardingParam("?onboarding=1", "#/")).toBe("force");
    expect(readOnboardingParam("", "#/?onboarding=1")).toBe("force");
    expect(readOnboardingParam("", "#/?onboarding=0")).toBe("suppress");
    expect(readOnboardingParam("?onboarding=0", "#/?onboarding=1")).toBe(
      "force",
    ); // the route's own wins
    expect(readOnboardingParam("?x=1", "#/contacts")).toBeNull();
  });

  it("auto-shows on the homepage for a new or interrupted user only", () => {
    const fresh = { status: "new" as const, completedAt: null };
    expect(shouldAutoShow(fresh, "/", null)).toBe(true);
    expect(shouldAutoShow(fresh, "/contacts", null)).toBe(false);
    expect(
      shouldAutoShow({ status: "in_progress", completedAt: null }, "/", null),
    ).toBe(true);
    expect(
      shouldAutoShow({ status: "paused", completedAt: null }, "/", null),
    ).toBe(false);
    expect(
      shouldAutoShow({ status: "in_progress", completedAt: NOW }, "/", null),
    ).toBe(false);
    expect(
      shouldAutoShow({ status: "completed", completedAt: NOW }, "/", null),
    ).toBe(false);
  });

  it("?onboarding=1 forces it anywhere; ?onboarding=0 suppresses it", () => {
    expect(
      shouldAutoShow(
        { status: "completed", completedAt: NOW },
        "/contacts",
        "force",
      ),
    ).toBe(true);
    expect(
      shouldAutoShow({ status: "new", completedAt: null }, "/", "suppress"),
    ).toBe(false);
  });
});

describe("normalizeUrl", () => {
  it("accepts empty input: every link is optional", () => {
    expect(normalizeUrl("  ")).toEqual({ ok: true, url: "" });
  });

  it("adds https:// and keeps paths", () => {
    expect(normalizeUrl("example.org")).toEqual({
      ok: true,
      url: "https://example.org/",
    });
    expect(normalizeUrl(" http://example.org/stories ")).toEqual({
      ok: true,
      url: "http://example.org/stories",
    });
  });

  it.each([
    ["javascript:alert(1)", "https://"],
    ["ftp://example.org", "https://"],
    ["example", "web address"],
    ["https://localhost:3000", "web address"],
    ["exa mple.org", "spaces"],
    ["https://user:pass@example.org", "web address"],
    ["https://example.", "web address"],
  ])("rejects %s", (input, message) => {
    const result = normalizeUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

describe("normalizeSocialUrl", () => {
  it("turns @handles and bare handles into profile links", () => {
    expect(normalizeSocialUrl("instagram", "@baysideyouth")).toEqual({
      ok: true,
      url: "https://www.instagram.com/baysideyouth",
    });
    expect(normalizeSocialUrl("tiktok", "baysideyouth")).toEqual({
      ok: true,
      url: "https://www.tiktok.com/@baysideyouth",
    });
    expect(normalizeSocialUrl("x", "@bayside.youth")).toEqual({
      ok: true,
      url: "https://x.com/bayside.youth",
    });
    expect(normalizeSocialUrl("linkedin", "@bayside")).toEqual({
      ok: true,
      url: "https://www.linkedin.com/company/bayside",
    });
  });

  it("accepts the platform's own domains and subdomains", () => {
    expect(normalizeSocialUrl("x", "twitter.com/bayside").ok).toBe(true);
    expect(
      normalizeSocialUrl("facebook", "https://m.facebook.com/bayside").ok,
    ).toBe(true);
    expect(normalizeSocialUrl("facebook", "fb.com/bayside").ok).toBe(true);
    expect(
      normalizeSocialUrl(
        "linkedin",
        "https://www.linkedin.com/company/bayside/",
      ),
    ).toEqual({
      ok: true,
      url: "https://www.linkedin.com/company/bayside/",
    });
  });

  it("rejects another site, a look-alike domain or a bare homepage", () => {
    const wrong = normalizeSocialUrl(
      "instagram",
      "https://facebook.com/bayside",
    );
    expect(wrong).toMatchObject({ ok: false });
    if (!wrong.ok) expect(wrong.error).toContain("Instagram");
    expect(
      normalizeSocialUrl("instagram", "https://notinstagram.com/bayside").ok,
    ).toBe(false);
    expect(normalizeSocialUrl("x", "https://x.com/").ok).toBe(false);
    expect(normalizeSocialUrl("tiktok", "bayside.org").ok).toBe(false);
  });
});

describe("validateLinks", () => {
  it("normalizes good links and reports each bad one", () => {
    const { links, errors } = validateLinks({
      ...EMPTY_LINKS,
      website: "bayside.example.org",
      instagram: "@bayside",
      facebook: "https://instagram.com/bayside",
    });
    expect(links.website).toBe("https://bayside.example.org/");
    expect(links.instagram).toBe("https://www.instagram.com/bayside");
    expect(Object.keys(errors)).toEqual(["facebook"]);
  });
});

describe("quarter goal", () => {
  it("parses amounts people type", () => {
    expect(parseAmount("$150,000")).toBe(150000);
    expect(parseAmount("150k")).toBe(150000);
    expect(parseAmount("1.5M")).toBe(1500000);
    expect(parseAmount("2500.50")).toBe(2500.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("a lot")).toBeNull();
  });

  it("finds the end of the current quarter", () => {
    expect(quarterEnd(new Date(2026, 10, 7))).toBe("2026-12-31");
    expect(quarterEnd(new Date(2026, 0, 1))).toBe("2026-03-31");
    expect(quarterEnd(new Date(2026, 4, 15))).toBe("2026-06-30");
    expect(quarterEnd(new Date(2026, 8, 30))).toBe("2026-09-30");
  });

  it("validates amount and end date, both optional", () => {
    const today = new Date(2026, 10, 7);
    expect(validateGoal("", "", today)).toEqual({
      goal: { amount: null, endDate: null },
      errors: {},
    });
    expect(validateGoal("150,000", "2026-12-31", today)).toEqual({
      goal: { amount: 150000, endDate: "2026-12-31" },
      errors: {},
    });
    expect(validateGoal("lots", "2026-11-01", today).errors).toEqual({
      amount: "Enter an amount, like 150,000.",
      endDate: "Choose a date from today on.",
    });
    expect(validateGoal("5", "2026-11-07", today).errors).toEqual({}); // today is fine
  });
});
