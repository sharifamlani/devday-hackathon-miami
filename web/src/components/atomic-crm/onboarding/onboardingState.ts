import { useCallback, useSyncExternalStore } from "react";

/**
 * Guided onboarding: persisted progress and the pure rules behind it.
 *
 * Everything the person enters is kept in this browser (localStorage, one
 * versioned key). The flow also saves what the API accepts (website, X,
 * LinkedIn, Instagram via POST /context/run in live mode); Facebook, TikTok,
 * the names and the quarter goal have no API field yet, so they live here.
 */

export const ONBOARDING_STORAGE_KEY = "donordesk.onboarding.v1";
export const ONBOARDING_VERSION = 1;

export const STEPS = ["welcome", "online", "donors", "goal", "tour"] as const;
export type StepId = (typeof STEPS)[number];
export const STEP_COUNT = STEPS.length;
export const LAST_STEP = STEP_COUNT - 1;

/** new: never opened · in_progress: open or interrupted · paused: "Finish later" · completed */
export type OnboardingStatus = "new" | "in_progress" | "paused" | "completed";

export const SOCIAL_PLATFORMS = [
  "instagram",
  "linkedin",
  "facebook",
  "x",
  "tiktok",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  x: "X",
  tiktok: "TikTok",
};

export interface OnlineLinks {
  website: string;
  instagram: string;
  linkedin: string;
  facebook: string;
  x: string;
  tiktok: string;
}

export interface QuarterGoal {
  amount: number | null;
  endDate: string | null; // YYYY-MM-DD
}

export interface OnboardingData {
  version: typeof ONBOARDING_VERSION;
  status: OnboardingStatus;
  step: number; // 0-based index into STEPS
  personName: string;
  orgName: string;
  links: OnlineLinks;
  /** "live" once POST /context/run accepted the links; "local" otherwise. */
  linksSavedTo: "live" | "local" | null;
  donors: "upload" | "sample" | null;
  goal: QuarterGoal;
  completedAt: string | null;
  updatedAt: string | null;
}

export const EMPTY_LINKS: OnlineLinks = {
  website: "",
  instagram: "",
  linkedin: "",
  facebook: "",
  x: "",
  tiktok: "",
};

export const initialOnboarding = (): OnboardingData => ({
  version: ONBOARDING_VERSION,
  status: "new",
  step: 0,
  personName: "",
  orgName: "",
  links: { ...EMPTY_LINKS },
  linksSavedTo: null,
  donors: null,
  goal: { amount: null, endDate: null },
  completedAt: null,
  updatedAt: null,
});

/* ---------- Pure state machine ---------- */

export const clampStep = (step: number) =>
  Number.isFinite(step)
    ? Math.min(LAST_STEP, Math.max(0, Math.trunc(step)))
    : 0;

export type OnboardingAction =
  | { type: "start"; step?: number }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: number }
  | {
      type: "update";
      patch: Partial<Omit<OnboardingData, "version" | "status" | "step">>;
    }
  | { type: "finishLater" }
  | { type: "finish" }
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
  switch (action.type) {
    case "start":
      // Restarting keeps what was typed, so every field comes back prefilled.
      return stamp({
        ...state,
        status: "in_progress",
        step: clampStep(action.step ?? 0),
      });
    case "next":
      return stamp({
        ...state,
        status: "in_progress",
        step: clampStep(state.step + 1),
      });
    case "back":
      return stamp({
        ...state,
        status: "in_progress",
        step: clampStep(state.step - 1),
      });
    case "goTo":
      return stamp({
        ...state,
        status: "in_progress",
        step: clampStep(action.step),
      });
    case "update":
      return stamp({ ...state, ...action.patch });
    case "finishLater":
      // A flow finished once stays finished when it was only reopened.
      return stamp({
        ...state,
        status: state.completedAt ? "completed" : "paused",
      });
    case "finish":
      return stamp({ ...state, status: "completed", completedAt: now() });
    case "reset":
      return initialOnboarding();
  }
};

