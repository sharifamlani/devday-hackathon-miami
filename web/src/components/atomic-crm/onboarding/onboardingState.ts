import { useCallback, useSyncExternalStore } from "react";

/**
 * First run (plan.md §21.2.2): persisted progress and the pure rules behind it.
 *
 * 1. Drag in your files → POST /ingest (people + gifts)
 * 2. Tell us about your organization → website (required), X, LinkedIn, Instagram
 * 3. The context agent runs on its own → POST /context/run, then /tasks/generate
 * → the dashboard, with an optional "Take a quick tour" offer.
 *
 * Progress lives in this browser (localStorage, one versioned key). The links
 * are also saved by the service through POST /context/run in step 3.
 */

export const ONBOARDING_STORAGE_KEY = "donordesk.onboarding.v2";
export const ONBOARDING_VERSION = 2;
/** v1 (PR #84): welcome → online → donors → goal → tour. Migrated once, then removed. */
export const LEGACY_STORAGE_KEY_V1 = "donordesk.onboarding.v1";

export const STEPS = ["files", "organization", "context"] as const;
export type StepId = (typeof STEPS)[number];
export const STEP_COUNT = STEPS.length;
export const LAST_STEP = STEP_COUNT - 1;

/** new: never opened · in_progress: open or interrupted · paused: "Finish later" · completed */
export type OnboardingStatus = "new" | "in_progress" | "paused" | "completed";
const STATUSES: readonly OnboardingStatus[] = [
  "new",
  "in_progress",
  "paused",
  "completed",
];

/** Only the links POST /context/run accepts. */
export const SOCIAL_PLATFORMS = ["x", "linkedin", "instagram"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
};

export interface OrgLinks {
  website: string;
  x: string;
  linkedin: string;
  instagram: string;
}

export const EMPTY_LINKS: OrgLinks = {
  website: "",
  x: "",
  linkedin: "",
  instagram: "",
};

/** What step 1 brought in, for the summary line when someone comes back. */
export interface FilesSummary {
  people: number | null;
  gifts: number | null;
  duplicates: number | null;
  files: number;
}

/** How step 3 ended. */
export interface ContextSummary {
  outcome: "done" | "saved" | "failed";
  items: number;
  tasks: number | null;
}

/** The optional tour offered on the dashboard after setup. */
export type TourOffer = "pending" | "taken" | "dismissed" | null;

export interface OnboardingData {
  version: typeof ONBOARDING_VERSION;
  status: OnboardingStatus;
  step: number; // 0-based index into STEPS
  links: OrgLinks;
  /** "live" once POST /context/run saved the links; "local" otherwise. */
  linksSavedTo: "live" | "local" | null;
  files: FilesSummary | null;
  context: ContextSummary | null;
  tourOffer: TourOffer;
  completedAt: string | null;
  updatedAt: string | null;
}

export const initialOnboarding = (): OnboardingData => ({
  version: ONBOARDING_VERSION,
  status: "new",
  step: 0,
  links: { ...EMPTY_LINKS },
  linksSavedTo: null,
  files: null,
  context: null,
  tourOffer: null,
  completedAt: null,
  updatedAt: null,
});

/* ---------- Pure state machine ---------- */

export const clampStep = (step: number) =>
  Number.isFinite(step)
    ? Math.min(LAST_STEP, Math.max(0, Math.trunc(step)))
    : 0;

export type OnboardingPatch = Partial<
  Pick<
    OnboardingData,
    "links" | "linksSavedTo" | "files" | "context" | "tourOffer"
  >
>;

export type OnboardingAction =
  | { type: "start"; step?: number }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: number }
  | { type: "update"; patch: OnboardingPatch }
  | { type: "finishLater" }
  | { type: "finish" }
  | { type: "adopt" }
  | { type: "reset" };

