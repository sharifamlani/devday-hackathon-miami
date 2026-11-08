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
 * are also saved by the service through POST /context/run in step 3, even when
 * the read times out; a slow read then finishes in the background
 * (POST /context/refresh), tracked here as `background`.
 */

export const ONBOARDING_STORAGE_KEY = "donordesk.onboarding.v3";
export const ONBOARDING_VERSION = 3;
/** v2 (PR #99): same steps, no tab counts or background read. Migrated once, then removed. */
export const LEGACY_STORAGE_KEY_V2 = "donordesk.onboarding.v2";
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

/** The three CRM tabs POST /ingest sorts people into (by_tab). */
export const TABS = ["giver", "neighbor", "community"] as const;
export type TabId = (typeof TABS)[number];
export const TAB_NAMES: Record<TabId, string> = {
  giver: "Givers",
  neighbor: "Neighbors",
  community: "Community",
};
export type TabCounts = Record<TabId, number>;

/** What step 1 brought in, for the receipt when someone comes back. */
export interface FilesSummary {
  people: number | null;
  gifts: number | null;
  /** Declined charges the importer kept on record; they are not gifts and not in `gifts`. */
  declined?: number | null;
  duplicates: number | null;
  files: number;
  /** People per tab, when the service reports it. */
  byTab: TabCounts | null;
  /** People the importer flagged to double-check. */
  review: number | null;
}

/**
 * How step 3 ended. done: the website was read · background: the read was
 * slow and goes on in the background · saved: v2's "showed saved context" ·
 * failed: nothing was read · preview: the read-only public preview refused the read.
 */
export type ContextOutcome =
  | "done"
  | "background"
  | "saved"
  | "failed"
  | "preview";
export interface ContextSummary {
  outcome: ContextOutcome;
  items: number;
  tasks: number | null;
}

/** A slow website read that goes on after setup (POST /context/refresh). */
export interface BackgroundRead {
  status: "running" | "done" | "failed";
  /** The service's started_at, to tell this job from an older one. */
  startedAt: string | null;
  finishedAt: string | null;
  /** New facts it saved, and a few of them to show. */
  facts: number | null;
  titles: string[];
  /** Plain words for a failure. */
  detail: string | null;
  /** The status line was closed (polling goes on while running). */
  hidden: boolean;
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
  background: BackgroundRead | null;
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
  background: null,
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
    "links" | "linksSavedTo" | "files" | "context" | "background" | "tourOffer"
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

/** {giver, neighbor, community} counts; anything else (or nothing) is null. */
export const readTabCounts = (value: unknown): TabCounts | null => {
  if (!isObject(value)) return null;
  const counts = TABS.map((tab) => count(value[tab]));
  if (counts.every((n) => n === null)) return null;
  return {
    giver: counts[0] ?? 0,
    neighbor: counts[1] ?? 0,
    community: counts[2] ?? 0,
  };
};

const readFiles = (value: unknown): FilesSummary | null =>
  isObject(value)
    ? {
        people: count(value.people),
        gifts: count(value.gifts),
        ...(count(value.declined) != null ? { declined: count(value.declined) } : {}),
        duplicates: count(value.duplicates),
        files: count(value.files) ?? 0,
        byTab: readTabCounts(value.byTab),
        review: count(value.review),
      }
    : null;

const OUTCOMES: readonly ContextOutcome[] = [
  "done",
  "background",
  "saved",
  "preview",
  "failed",
];

const readContext = (value: unknown): ContextSummary | null =>
  isObject(value) && OUTCOMES.includes(value.outcome as ContextOutcome)
    ? {
        outcome: value.outcome as ContextOutcome,
        items: count(value.items) ?? 0,
        tasks: count(value.tasks),
      }
    : null;

const BACKGROUND_STATUSES: readonly BackgroundRead["status"][] = [
  "running",
  "done",
  "failed",
];

const readBackground = (value: unknown): BackgroundRead | null =>
  isObject(value) &&
  BACKGROUND_STATUSES.includes(value.status as BackgroundRead["status"])
    ? {
        status: value.status as BackgroundRead["status"],
        startedAt: readStamp(value.startedAt),
        finishedAt: readStamp(value.finishedAt),
        facts: count(value.facts),
        titles: Array.isArray(value.titles)
          ? value.titles
              .filter((t): t is string => typeof t === "string")
              .slice(0, 3)
          : [],
        detail: typeof value.detail === "string" ? value.detail : null,
        hidden: value.hidden === true,
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

/** v2 and v3 share these fields; v3 adds byTab/review and background. */
const readData = (value: Record<string, unknown>): OnboardingData => {
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
    background: readBackground(value.background),
    tourOffer,
    completedAt: readStamp(value.completedAt),
    updatedAt: readStamp(value.updatedAt),
  };
};

const parseVersion = (raw: string | null, version: number) => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isObject(value) && value.version === version
      ? readData(value)
      : null;
  } catch {
    return null;
  }
};

