import snapshotJson from "../../../../../public/snapshot.json";
import { askSnapshot, chipAnswer, type ApiSnapshotWithAsk } from "./ask";

const snapshot = () =>
  structuredClone(snapshotJson) as unknown as ApiSnapshotWithAsk;
const suggestions = () =>
  (snapshotJson as unknown as { home_summary?: { suggestions?: string[] } })
    .home_summary?.suggestions ?? [];

describe("home suggestion chips on the snapshot build", () => {
  it("answers every chip the snapshot offers, with real people", () => {
    expect(suggestions().length).toBeGreaterThan(0);
    for (const chip of suggestions()) {
      const answer = askSnapshot(snapshot(), chip);
      expect(answer.understood, chip).toBe(true);
      expect(answer.donors.length, chip).toBeGreaterThan(0);
      expect(answer.served_from).toBe("cache");
    }
  });

  it("late on a usual gift = the home's late and failed gift alerts", () => {
    const snap = snapshot();
    const alerts = (
      snap as unknown as { people_attention: { id: number; badge: string }[] }
    ).people_attention
      .filter((p) => ["late", "failed", "card_failed"].includes(p.badge))
      .map((p) => p.id);
    const answer = askSnapshot(snap, "Who’s late on a usual gift?"); // curly apostrophe still matches
    expect(answer.donor_ids).toEqual(
      alerts.filter((id, i) => alerts.indexOf(id) === i),
    );
  });

  it("an Enrich chip for someone not in the snapshot is not invented", () => {
    const snap = snapshot();
    expect(chipAnswer(snap, "Enrich Nobody Here", new Map())).toBeNull();
  });

  it("free text still gets the friendly can't-answer reply", () => {
    const answer = askSnapshot(snapshot(), "what's the weather in Miami");
    expect(answer.understood).toBe(false);
    expect(answer.donors).toEqual([]);
  });
});