export const onboardingReducer = (
  state: OnboardingData,
  action: OnboardingAction,
  now: () => string = () => new Date().toISOString(),
): OnboardingData => {
  const stamp = (next: Omit<OnboardingData, "updatedAt">): OnboardingData => ({
    ...next,
    updatedAt: now(),
  });
  const at = (step: number) =>
    stamp({ ...state, status: "in_progress", step: clampStep(step) });
  switch (action.type) {
    case "start":
      // Reopening keeps what was entered, so every field comes back prefilled.
      return at(action.step ?? 0);
    case "next":
      return at(state.step + 1);
    case "back":
      return at(state.step - 1);
    case "goTo":
      return at(action.step);
    case "update":
      return stamp({ ...state, ...action.patch });
    case "finishLater":
      // A flow finished once stays finished when it was only reopened.
      return stamp({
        ...state,
        status: state.completedAt ? "completed" : "paused",
      });
    case "finish":
      // The tour is offered once, the first time setup ends.
      return stamp({
        ...state,
        status: "completed",
        completedAt: now(),
        tourOffer: state.tourOffer ?? "pending",
      });
    case "adopt":
      // The service already has people (set up in another browser): done, no tour card on someone else's stage.
      return stamp({
        ...state,
        status: "completed",
        completedAt: state.completedAt ?? now(),
        tourOffer: state.tourOffer ?? "dismissed",
      });
    case "reset":
      return initialOnboarding();
  }
};

/* ---------- Reading what's stored ---------- */

const text = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const readLinks = (value: unknown): OrgLinks => {
  const raw = isObject(value) ? value : {};
  return {
    website: text(raw.website),
    x: text(raw.x),
    linkedin: text(raw.linkedin),
    instagram: text(raw.instagram),
  };
};

const readFiles = (value: unknown): FilesSummary | null =>
  isObject(value)
    ? {
        people: count(value.people),
        gifts: count(value.gifts),
        duplicates: count(value.duplicates),
        files: count(value.files) ?? 0,
      }
    : null;

const readContext = (value: unknown): ContextSummary | null =>
  isObject(value) &&
  (["done", "saved", "failed"] as const).includes(
    value.outcome as ContextSummary["outcome"],
  )
    ? {
        outcome: value.outcome as ContextSummary["outcome"],
        items: count(value.items) ?? 0,
        tasks: count(value.tasks),
      }
    : null;

const readStatus = (value: unknown): OnboardingStatus =>
  STATUSES.includes(value as OnboardingStatus)
    ? (value as OnboardingStatus)
    : "new";

const readSavedTo = (value: unknown): OnboardingData["linksSavedTo"] =>
  value === "live" || value === "local" ? value : null;

const readStamp = (value: unknown) =>
  typeof value === "string" && value ? value : null;

/** Anything unreadable or from another version starts fresh; bad fields are repaired. */
export const parseStored = (raw: string | null): OnboardingData => {
  if (!raw) return initialOnboarding();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || value.version !== ONBOARDING_VERSION) {
      return initialOnboarding();
    }
    const tourOffer = (["pending", "taken", "dismissed"] as const).includes(
      value.tourOffer as Exclude<TourOffer, null>,
    )
      ? (value.tourOffer as TourOffer)
      : null;
    return {
      version: ONBOARDING_VERSION,
      status: readStatus(value.status),
      step: clampStep(Number(value.step)),
      links: readLinks(value.links),
      linksSavedTo: readSavedTo(value.linksSavedTo),
      files: readFiles(value.files),
      context: readContext(value.context),
      tourOffer,
      completedAt: readStamp(value.completedAt),
      updatedAt: readStamp(value.updatedAt),
    };
  } catch {
    return initialOnboarding();
  }
};

/**
 * v1 progress → v2. The steps changed, so everyone resumes at step 1; the
 * website, X, LinkedIn and Instagram links carry over. Someone who finished
 * v1 already saw the tour, so it isn't offered again. Names, Facebook,
 * TikTok and the quarter goal are dropped (the service has no field for them).
 */
export const migrateV1 = (raw: string | null): OnboardingData | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || value.version !== 1) return null;
    const completedAt = readStamp(value.completedAt);
    const status = readStatus(value.status);
    return {
      ...initialOnboarding(),
      status: completedAt ? "completed" : status,
      links: readLinks(value.links),
      linksSavedTo: readSavedTo(value.linksSavedTo),
      tourOffer: completedAt ? "dismissed" : null,
      completedAt,
      updatedAt: readStamp(value.updatedAt),
    };
  } catch {
    return null;
  }
};

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Reads v2; falls back to migrating v1 (then writes v2 and removes v1). */
export const loadOnboarding = (storage: KeyValueStorage): OnboardingData => {
  const current = storage.getItem(ONBOARDING_STORAGE_KEY);
  if (current) return parseStored(current);
  const migrated = migrateV1(storage.getItem(LEGACY_STORAGE_KEY_V1));
  if (!migrated) return initialOnboarding();
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(migrated));
    storage.removeItem(LEGACY_STORAGE_KEY_V1);
  } catch {
    // Storage full or blocked: use the migrated copy in memory.
  }
  return migrated;
};