/** Anything unreadable or from another version starts fresh; bad fields are repaired. */
export const parseStored = (raw: string | null): OnboardingData =>
  parseVersion(raw, ONBOARDING_VERSION) ?? initialOnboarding();

/**
 * v2 progress → v3. The steps are the same, so progress, links, the import
 * summary (without tab counts) and the tour answer all carry over.
 */
export const migrateV2 = (raw: string | null): OnboardingData | null =>
  parseVersion(raw, 2);

/**
 * v1 progress → v3. The steps changed, so everyone resumes at step 1; the
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

/** Reads v3; else migrates v2, else v1 (then writes v3 and removes the old key). */
export const loadOnboarding = (storage: KeyValueStorage): OnboardingData => {
  const current = storage.getItem(ONBOARDING_STORAGE_KEY);
  if (current) return parseStored(current);
  for (const [key, migrate] of [
    [LEGACY_STORAGE_KEY_V2, migrateV2],
    [LEGACY_STORAGE_KEY_V1, migrateV1],
  ] as const) {
    const migrated = migrate(storage.getItem(key));
    if (!migrated) continue;
    try {
      storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(migrated));
      storage.removeItem(key);
    } catch {
      // Storage full or blocked: use the migrated copy in memory.
    }
    return migrated;
  }
  return initialOnboarding();
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

/**
 * Adopt (mark setup done, no overlay) only when THIS browser never started setup and the service already
 * has people: a fresh browser on a filled service (#128). A setup in progress here resumes at its saved step
 * instead, so reloading between steps 1 and 3 never skips the website and context steps.
 */
export const shouldAdopt = (
  state: Pick<OnboardingData, "status" | "completedAt">,
  hasPeople: boolean,
): boolean => hasPeople && state.status === "new" && !state.completedAt;

/** The "Take a quick tour" card: on the dashboard, once setup is done, until answered. */
export const shouldOfferTour = (
  state: Pick<OnboardingData, "tourOffer">,
  pathname: string,
  param: OnboardingParam,
): boolean =>
  state.tourOffer === "pending" && isHome(pathname) && param !== "suppress";

/** The background-read status line: after setup, until it's closed. */
export const shouldShowBackground = (
  state: Pick<OnboardingData, "background" | "completedAt">,
  param: OnboardingParam,
): boolean =>
  !!state.background &&
  !state.background.hidden &&
  !!state.completedAt &&
  param !== "suppress";

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

/* ---------- The fields as typed (grey prefixes) ---------- */

/** The grey text before each field: the field holds only what follows it. */
export const FIELD_PREFIX: Record<keyof OrgLinks, string> = {
  website: "https://",
  x: "x.com/",
  linkedin: "linkedin.com/",
  instagram: "instagram.com/",
};

const PROFILE_HOST: Record<SocialPlatform, string> = {
  x: "x.com",
  linkedin: "www.linkedin.com",
  instagram: "www.instagram.com",
};

/**
 * The website field's value keeps a scheme only when it isn't the default:
 * "https://…" is stored bare (the prefix already says https://), "http://…"
 * stays "http://…" so an HTTP-only site is read over HTTP.
 */