/** Anything unreadable or from another version starts fresh. */
export const parseStored = (raw: string | null): OnboardingData => {
  if (!raw) return initialOnboarding();
  try {
    const value = JSON.parse(raw) as Partial<OnboardingData> | null;
    if (
      !value ||
      typeof value !== "object" ||
      value.version !== ONBOARDING_VERSION
    ) {
      return initialOnboarding();
    }
    const base = initialOnboarding();
    const status: OnboardingStatus = (
      ["new", "in_progress", "paused", "completed"] as const
    ).includes(value.status as OnboardingStatus)
      ? (value.status as OnboardingStatus)
      : "new";
    return {
      ...base,
      ...value,
      version: ONBOARDING_VERSION,
      status,
      step: clampStep(Number(value.step)),
      links: { ...EMPTY_LINKS, ...(value.links ?? {}) },
      goal: { ...base.goal, ...(value.goal ?? {}) },
    };
  } catch {
    return initialOnboarding();
  }
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

/** Auto-open only on the homepage, for someone who never started (or left mid-flow). */
export const shouldAutoShow = (
  state: Pick<OnboardingData, "status" | "completedAt">,
  pathname: string,
  param: OnboardingParam,
): boolean => {
  if (param === "suppress") return false;
  if (param === "force") return true;
  if (pathname !== "/" && pathname !== "") return false;
  if (state.completedAt) return false;
  return state.status === "new" || state.status === "in_progress";
};

/* ---------- URL validation ---------- */

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

const SOCIAL_HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com"],
  linkedin: ["linkedin.com"],
  facebook: ["facebook.com", "fb.com"],
  x: ["x.com", "twitter.com"],
  tiktok: ["tiktok.com"],
};

