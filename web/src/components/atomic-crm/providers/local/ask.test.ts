import snapshotJson from "../../../../../public/snapshot.json";
import { campaignHref, filterChips, withoutChip } from "../../ask/askChips";
import type { ApiSnapshot } from "./apiTypes";
import {
  EMPTY_FILTER,
  EXAMPLE_QUESTIONS,
  applyAskFilter,
  askSnapshot,
  type ApiSnapshotWithAsk,
} from "./ask";

const snapshot = () =>
  structuredClone(snapshotJson) as unknown as ApiSnapshotWithAsk;

describe("Ask Donor Desk in snapshot mode", () => {
  it("has a precomputed answer for every example question", () => {
    const examples = snapshot().ask_examples ?? [];
    expect(examples.map((e) => e.question)).toEqual([...EXAMPLE_QUESTIONS]);
  });

  it("re-runs each example's filter to the same donors Python exported", () => {
    const snap = snapshot();
    for (const example of snap.ask_examples ?? []) {
      const ids = applyAskFilter(snap as ApiSnapshot, {
        ...EMPTY_FILTER,
        ...example.filter,
      }).map((m) => m.row.id);
      expect(ids, example.question).toEqual(example.donor_ids);
    }
  });

  it("answers an example from the cache, case- and space-insensitively", () => {
    const answer = askSnapshot(
      snapshot(),
      "  who needs outreach because they’ve gone QUIET? ",
    );
    expect(answer.served_from).toBe("cache");
    expect(answer.understood).toBe(true);
    expect(answer.donors.map((d) => d.id)).toEqual(answer.donor_ids);
    expect(answer.intent?.kind).toBe("re_engage");
  });

  it("says live AI is needed for free text", () => {
    const answer = askSnapshot(snapshot(), "Who gave on Give Miami Day 2024?");
    expect(answer.understood).toBe(false);
    expect(answer.donors).toEqual([]);
    expect(answer.interpretation).toMatch(/Live AI runs on the demo laptop/);
  });

  it("re-applies an edited filter in the browser", () => {
    const snap = snapshot();
    const thanks = askSnapshot(snap, EXAMPLE_QUESTIONS[0]);
    expect(thanks.donors[0].ask?.period_gifts).toBeGreaterThan(0);
    const edited = withoutChip(thanks.filter, "gave_between");
    const all = askSnapshot(snap, EXAMPLE_QUESTIONS[0], edited, thanks.intent);
    expect(all.served_from).toBe("edited");
    expect(all.donors.length).toBe(snap.donors.length);
    expect(all.intent).toEqual(thanks.intent);
  });

  it("labels chips and builds the campaign hand-off link", () => {
    const thanks = askSnapshot(snapshot(), EXAMPLE_QUESTIONS[0]);
    expect(filterChips(thanks.filter).map((c) => c.label)).toEqual([
      "Gave Oct 1, 2026 – Nov 8, 2026",
    ]);
    const big = askSnapshot(snapshot(), EXAMPLE_QUESTIONS[3]);
    expect(filterChips(big.filter).map((c) => c.key)).toEqual([
      "tier",
      "not_contacted_since",
    ]);
    expect(
      campaignHref([9, 3], { kind: "thank_you", channel_hint: "email" }),
    ).toBe("/campaigns/new?donors=9,3&intent=thank_you&channel=email");
    expect(campaignHref([1], { kind: "re_engage", channel_hint: null })).toBe(
      "/campaigns/new?donors=1&intent=re_engage",
    );
  });
});
