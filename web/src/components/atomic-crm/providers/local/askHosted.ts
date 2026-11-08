/**
 * Ask Donor Desk on the hosted snapshot site: free text goes to POST /api/ask
 * (web/api/ask.ts), which returns only a filter. The donors still come from
 * this snapshot via applyAskFilter, so the model never sees a donor row.
 *
 * Example questions and chip edits stay in the browser (no API call, no spend).
 */
import {
  EMPTY_FILTER,
  applyAskFilter,
  askSnapshot,
  snapshotAnswer,
  type ApiSnapshotWithAsk,
  type AskAnswer,
  type AskFilter,
  type AskIntent,
} from "./ask";

export const ASK_API_URL = "/api/ask";

/**
 * Once /api/ask says it isn't configured (503), later free-text questions skip the request and go straight
 * to the friendly fallback, so a deployment without a key logs one console error, not one per question.
 * Remembered for the browser session; VITE_ASK_API=off skips the API from the first question.
 */
const UNCONFIGURED_KEY = "donordesk.askApi.unconfigured";
let unconfigured = import.meta.env.VITE_ASK_API === "off" || readUnconfigured();

function readUnconfigured(): boolean {
  try {
    return window.sessionStorage.getItem(UNCONFIGURED_KEY) === "1";
  } catch {
    return false;
  }
}

const rememberUnconfigured = () => {
  unconfigured = true;
  try {
    window.sessionStorage.setItem(UNCONFIGURED_KEY, "1");
  } catch {
    /* private mode: remembered for this page load */
  }
};

/** For tests: forget a cached 503. */
export const resetHostedAsk = () => {
  unconfigured = import.meta.env.VITE_ASK_API === "off";
  try {
    window.sessionStorage.removeItem(UNCONFIGURED_KEY);
  } catch {
    /* nothing stored */
  }
};

export const HOSTED_MESSAGES = {
  notConfigured:
    "Live AI isn't configured on this deployment. Pick one of the example questions, then edit its filters.",
  rateLimited:
    "Too many questions, try again shortly. The example questions still answer instantly.",
  unavailable:
    "Live AI couldn't answer that just now. Try again, or pick one of the example questions.",
  length: "Ask in 3 to 300 characters, or pick one of the example questions.",
} as const;

/** What POST /api/ask returns on success (api/_askCore.ts AskSuccess). */
interface HostedPlan {
  interpretation: string;
  filter: Partial<AskFilter>;
  intent: AskIntent;
  served_from: "model" | "cache";
  trace_id?: string | null;
}

const isPlan = (value: unknown): value is HostedPlan => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.interpretation === "string" &&
    !!v.filter &&
    typeof v.filter === "object" &&
    !!v.intent &&
    typeof v.intent === "object"
  );
};

export const askHosted = async (
  snapshot: ApiSnapshotWithAsk,
  question: string,
  filter?: AskFilter | null,
  intent?: AskIntent | null,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<AskAnswer> => {
  const local = askSnapshot(snapshot, question, filter, intent);
  // An edited filter or a precomputed example: answered here, no API call.
  if (filter || local.understood) return local;

  const notAnswered = (message: string): AskAnswer => ({
    ...local,
    interpretation: message,
  });

  const text = question.trim();
  if (text.length < 3 || text.length > 300)
    return notAnswered(HOSTED_MESSAGES.length);
  if (unconfigured) return notAnswered(HOSTED_MESSAGES.notConfigured);

  let response: Response;
  try {
    response = await fetchImpl(ASK_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: text, as_of: snapshot.meta.as_of }),
    });
  } catch {
    return notAnswered(HOSTED_MESSAGES.unavailable);
  }
  if (response.status === 503) {
    rememberUnconfigured();
    return notAnswered(HOSTED_MESSAGES.notConfigured);
  }
  if (response.status === 429) return notAnswered(HOSTED_MESSAGES.rateLimited);
  if (!response.ok) return notAnswered(HOSTED_MESSAGES.unavailable);

  let plan: unknown;
  try {
    plan = await response.json();
  } catch {
    return notAnswered(HOSTED_MESSAGES.unavailable);
  }
  if (!isPlan(plan)) return notAnswered(HOSTED_MESSAGES.unavailable);

  const spec: AskFilter = { ...EMPTY_FILTER, ...plan.filter };
  return snapshotAnswer(
    snapshot,
    question,
    {
      interpretation: plan.interpretation,
      filter: spec,
      intent: {
        kind: plan.intent.kind,
        channel_hint: plan.intent.channel_hint ?? null,
      },
      served_from: plan.served_from === "cache" ? "cache" : "model",
      trace_id: plan.trace_id ?? null,
      detail:
        "The AI read only your question into these filters; the donors come from this sample's records.",
    },
    applyAskFilter(snapshot, spec, snapshot.meta.as_of),
  );
};
