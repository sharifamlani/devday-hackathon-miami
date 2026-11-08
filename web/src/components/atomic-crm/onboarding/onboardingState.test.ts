import {
  EMPTY_LINKS,
  LAST_STEP,
  LEGACY_STORAGE_KEY_V1,
  ONBOARDING_STORAGE_KEY,
  STEPS,
  WEBSITE_REQUIRED,
  initialOnboarding,
  loadOnboarding,
  migrateV1,
  normalizeSocialUrl,
  normalizeUrl,
  onboardingReducer,
  onboardingStore,
  parseStored,
  readOnboardingParam,
  shouldAutoShow,
  shouldOfferTour,
  validateLinks,
  type KeyValueStorage,
  type OnboardingData,
} from "./onboardingState";

const NOW = "2026-11-07T20:00:00.000Z";
const reduce = (
  state: OnboardingData,
  ...actions: Parameters<typeof onboardingReducer>[1][]
) => actions.reduce((s, a) => onboardingReducer(s, a, () => NOW), state);

const memoryStorage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return { map, storage };
};

describe("the first-run steps (plan.md §21.2.2)", () => {
  it("are files → organization → context, in that order", () => {
    expect(STEPS).toEqual(["files", "organization", "context"]);
    expect(LAST_STEP).toBe(2);
  });
});

describe("onboardingReducer", () => {
  it("walks forward and back within the three steps", () => {
    let state = reduce(initialOnboarding(), { type: "start" });
    expect(state).toMatchObject({
      status: "in_progress",
      step: 0,
      updatedAt: NOW,
    });
    state = reduce(state, { type: "back" });
    expect(state.step).toBe(0); // never below step 1
    state = reduce(state, { type: "next" }, { type: "next" }, { type: "next" });
    expect(state.step).toBe(LAST_STEP); // never past the context run
    state = reduce(state, { type: "back" });
    expect(state.step).toBe(1);
    expect(reduce(state, { type: "goTo", step: 99 }).step).toBe(LAST_STEP);
    expect(reduce(state, { type: "goTo", step: -3 }).step).toBe(0);
    expect(reduce(state, { type: "goTo", step: Number.NaN }).step).toBe(0);
  });

  it("Finish later pauses and keeps progress and answers", () => {
    const state = reduce(
      initialOnboarding(),
      { type: "start" },
      {
        type: "update",
        patch: { files: { people: 68, gifts: 113, duplicates: 6, files: 7 } },
      },
      { type: "next" },
      { type: "finishLater" },
    );
    expect(state).toMatchObject({
      status: "paused",
      step: 1,
      files: { people: 68, gifts: 113 },
    });
  });

  it("finish completes and offers the tour once", () => {
    let state = reduce(
      initialOnboarding(),
      { type: "start" },
      { type: "finish" },
    );
    expect(state).toMatchObject({
      status: "completed",
      completedAt: NOW,
      tourOffer: "pending",
    });
    // Answered once, it isn't offered again when setup is re-run.
    state = reduce(
      state,
      { type: "update", patch: { tourOffer: "dismissed" } },
      { type: "start" },
      { type: "finish" },
    );
    expect(state.tourOffer).toBe("dismissed");
  });

  it("reopening and leaving a finished setup keeps it completed", () => {
    let state = reduce(
      initialOnboarding(),
      { type: "finish" },
      { type: "start" },
    );
    expect(state.status).toBe("in_progress");
    state = reduce(state, { type: "finishLater" });
    expect(state.status).toBe("completed");
  });

  it("restart keeps what was entered; reset forgets everything", () => {
    const typed = reduce(
      initialOnboarding(),
      {
        type: "update",
        patch: { links: { ...EMPTY_LINKS, website: "https://example.org/" } },
      },
      { type: "goTo", step: 2 },
      { type: "finish" },
    );
    expect(reduce(typed, { type: "start" })).toMatchObject({
      step: 0,
      links: { website: "https://example.org/" },
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
          linksSavedTo: "live",
          files: { people: 68, gifts: 113, duplicates: 6, files: 7 },
          context: { outcome: "done", items: 14, tasks: 3 },
        },
      },
      { type: "finish" },
    );
    expect(parseStored(JSON.stringify(state))).toEqual(state);
  });

  it("starts fresh on missing, broken or other-version data", () => {
    expect(parseStored(null)).toEqual(initialOnboarding());
    expect(parseStored("{not json")).toEqual(initialOnboarding());
    expect(parseStored("null")).toEqual(initialOnboarding());
    expect(parseStored("[]")).toEqual(initialOnboarding());
    expect(
      parseStored(JSON.stringify({ version: 1, status: "completed" })),
    ).toEqual(initialOnboarding());
  });

  it("repairs bad fields instead of trusting them", () => {
    const parsed = parseStored(
      JSON.stringify({
        version: 2,
        status: "weird",
        step: 42,
        links: { x: "@a", website: 7, facebook: "https://facebook.com/a" },
        linksSavedTo: "cloud",
        files: { people: -1, gifts: "113", files: 2 },
        context: { outcome: "maybe", items: 3 },
        tourOffer: "always",
        completedAt: 5,
      }),
    );
    expect(parsed).toMatchObject({
      status: "new",
      step: LAST_STEP,
      links: { ...EMPTY_LINKS, x: "@a" },
      linksSavedTo: null,
      files: { people: null, gifts: null, duplicates: null, files: 2 },
      context: null,
      tourOffer: null,
      completedAt: null,
    });
    expect(parsed.links).not.toHaveProperty("facebook");
  });
});