/** Where a bare @handle points on each platform. */
const HANDLE_URL: Record<SocialPlatform, (handle: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}`,
  linkedin: (h) => `https://www.linkedin.com/company/${h}`,
  facebook: (h) => `https://www.facebook.com/${h}`,
  x: (h) => `https://x.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
};

const hostMatches = (host: string, domains: string[]) =>
  domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * A public web address: adds https:// when missing, requires http(s), a host
 * with a dot (or localhost is refused) and no spaces. Empty input is "ok" with
 * an empty url: every link is optional.
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

export type LinkErrors = Partial<Record<keyof OnlineLinks, string>>;

/** Validates every field; `links` comes back normalized when there are no errors. */
export const validateLinks = (
  links: OnlineLinks,
): { links: OnlineLinks; errors: LinkErrors } => {
  const errors: LinkErrors = {};
  const next: OnlineLinks = { ...links };
  const website = normalizeUrl(links.website);
  if (website.ok) next.website = website.url;
  else errors.website = website.error;
  for (const platform of SOCIAL_PLATFORMS) {
    const check = normalizeSocialUrl(platform, links[platform]);
    if (check.ok) next[platform] = check.url;
    else errors[platform] = check.error;
  }
  return { links: next, errors };
};

/* ---------- Quarter goal ---------- */

/** "$150,000", "150k", "150000.50" → number; null when it isn't a positive amount. */
export const parseAmount = (input: string): number | null => {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[$,\s]/g, "");
  const match = /^(\d+(?:\.\d{1,2})?)(k|m)?$/.exec(value);
  if (!match) return null;
  const amount =
    Number(match[1]) *
    (match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1);
  return amount > 0 && Number.isFinite(amount)
    ? Math.round(amount * 100) / 100
    : null;
};

const pad = (n: number) => String(n).padStart(2, "0");
export const toIsoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The last day of the calendar quarter `today` falls in, as YYYY-MM-DD. */
export const quarterEnd = (today: Date): string => {
  const lastMonth = Math.floor(today.getMonth() / 3) * 3 + 2;
  return toIsoDate(new Date(today.getFullYear(), lastMonth + 1, 0));
};

export const validateGoal = (
  amountInput: string,
  endDate: string,
  today: Date,
): { goal: QuarterGoal; errors: { amount?: string; endDate?: string } } => {
  const errors: { amount?: string; endDate?: string } = {};
  const amount = amountInput.trim() ? parseAmount(amountInput) : null;
  if (amountInput.trim() && amount == null)
    errors.amount = "Enter an amount, like 150,000.";
  let end: string | null = null;
  if (endDate) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
      !Number.isNaN(Date.parse(`${endDate}T00:00:00`));
    if (!valid) errors.endDate = "Choose an end date.";
    else if (endDate < toIsoDate(today))
      errors.endDate = "Choose a date from today on.";
    else end = endDate;
  }
  return { goal: { amount, endDate: end }, errors };
};

/* ---------- Store + hook ---------- */

type Listener = () => void;

const readStorage = (): OnboardingData => {
  try {
    return parseStored(window.localStorage.getItem(ONBOARDING_STORAGE_KEY));
  } catch {
    return initialOnboarding();
  }
};

interface Snapshot {
  data: OnboardingData;
  open: boolean; // the flow is on screen (this tab only, not persisted)
}

let snapshot: Snapshot | null = null;
const listeners = new Set<Listener>();

const getSnapshot = (): Snapshot => {
  if (!snapshot) snapshot = { data: readStorage(), open: false };
  return snapshot;
};

const emit = () => listeners.forEach((l) => l());

const setSnapshot = (next: Snapshot) => {
  snapshot = next;
  try {
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify(next.data),
    );
  } catch {
    // Private mode or full storage: keep going in memory.
  }
  emit();
};

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ONBOARDING_STORAGE_KEY) return;
    snapshot = { data: parseStored(event.newValue), open: getSnapshot().open };
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

const dispatch = (action: OnboardingAction, open?: boolean) => {
  const current = getSnapshot();
  setSnapshot({
    data: onboardingReducer(current.data, action),
    open: open ?? current.open,
  });
};

/** The same store without React, for tests and non-component callers. */
export const onboardingStore = {
  get: () => getSnapshot(),
  dispatch,
  subscribe,
  /** Forget the in-memory copy so the next read comes from storage. */
  forget: () => {
    snapshot = null;
  },
};

const serverSnapshot: Snapshot = { data: initialOnboarding(), open: false };

export const useOnboarding = () => {
  const { data, open } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => serverSnapshot,
  );
  return {
    data,
    open,
    status: data.status,
    completed: data.status === "completed",
    step: data.step,
    stepId: STEPS[data.step] as StepId,
    /** Opens the flow at `step` (default: Welcome), keeping anything typed before. */
    start: useCallback(
      (step?: number) => dispatch({ type: "start", step }, true),
      [],
    ),
    next: useCallback(() => dispatch({ type: "next" }), []),
    back: useCallback(() => dispatch({ type: "back" }), []),
    goTo: useCallback((step: number) => dispatch({ type: "goTo", step }), []),
    update: useCallback(
      (patch: Extract<OnboardingAction, { type: "update" }>["patch"]) =>
        dispatch({ type: "update", patch }),
      [],
    ),
    /** Esc or "Finish later": close and keep progress. */
    finishLater: useCallback(
      () => dispatch({ type: "finishLater" }, false),
      [],
    ),
    finish: useCallback(() => dispatch({ type: "finish" }, false), []),
    /** Forget everything; the flow shows again on the next homepage visit. */
    reset: useCallback(() => dispatch({ type: "reset" }, false), []),
  };
};

/** The quarter goal set during onboarding, for the homepage gauge (null when unset). */
export const useOnboardingQuarterGoal = (): QuarterGoal | null => {
  const { data } = useOnboarding();
  return data.goal.amount != null || data.goal.endDate ? data.goal : null;
};