/* ---------- When to show it ---------- */

export type OnboardingParam = "force" | "suppress" | null;

/**
 * `?onboarding=1` forces the flow (demos), `?onboarding=0` suppresses it.
 * Read from the real query string or from the hash route's own query
 * (`#/?onboarding=1`), since the app uses a hash router.
 */
export const readOnboardingParam = (
  search: string,
  hash: string,
): OnboardingParam => {
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
  for (const query of [hashQuery, search]) {
    const value = new URLSearchParams(query).get("onboarding");
    if (value === "1" || value === "true") return "force";
    if (value === "0" || value === "false") return "suppress";
  }
  return null;
};

const isHome = (pathname: string) => pathname === "/" || pathname === "";

/** Auto-open only on the homepage, for someone who never started (or left mid-flow). */
export const shouldAutoShow = (
  state: Pick<OnboardingData, "status" | "completedAt">,
  pathname: string,
  param: OnboardingParam,
): boolean => {
  if (param === "suppress") return false;
  if (param === "force") return true;
  if (!isHome(pathname)) return false;
  if (state.completedAt) return false;
  return state.status === "new" || state.status === "in_progress";
};

/** The "Take a quick tour" card: on the dashboard, once setup is done, until answered. */
export const shouldOfferTour = (
  state: Pick<OnboardingData, "tourOffer">,
  pathname: string,
  param: OnboardingParam,
): boolean =>
  state.tourOffer === "pending" && isHome(pathname) && param !== "suppress";

/* ---------- URL validation ---------- */

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

const SOCIAL_HOSTS: Record<SocialPlatform, string[]> = {
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  instagram: ["instagram.com"],
};

/** Where a bare @handle points on each platform. */
const HANDLE_URL: Record<SocialPlatform, (handle: string) => string> = {
  x: (h) => `https://x.com/${h}`,
  linkedin: (h) => `https://www.linkedin.com/company/${h}`,
  instagram: (h) => `https://www.instagram.com/${h}`,
};

const hostMatches = (host: string, domains: string[]) =>
  domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * A public web address: adds https:// when missing, requires http(s), a host
 * with a dot (so localhost is refused) and no spaces. Empty input is "ok"
 * with an empty url; `validateLinks` decides what is required.
 */
export const normalizeUrl = (input: string): UrlCheck => {
  const value = input.trim();
  if (!value) return { ok: true, url: "" };
  if (/\s/.test(value))
    return { ok: false, error: "Remove the spaces from this address." };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return {
      ok: false,
      error: "Enter a web address, like https://yourorg.org.",
    };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Use a web address that starts with https://." };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host.includes(".") ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    parsed.username ||
    parsed.password
  ) {
    return {
      ok: false,
      error: "Enter a web address, like https://yourorg.org.",
    };
  }
  return { ok: true, url: parsed.toString() };
};

/** A profile link on that platform, or a bare @handle turned into one. */
export const normalizeSocialUrl = (
  platform: SocialPlatform,
  input: string,
): UrlCheck => {
  const value = input.trim();
  if (!value) return { ok: true, url: "" };
  // "@yourorg", or a bare "yourorg" (no dot, so it can't be a domain).
  const handle = /^@?([A-Za-z0-9._-]{2,100})$/.exec(value);
  if (handle && (value.startsWith("@") || !value.includes("."))) {
    return { ok: true, url: HANDLE_URL[platform](handle[1]) };
  }
  const check = normalizeUrl(value);
  if (!check.ok) return check;
  const url = new URL(check.url);
  if (!hostMatches(url.hostname.toLowerCase(), SOCIAL_HOSTS[platform])) {
    return {
      ok: false,
      error: `This doesn't look like a ${SOCIAL_LABELS[platform]} link. Try ${HANDLE_URL[platform]("yourorg")}.`,
    };
  }
  if (url.pathname === "/" || url.pathname === "") {
    return {
      ok: false,
      error: `Add your ${SOCIAL_LABELS[platform]} page, not just the site.`,
    };
  }
  return { ok: true, url: check.url };
};

export type LinkErrors = Partial<Record<keyof OrgLinks, string>>;

export const WEBSITE_REQUIRED =
  "Enter your website, like https://yourorg.org. The agent starts there.";