describe("migrating v1 progress", () => {
  const v1 = (fields: Record<string, unknown>) =>
    JSON.stringify({
      version: 1,
      status: "in_progress",
      step: 3,
      personName: "Dana Sample",
      orgName: "Bayside Youth Fund",
      links: {
        website: "https://bayside.example.org/",
        instagram: "https://www.instagram.com/bayside",
        linkedin: "",
        facebook: "https://www.facebook.com/bayside",
        x: "https://x.com/bayside",
        tiktok: "https://www.tiktok.com/@bayside",
      },
      linksSavedTo: "live",
      donors: "sample",
      goal: { amount: 150000, endDate: "2026-12-31" },
      completedAt: null,
      updatedAt: NOW,
      ...fields,
    });

  it("keeps the links the service accepts and restarts at step 1", () => {
    expect(migrateV1(v1({}))).toEqual({
      ...initialOnboarding(),
      status: "in_progress",
      step: 0,
      links: {
        website: "https://bayside.example.org/",
        x: "https://x.com/bayside",
        linkedin: "",
        instagram: "https://www.instagram.com/bayside",
      },
      linksSavedTo: "live",
      updatedAt: NOW,
    });
  });

  it("someone who finished v1 stays finished and isn't offered the tour again", () => {
    expect(
      migrateV1(v1({ status: "completed", completedAt: NOW })),
    ).toMatchObject({
      status: "completed",
      completedAt: NOW,
      tourOffer: "dismissed",
    });
  });

  it("ignores anything that isn't v1", () => {
    expect(migrateV1(null)).toBeNull();
    expect(migrateV1("{broken")).toBeNull();
    expect(migrateV1(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it("loadOnboarding migrates once: writes v2 and removes v1", () => {
    const { map, storage } = memoryStorage({ [LEGACY_STORAGE_KEY_V1]: v1({}) });
    const loaded = loadOnboarding(storage);
    expect(loaded.links.website).toBe("https://bayside.example.org/");
    expect(map.has(LEGACY_STORAGE_KEY_V1)).toBe(false);
    expect(JSON.parse(map.get(ONBOARDING_STORAGE_KEY)!)).toEqual(loaded);
  });

  it("v2 wins over a leftover v1, and nothing stored means a fresh start", () => {
    const current = reduce(initialOnboarding(), { type: "finish" });
    const { map, storage } = memoryStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify(current),
      [LEGACY_STORAGE_KEY_V1]: v1({}),
    });
    expect(loadOnboarding(storage)).toEqual(current);
    expect(map.has(LEGACY_STORAGE_KEY_V1)).toBe(true); // untouched
    expect(loadOnboarding(memoryStorage().storage)).toEqual(
      initialOnboarding(),
    );
  });
});

describe("onboardingStore persistence", () => {
  // The tests run in a real browser, where `window` can't be redefined: use its own localStorage, cleared
  // around each test so nothing leaks between tests (or into other files).
  beforeEach(() => {
    window.localStorage.clear();
    onboardingStore.forget();
  });
  afterEach(() => {
    window.localStorage.clear();
    onboardingStore.forget();
  });

  it("writes every change under the versioned key and reads it back after a reload", () => {
    onboardingStore.dispatch({ type: "start" }, { open: true });
    onboardingStore.dispatch({ type: "next" });
    expect(onboardingStore.get().open).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toMatchObject({
      version: 2,
      step: 1,
    });

    onboardingStore.forget(); // a page reload
    expect(onboardingStore.get()).toMatchObject({
      open: false,
      tour: false,
      data: { status: "in_progress", step: 1 },
    });
  });

  it("a successful import is saved at once, so Finish later and a reload keep it", () => {
    const summary = { people: 68, gifts: 113, duplicates: 6, files: 7 };
    onboardingStore.dispatch({ type: "start" }, { open: true });
    onboardingStore.dispatch({ type: "update", patch: { files: summary } });
    onboardingStore.dispatch({ type: "finishLater" }, { open: false });
    onboardingStore.forget(); // a page reload
    expect(onboardingStore.get().data).toMatchObject({
      status: "paused",
      step: 0,
      files: summary,
    });
    // Reopening resumes at step 1 with the import still recorded.
    onboardingStore.dispatch({ type: "start", step: 0 }, { open: true });
    expect(onboardingStore.get().data.files).toEqual(summary);
  });

  it("starting the tour closes setup and answers the offer", () => {
    onboardingStore.dispatch({ type: "finish" }, { open: true });
    onboardingStore.setTour(true);
    expect(onboardingStore.get()).toMatchObject({
      open: false,
      tour: true,
      data: { tourOffer: "taken" },
    });
    onboardingStore.setTour(false);
    expect(onboardingStore.get().tour).toBe(false);
  });

  it("notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = onboardingStore.subscribe(listener);
    onboardingStore.dispatch({ type: "finishLater" }, { open: false });
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

  it("offers the tour on the dashboard only, until it's answered", () => {
    expect(shouldOfferTour({ tourOffer: "pending" }, "/", null)).toBe(true);
    expect(shouldOfferTour({ tourOffer: "pending" }, "/contacts", null)).toBe(
      false,
    );
    expect(shouldOfferTour({ tourOffer: "pending" }, "/", "suppress")).toBe(
      false,
    );
    expect(shouldOfferTour({ tourOffer: "taken" }, "/", null)).toBe(false);
    expect(shouldOfferTour({ tourOffer: "dismissed" }, "/", null)).toBe(false);
    expect(shouldOfferTour({ tourOffer: null }, "/", null)).toBe(false);
  });
});

describe("normalizeUrl", () => {
  it("accepts empty input (validateLinks decides what's required)", () => {
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
    expect(normalizeSocialUrl("x", "baysideyouth")).toEqual({
      ok: true,
      url: "https://x.com/baysideyouth",
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
      normalizeSocialUrl("instagram", "https://m.instagram.com/bayside").ok,
    ).toBe(true);
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
    const wrong = normalizeSocialUrl("instagram", "https://x.com/bayside");
    expect(wrong).toMatchObject({ ok: false });
    if (!wrong.ok) expect(wrong.error).toContain("Instagram");
    expect(
      normalizeSocialUrl("instagram", "https://notinstagram.com/bayside").ok,
    ).toBe(false);
    expect(normalizeSocialUrl("x", "https://x.com/").ok).toBe(false);
    expect(normalizeSocialUrl("linkedin", "bayside.org").ok).toBe(false);
  });
});

describe("validateLinks", () => {
  it("requires the website", () => {
    expect(validateLinks({ ...EMPTY_LINKS }).errors).toEqual({
      website: WEBSITE_REQUIRED,
    });
    expect(
      validateLinks({ ...EMPTY_LINKS, website: "not a site" }).errors.website,
    ).toContain("spaces");
  });

  it("normalizes good links and reports each bad one", () => {
    const { links, errors } = validateLinks({
      website: "bayside.example.org",
      instagram: "@bayside",
      x: "https://instagram.com/bayside",
      linkedin: "",
    });
    expect(links.website).toBe("https://bayside.example.org/");
    expect(links.instagram).toBe("https://www.instagram.com/bayside");
    expect(links.linkedin).toBe("");
    expect(Object.keys(errors)).toEqual(["x"]);
  });
});