export const websiteFieldValue = (input: string) => {
  const value = input.trimStart();
  if (/^https:\/\//i.test(value)) return value.slice("https://".length);
  if (/^http:\/\//i.test(value))
    return `http://${value.slice("http://".length)}`;
  return value;
};

/** What the user typed after the prefix, keeping the field's current scheme unless they typed one. */
export const websiteFieldChange = (current: string, typed: string) => {
  if (/^https?:\/\//i.test(typed.trimStart()) || !typed)
    return websiteFieldValue(typed);
  return current.startsWith("http://") ? `http://${typed}` : typed;
};

/** The grey prefix before the website field: the scheme it will use. */
export const websitePrefix = (field: string) =>
  field.startsWith("http://") ? "http://" : "https://";

/** The text inside the website input, after its prefix. */
export const websiteInputText = (field: string) =>
  field.startsWith("http://") ? field.slice("http://".length) : field;

/** A saved URL as the field holds it: "https://yourorg.org/" → "yourorg.org", "http://x.org/" → "http://x.org". */
export const websiteFromSaved = (url: string) =>
  websiteFieldValue(url).replace(/^((?:http:\/\/)?[^/]+)\/$/, "$1");

const looksLikeUrl = (value: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[^\s/@]+\.[^\s/@]+\//.test(value);

/**
 * What follows the prefix for a social link: a pasted profile link on that
 * platform becomes its path ("company/yourorg"), "@yourorg" becomes
 * "yourorg". Anything else is left as typed, for validation to explain.
 */
export const socialFieldValue = (platform: SocialPlatform, input: string) => {
  const value = input.trim();
  if (!value) return "";
  if (looksLikeUrl(value)) {
    try {
      const url = new URL(/:\/\//.test(value) ? value : `https://${value}`);
      if (hostMatches(url.hostname.toLowerCase(), SOCIAL_HOSTS[platform]))
        return `${url.pathname.replace(/^\/+/, "")}${url.search}`.replace(
          /\/$/,
          "",
        );
    } catch {
      return value;
    }
    return value;
  }
  return value.replace(/^@/, "");
};

/**
 * The profile link for what's in a social field. A bare LinkedIn name is a
 * company page; a full link (any site) is passed through so validation can
 * say when it's the wrong platform.
 */
export const socialUrlFromField = (platform: SocialPlatform, field: string) => {
  const value = field.trim();
  if (!value) return "";
  if (looksLikeUrl(value)) return value;
  const path = value.replace(/^@/, "").replace(/^\/+/, "");
  if (!path) return "";
  const full =
    platform === "linkedin" && !path.includes("/") ? `company/${path}` : path;
  return `https://${PROFILE_HOST[platform]}/${full}`;
};

/** The fields as shown, from saved links. */
export const fieldsFromLinks = (links: OrgLinks): OrgLinks => ({
  website: websiteFromSaved(links.website),
  x: links.x ? socialFieldValue("x", links.x) : "",
  linkedin: links.linkedin ? socialFieldValue("linkedin", links.linkedin) : "",
  instagram: links.instagram
    ? socialFieldValue("instagram", links.instagram)
    : "",
});

const withScheme = (value: string) =>
  !value || /:\/\//.test(value) ? value : `https://${value}`;

/** The links to validate, from the fields as typed. */
export const linksFromFields = (fields: OrgLinks): OrgLinks => ({
  website: withScheme(fields.website.trim()),
  x: socialUrlFromField("x", fields.x),
  linkedin: socialUrlFromField("linkedin", fields.linkedin),
  instagram: socialUrlFromField("instagram", fields.instagram),
});

/** One field checked on its own (on blur): an error, or null. Empty is not an error here. */
export const checkField = (key: keyof OrgLinks, field: string) => {
  const links = linksFromFields({ ...EMPTY_LINKS, [key]: field });
  if (!links[key]) return null;
  const check =
    key === "website"
      ? normalizeUrl(links.website)
      : normalizeSocialUrl(key, links[key]);
  return check.ok ? null : check.error;
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