/** Website is required; the social links are optional. `links` comes back normalized. */
export const validateLinks = (
  links: OrgLinks,
): { links: OrgLinks; errors: LinkErrors } => {
  const errors: LinkErrors = {};
  const next: OrgLinks = { ...links };
  const website = normalizeUrl(links.website);
  if (!website.ok) errors.website = website.error;
  else if (!website.url) errors.website = WEBSITE_REQUIRED;
  else next.website = website.url;
  for (const platform of SOCIAL_PLATFORMS) {
    const check = normalizeSocialUrl(platform, links[platform]);
    if (check.ok) next[platform] = check.url;
    else errors[platform] = check.error;
  }
  return { links: next, errors };
};

/* ---------- Store + hook ---------- */

type Listener = () => void;

const browserStorage = (): KeyValueStorage => window.localStorage;

const readStorage = (): OnboardingData => {
  try {
    return loadOnboarding(browserStorage());
  } catch {
    return initialOnboarding();
  }
};

interface Snapshot {
  data: OnboardingData;
  open: boolean; // the setup flow is on screen (this tab only, not persisted)
  tour: boolean; // the coach-mark tour is running (this tab only)
}

let snapshot: Snapshot | null = null;
const listeners = new Set<Listener>();

const getSnapshot = (): Snapshot => {
  if (!snapshot) snapshot = { data: readStorage(), open: false, tour: false };
  return snapshot;
};

const emit = () => listeners.forEach((l) => l());

const setSnapshot = (next: Snapshot) => {
  snapshot = next;
  try {
    browserStorage().setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(next.data));
  } catch {
    // Private mode or full storage: keep going in memory.
  }
  emit();
};

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ONBOARDING_STORAGE_KEY) return;
    const current = getSnapshot();
    snapshot = { ...current, data: parseStored(event.newValue) };
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

const dispatch = (
  action: OnboardingAction,
  view: Partial<Pick<Snapshot, "open" | "tour">> = {},
) => {
  const current = getSnapshot();
  setSnapshot({
    data: onboardingReducer(current.data, action),
    open: view.open ?? current.open,
    tour: view.tour ?? current.tour,
  });
};

/** The tour only changes what's on screen, plus the offer's answer. */
const setTour = (tour: boolean) => {
  const current = getSnapshot();
  setSnapshot({
    data:
      tour && current.data.tourOffer !== "taken"
        ? onboardingReducer(current.data, {
            type: "update",
            patch: { tourOffer: "taken" },
          })
        : current.data,
    open: tour ? false : current.open,
    tour,
  });
};

/** The same store without React, for tests and non-component callers. */
export const onboardingStore = {
  get: () => getSnapshot(),
  dispatch,
  setTour,
  subscribe,
  /** Forget the in-memory copy so the next read comes from storage. */
  forget: () => {
    snapshot = null;
  },
};

const serverSnapshot: Snapshot = {
  data: initialOnboarding(),
  open: false,
  tour: false,
};

export const useOnboarding = () => {
  const { data, open, tour } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => serverSnapshot,
  );
  return {
    data,
    open,
    tour,
    status: data.status,
    completed: data.status === "completed",
    step: data.step,
    stepId: STEPS[data.step] as StepId,
    /** Opens setup at `step` (default: step 1), keeping anything entered before. */
    start: useCallback(
      (step?: number) => dispatch({ type: "start", step }, { open: true }),
      [],
    ),
    next: useCallback(() => dispatch({ type: "next" }), []),
    back: useCallback(() => dispatch({ type: "back" }), []),
    goTo: useCallback((step: number) => dispatch({ type: "goTo", step }), []),
    update: useCallback(
      (patch: OnboardingPatch) => dispatch({ type: "update", patch }),
      [],
    ),
    /** Esc or "Finish later": close and keep progress. */
    finishLater: useCallback(
      () => dispatch({ type: "finishLater" }, { open: false }),
      [],
    ),
    finish: useCallback(
      () => dispatch({ type: "finish" }, { open: false }),
      [],
    ),
    /** The live service already has people: mark setup done here too (no tour offer). */
    adopt: useCallback(() => dispatch({ type: "adopt" }, { open: false }), []),
    /** Forget everything; setup shows again on the next homepage visit. */
    reset: useCallback(
      () => dispatch({ type: "reset" }, { open: false, tour: false }),
      [],
    ),
    /** The coach-mark tour over the dashboard (closes setup if it's open). */
    startTour: useCallback(() => setTour(true), []),
    endTour: useCallback(() => setTour(false), []),
    dismissTourOffer: useCallback(
      () => dispatch({ type: "update", patch: { tourOffer: "dismissed" } }),
      [],
    ),
  };
};
