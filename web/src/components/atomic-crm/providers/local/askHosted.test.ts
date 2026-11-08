import snapshotJson from "../../../../../public/snapshot.json";
import type { ApiSnapshot } from "./apiTypes";
import {
  EMPTY_FILTER,
  EXAMPLE_QUESTIONS,
  applyAskFilter,
  type ApiSnapshotWithAsk,
  type AskFilter,
} from "./ask";
import { ASK_API_URL, HOSTED_MESSAGES, askHosted } from "./askHosted";

const snapshot = () =>
  structuredClone(snapshotJson) as unknown as ApiSnapshotWithAsk;

const overdueFilter: AskFilter = {
  ...EMPTY_FILTER,
  overdue: true,
  tier: ["mid", "big"],
  sort: "score",
};

const reply = (status: number, body: unknown) =>
  vi.fn(
    async (..._args: Parameters<typeof fetch>) =>
      new Response(JSON.stringify(body), { status }),
  );

describe("askHosted: snapshot mode with /api/ask", () => {
  it("answers examples from the cache without calling the API", async () => {
    const fetchImpl = reply(200, {});
    const answer = await askHosted(
      snapshot(),
      EXAMPLE_QUESTIONS[1],
      null,
      null,
      fetchImpl,
    );
    expect(answer.served_from).toBe("cache");
    expect(answer.understood).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-runs an edited filter locally without calling the API", async () => {
    const fetchImpl = reply(200, {});
    const answer = await askHosted(
      snapshot(),
      "anything",
      overdueFilter,
      null,
      fetchImpl,
    );
    expect(answer.served_from).toBe("edited");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends only the question and as-of day, then filters the snapshot itself", async () => {
    const snap = snapshot();
    const fetchImpl = reply(200, {
      interpretation:
        "Mid and big donors who have gone quiet, highest priority first.",
      filter: { overdue: true, tier: ["mid", "big"], sort: "score" },
      intent: { kind: "re_engage", channel_hint: null },
      served_from: "model",
      trace_id: "trace_123",
    });
    const answer = await askHosted(
      snap,
      "Which larger donors went silent?",
      null,
      null,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ASK_API_URL);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      question: "Which larger donors went silent?",
      as_of: snap.meta.as_of,
    });

    const expected = applyAskFilter(snap as ApiSnapshot, overdueFilter).map(
      (m) => m.row.id,
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(answer).toMatchObject({
      understood: true,
      served_from: "model",
      trace_id: "trace_123",
      donor_ids: expected,
      intent: { kind: "re_engage", channel_hint: null },
      filter: overdueFilter,
    });
    expect(answer.donors.map((d) => d.id)).toEqual(expected);
  });

  it.each([
    [503, { error: "not_configured" }, HOSTED_MESSAGES.notConfigured],
    [429, { error: "rate_limited" }, HOSTED_MESSAGES.rateLimited],
    [502, { error: "model_error" }, HOSTED_MESSAGES.unavailable],
    [200, { nope: true }, HOSTED_MESSAGES.unavailable],
  ])(
    "falls back on HTTP %s with a clear message",
    async (status, body, message) => {
      const answer = await askHosted(
        snapshot(),
        "Who gave on Give Miami Day 2024?",
        null,
        null,
        reply(status, body),
      );
      expect(answer.understood).toBe(false);
      expect(answer.donors).toEqual([]);
      expect(answer.interpretation).toBe(message);
    },
  );

  it("falls back when the network fails, and skips the API for too-long questions", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const answer = await askHosted(
      snapshot(),
      "Who gave?",
      null,
      null,
      offline,
    );
    expect(answer.interpretation).toBe(HOSTED_MESSAGES.unavailable);

    const fetchImpl = reply(200, {});
    const long = await askHosted(
      snapshot(),
      "x".repeat(301),
      null,
      null,
      fetchImpl,
    );
    expect(long.interpretation).toBe(HOSTED_MESSAGES.length);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
